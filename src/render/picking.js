// mcviewer —— 拾取（射线 → 方块语义）与悬停节流
//
// 场景层（scene.js）已经用体素栅格做了 DDA 射线遍历，拿到的是 {x,y,z,stateKey,...}；
// 这里负责把它"翻译"成 UI 需要的东西：方块 id / 属性表 / 中文名 / 方块实体 NBT / 容器物品列表，
// 另外提供 HoverPicker：把 pointermove 节流到每帧最多一次，并处理 pointerleave / 拖动中不拾取。

/** 建立 "regionName → Map<'x,y,z', blockEntity>" 索引 */
export function indexBlockEntities(schematic) {
  const out = new Map();
  for (const region of schematic?.regions || []) {
    if (!region) continue;
    const name = region.name || "region";
    const map = new Map();
    const p = region.position || { x: 0, y: 0, z: 0 };
    for (const be of region.blockEntities || []) {
      if (!be) continue;
      // 契约：blockEntities 的 x/y/z 是 region 局部坐标
      map.set(`${be.x},${be.y},${be.z}`, be);
      // 有些实现会给绝对坐标，两种都塞一份
      map.set(`${Math.round(be.x + p.x)},${Math.round(be.y + p.y)},${Math.round(be.z + p.z)}`, be);
    }
    out.set(name, map);
  }
  return out;
}

/** 建立 "regionName → Map<'x,y,z', entity[]>" 索引（实体是相对 region.position 的） */
export function indexEntities(schematic) {
  const out = new Map();
  for (const region of schematic?.regions || []) {
    if (!region) continue;
    const p = region.position || { x: 0, y: 0, z: 0 };
    const map = new Map();
    for (const e of region.entities || []) {
      if (!e || !e.pos) continue;
      const x = Math.round(p.x + (e.pos[0] || 0));
      const y = Math.round(p.y + (e.pos[1] || 0));
      const z = Math.round(p.z + (e.pos[2] || 0));
      const k = `${x},${y},${z}`;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(e);
    }
    out.set(region.name || "region", map);
  }
  return out;
}

/** 把 'minecraft:xxx[props]' 拆开 */
export function splitState(stateKey) {
  const i = stateKey.indexOf("[");
  if (i < 0) return { id: stateKey, props: [] };
  const id = stateKey.slice(0, i);
  const body = stateKey.slice(i + 1, stateKey.lastIndexOf("]"));
  const props = body
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const eq = s.indexOf("=");
      return eq < 0 ? [s, ""] : [s.slice(0, eq), s.slice(eq + 1)];
    });
  return { id, props };
}

const fmtNum = (n) => (typeof n === "number" && Number.isFinite(n) ? n : 0);

/** 从方块实体 NBT 里抽出容器物品（箱子/发射器/潜影盒/木桶…） */
export function extractContainerItems(nbt) {
  if (!nbt || typeof nbt !== "object") return [];
  let items = nbt.Items || nbt.items || null;
  // 1.20.5+ 的行内组件写法
  if (!items && nbt.components && nbt.components["minecraft:container"]) {
    items = nbt.components["minecraft:container"];
  }
  if (!items) return [];
  const list = [];
  const push = (entry, idx) => {
    if (!entry || typeof entry !== "object") return;
    // { item: { id, count } , slot } 形式（新版本）或 { id, Count, Slot }（老版本）
    const inner = entry.item && typeof entry.item === "object" ? entry.item : entry;
    const id = inner.id || inner.Id || inner.item || "unknown";
    const count = fmtNum(inner.count ?? inner.Count ?? 1);
    const slot = fmtNum(entry.slot ?? entry.Slot ?? entry.byte ?? idx);
    list.push({
      id: String(id),
      count,
      slot,
      tag: inner.tag || inner.components || null,
      raw: entry,
    });
  };
  if (Array.isArray(items)) {
    items.forEach((it, i) => push(it, i));
  } else if (typeof items === "object") {
    // { "0": {...}, "1": {...} } 形式
    Object.entries(items).forEach(([k, v], i) => push(v, Number(k) || i));
  }
  list.sort((a, b) => a.slot - b.slot);
  return list;
}

