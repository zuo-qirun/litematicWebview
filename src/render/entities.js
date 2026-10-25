/**
 * 实体标记层：把 .litematic 里记录的非方块实体（生物、矿车、物品展示框、盔甲架……）
 * 画成「名字标签」billboard，位置 = region.position + entity.pos（Entities[].Pos 是相对
 * region 起始角的坐标，见 docs/CONTRACT.md §0）。
 *
 * 原版实体没有体积数据，也没有可复用的烘焙模型，所以这里用标签而不是几何：
 * 至少能看到「这里放了一只猪 / 一个漏斗矿车 / 一个物品展示框」，配合检查器里的 NBT 看详情。
 */
import * as THREE from "three";

// 默认只显示"有体积"的实体：生物 / 载具。物品展示框、画、盔甲架、掉落物在投影里
// 往往是成排装饰（动辄几十个），全部标出来会把画面糊满，所以默认跳过。
const DEFAULT_KINDS = new Set(["mob", "vehicle", "other"]);

const KIND_COLORS = {
  mob: "#7ee787",
  vehicle: "#ffb454",
  item: "#79c0ff",
  frame: "#d2a8ff",
  other: "#9aa7b8",
};

/** 按 id 粗略分类，只影响标签颜色 */
function kindOf(id) {
  const name = id.replace(/^minecraft:/, "");
  if (/^(hopper_minecart|chest_minecart|tnt_minecart|minecart|furnace_minecart|command_block_minecart|spawner_minecart)$/.test(name)) return "vehicle";
  if (/^item_frame$|^glow_item_frame$|^painting$|^armor_stand$/.test(name)) return "frame";
  if (/^(item|experience_orb|arrow|snowball|egg|ender_pearl|eye_of_ender|firework_rocket|boat|.*_boat|.*_raft)$/.test(name)) return "item";
  if (/^(pig|sheep|cow|chicken|rabbit|horse|donkey|mule|llama|wolf|cat|ocelot|fox|bee|parrot|bat|squid|dolphin|turtle|axolotl|frog|goat|camel|sniffer|allay|villager|wandering_trader|iron_golem|snow_golem|zombie|skeleton|husk|stray|drowned|witch|pillager|vindicator|evoker|ravager|slime|magma_cube|blaze|ghast|piglin|piglin_brute|hoglin|zoglin|strider|enderman|wither_skeleton|guardian|elder_guardian|shulker|phantom|vex|wither|creeper|spider|cave_spider|silverfish|endermite|spawner)$/.test(name)) return "mob";
  return "other";
}

function labelTexture(text, color) {
  const pad = 8;
  const font = "600 26px 'Segoe UI', 'Microsoft YaHei', sans-serif";
  const measure = document.createElement("canvas").getContext("2d");
  measure.font = font;
  const w = Math.ceil(measure.measureText(text).width) + pad * 2;
  const h = 40;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(10,13,19,0.82)";
  const r = 8;
  ctx.beginPath();
  ctx.roundRect(0.5, 0.5, w - 1, h - 1, r);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.fillText(text, pad, h / 2 + 1);
  return { canvas, w, h };
}

/**
 * @param {object} schematic 解析结果
 * @param {{offset:{x:number,y:number,z:number}, scale?:number}} params
 * @returns {{group: THREE.Group, count: number, dispose(): void}}
 */
export function createEntityLayer(schematic, { offset, scale = 1 } = {}) {
  const group = new THREE.Group();
  group.name = "entity-labels";
  const textures = [];
  const materials = [];
  let count = 0;
  let skipped = 0;
  // 同一格子附近常常堆着多个实体（盔甲架、物品展示框、掉落物），标签会糊成一团：
  // 用一个 1/2 格的栅格做去重，同一格里只保留第一个。
  const seen = new Set();
  const regions = (schematic && schematic.regions) || [];
  const worldScale = (scale || 1) * 1.9;
  for (const rg of regions) {
    const list = rg.entities || [];
    if (!list.length) continue;
    const origin = rg.position || rg.min || { x: 0, y: 0, z: 0 };
    for (const ent of list) {
      const p = ent.pos || ent.position;
      if (!p) continue;
      const px = Array.isArray(p) ? p[0] : p.x;
      const py = Array.isArray(p) ? p[1] : p.y;
      const pz = Array.isArray(p) ? p[2] : p.z;
      if (![px, py, pz].every(Number.isFinite)) continue;
      const id = String(ent.id || (ent.nbt && ent.nbt.id) || "unknown");
      const cellKey = `${rg.name}|${Math.round(px * 2)}|${Math.round(py * 2)}|${Math.round(pz * 2)}`;
      if (seen.has(cellKey)) { skipped++; continue; }
      seen.add(cellKey);
      const kindOfEnt = kindOf(id);
      if (!DEFAULT_KINDS.has(kindOfEnt)) { skipped++; continue; }
      const kind = kindOfEnt;
      const label = id.replace(/^minecraft:/, "");
      const { canvas, w, h } = labelTexture(label, KIND_COLORS[kind] || KIND_COLORS.other);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      textures.push(tex);
      const mat = new THREE.SpriteMaterial({
        map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false,
        sizeAttenuation: true,
      });
      materials.push(mat);
      const sprite = new THREE.Sprite(mat);
      const sprH = worldScale * 0.42;
      sprite.scale.set((sprH * w) / h, sprH, 1);
      sprite.position.set(
        origin.x + px + offset.x,
        origin.y + py + offset.y + worldScale * 0.55,
        origin.z + pz + offset.z,
      );
      sprite.renderOrder = 20;
      sprite.userData = { entityId: id, regionName: rg.name, kind };
      group.add(sprite);
      count++;
    }
  }
  return {
    group,
    count,
    skipped,
    dispose() {
      for (const t of textures) t.dispose();
      for (const m of materials) m.dispose();
      group.clear();
    },
  };
}
