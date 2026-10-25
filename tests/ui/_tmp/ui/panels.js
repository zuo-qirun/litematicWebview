// src/ui/dom.js
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v === null || v === void 0 || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "html") el.innerHTML = v;
      else if (k === "text") el.textContent = v;
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "dataset" && typeof v === "object") Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? "" : String(v));
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === void 0 || c === false) continue;
    el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return el;
}
var fmtInt = (n) => typeof n === "number" && Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "\u2014";
function fmtSize(s) {
  if (!s) return "\u2014";
  return `${s.x ?? s[0] ?? "?"} \xD7 ${s.y ?? s[1] ?? "?"} \xD7 ${s.z ?? s[2] ?? "?"}`;
}
function rgbCss(c) {
  if (!c) return "#3a4455";
  const arr = Array.isArray(c) ? c : [c.r, c.g, c.b];
  const norm = arr.map((v) => v > 1.0001 ? v / 255 : v);
  const [r, g, b] = norm.map((v) => Math.max(0, Math.min(255, Math.round(v * 255))));
  return `rgb(${r} ${g} ${b})`;
}

// src/ui/panels.js
function clearFileCard(refs) {
  refs.fileCardBody.innerHTML = `
    <div class="filecard-empty">
      <p>\u5C1A\u672A\u6253\u5F00\u6587\u4EF6</p>
      <p class="muted">\u62D6\u5165 .litematic\uFF0C\u6216\u70B9\u51FB\u300C\u6253\u5F00\u793A\u4F8B\u300D</p>
    </div>`;
  refs.fileChipName.textContent = "\u672A\u6253\u5F00\u6587\u4EF6";
  refs.fileChipMeta.textContent = "";
  refs.fileChip.classList.remove("is-loaded");
}
var kvRow = (k, v, opts = {}) => h(
  "div",
  { class: `kv-row${opts.strong ? " is-strong" : ""}${opts.mono ? " is-mono" : ""}` },
  h("dt", { text: k }),
  h("dd", { title: typeof v === "string" ? v.replace(/<[^>]+>/g, "") : "" }, v)
);
function renderFileCard(refs, info) {
  const {
    fileName = "\u672A\u547D\u540D",
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
    parseMs = 0
  } = info;
  refs.fileChipName.textContent = fileName;
  refs.fileChipMeta.textContent = `${fmtInt(blocks)} \u65B9\u5757 \xB7 ${fmtSize(size)}${mcVersion ? " \xB7 " + mcVersion : ""}`;
  refs.fileChip.classList.add("is-loaded");
  const rows = [];
  if (author) rows.push(kvRow("\u4F5C\u8005", author));
  rows.push(kvRow("\u5C3A\u5BF8", `${fmtSize(size)} \u683C`));
  rows.push(kvRow("\u65B9\u5757\u6570", fmtInt(blocks), { strong: true }));
  rows.push(kvRow("Region", `${fmtInt(regions)} \u4E2A`));
  if (mcVersion || dataVersion) {
    rows.push(kvRow("\u6570\u636E\u7248\u672C", `${mcVersion || "\u672A\u77E5"}${dataVersion ? ` \xB7 ${dataVersion}` : ""}`));
  }
  if (parseMs) rows.push(kvRow("\u89E3\u6790 / \u6784\u5EFA", `${Math.round(parseMs)} ms / ${Math.round(buildMs)} ms`, { mono: true }));
  const wrap = h("div", { class: "filecard-body" });
  wrap.appendChild(h("div", { class: "fc-name", text: fileName, title: fileName }));
  if (description) wrap.appendChild(h("p", { class: "fc-desc", text: description }));
  const dl = h("dl", { class: "kv" }, ...rows);
  wrap.appendChild(dl);
  const badges = h("div", { class: "fc-badges" });
  if (missing > 0) {
    badges.appendChild(
      h(
        "span",
        { class: "fc-badge warn", title: "\u8FD9\u4E9B\u65B9\u5757\u72B6\u6001\u5728\u8D44\u4EA7\u56FE\u96C6\u91CC\u6CA1\u6709\u6A21\u578B\uFF0C\u5DF2\u7528\u6D0B\u7EA2\u8272\u5360\u4F4D\uFF1A" + (info.missingSample || []).join(", ") },
        `${fmtInt(missing)} \u4E2A\u65B9\u5757\u7F3A\u6A21\u578B`
      )
    );
  }
  if (fallbackAssets) {
    badges.appendChild(h("span", { class: "fc-badge", title: "assets/ \u672A\u5C31\u7EEA\uFF0C\u4F7F\u7528\u5185\u7F6E\u7A0B\u5E8F\u5316\u8D34\u56FE" }, "\u5185\u7F6E\u515C\u5E95\u8D34\u56FE"));
  }
  if (warnings.length) {
    const btn = h(
      "button",
      { class: "fc-badge warn", type: "button", title: "\u70B9\u51FB\u5C55\u5F00\u5168\u90E8\u8B66\u544A" },
      `${warnings.length} \u6761\u8B66\u544A`
    );
    const list = h(
      "ul",
      { class: "fc-warnlist", hidden: "" },
      ...warnings.slice(0, 12).map((w) => h("li", { text: String(w) }))
    );
    if (warnings.length > 12) list.appendChild(h("li", { class: "muted", text: `\u2026\u53E6\u6709 ${warnings.length - 12} \u6761` }));
    btn.addEventListener("click", () => {
      if (list.hasAttribute("hidden")) list.removeAttribute("hidden");
      else list.setAttribute("hidden", "");
    });
    badges.appendChild(btn);
    wrap.appendChild(badges);
    wrap.appendChild(list);
  } else if (badges.childElementCount) {
    wrap.appendChild(badges);
  }
  refs.fileCardBody.replaceChildren(wrap);
}
function clearRegions(refs) {
  refs.regionCount.textContent = "0";
  refs.regionList.innerHTML = '<div class="list-empty">\u6253\u5F00\u6587\u4EF6\u540E\u663E\u793A Region \u5217\u8868</div>';
}
function renderRegions(refs, regions, handlers = {}) {
  refs.regionCount.textContent = String(regions.length);
  if (!regions.length) {
    refs.regionList.innerHTML = '<div class="list-empty">\u6CA1\u6709 Region</div>';
    return;
  }
  const frag = document.createDocumentFragment();
  regions.forEach((r, i) => {
    const cb = h("input", { type: "checkbox", class: "region-check", checked: r.visible !== false });
    cb.setAttribute("aria-label", `\u663E\u793A / \u9690\u85CF ${r.name}`);
    cb.addEventListener("change", () => handlers.onToggle && handlers.onToggle(r.name, cb.checked));
    const row = h(
      "div",
      { class: "region-row", role: "listitem", tabindex: "0", title: `\u70B9\u51FB\u805A\u7126\uFF1A${r.name}` },
      cb,
      h("span", { class: "region-idx", text: String(i + 1).padStart(2, "0") }),
      h(
        "span",
        { class: "region-main" },
        h("span", { class: "region-name", text: r.name }),
        h("span", { class: "region-meta", text: `${fmtSize(r.size)} \xB7 ${fmtInt(r.volume || 0)} \u683C` })
      ),
      h("button", {
        class: "region-focus",
        type: "button",
        title: "\u805A\u7126\u5230\u6B64 Region",
        "aria-label": `\u805A\u7126\u5230 ${r.name}`,
        onclick: (e) => {
          e.stopPropagation();
          handlers.onFocus && handlers.onFocus(r.name);
        }
      }, "")
    );
    row.addEventListener("mouseenter", () => handlers.onHover && handlers.onHover(r.name));
    row.addEventListener("mouseleave", () => handlers.onHover && handlers.onHover(null));
    row.addEventListener("click", () => handlers.onFocus && handlers.onFocus(r.name));
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handlers.onFocus && handlers.onFocus(r.name);
      }
      if (e.key === " ") e.preventDefault();
    });
    if (r.hidden) row.classList.add("is-hidden");
    frag.appendChild(row);
  });
  refs.regionList.replaceChildren(frag);
}
function clearLegend(refs) {
  refs.legendCount.textContent = "0";
  refs.legendSearch.value = "";
  refs.legendList.innerHTML = '<div class="list-empty">\u6253\u5F00\u6587\u4EF6\u540E\u6309\u6570\u91CF\u6392\u5E8F\u663E\u793A</div>';
}
function swatch(entry, db) {
  const color = entry.color || (db && db.color ? db.color(entry.stateKey) : null);
  const bg = rgbCss(color);
  return h("span", {
    class: "legend-swatch",
    style: { background: `linear-gradient(160deg, ${bg}, ${bg})`, borderColor: "rgba(0,0,0,.45)" },
    "aria-hidden": "true"
  });
}
function renderLegend(refs, entries, opts = {}) {
  const { db, onSelect, filter = "" } = opts;
  const q = filter.trim().toLowerCase();
  const list = q ? entries.filter((e) => e.name && e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q) || e.stateKey.toLowerCase().includes(q)) : entries;
  refs.legendCount.textContent = q ? `${list.length}/${entries.length}` : String(entries.length);
  if (!list.length) {
    refs.legendList.innerHTML = `<div class="list-empty">${entries.length ? "\u6CA1\u6709\u5339\u914D\u7684\u65B9\u5757" : "\u6CA1\u6709\u53EF\u663E\u793A\u7684\u65B9\u5757"}</div>`;
    return;
  }
  const MAX = 260;
  const frag = document.createDocumentFragment();
  for (const e of list.slice(0, MAX)) {
    const row = h(
      "button",
      { class: "legend-row", type: "button", title: `${e.name}
${e.stateKey}
\u70B9\u51FB\uFF1A\u9AD8\u4EAE\u5E76\u805A\u7126\u8FD9\u4E9B\u65B9\u5757` },
      swatch(e, db),
      h(
        "span",
        { class: "legend-text" },
        h("span", { class: "legend-name", text: e.name }),
        h("span", { class: "legend-id", text: e.id.replace(/^minecraft:/, "") })
      ),
      h("span", { class: "legend-count", text: fmtInt(e.count) })
    );
    row.addEventListener("click", () => onSelect && onSelect(e));
    frag.appendChild(row);
  }
  if (list.length > MAX) {
    frag.appendChild(h("div", { class: "list-empty", text: `\u8FD8\u6709 ${list.length - MAX} \u79CD\u65B9\u5757\u672A\u5217\u51FA\uFF0C\u8BF7\u7528\u641C\u7D22\u7F29\u5C0F\u8303\u56F4` }));
  }
  refs.legendList.replaceChildren(frag);
}
export {
  clearFileCard,
  clearLegend,
  clearRegions,
  renderFileCard,
  renderLegend,
  renderRegions
};