/** 常用的方块实体类型判断 */
export function isContainer(nbt) {
  return !!(nbt && (nbt.Items || nbt.items || (nbt.components && nbt.components["minecraft:container"])));
}

/**
 * 把场景拾取结果补充成 UI 可用的方块信息。
 * @param {object} hit scene.pickAt 的返回值
 * @param {{db: object, blocks: object, beIndex: Map, entityIndex: Map}} ctx
 */
export function describeBlock(hit, ctx) {
  if (!hit) return null;
  const { db, beIndex, entityIndex } = ctx;
  const { id, props } = splitState(hit.stateKey);
  const beMap = beIndex?.get(hit.regionName);
  const be = beMap ? beMap.get(`${hit.x - 0},${hit.y},${hit.z}`) || beMap.get(`${hit.x},${hit.y},${hit.z}`) : null;
  const ents = entityIndex?.get(hit.regionName)?.get(`${hit.x},${hit.y},${hit.z}`) || null;
  return {
    x: hit.x,
    y: hit.y,
    z: hit.z,
    stateKey: hit.stateKey,
    id,
    props,
    displayName: db ? db.displayName(id) : id,
    regionName: hit.regionName,
    normal: hit.normal,
    blockEntity: be ? be.nbt || be : null,
    entities: ents,
    containerItems: be ? extractContainerItems(be.nbt || be) : [],
    source: hit,
  };
}

/**
 * 悬停拾取：pointermove → 每帧最多算一次；拖动 / pointerleave 时不拾取。
 */
export class HoverPicker {
  constructor(scene, onHover) {
    this.scene = scene;
    this.onHover = onHover;
    this.canvas = scene.canvas;
    this._pending = null;
    this._raf = 0;
    this._down = false;
    this._lastHitKey = "";
    this._enabled = true;
    this._onMove = this._onMove.bind(this);
    this._onLeave = this._onLeave.bind(this);
    this._onDown = () => { this._down = true; };
    this._onUp = () => { this._down = false; this._request(this._lastClient); };
    this._lastClient = null;
    this._onTick = this._onTick.bind(this);
    this.canvas.addEventListener("pointermove", this._onMove);
    this.canvas.addEventListener("pointerleave", this._onLeave);
    this.canvas.addEventListener("pointerdown", this._onDown);
    window.addEventListener("pointerup", this._onUp);
  }

  setEnabled(v) {
    this._enabled = v;
    if (!v) this.onHover(null);
  }

  _onMove(ev) {
    this._lastClient = { x: ev.clientX, y: ev.clientY };
    if (!this._enabled) return;
    this._request(this._lastClient);
  }

  _request(client) {
    this._pending = client;
    if (this._raf) return;
    this._raf = requestAnimationFrame(this._onTick);
  }

  _onTick() {
    this._raf = 0;
    const client = this._pending;
    this._pending = null;
    if (!client || !this._enabled) return;
    if (this._down) { return; } // 拖动中不做悬停，降低开销
    let hit = null;
    try {
      hit = this.scene.pickAt(client.x, client.y);
    } catch (err) {
      hit = null;
    }
    const key = hit ? `${hit.x},${hit.y},${hit.z},${hit.stateKey}` : "";
    if (key === this._lastHitKey) return;
    this._lastHitKey = key;
    this.onHover(hit, client);
  }

  _onLeave() {
    this._lastHitKey = "";
    this.onHover(null);
  }

  dispose() {
    this.canvas.removeEventListener("pointermove", this._onMove);
    this.canvas.removeEventListener("pointerleave", this._onLeave);
    this.canvas.removeEventListener("pointerdown", this._onDown);
    window.removeEventListener("pointerup", this._onUp);
    if (this._raf) cancelAnimationFrame(this._raf);
  }
}
