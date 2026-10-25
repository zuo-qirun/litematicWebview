// src/render/picking.js
function indexBlockEntities(schematic) {
  const out = /* @__PURE__ */ new Map();
  for (const region of schematic?.regions || []) {
    if (!region) continue;
    const name = region.name || "region";
    const map = /* @__PURE__ */ new Map();
    const p = region.position || { x: 0, y: 0, z: 0 };
    for (const be of region.blockEntities || []) {
      if (!be) continue;
      map.set(`${be.x},${be.y},${be.z}`, be);
      map.set(`${Math.round(be.x + p.x)},${Math.round(be.y + p.y)},${Math.round(be.z + p.z)}`, be);
    }
    out.set(name, map);
  }
  return out;
}
function indexEntities(schematic) {
  const out = /* @__PURE__ */ new Map();
  for (const region of schematic?.regions || []) {
    if (!region) continue;
    const p = region.position || { x: 0, y: 0, z: 0 };
    const map = /* @__PURE__ */ new Map();
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
function splitState(stateKey) {
  const i = stateKey.indexOf("[");
  if (i < 0) return { id: stateKey, props: [] };
  const id = stateKey.slice(0, i);
  const body = stateKey.slice(i + 1, stateKey.lastIndexOf("]"));
  const props = body.split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    const eq = s.indexOf("=");
    return eq < 0 ? [s, ""] : [s.slice(0, eq), s.slice(eq + 1)];
  });
  return { id, props };
}
var fmtNum = (n) => typeof n === "number" && Number.isFinite(n) ? n : 0;
function extractContainerItems(nbt) {
  if (!nbt || typeof nbt !== "object") return [];
  let items = nbt.Items || nbt.items || null;
  if (!items && nbt.components && nbt.components["minecraft:container"]) {
    items = nbt.components["minecraft:container"];
  }
  if (!items) return [];
  const list = [];
  const push = (entry, idx) => {
    if (!entry || typeof entry !== "object") return;
    const inner = entry.item && typeof entry.item === "object" ? entry.item : entry;
    const id = inner.id || inner.Id || inner.item || "unknown";
    const count = fmtNum(inner.count ?? inner.Count ?? 1);
    const slot = fmtNum(entry.slot ?? entry.Slot ?? entry.byte ?? idx);
    list.push({
      id: String(id),
      count,
      slot,
      tag: inner.tag || inner.components || null,
      raw: entry
    });
  };
  if (Array.isArray(items)) {
    items.forEach((it, i) => push(it, i));
  } else if (typeof items === "object") {
    Object.entries(items).forEach(([k, v], i) => push(v, Number(k) || i));
  }
  list.sort((a, b) => a.slot - b.slot);
  return list;
}
function isContainer(nbt) {
  return !!(nbt && (nbt.Items || nbt.items || nbt.components && nbt.components["minecraft:container"]));
}
function describeBlock(hit, ctx) {
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
    source: hit
  };
}
var HoverPicker = class {
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
    this._onDown = () => {
      this._down = true;
    };
    this._onUp = () => {
      this._down = false;
      this._request(this._lastClient);
    };
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
    if (this._down) {
      return;
    }
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
};
export {
  HoverPicker,
  describeBlock,
  extractContainerItems,
  indexBlockEntities,
  indexEntities,
  isContainer,
  splitState
};
