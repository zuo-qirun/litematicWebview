// mcviewer —— 右侧栏：方块检查器

import { h, fmtInt, rgbCss, copyText } from "./dom.js";
import { icons } from "./icons.js";

// 常见物品的中文名（方块走 BlockDB 的 lang，物品补一张小表）
const ITEM_ZH = {
  "minecraft:kelp": "海带",
  "minecraft:sea_pickle": "海泡菜",
  "minecraft:redstone": "红石",
  "minecraft:diamond": "钻石",
  "minecraft:diamond_block": "钻石块",
  "minecraft:emerald_block": "绿宝石块",
  "minecraft:gold_block": "金块",
  "minecraft:name_tag": "命名牌",
  "minecraft:bone_meal": "骨粉",
  "minecraft:poisonous_potato": "毒马铃薯",
  "minecraft:cherry_planks": "樱花木板",
  "minecraft:white_concrete": "白色混凝土",
  "minecraft:cherry_stairs": "樱花木楼梯",
  "minecraft:torch": "火把",
  "minecraft:oak_fence": "橡木栅栏",
};

function itemName(id) {
  if (ITEM_ZH[id]) return ITEM_ZH[id];
  const path = id.replace(/^[a-z_]+:/, "").replace(/_/g, " ");
  return path;
}

const shortId = (id) => id.replace(/^minecraft:/, "");

