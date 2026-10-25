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
function rgbCss(c) {
  if (!c) return "#3a4455";
  const arr = Array.isArray(c) ? c : [c.r, c.g, c.b];
  const norm = arr.map((v) => v > 1.0001 ? v / 255 : v);
  const [r, g, b] = norm.map((v) => Math.max(0, Math.min(255, Math.round(v * 255))));
  return `rgb(${r} ${g} ${b})`;
}
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      return true;
    } catch (e2) {
      return false;
    }
  }
}

// src/ui/icons.js
var wrap = (body, extra = "") => `<svg class="ico" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;
var icons = {
  cube: wrap('<path d="M8 1.7 13.4 4.6v6.8L8 14.3 2.6 11.4V4.6Z"/><path d="M2.6 4.6 8 7.5l5.4-2.9"/><path d="M8 7.5v6.8"/>'),
  cubeSolid: wrap('<path d="M8 1.7 13.4 4.6v6.8L8 14.3 2.6 11.4V4.6Z" fill="currentColor" fill-opacity=".16"/><path d="M2.6 4.6 8 7.5l5.4-2.9"/><path d="M8 7.5v6.8"/>'),
  layers: wrap('<path d="M8 2.2 2.6 5 8 7.8 13.4 5Z"/><path d="M2.6 8 8 10.8 13.4 8"/><path d="M2.6 11 8 13.8 13.4 11"/>'),
  slice: wrap('<path d="M8 2.2 2.6 5 8 7.8 13.4 5Z"/><path d="M2.6 8 8 10.8 13.4 8"/><path d="M2.6 12h10.8"/>'),
  grid: wrap('<path d="M2.4 2.4h11.2v11.2H2.4Z"/><path d="M6.1 2.4v11.2M9.9 2.4v11.2M2.4 6.1h11.2M2.4 9.9h11.2"/>'),
  wire: wrap('<path d="M8 1.7 13.4 4.6v6.8L8 14.3 2.6 11.4V4.6Z"/><path d="M2.6 4.6 8 7.5l5.4-2.9M2.6 11.4 8 8.4l5.4 3M8 7.5v6.8"/>'),
  viewIso: wrap('<path d="M8 2.6 13 5.3v5.4L8 13.4 3 10.7V5.3Z"/><path d="M3 5.3 8 8l5-2.7"/>'),
  viewTop: wrap('<path d="M3 4.2 8 2.4l5 1.8-5 1.8Z"/><path d="M3 9.4 8 7.6l5 1.8-5 1.8Z"/>'),
  viewFront: wrap('<path d="M3 3.2h10v9.6H3Z"/><path d="M3 8.8h10"/>'),
  viewSide: wrap('<path d="M4.6 3.2h6.8v9.6H4.6Z"/><path d="M8 3.2v9.6"/>'),
  camera: wrap('<path d="M2.4 5.6h2.9l1-1.7h3.4l1 1.7h2.9v7.2H2.4Z"/><circle cx="8" cy="9.1" r="2.2"/>'),
  fullscreen: wrap('<path d="M6.2 2.6H2.6v3.6M9.8 2.6h3.6v3.6M6.2 13.4H2.6V9.8M9.8 13.4h3.6V9.8"/>'),
  help: wrap('<circle cx="8" cy="8" r="5.7"/><path d="M6.3 6.2a1.75 1.75 0 1 1 2.3 1.66c-.4.15-.6.5-.6.93v.3"/><path d="M8 11.6h.01"/>'),
  folder: wrap('<path d="M2.4 4.2h4l1.2 1.6h6v7H2.4Z"/>'),
  file: wrap('<path d="M4.2 2.6h5l2.6 2.6v8.2H4.2Z"/><path d="M9.2 2.6v2.6h2.6"/>'),
  search: wrap('<circle cx="7.2" cy="7.2" r="3.9"/><path d="M10.1 10.1 13.4 13.4"/>'),
  close: wrap('<path d="M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8"/>'),
  chevronDown: wrap('<path d="M4.4 6.2 8 9.8l3.6-3.6"/>'),
  chevronRight: wrap('<path d="M6.2 4.4 9.8 8l-3.6 3.6"/>'),
  chevronLeft: wrap('<path d="M9.8 4.4 6.2 8l3.6 3.6"/>'),
  reset: wrap('<path d="M3.1 7.4a4.9 4.9 0 1 1 1.5 4"/><path d="M3 3.2v3.4h3.4"/>'),
  copy: wrap('<path d="M5.6 5.6h7.8v7.8H5.6Z"/><path d="M10.4 5.6V2.6H2.6v7.8h3"/>'),
  warning: wrap('<path d="M8 2.6 14 13H2Z"/><path d="M8 6.4v3.2"/><path d="M8 11.6h.01"/>'),
  check: wrap('<path d="M3.4 8.4 6.4 11.4 12.6 4.8"/>'),
  drop: wrap('<path d="M8 2.6v6.6"/><path d="M5.2 6.8 8 9.6l2.8-2.8"/><path d="M2.6 11.4v2h10.8v-2"/>'),
  target: wrap('<circle cx="8" cy="8" r="4.6"/><circle cx="8" cy="8" r="1.2"/><path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2"/>'),
  sun: wrap('<circle cx="8" cy="8" r="2.8"/><path d="M8 1.6v1.6M8 12.8v1.6M1.6 8h1.6M12.8 8h1.6M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1"/>'),
  info: wrap('<circle cx="8" cy="8" r="5.7"/><path d="M8 7.4v4"/><path d="M8 4.9h.01"/>'),
  bolt: wrap('<path d="M8.8 1.8 4.4 8.6h3.3l-1.1 5.6 4.6-7.1H8.1Z"/>'),
  eye: wrap('<path d="M1.8 8S4.2 4.2 8 4.2 14.2 8 14.2 8 11.8 11.8 8 11.8 1.8 8 1.8 8Z"/><circle cx="8" cy="8" r="1.7"/>'),
  eyeOff: wrap('<path d="M2.6 8s2.3-3.4 5.4-3.4c.9 0 1.7.2 2.4.6"/><path d="M13.4 8s-2.3 3.4-5.4 3.4c-.9 0-1.7-.2-2.4-.6"/><path d="M2.8 13.2 13.2 2.8"/>')
};

// src/ui/inspector.js
var ITEM_ZH = {
  "minecraft:kelp": "\u6D77\u5E26",
  "minecraft:sea_pickle": "\u6D77\u6CE1\u83DC",
  "minecraft:redstone": "\u7EA2\u77F3",
  "minecraft:diamond": "\u94BB\u77F3",
  "minecraft:diamond_block": "\u94BB\u77F3\u5757",
  "minecraft:emerald_block": "\u7EFF\u5B9D\u77F3\u5757",
  "minecraft:gold_block": "\u91D1\u5757",
  "minecraft:name_tag": "\u547D\u540D\u724C",
  "minecraft:bone_meal": "\u9AA8\u7C89",
  "minecraft:poisonous_potato": "\u6BD2\u9A6C\u94C3\u85AF",
  "minecraft:cherry_planks": "\u6A31\u82B1\u6728\u677F",
  "minecraft:white_concrete": "\u767D\u8272\u6DF7\u51DD\u571F",
  "minecraft:cherry_stairs": "\u6A31\u82B1\u6728\u697C\u68AF",
  "minecraft:torch": "\u706B\u628A",
  "minecraft:oak_fence": "\u6A61\u6728\u6805\u680F"
};
function itemName(id) {
  if (ITEM_ZH[id]) return ITEM_ZH[id];
  const path = id.replace(/^[a-z_]+:/, "").replace(/_/g, " ");
  return path;
}
var shortId = (id) => id.replace(/^minecraft:/, "");
var Inspector = class {
  constructor(bodyEl, footEl) {
    this.body = bodyEl;
    this.foot = footEl;
    this.db = null;
    this.pinned = null;
    this.last = null;
    this.showEmpty();
  }
  setDb(db) {
    this.db = db;
  }
  showEmpty(reason) {
    this.last = null;
    this.body.replaceChildren(
      h(
        "div",
        { class: "insp-empty" },
        h("div", { class: "insp-empty-art", html: icons.cube }),
        h("p", { class: "insp-empty-title", text: reason || "\u628A\u9F20\u6807\u79FB\u5230\u6A21\u578B\u4E0A" }),
        h("p", { class: "insp-empty-sub", text: "\u8FD9\u91CC\u4F1A\u5B9E\u65F6\u663E\u793A\u65B9\u5757 ID\u3001\u72B6\u6001\u5C5E\u6027\u3001\u5750\u6807\u4E0E\u65B9\u5757\u5B9E\u4F53\u5185\u5BB9\u3002" }),
        h(
          "ul",
          { class: "insp-empty-tips" },
          h("li", { text: "\u60AC\u505C\uFF1A\u5B9E\u65F6\u68C0\u67E5\u65B9\u5757" }),
          h("li", { text: "\u5355\u51FB\uFF1A\u56FA\u5B9A\u5F53\u524D\u65B9\u5757" }),
          h("li", { text: "\u53CC\u51FB\uFF1A\u76F8\u673A\u805A\u7126" })
        )
      )
    );
    this._setFoot("");
  }
  _setFoot(text) {
    if (!this.foot) return;
    if (!text) {
      this.foot.replaceChildren();
      this.foot.hidden = true;
      return;
    }
    this.foot.hidden = false;
    this.foot.replaceChildren(h("span", { class: "muted", text }));
  }
  /**
   * @param {object} info describeBlock() 的结果
   * @param {{pinned?:boolean}} opts
   */
  show(info, opts = {}) {
    if (!info) {
      this.showEmpty();
      return;
    }
    this.last = info;
    const db = this.db;
    const color = db && db.color ? db.color(info.stateKey) : null;
    const hasModel = db && db.resolve ? db.resolve(info.stateKey) !== null : true;
    const be = info.blockEntity;
    const items = info.containerItems || [];
    const entities = info.entities || [];
    const parts = [];
    const head = h(
      "div",
      { class: "insp-head" },
      h("span", { class: "insp-swatch", style: { background: rgbCss(color) }, "aria-hidden": "true" }),
      h(
        "div",
        { class: "insp-title" },
        h("div", { class: "insp-name", text: info.displayName || shortId(info.id) }),
        h("div", { class: "insp-id mono", text: info.id })
      ),
      opts.pinned ? h("span", { class: "insp-pin", title: "\u5DF2\u56FA\u5B9A", html: icons.target }) : null
    );
    parts.push(head);
    if (!hasModel) {
      parts.push(h("div", { class: "insp-alert", html: `${icons.warning}<span>\u8D44\u4EA7\u5E93\u7F3A\u5C11\u8BE5\u65B9\u5757\u6A21\u578B\uFF0C\u5F53\u524D\u4EE5\u6D0B\u7EA2\u8272\u5360\u4F4D\u663E\u793A\u3002</span>` }));
    }
    const coord = h(
      "div",
      { class: "insp-coords" },
      h("span", { class: "coord" }, h("i", { text: "X" }), h("b", { text: String(info.x) })),
      h("span", { class: "coord" }, h("i", { text: "Y" }), h("b", { text: String(info.y) })),
      h("span", { class: "coord" }, h("i", { text: "Z" }), h("b", { text: String(info.z) }))
    );
    parts.push(h(
      "div",
      { class: "insp-sec" },
      h("div", { class: "insp-sec-head" }, h("h3", { text: "\u4F4D\u7F6E" })),
      coord,
      h(
        "div",
        { class: "insp-kvline" },
        h("span", { class: "k", text: "Region" }),
        h("span", { class: "v", text: info.regionName || "\u2014" })
      )
    ));
    const stateRow = h(
      "div",
      { class: "insp-state" },
      h("code", { class: "mono", text: info.stateKey }),
      h("button", {
        class: "iconbtn sm ghost",
        type: "button",
        title: "\u590D\u5236\u72B6\u6001\u5B57\u7B26\u4E32",
        "aria-label": "\u590D\u5236\u72B6\u6001\u5B57\u7B26\u4E32",
        html: icons.copy,
        onclick: async () => {
          await copyText(info.stateKey);
        }
      })
    );
    parts.push(h(
      "div",
      { class: "insp-sec" },
      h("div", { class: "insp-sec-head" }, h("h3", { text: "\u65B9\u5757\u72B6\u6001" }), h("span", { class: "muted", text: `${info.props.length} \u4E2A\u5C5E\u6027` })),
      stateRow
    ));
    if (info.props.length) {
      const table = h(
        "dl",
        { class: "prop-table" },
        ...info.props.flatMap(([k, v]) => [h("dt", { text: k }), h("dd", { text: String(v) })])
      );
      parts.push(h("div", { class: "insp-sec" }, h("div", { class: "insp-sec-head" }, h("h3", { text: "\u5C5E\u6027" })), table));
    }
    parts.push(this._blockEntitySection(be, items, info));
    if (entities.length) {
      parts.push(h(
        "div",
        { class: "insp-sec" },
        h("div", { class: "insp-sec-head" }, h("h3", { text: "\u5B9E\u4F53" }), h("span", { class: "muted", text: `${entities.length} \u4E2A` })),
        h(
          "div",
          { class: "ent-list" },
          ...entities.map((e, i) => h(
            "div",
            { class: "ent-row" },
            h("span", { class: "ent-type mono", text: (e.type || e.id || "unknown").replace(/^minecraft:/, "") }),
            h("span", { class: "muted", text: `#${i + 1}` })
          ))
        )
      ));
    }
    this.body.replaceChildren(...parts);
    this.body.scrollTop = 0;
    this._setFoot(opts.pinned ? "\u5DF2\u56FA\u5B9A \xB7 \u6309 Esc \u53D6\u6D88\u56FA\u5B9A" : "\u60AC\u505C\u5B9E\u65F6\u66F4\u65B0 \xB7 \u5355\u51FB\u56FA\u5B9A \xB7 \u53CC\u51FB\u805A\u7126");
  }
  _blockEntitySection(be, items, info) {
    if (!be) {
      return h(
        "div",
        { class: "insp-sec insp-sec-muted" },
        h("div", { class: "insp-sec-head" }, h("h3", { text: "\u65B9\u5757\u5B9E\u4F53" })),
        h("p", { class: "muted small", text: "\u8BE5\u65B9\u5757\u6CA1\u6709\u65B9\u5757\u5B9E\u4F53\u6570\u636E\u3002" })
      );
    }
    const id = String(be.id || be.Id || info.id || "unknown");
    const custom = be.CustomName ? typeof be.CustomName === "string" ? be.CustomName : JSON.stringify(be.CustomName) : "";
    const customText = (custom.match(/"text"\s*:\s*"([^"]*)"/) || [])[1] || custom;
    const sec = h(
      "div",
      { class: "insp-sec" },
      h(
        "div",
        { class: "insp-sec-head" },
        h("h3", { text: "\u65B9\u5757\u5B9E\u4F53" }),
        h("span", { class: "tag mono", text: shortId(id) })
      )
    );
    if (customText) {
      sec.appendChild(h("div", { class: "insp-kvline" }, h("span", { class: "k", text: "\u81EA\u5B9A\u4E49\u540D\u79F0" }), h("span", { class: "v be-name", text: customText })));
    }
    if (items.length) {
      const total = items.reduce((n, it) => n + (it.count || 0), 0);
      const slots = Math.max(...items.map((i) => i.slot || 0)) + 1;
      sec.appendChild(
        h(
          "div",
          { class: "inv-head" },
          h("span", { class: "inv-title", text: `\u5BB9\u5668\u5185\u5BB9 \xB7 ${fmtInt(items.length)} \u7EC4` }),
          h("span", { class: "muted small", text: `\u5171 ${fmtInt(total)} \u4E2A \xB7 \u6700\u9AD8\u69FD\u4F4D ${slots}` })
        )
      );
      const db = this.db;
      const rows = items.map((it) => {
        const c = db && db.color ? db.color(it.id) : null;
        return h(
          "div",
          { class: "item-row", title: it.id },
          h("span", { class: "item-swatch", style: { background: rgbCss(c) } }),
          h("span", { class: "item-name", text: itemName(it.id) }),
          h("span", { class: "item-id mono", text: shortId(it.id) }),
          it.count > 1 ? h("span", { class: "item-count", text: `\xD7${it.count}` }) : null,
          h("span", { class: "item-slot", text: `${it.slot}` })
        );
      });
      sec.appendChild(h("div", { class: "item-list" }, ...rows));
    } else {
      sec.appendChild(h("p", { class: "muted small", text: "\u5BB9\u5668\u4E3A\u7A7A\uFF0C\u6216\u8BE5\u65B9\u5757\u5B9E\u4F53\u6CA1\u6709\u7269\u54C1\u6570\u636E\u3002" }));
    }
    const json = safeJson(be);
    const det = h(
      "details",
      { class: "nbt" },
      h(
        "summary",
        null,
        h("span", { html: icons.chevronRight, class: "nbt-chev" }),
        h("span", { text: "\u539F\u59CB NBT" }),
        h("button", {
          class: "iconbtn sm ghost nbt-copy",
          type: "button",
          title: "\u590D\u5236 NBT",
          "aria-label": "\u590D\u5236 NBT",
          html: icons.copy,
          onclick: async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await copyText(JSON.stringify(be, nbtReplacer, 2));
          }
        })
      ),
      h("pre", { class: "nbt-json mono", text: json })
    );
    sec.appendChild(det);
    return sec;
  }
};
function nbtReplacer(_k, v) {
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Uint8Array || v instanceof Int32Array) return Array.from(v);
  return v;
}
function safeJson(obj) {
  let s = "";
  try {
    s = JSON.stringify(obj, nbtReplacer, 2);
  } catch (e) {
    s = String(obj);
  }
  if (!s) s = "{}";
  const MAX = 2e4;
  if (s.length > MAX) s = s.slice(0, MAX) + `
\u2026 \u5DF2\u622A\u65AD\uFF08\u5171 ${s.length} \u5B57\u7B26\uFF09`;
  return s;
}
export {
  Inspector
};
