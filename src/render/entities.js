/**
 * 实体标记层：把 .litematic 里记录的非方块实体（生物、矿车、物品展示框、盔甲架……）
 * 画成 billboard，位置 = region.position + entity.pos（Entities[].Pos 是相对
 * region 起始角的坐标，见 docs/CONTRACT.md §0）。
 *
 * 原版实体没有体积数据，也没有可复用的烘模几何，所以这里用两种标记：
 *   1. 认识了材质表（assets/entity-icons.png，由 tools/bake/post_entity_icons.py 从客户端
 *      jar 裁出每只生物的脸）→ 贴图 Sprite，一眼就能看出是猪还是僵尸；
 *   2. 不认识 → 退回原来的名字标签（带分类配色）。
 * 配合检查器里的 NBT 看详情。
 */
import * as THREE from "three";

/** 图标图集的 URL（放在 assets 里，由 build.mjs 一起拷进 dist） */
const ICONS_JSON = "entity-icons.json";
const ICONS_PNG = "entity-icons.png";
// 图标之间的 1px 内缩，避免最近邻采样吃到隔壁格子的边缘像素
const ICON_INSET = 0.02;

/**
 * 载入实体图标图集；失败返回 null（调用方会退回名字标签）。
 * @param {{_url?: (name: string) => string, baseUrl?: string}} db BlockDB（用它的 _url 拼 ?v=）
 */
export async function loadEntityIcons(db) {
  try {
    const url = (name) => (db && typeof db._url === "function"
      ? db._url(name)
      : (db && db.baseUrl ? db.baseUrl.replace(/\/?$/, "/") : "./assets/") + name);
    const res = await fetch(url(ICONS_JSON), { cache: "default" });
    if (!res.ok) return null;
    const doc = await res.json();
    if (!doc || !doc.icons) return null;
    const tex = await new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(url(ICONS_PNG), resolve, undefined, reject);
    });
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    return {
      texture: tex,
      size: doc.size || [tex.image.width, tex.image.height],
      cell: doc.cell || 16,
      padding: typeof doc.padding === "number" ? doc.padding : 1,
      icons: doc.icons,
    };
  } catch (_err) {
    return null;
  }
}

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
 * @param {{offset:{x:number,y:number,z:number}, scale?:number, icons?:object}} params
 * @returns {{group: THREE.Group, count: number, dispose(): void}}
 */
export function createEntityLayer(schematic, { offset, scale = 1, icons = null } = {}) {
  const group = new THREE.Group();
  group.name = "entity-labels";
  const textures = [];
  const materials = [];
  const iconTexByEntity = new Map();
  const iconMatByEntity = new Map();
  let count = 0;
  let skipped = 0;
  let iconCount = 0;
  // 同一格子附近常常堆着多个实体（盔甲架、物品展示框、掉落物），标签会糊成一团：
  // 用一个 1/2 格的栅格做去重，同一格里只保留第一个。
  const seen = new Set();
  const regions = (schematic && schematic.regions) || [];
  const worldScale = (scale || 1) * 1.9;

  // 同一只生物的所有实例共享一份「裁好 UV 的贴图 + 材质」，省掉几百个 clone。
  const tileFor = (id) => {
    if (iconMatByEntity.has(id)) return iconMatByEntity.get(id);
    const rect = icons && icons.icons ? icons.icons[id] : null;
    if (!rect) return null;
    const [w, h] = icons.size;
    const tex = icons.texture.clone();
    tex.needsUpdate = true;
    // 图集是 flipY=false 加载的（和方块图集一致），所以 v 直接用像素坐标 / 高度。
    tex.offset.set(rect[0] / w + ICON_INSET / w, 1 - (rect[1] + rect[3]) / h + ICON_INSET / h);
    tex.repeat.set(rect[2] / w - (ICON_INSET * 2) / w, rect[3] / h - (ICON_INSET * 2) / h);
    textures.push(tex);
    const mat = new THREE.SpriteMaterial({
      map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false,
      sizeAttenuation: true,
    });
    materials.push(mat);
    iconTexByEntity.set(id, tex);
    iconMatByEntity.set(id, mat);
    return mat;
  };

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
      const px0 = origin.x + px + offset.x;
      const py0 = origin.y + py + offset.y + worldScale * 0.55;
      const pz0 = origin.z + pz + offset.z;
      const iconMat = tileFor(id);
      if (iconMat) {
        const sprite = new THREE.Sprite(iconMat);
        const side = worldScale * (kind === "vehicle" ? 0.62 : 0.55);
        sprite.scale.set(side, side, 1);
        sprite.position.set(px0, py0 + worldScale * 0.12, pz0);
        sprite.renderOrder = 20;
        sprite.userData = { entityId: id, regionName: rg.name, kind, hasIcon: true };
        group.add(sprite);
        iconCount++;
        count++;
        continue;
      }
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
      sprite.position.set(px0, py0, pz0);
      sprite.renderOrder = 20;
      sprite.userData = { entityId: id, regionName: rg.name, kind };
      group.add(sprite);
      count++;
    }
  }
  return {
    group,
    count,
    iconCount,
    skipped,
    dispose() {
      for (const t of textures) t.dispose();
      for (const m of materials) m.dispose();
      group.clear();
    },
  };
}