export class Inspector {
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
      h("div", { class: "insp-empty" },
        h("div", { class: "insp-empty-art", html: icons.cube }),
        h("p", { class: "insp-empty-title", text: reason || "把鼠标移到模型上" }),
        h("p", { class: "insp-empty-sub", text: "这里会实时显示方块 ID、状态属性、坐标与方块实体内容。" }),
        h("ul", { class: "insp-empty-tips" },
          h("li", { text: "悬停：实时检查方块" }),
          h("li", { text: "单击：固定当前方块" }),
          h("li", { text: "双击：相机聚焦" })
        )
      )
    );
    this._setFoot("");
  }

  _setFoot(text) {
    if (!this.foot) return;
    if (!text) { this.foot.replaceChildren(); this.foot.hidden = true; return; }
    this.foot.hidden = false;
    this.foot.replaceChildren(h("span", { class: "muted", text }));
  }

  /**
   * @param {object} info describeBlock() 的结果
   * @param {{pinned?:boolean}} opts
   */
  show(info, opts = {}) {
    if (!info) { this.showEmpty(); return; }
    this.last = info;
    const db = this.db;
    const color = db && db.color ? db.color(info.stateKey) : null;
    const hasModel = db && db.resolve ? db.resolve(info.stateKey) !== null : true;
    const be = info.blockEntity;
    const items = info.containerItems || [];
    const entities = info.entities || [];

    const parts = [];

    // ── 头部
    const head = h("div", { class: "insp-head" },
      h("span", { class: "insp-swatch", style: { background: rgbCss(color) }, "aria-hidden": "true" }),
      h("div", { class: "insp-title" },
        h("div", { class: "insp-name", text: info.displayName || shortId(info.id) }),
        h("div", { class: "insp-id mono", text: info.id })
      ),
      opts.pinned ? h("span", { class: "insp-pin", title: "已固定", html: icons.target }) : null
    );
    parts.push(head);

    if (!hasModel) {
      parts.push(h("div", { class: "insp-alert", html: `${icons.warning}<span>资产库缺少该方块模型，当前以洋红色占位显示。</span>` }));
    }

    // ── 坐标 / Region
    const coord = h("div", { class: "insp-coords" },
      h("span", { class: "coord" }, h("i", { text: "X" }), h("b", { text: String(info.x) })),
      h("span", { class: "coord" }, h("i", { text: "Y" }), h("b", { text: String(info.y) })),
      h("span", { class: "coord" }, h("i", { text: "Z" }), h("b", { text: String(info.z) }))
    );
    parts.push(h("div", { class: "insp-sec" },
      h("div", { class: "insp-sec-head" }, h("h3", { text: "位置" })),
      coord,
      h("div", { class: "insp-kvline" },
        h("span", { class: "k", text: "Region" }),
        h("span", { class: "v", text: info.regionName || "—" })
      )
    ));

    // ── 状态字符串
    const stateRow = h("div", { class: "insp-state" },
      h("code", { class: "mono", text: info.stateKey }),
      h("button", {
        class: "iconbtn sm ghost", type: "button", title: "复制状态字符串", "aria-label": "复制状态字符串",
        html: icons.copy,
        onclick: async () => { await copyText(info.stateKey); },
      })
    );
    parts.push(h("div", { class: "insp-sec" },
      h("div", { class: "insp-sec-head" }, h("h3", { text: "方块状态" }), h("span", { class: "muted", text: `${info.props.length} 个属性` })),
      stateRow
    ));

    // ── 属性表
    if (info.props.length) {
      const table = h("dl", { class: "prop-table" },
        ...info.props.flatMap(([k, v]) => [h("dt", { text: k }), h("dd", { text: String(v) })])
      );
      parts.push(h("div", { class: "insp-sec" }, h("div", { class: "insp-sec-head" }, h("h3", { text: "属性" })), table));
    }

    // ── 方块实体
    parts.push(this._blockEntitySection(be, items, info));

    // ── 实体
    if (entities.length) {
      parts.push(h("div", { class: "insp-sec" },
        h("div", { class: "insp-sec-head" }, h("h3", { text: "实体" }), h("span", { class: "muted", text: `${entities.length} 个` })),
        h("div", { class: "ent-list" },
          ...entities.map((e, i) => h("div", { class: "ent-row" },
            h("span", { class: "ent-type mono", text: (e.type || e.id || "unknown").replace(/^minecraft:/, "") }),
            h("span", { class: "muted", text: `#${i + 1}` })
          ))
        )
      ));
    }

    this.body.replaceChildren(...parts);
    this.body.scrollTop = 0;
    this._setFoot(opts.pinned ? "已固定 · 按 Esc 取消固定" : "悬停实时更新 · 单击固定 · 双击聚焦");
  }

  _blockEntitySection(be, items, info) {
    if (!be) {
      return h("div", { class: "insp-sec insp-sec-muted" },
        h("div", { class: "insp-sec-head" }, h("h3", { text: "方块实体" })),
        h("p", { class: "muted small", text: "该方块没有方块实体数据。" })
      );
    }
    const id = String(be.id || be.Id || info.id || "unknown");
    const custom = be.CustomName
      ? typeof be.CustomName === "string"
        ? be.CustomName
        : JSON.stringify(be.CustomName)
      : "";
    const customText = (custom.match(/"text"\s*:\s*"([^"]*)"/) || [])[1] || custom;

    const sec = h("div", { class: "insp-sec" },
      h("div", { class: "insp-sec-head" },
        h("h3", { text: "方块实体" }),
        h("span", { class: "tag mono", text: shortId(id) })
      )
    );
    if (customText) {
      sec.appendChild(h("div", { class: "insp-kvline" }, h("span", { class: "k", text: "自定义名称" }), h("span", { class: "v be-name", text: customText })));
    }

    if (items.length) {
      const total = items.reduce((n, it) => n + (it.count || 0), 0);
      const slots = Math.max(...items.map((i) => i.slot || 0)) + 1;
      sec.appendChild(
        h("div", { class: "inv-head" },
          h("span", { class: "inv-title", text: `容器内容 · ${fmtInt(items.length)} 组` }),
          h("span", { class: "muted small", text: `共 ${fmtInt(total)} 个 · 最高槽位 ${slots}` })
        )
      );
      const db = this.db;
      const rows = items.map((it) => {
        const c = db && db.color ? db.color(it.id) : null;
        return h("div", { class: "item-row", title: it.id },
          h("span", { class: "item-swatch", style: { background: rgbCss(c) } }),
          h("span", { class: "item-name", text: itemName(it.id) }),
          h("span", { class: "item-id mono", text: shortId(it.id) }),
          it.count > 1 ? h("span", { class: "item-count", text: `×${it.count}` }) : null,
          h("span", { class: "item-slot", text: `${it.slot}` })
        );
      });
      sec.appendChild(h("div", { class: "item-list" }, ...rows));
    } else {
      sec.appendChild(h("p", { class: "muted small", text: "容器为空，或该方块实体没有物品数据。" }));
    }

    // 原始 NBT
    const json = safeJson(be);
    const det = h("details", { class: "nbt" },
      h("summary", null,
        h("span", { html: icons.chevronRight, class: "nbt-chev" }),
        h("span", { text: "原始 NBT" }),
        h("button", {
          class: "iconbtn sm ghost nbt-copy", type: "button", title: "复制 NBT", "aria-label": "复制 NBT",
          html: icons.copy,
          onclick: async (e) => {
            e.preventDefault(); e.stopPropagation();
            await copyText(JSON.stringify(be, nbtReplacer, 2));
          },
        })
      ),
      h("pre", { class: "nbt-json mono", text: json })
    );
    sec.appendChild(det);
    return sec;
  }
}

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
  const MAX = 20000;
  if (s.length > MAX) s = s.slice(0, MAX) + `\n… 已截断（共 ${s.length} 字符）`;
  return s;
}
