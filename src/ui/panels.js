// mcviewer —— 左侧栏：文件信息 / Region 列表 / 方块图例

import { h, fmtInt, fmtSize, rgbCss } from "./dom.js";

/* ------------------------------------------------------------------ 文件卡 */

export function clearFileCard(refs) {
  refs.fileCardBody.innerHTML = `
    <div class="filecard-empty">
      <p>尚未打开文件</p>
      <p class="muted">拖入 .litematic，或点击「打开示例」</p>
    </div>`;
  refs.fileChipName.textContent = "未打开文件";
  refs.fileChipMeta.textContent = "";
  refs.fileChip.classList.remove("is-loaded");
}

const kvRow = (k, v, opts = {}) =>
  h(
    "div",
    { class: `kv-row${opts.strong ? " is-strong" : ""}${opts.mono ? " is-mono" : ""}` },
    h("dt", { text: k }),
    h("dd", { title: typeof v === "string" ? v.replace(/<[^>]+>/g, "") : "" }, v)
  );

export function renderFileCard(refs, info) {
  const {
    fileName = "未命名",
    author = "",
    description = "",
    size = null,
    blocks = 0,
    regions = 0,
    mcVersion = "",
    dataVersion = null,
    warnings = [],
    buildMs = 0,
    missing = 0,
    fallbackAssets = false,
    parseMs = 0,
  } = info;

  refs.fileChipName.textContent = fileName;
  refs.fileChipMeta.textContent = `${fmtInt(blocks)} 方块 · ${fmtSize(size)}${mcVersion ? " · " + mcVersion : ""}`;
  refs.fileChip.classList.add("is-loaded");

  const rows = [];
  if (author) rows.push(kvRow("作者", author));
  rows.push(kvRow("尺寸", `${fmtSize(size)} 格`));
  rows.push(kvRow("方块数", fmtInt(blocks), { strong: true }));
  rows.push(kvRow("Region", `${fmtInt(regions)} 个`));
  if (mcVersion || dataVersion) {
    // mcVersion 来自 Metadata（很多文件不写），dataVersion 才是文件里真实带的数字
    const label = "MC 版本";
    const value = mcVersion
      ? `${mcVersion}${dataVersion ? ` · 数据 ${dataVersion}` : ""}`
      : dataVersion
        ? `未知（数据 ${dataVersion}）`
        : "未知";
    rows.push(kvRow(label, value));
  }
  if (parseMs) rows.push(kvRow("解析 / 构建", `${Math.round(parseMs)} ms / ${Math.round(buildMs)} ms`, { mono: true }));

  const wrap = h("div", { class: "filecard-body" });
  wrap.appendChild(h("div", { class: "fc-name", text: fileName, title: fileName }));
  if (description) wrap.appendChild(h("p", { class: "fc-desc", text: description }));
  const dl = h("dl", { class: "kv" }, ...rows);
  wrap.appendChild(dl);

  const badges = h("div", { class: "fc-badges" });
  if (missing > 0) {
    badges.appendChild(
      h("span", { class: "fc-badge warn", title: "这些方块状态在资产图集里没有模型，已用洋红色占位：" + (info.missingSample || []).join(", ") },
        `${fmtInt(missing)} 个方块缺模型`)
    );
  }
  if (fallbackAssets) {
    badges.appendChild(h("span", { class: "fc-badge", title: "assets/ 未就绪，使用内置程序化贴图" }, "内置兜底贴图"));
  }
  if (warnings.length) {
    const btn = h("button", { class: "fc-badge warn", type: "button", title: "点击展开全部警告" },
      `${warnings.length} 条警告`);
    const list = h("ul", { class: "fc-warnlist", hidden: "" },
      ...warnings.slice(0, 12).map((w) => h("li", { text: String(w) })));
    if (warnings.length > 12) list.appendChild(h("li", { class: "muted", text: `…另有 ${warnings.length - 12} 条` }));
    btn.addEventListener("click", () => { if (list.hasAttribute("hidden")) list.removeAttribute("hidden"); else list.setAttribute("hidden", ""); });
    badges.appendChild(btn);
    wrap.appendChild(badges);
    wrap.appendChild(list);
  } else if (badges.childElementCount) {
    wrap.appendChild(badges);
  }
  refs.fileCardBody.replaceChildren(wrap);
}

/* ------------------------------------------------------------------ Region */

export function clearRegions(refs) {
  refs.regionCount.textContent = "0";
  refs.regionList.innerHTML = '<div class="list-empty">打开文件后显示 Region 列表</div>';
}

export function renderRegions(refs, regions, handlers = {}) {
  refs.regionCount.textContent = String(regions.length);
  if (!regions.length) {
    refs.regionList.innerHTML = '<div class="list-empty">没有 Region</div>';
    return;
  }
  const frag = document.createDocumentFragment();
  regions.forEach((r, i) => {
    const cb = h("input", { type: "checkbox", class: "region-check", checked: r.visible !== false });
    cb.setAttribute("aria-label", `显示 / 隐藏 ${r.name}`);
    cb.addEventListener("change", () => handlers.onToggle && handlers.onToggle(r.name, cb.checked));
    const row = h(
      "div",
      { class: "region-row", role: "listitem", tabindex: "0", title: `点击聚焦：${r.name}` },
      cb,
      h("span", { class: "region-idx", text: String(i + 1).padStart(2, "0") }),
      h("span", { class: "region-main" },
        h("span", { class: "region-name", text: r.name }),
        h("span", { class: "region-meta", text: `${fmtSize(r.size)} · ${fmtInt(r.volume || 0)} 格` })
      ),
      h("button", {
        class: "region-focus", type: "button", title: "聚焦到此 Region",
        "aria-label": `聚焦到 ${r.name}`,
        onclick: (e) => { e.stopPropagation(); handlers.onFocus && handlers.onFocus(r.name); },
      }, "")
    );
    row.addEventListener("mouseenter", () => handlers.onHover && handlers.onHover(r.name));
    row.addEventListener("mouseleave", () => handlers.onHover && handlers.onHover(null));
    row.addEventListener("click", () => handlers.onFocus && handlers.onFocus(r.name));
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handlers.onFocus && handlers.onFocus(r.name); }
      if (e.key === " ") e.preventDefault();
    });
    if (r.hidden) row.classList.add("is-hidden");
    frag.appendChild(row);
  });
  refs.regionList.replaceChildren(frag);
}

/* ------------------------------------------------------------------ 图例 */

export function clearLegend(refs) {
  refs.legendCount.textContent = "0";
  refs.legendSearch.value = "";
  refs.legendList.innerHTML = '<div class="list-empty">打开文件后按数量排序显示</div>';
}

function swatch(entry, db) {
  const color = entry.color || (db && db.color ? db.color(entry.stateKey) : null);
  const bg = rgbCss(color);
  return h("span", {
    class: "legend-swatch",
    style: { background: `linear-gradient(160deg, ${bg}, ${bg})`, borderColor: "rgba(0,0,0,.45)" },
    "aria-hidden": "true",
  });
}

/**
 * @param {object} refs
 * @param {Array<{stateKey,id,name,count,color,first}>} entries
 * @param {{db:object, onSelect:Function, filter?:string}} opts
 */
export function renderLegend(refs, entries, opts = {}) {
  const { db, onSelect, filter = "" } = opts;
  const groups = groupLegend(entries);

  const q = filter.trim().toLowerCase();
  const list = q
    ? groups.filter(
        (g) =>
          (g.name && g.name.toLowerCase().includes(q)) ||
          g.id.toLowerCase().includes(q) ||
          g.states.some((s) => s.toLowerCase().includes(q))
      )
    : groups;
  refs.legendCount.textContent = q ? `${list.length}/${groups.length}` : String(groups.length);

  if (!list.length) {
    refs.legendList.innerHTML = `<div class="list-empty">${groups.length ? "没有匹配的方块" : "没有可显示的方块"}</div>`;
    return;
  }

  const MAX = 300;
  const frag = document.createDocumentFragment();
  for (const e of list.slice(0, MAX)) {
    const tip = e.variants > 1
      ? `${e.name}（合计 ${fmtInt(e.count)} 个，${e.variants} 种状态）\n点击：高亮并聚焦数量最多的状态`
      : `${e.name}（${fmtInt(e.count)} 个）\n点击：高亮并聚焦这些方块`;
    const row = h(
      "button",
      { class: "legend-row", type: "button", title: tip },
      swatch(e, db),
      h("span", { class: "legend-text" },
        h("span", { class: "legend-name", text: e.name }),
        h("span", { class: "legend-id" },
          h("span", { text: e.id.replace(/^minecraft:/, "") }),
          e.variants > 1 ? h("span", { class: "legend-var", text: `· ${e.variants} 态` }) : null
        )
      ),
      h("span", { class: "legend-count", text: fmtInt(e.count) })
    );
    row.addEventListener("click", () => onSelect && onSelect(e));
    frag.appendChild(row);
  }
  if (list.length > MAX) {
    frag.appendChild(h("div", { class: "list-empty", text: `还有 ${list.length - MAX} 种方块未列出，请用搜索缩小范围` }));
  }
  refs.legendList.replaceChildren(frag);
}

/**
 * 图例按方块 id 合并：同一 id 的不同状态（朝向/半砖/水位等）合成一行，
 * count 求和、取数量最多的那个状态作为代表（点击时高亮它）。
 * 否则大型投影里 侦测器/箱子/漏斗 这类多状态方块会各占一行、看起来像重复项。
 */
function groupLegend(entries) {
  const map = new Map();
  for (const e of entries) {
    let g = map.get(e.id);
    if (!g) {
      g = { id: e.id, name: e.name, count: 0, variants: 0, states: [], best: -1, stateKey: e.stateKey, first: e.first };
      map.set(e.id, g);
    }
    g.count += e.count;
    g.variants++;
    g.states.push(e.stateKey);
    if (e.count > g.best) {
      g.best = e.count;
      g.stateKey = e.stateKey;
      g.first = e.first;
    }
  }
  const out = [...map.values()];
  for (const g of out) delete g.best;
  out.sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  return out;
}
