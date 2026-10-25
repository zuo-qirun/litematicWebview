// mcviewer —— 内置兜底资产包（程序化图集 + 程序化模型 + 中文名 + 颜色）
//
// 作用：assets/ 还没烘焙好（或加载失败）时，让查看器仍然能渲染出"像 MC"的画面。
// 它与 §1 资产契约的数据结构保持一致（同样的 quads 结构、同样的 uv 绝对像素约定），
// 只是把 JSON 换成运行时生成。真实资产一旦可用，BlockDB 会优先走真实数据。
//
// 设计：
//   * 图集 256×256，16×16 格，每格 16×16 像素；所有格子都是**灰度**纹理，
//     颜色通过 tint（乘到顶点色）得到 —— 这样一份图集可以染出所有方块色。
//   * 模型按"形状"生成：cube / slab / stairs / thin / post / pane / chest / cross ...
//     uv 指向图集里的某个格子，p 是 0..16 模型空间、逆时针绕序（同原版 quad 约定）。

import * as THREE from "three";

const CELL_PX = 16;
const GRID = 16; // 16×16 格
export const FALLBACK_ATLAS_SIZE = GRID * CELL_PX; // 256

export const CELL = {
  stone: 0,
  smooth: 1,
  planks: 2,
  brick: 3,
  wool: 4,
  leaves: 5,
  glass: 6,
  water: 7,
  glow: 8,
  redstone: 9,
  dirt: 10,
  metal: 11,
  plant: 12,
  obsidian: 13,
  log: 14,
  white: 15,
};

// ---------------------------------------------------------------- 伪随机
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// ---------------------------------------------------------------- 图集绘制
/** 灰度噪声图案绘制器 */
function makePainter(data, size, cell) {
  const ox = (cell % 4) * CELL_PX;
  const oy = Math.floor(cell / 4) * CELL_PX;
  return (x, y, v, a = 255) => {
    if (x < 0 || y < 0 || x >= CELL_PX || y >= CELL_PX) return;
    const i = ((oy + y) * size + (ox + x)) * 4;
    const c = Math.max(0, Math.min(255, Math.round(v * 255)));
    data[i] = c;
    data[i + 1] = c;
    data[i + 2] = c;
    data[i + 3] = a;
  };
}

function paintAtlas() {
  const size = FALLBACK_ATLAS_SIZE;
  const data = new Uint8Array(size * size * 4);
  const cells = [
    [CELL.stone, (p, r) => {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p(x, y, 0.6 + (r() - 0.5) * 0.22);
      // 几块深色石头纹理
      for (let k = 0; k < 5; k++) {
        const x = Math.floor(r() * 15), y = Math.floor(r() * 15);
        p(x, y, 0.42); p(x + 1, y, 0.46); p(x, y + 1, 0.47);
      }
    }],
    [CELL.smooth, (p, r) => {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p(x, y, 0.86 + (r() - 0.5) * 0.05);
      for (let i = 1; i < 16; i++) { p(i, 0, 0.76); p(0, i, 0.76); }
      p(15, 15, 0.9); p(14, 15, 0.9);
    }],
    [CELL.planks, (p, r) => {
      for (let y = 0; y < 16; y++) {
        const band = Math.floor(y / 4);
        const base = 0.74 + (r() - 0.5) * 0.1;
        for (let x = 0; x < 16; x++) {
          let v = base + (r() - 0.5) * 0.07;
          if (y % 4 === 3) v = 0.55; // 板缝
          if ((x + band * 5) % 8 === 0 && y % 4 !== 3) v *= 0.9; // 竖向木纹
          p(x, y, v);
        }
      }
    }],
    [CELL.brick, (p, r) => {
      for (let y = 0; y < 16; y++) {
        const row = Math.floor(y / 4);
        const off = row % 2 === 0 ? 0 : 4;
        for (let x = 0; x < 16; x++) {
          const mortar = y % 4 === 3 || (x + off) % 8 === 7;
          p(x, y, mortar ? 0.66 : 0.8 + (r() - 0.5) * 0.12);
        }
      }
    }],
    [CELL.wool, (p, r) => {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const bx = Math.floor(x / 2), by = Math.floor(y / 2);
          const n = r();
          p(x, y, 0.84 + (((bx * 7 + by * 13) % 5) - 2) * 0.012 + (n - 0.5) * 0.05);
        }
      }
    }],
    [CELL.leaves, (p, r) => {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const a = r();
          if (a < 0.26) { p(x, y, 0, 0); continue; }
          p(x, y, 0.5 + (r() - 0.5) * 0.5, 255);
        }
      }
    }],
    [CELL.glass, (p, r) => {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const border = x === 0 || y === 0 || x === 15 || y === 15;
          if (border) { p(x, y, 0.86 + (r() - 0.5) * 0.08); continue; }
          // 内部基本透明，只留两道高光
          if ((x === y + 2) || (x === y - 9 && y < 6)) p(x, y, 0.95, 210);
          else p(x, y, 0, 0);
        }
      }
    }],
    [CELL.water, (p, r) => {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const w = Math.sin((x + y) * 0.9) * 0.04;
          p(x, y, 0.66 + w + (r() - 0.5) * 0.06, 235);
        }
      }
    }],
    [CELL.glow, (p, r) => {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const d = Math.hypot(x - 7.5, y - 7.5) / 11;
          p(x, y, 0.98 - d * 0.18 + (r() - 0.5) * 0.07);
        }
      }
      for (let k = 0; k < 6; k++) { p(Math.floor(r() * 14) + 1, Math.floor(r() * 14) + 1, 1.0); }
    }],
    [CELL.redstone, (p, r) => {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p(x, y, 0.55 + (r() - 0.5) * 0.3);
      for (let k = 0; k < 10; k++) p(Math.floor(r() * 16), Math.floor(r() * 16), 0.28);
    }],
    [CELL.dirt, (p, r) => {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          let v = 0.62 + (r() - 0.5) * 0.28;
          if (r() < 0.06) v = 0.4;
          p(x, y, v);
        }
      }
    }],
    [CELL.metal, (p, r) => {
      for (let y = 0; y < 16; y++) {
        const band = 0.86 + Math.sin(y * 0.8) * 0.05;
        for (let x = 0; x < 16; x++) p(x, y, band + (r() - 0.5) * 0.04);
      }
      for (let x = 0; x < 16; x++) { p(x, 3, 0.97); p(x, 12, 0.78); }
    }],
    [CELL.plant, (p, r) => {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const stem = Math.abs(x - 7.5) < 1.2;
          const leaf = r() < 0.42 && y < 13 && Math.abs(x - 7.5) < 6;
          if (stem) { p(x, y, 0.62 + (r() - 0.5) * 0.15); continue; }
          if (leaf) { p(x, y, 0.55 + (r() - 0.5) * 0.35); continue; }
          p(x, y, 0, 0);
        }
      }
    }],
    [CELL.obsidian, (p, r) => {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p(x, y, 0.24 + (r() - 0.5) * 0.14);
      for (let k = 0; k < 4; k++) p(Math.floor(r() * 16), Math.floor(r() * 16), 0.5);
    }],
    [CELL.log, (p, r) => {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          let v = 0.72 + (r() - 0.5) * 0.1;
          if (x % 4 === 0) v *= 0.72;
          p(x, y, v);
        }
      }
    }],
    [CELL.white, (p) => {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p(x, y, 0.94);
    }],
  ];
  for (const [cell, fn] of cells) {
    const p = makePainter(data, size, cell);
    fn(p, mulberry32(0x9e3779b9 + cell * 7919));
  }
  return data;
}

export function createFallbackAtlasTexture() {
  const data = paintAtlas();
  const tex = new THREE.DataTexture(data, FALLBACK_ATLAS_SIZE, FALLBACK_ATLAS_SIZE, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------- 颜色
/** 16 种染料色（近似原版，sRGB 0..1） */
const DYE = {
  white: [0.93, 0.94, 0.94],
  orange: [0.94, 0.5, 0.13],
  magenta: [0.78, 0.32, 0.78],
  light_blue: [0.35, 0.63, 0.88],
  yellow: [0.95, 0.83, 0.24],
  lime: [0.47, 0.78, 0.13],
  pink: [0.94, 0.55, 0.66],
  gray: [0.32, 0.34, 0.35],
  light_gray: [0.6, 0.6, 0.6],
  cyan: [0.13, 0.5, 0.55],
  purple: [0.4, 0.2, 0.6],
  blue: [0.23, 0.28, 0.65],
  brown: [0.4, 0.27, 0.13],
  green: [0.3, 0.36, 0.13],
  red: [0.6, 0.19, 0.16],
  black: [0.11, 0.11, 0.11],
};

const NAMED = {
  stone: [0.55, 0.55, 0.55],
  smooth_stone: [0.62, 0.62, 0.62],
  cobblestone: [0.5, 0.5, 0.5],
  cobbled_deepslate: [0.32, 0.32, 0.34],
  deepslate: [0.28, 0.28, 0.3],
  andesite: [0.53, 0.53, 0.53],
  diorite: [0.72, 0.72, 0.72],
  granite: [0.63, 0.45, 0.38],
  polished_andesite: [0.5, 0.5, 0.51],
  blackstone: [0.2, 0.18, 0.2],
  polished_blackstone: [0.24, 0.22, 0.24],
  dirt: [0.47, 0.34, 0.24],
  grass_block: [0.45, 0.72, 0.34],
  podzol: [0.44, 0.33, 0.16],
  mud: [0.32, 0.29, 0.24],
  coarse_dirt: [0.44, 0.32, 0.22],
  mycelium: [0.55, 0.5, 0.55],
  sand: [0.87, 0.82, 0.65],
  red_sand: [0.79, 0.5, 0.25],
  gravel: [0.53, 0.5, 0.48],
  clay: [0.63, 0.65, 0.7],
  soul_sand: [0.29, 0.23, 0.18],
  soul_soil: [0.32, 0.26, 0.2],
  snow_block: [0.95, 0.96, 0.97],
  powder_snow: [0.92, 0.94, 0.97],
  ice: [0.62, 0.79, 0.96],
  packed_ice: [0.56, 0.72, 0.9],
  blue_ice: [0.45, 0.63, 0.94],
  frosted_ice: [0.6, 0.78, 0.95],
  water: [0.2, 0.4, 0.78],
  lava: [0.95, 0.48, 0.12],
  obsidian: [0.09, 0.07, 0.15],
  crying_obsidian: [0.18, 0.07, 0.3],
  redstone_block: [0.62, 0.09, 0.05],
  redstone_wire: [0.56, 0.04, 0.02],
  redstone_torch: [0.6, 0.06, 0.03],
  redstone_lamp: [0.5, 0.2, 0.12],
  glowstone: [0.94, 0.83, 0.55],
  sea_lantern: [0.82, 0.92, 0.9],
  shroomlight: [0.94, 0.68, 0.36],
  jack_o_lantern: [0.92, 0.66, 0.2],
  magma_block: [0.52, 0.23, 0.1],
  iron_block: [0.85, 0.85, 0.86],
  gold_block: [0.98, 0.83, 0.25],
  diamond_block: [0.35, 0.9, 0.86],
  emerald_block: [0.28, 0.84, 0.36],
  netherite_block: [0.28, 0.25, 0.25],
  quartz_block: [0.94, 0.92, 0.88],
  smooth_quartz: [0.94, 0.92, 0.88],
  oak_planks: [0.72, 0.58, 0.36],
  spruce_planks: [0.45, 0.34, 0.18],
  birch_planks: [0.85, 0.78, 0.53],
  jungle_planks: [0.7, 0.55, 0.36],
  acacia_planks: [0.75, 0.5, 0.3],
  dark_oak_planks: [0.35, 0.26, 0.14],
  cherry_planks: [0.93, 0.75, 0.71],
  bamboo_planks: [0.83, 0.7, 0.42],
  oak_log: [0.55, 0.42, 0.25],
  cherry_log: [0.35, 0.21, 0.19],
  spruce_log: [0.3, 0.2, 0.1],
  birch_log: [0.86, 0.84, 0.78],
  oak_leaves: [0.29, 0.52, 0.2],
  oak_planks_stairs: [0.72, 0.58, 0.36],
  cherry_leaves: [0.89, 0.55, 0.66],
  grass: [0.45, 0.7, 0.3],
  tall_grass: [0.45, 0.7, 0.3],
  fern: [0.45, 0.7, 0.3],
  vine: [0.3, 0.55, 0.2],
  lily_pad: [0.25, 0.5, 0.18],
  sugar_cane: [0.55, 0.72, 0.35],
  cactus: [0.35, 0.55, 0.2],
  bamboo: [0.6, 0.72, 0.32],
  moss_block: [0.4, 0.55, 0.22],
  sculk: [0.06, 0.12, 0.14],
  bubble_column: [0.3, 0.5, 0.8],
  nether_portal: [0.45, 0.12, 0.66],
  slime_block: [0.5, 0.78, 0.4],
  honey_block: [0.9, 0.66, 0.22],
  hopper: [0.3, 0.3, 0.32],
  observer: [0.35, 0.35, 0.37],
  piston: [0.55, 0.44, 0.28],
  sticky_piston: [0.45, 0.5, 0.3],
  piston_head: [0.62, 0.52, 0.34],
  dispenser: [0.35, 0.35, 0.37],
  dropper: [0.35, 0.35, 0.37],
  crafter: [0.42, 0.35, 0.28],
  chest: [0.6, 0.43, 0.22],
  ender_chest: [0.16, 0.24, 0.23],
  barrel: [0.5, 0.36, 0.2],
  furnace: [0.5, 0.5, 0.51],
  crafting_table: [0.55, 0.4, 0.22],
  composter: [0.5, 0.35, 0.18],
  note_block: [0.48, 0.33, 0.2],
  jukebox: [0.45, 0.3, 0.16],
  target: [0.9, 0.84, 0.75],
  lever: [0.55, 0.42, 0.26],
  repeater: [0.6, 0.6, 0.6],
  comparator: [0.62, 0.62, 0.62],
  rail: [0.6, 0.6, 0.62],
  powered_rail: [0.75, 0.6, 0.3],
  detector_rail: [0.6, 0.55, 0.5],
  activator_rail: [0.6, 0.45, 0.35],
  scaffolding: [0.83, 0.75, 0.42],
  ladder: [0.55, 0.42, 0.24],
  lantern: [0.55, 0.45, 0.32],
  soul_lantern: [0.36, 0.55, 0.6],
  soul_campfire: [0.3, 0.42, 0.46],
  campfire: [0.45, 0.3, 0.18],
  torch: [0.6, 0.45, 0.26],
  soul_fire: [0.32, 0.8, 0.82],
  fire: [0.95, 0.65, 0.2],
  glass: [0.85, 0.93, 0.96],
  tinted_glass: [0.16, 0.16, 0.18],
  beacon: [0.5, 0.85, 0.82],
  anvil: [0.35, 0.35, 0.37],
  stonecutter: [0.55, 0.52, 0.4],
  smithing_table: [0.35, 0.27, 0.25],
  cartography_table: [0.42, 0.33, 0.24],
  loom: [0.6, 0.52, 0.38],
  grindstone: [0.5, 0.48, 0.45],
  brewing_stand: [0.6, 0.5, 0.36],
  decorated_pot: [0.62, 0.35, 0.25],
  shulker_box: [0.6, 0.35, 0.62],
  chiseled_bookshelf: [0.62, 0.48, 0.3],
  bookshelf: [0.6, 0.45, 0.28],
  mangrove_roots: [0.45, 0.33, 0.22],
  turtle_egg: [0.85, 0.85, 0.78],
  sea_pickle: [0.4, 0.6, 0.3],
  glow_lichen: [0.4, 0.63, 0.6],
  tube_coral_fan: [0.28, 0.4, 0.8],
  ochre_froglight: [0.9, 0.82, 0.62],
  pearlescent_froglight: [0.9, 0.78, 0.85],
  verdant_froglight: [0.7, 0.82, 0.6],
  netherrack: [0.44, 0.22, 0.22],
  nether_bricks: [0.25, 0.15, 0.17],
  end_stone: [0.85, 0.85, 0.63],
  prismarine: [0.4, 0.6, 0.55],
  terracotta: [0.6, 0.4, 0.3],
  brick: [0.58, 0.33, 0.27],
  stone_bricks: [0.48, 0.48, 0.48],
  mossy_cobblestone: [0.4, 0.45, 0.33],
};

const PLANTISH = /(sapling|_flower|tulip|dandelion|poppy|orchid|allium|bluet|daisy|cornflower|wheat|carrots|potatoes|beetroots|melon_stem|pumpkin_stem|_bush|_fern|^fern|kelp|seagrass|coral|lichen|^vine|sugar_cane|_rose|sunflower|lilac|peony|azalea|_roots|hanging_roots|nether_sprouts|warped_roots|crimson_roots|soul_fire|^fire|torch|_torch)/;

const TRANSLUCENT = /(^minecraft:water$|flowing_water|^minecraft:lava$|_ice$|^minecraft:ice$|slime_block|honey_block|nether_portal|stained_glass$|tinted_glass|^minecraft:glass$|glass_pane|powder_snow|bubble_column|beacon$)/;

/** 方块 id → 颜色（0..1） */
export function fallbackColor(blockId) {
  const path = blockId.replace(/^minecraft:/, "");
  if (NAMED[path]) return NAMED[path];
  // 染料系：<color>_concrete / _wool / _stained_glass / _carpet / _terracotta / _shulker_box ...
  const m = path.match(/^([a-z_]+?)_(concrete|wool|stained_glass|stained_glass_pane|carpet|terracotta|shulker_box|glazed_terracotta|bed|banner|wall_banner|concrete_powder)$/);
  if (m && DYE[m[1]]) {
    const base = DYE[m[1]];
    if (/concrete$/.test(m[2])) return base;
    if (m[2] === "wool" || m[2] === "carpet") return base.map((c) => c * 0.98 + 0.02);
    if (/glass/.test(m[2])) return base.map((c) => 0.55 + c * 0.45);
    if (m[2] === "terracotta") return base.map((c) => 0.55 + c * 0.45);
    return base;
  }
  // 木头系派生（stairs/slab/fence/gate/door/trapdoor/sign/button/pressure_plate）
  const wood = path.match(/^(oak|spruce|birch|jungle|acacia|dark_oak|cherry|bamboo|mangrove|crimson|warped|crimson_stem|warped_stem)/);
  if (wood && NAMED[wood[1] + "_planks"]) return NAMED[wood[1] + "_planks"];
  const stoneish = path.match(/^(stone|cobble|andesite|diorite|granite|deepslate|blackstone|tuff|calcite)/);
  if (stoneish) return NAMED[path] || [0.5, 0.5, 0.5];
  // 其它未知方块：按 hash 生成一个低饱和的 MC 土色系
  const h = hashStr(path);
  const hue = (h % 360) / 360;
  const sat = 0.12 + ((h >>> 9) % 24) / 100; // 0.12~0.35
  const lum = 0.36 + ((h >>> 17) % 26) / 100; // 0.36~0.61
  return hslToRgb(hue, sat, lum);
}

function hslToRgb(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  return [f(0), f(8), f(4)];
}

/** 方块 id → 兜底图集格子 */
export function fallbackCell(stateKey) {
  const id = stateKey.split("[")[0].replace(/^minecraft:/, "");
  if (TRANSLUCENT.test("minecraft:" + id)) return CELL.water;
  if (/glass|pane$/.test(id)) return CELL.glass;
  if (/leaves|moss|azalea/.test(id)) return CELL.leaves;
  if (PLANTISH.test(id)) return CELL.plant;
  if (/planks|_log$|_wood$|_stem$|_hyphae$|bamboo_block|scaffolding|ladder/.test(id)) return CELL.planks;
  if (/brick/.test(id)) return CELL.brick;
  if (/wool|carpet|bed$|banner/.test(id)) return CELL.wool;
  if (/stone|concrete|terracotta|tuft|calcite|tuff|dripstone/.test(id)) return CELL.stone;
  if (/quartz|smooth|polished|beacon|target|iron_block|iron_door|iron_trapdoor|anvil/.test(id)) return CELL.smooth;
  if (/gold_block|diamond_block|emerald_block|netherite|copper|iron_bars/.test(id)) return CELL.metal;
  if (/redstone|repeater|comparator|observer|piston|dispenser|dropper|crafter|note_block/.test(id)) return CELL.redstone;
  if (/lamp|lantern|glow|sea_lantern|froglight|shroomlight|magma|campfire|jack_o_lantern|crying_obsidian/.test(id)) return CELL.glow;
  if (/obsidian|deepslate|blackstone|sculk|basalt/.test(id)) return CELL.obsidian;
  if (/dirt|sand|gravel|mud|soil|podzol|clay|soul_|farmland|path|snow$/.test(id)) return CELL.dirt;
  if (/chest|barrel|crafting_table|furniture|loom|smithing|cartography|grindstone|brewing|composter|bookshelf|pot/.test(id)) return CELL.log;
  if (/rail$|wire$|tripwire/.test(id)) return CELL.stone;
  if (/hopper|observer|piston|dispenser|dropper|chest|furnace|shulker/.test(id)) return CELL.metal;
  return CELL.stone;
}

// ---------------------------------------------------------------- 模型生成
/** 把一个 quad 的 uv 指向图集格子 */
function cellUv(cell) {
  const cx = (cell % 4) * CELL_PX;
  const cy = Math.floor(cell / 4) * CELL_PX;
  return { u0: cx, v0: cy, u1: cx + CELL_PX, v1: cy + CELL_PX };
}

/**
 * 由 4 个顶点生成 quad（顶点顺序 = 逆时针，uv 与 n 一同给定）
 * 顶点顺序约定：[左下, 右下, 右上, 左上]（从正面看）
 */
function quad(verts, n, cell) {
  const { u0, v0, u1, v1 } = cellUv(cell);
  const p = [];
  for (const v of verts) p.push(v[0], v[1], v[2]);
  // 契约：uv 为图集绝对像素、v 向下 → 顶点 0/1 在纹理底部
  return { p, uv: [u0, v1, u1, v1, u1, v0, u0, v0], n, tint: 0, tex: "fallback/auto" };
}

/** 任意盒子的六个面（from/to 为模型空间 0..16） */
function boxQuads(from, to, cell, opts = {}) {
  const [x0, y0, z0] = from;
  const [x1, y1, z1] = to;
  const c = opts.cells || {};
  const quads = [];
  // 下 (-Y)
  quads.push(quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], 0, c.down ?? cell));
  // 上 (+Y)
  quads.push(quad([[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], 1, c.up ?? cell));
  // 北 (-Z)
  quads.push(quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], 2, c.north ?? cell));
  // 南 (+Z)
  quads.push(quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], 3, c.south ?? cell));
  // 西 (-X)
  quads.push(quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], 4, c.west ?? cell));
  // 东 (+X)
  quads.push(quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], 5, c.east ?? cell));
  return quads;
}

function propMap(stateKey) {
  const out = {};
  const i = stateKey.indexOf("[");
  if (i < 0) return out;
  const body = stateKey.slice(i + 1, stateKey.lastIndexOf("]"));
  for (const part of body.split(",")) {
    const [k, v] = part.split("=");
    if (k) out[k.trim()] = (v || "").trim();
  }
  return out;
}

function stairsQuads(facing, half, cell) {
  const q = [];
  const upper = half === "top";
  // 下半/上半的整层
  if (!upper) {
    q.push(...boxQuads([0, 0, 0], [16, 8, 16], cell));
    const step = { north: [[0, 8, 0], [16, 16, 8]], south: [[0, 8, 8], [16, 16, 16]], west: [[0, 8, 0], [8, 16, 16]], east: [[8, 8, 0], [16, 16, 16]] }[facing] || [[0, 8, 0], [16, 16, 8]];
    q.push(...boxQuads(step[0], step[1], cell));
  } else {
    q.push(...boxQuads([0, 8, 0], [16, 16, 16], cell));
    const step = { north: [[0, 0, 0], [16, 8, 8]], south: [[0, 0, 8], [16, 8, 16]], west: [[0, 0, 0], [8, 8, 16]], east: [[8, 0, 0], [16, 8, 16]] }[facing] || [[0, 0, 0], [16, 8, 8]];
    q.push(...boxQuads(step[0], step[1], cell));
  }
  return q;
}

function slabQuads(kind, cell) {
  if (kind === "top") return boxQuads([0, 8, 0], [16, 16, 16], cell);
  if (kind === "double") return boxQuads([0, 0, 0], [16, 16, 16], cell);
  return boxQuads([0, 0, 0], [16, 8, 16], cell);
}

/** 形状判定：返回 { shape, params } */
function shapeOf(id, props) {
  const p = id.replace(/^minecraft:/, "");
  if (/stained_glass_pane$|glass_pane$|iron_bars$/.test(p)) return { shape: "pane" };
  if (/^(.+_)?pane$/.test(p)) return { shape: "pane" };
  if (/_stairs$/.test(p)) return { shape: "stairs", half: props.half || "bottom", facing: props.facing || "north" };
  if (/_slab$/.test(p)) return { shape: "slab", kind: props.type || (props.half === "top" ? "top" : "bottom") };
  if (/_carpet$|^moss_carpet$|^pale_moss_carpet$|_pressure_plate$|^stone_pressure_plate$|^heavy_weighted_pressure_plate$|^light_weighted_pressure_plate$|^daylight_detector$/.test(p)) return { shape: "thin" };
  if (/^(.+_)?fence$|^(.+_)?wall$|^(.+_)?fence_gate$|^end_rod$|_chain$/.test(p)) return { shape: "post" };
  if (/^(.+_)?torch$|^redstone_wall_torch$|^soul_wall_torch$|^redstone_torch$/.test(p)) return { shape: "torch" };
  if (/^(.+_)?rail$|^tripwire$|^redstone_wire$|^powder_snow$/.test(p)) return { shape: "thin" };
  if (/^chest$|^trapped_chest$|^ender_chest$|^barrel$/.test(p)) return { shape: "chest" };
  if (/^water$|^lava$/.test(p)) return { shape: "fluid", level: Number(props.level || 0) };
  if (PLANTISH.test(p)) return { shape: "cross" };
  if (/^ladder$/.test(p)) return { shape: "ladder" };
  return { shape: "cube" };
}

/** 生成模型（按 shape+cell 缓存由 BlockDB 负责） */
export function fallbackModelFor(id, props, cell) {
  const { shape } = shapeOf(id, props);
  const params = shapeOf(id, props);
  switch (shape) {
    case "stairs":
      return stairsQuads(params.facing, params.half, cell);
    case "slab":
      return slabQuads(params.kind, cell);
    case "thin":
      return boxQuads([0, 0, 0], [16, 1.5, 16], cell);
    case "post":
      return boxQuads([6, 0, 6], [10, 16, 10], cell);
    case "pane":
      return boxQuads([7, 0, 0], [9, 16, 16], cell);
    case "torch":
      return boxQuads([7, 0, 7], [9, 10, 9], cell);
    case "chest":
      return boxQuads([1, 0, 1], [15, 14, 15], cell);
    case "fluid": {
      const lvl = Math.max(0, Math.min(8, params.level | 0));
      const h = lvl === 0 ? 15 : Math.max(2, 15 - lvl * 1.6);
      return boxQuads([0, 0, 0], [16, h, 16], cell);
    }
    case "cross":
      return boxQuads([3, 0, 6], [13, 15, 10], cell);
    case "ladder":
      return boxQuads([14, 0, 0], [16, 16, 16], cell);
    case "cube":
    default:
      return boxQuads([0, 0, 0], [16, 16, 16], cell);
  }
}

// ---------------------------------------------------------------- 中文名
const ZH = {
  stone: "石头", smooth_stone: "平滑石头", cobblestone: "圆石", cobbled_deepslate: "深板岩圆石",
  andesite: "安山岩", diorite: "闪长岩", granite: "花岗岩", polished_andesite: "磨制安山岩",
  deepslate: "深板岩", blackstone: "黑石", obsidian: "黑曜石", crying_obsidian: "哭泣的黑曜石",
  dirt: "泥土", grass_block: "草方块", podzol: "灰化土", mud: "泥巴", sand: "沙子", gravel: "沙砾",
  soul_sand: "灵魂沙", soul_soil: "灵魂土", clay: "黏土", snow_block: "雪块", powder_snow: "细雪",
  ice: "冰", packed_ice: "浮冰", blue_ice: "蓝冰", frosted_ice: "霜冰", water: "水", lava: "熔岩",
  redstone_block: "红石块", redstone_wire: "红石粉", redstone_torch: "红石火把", redstone_wall_torch: "墙上红石火把",
  redstone_lamp: "红石灯", glowstone: "荧石", sea_lantern: "海晶灯", shroomlight: "菌光体",
  jack_o_lantern: "南瓜灯", magma_block: "岩浆块", iron_block: "铁块", gold_block: "金块",
  diamond_block: "钻石块", emerald_block: "绿宝石块", netherite_block: "下界合金块",
  quartz_block: "石英块", smooth_quartz: "平滑石英", quartz_pillar: "石英柱", quartz_slab: "石英台阶",
  quartz_stairs: "石英楼梯", smooth_quartz_slab: "平滑石英台阶", smooth_quartz_stairs: "平滑石英楼梯",
  oak_planks: "橡木木板", spruce_planks: "云杉木板", birch_planks: "桦木木板", cherry_planks: "樱花木板",
  oak_log: "橡木原木", spruce_log: "云杉原木", cherry_log: "樱花原木", birch_log: "桦木原木",
  oak_leaves: "橡树树叶", cherry_leaves: "樱花树叶", oak_stairs: "橡木楼梯", oak_slab: "橡木台阶",
  cherry_stairs: "樱花木楼梯", cherry_fence: "樱花木栅栏", cherry_fence_gate: "樱花木栅栏门",
  cherry_trapdoor: "樱花木活板门", cherry_door: "樱花木门", cherry_sign: "樱花木告示牌",
  cherry_wall_sign: "墙上的樱花木告示牌", oak_wall_sign: "墙上的橡木告示牌",
  birch_wall_sign: "墙上的桦木告示牌", oak_fence_gate: "橡木栅栏门", oak_trapdoor: "橡木活板门",
  oak_pressure_plate: "橡木压力板", cherry_pressure_plate: "樱花木压力板",
  stone_bricks: "石砖", stone_brick_stairs: "石砖楼梯", stone_brick_wall: "石砖墙",
  mossy_cobblestone: "苔石", brick: "砖块", terracotta: "陶瓦",
  white_concrete: "白色混凝土", red_concrete: "红色混凝土", light_gray_concrete: "淡灰色混凝土",
  gray_concrete: "灰色混凝土", black_concrete: "黑色混凝土", brown_concrete: "棕色混凝土",
  orange_concrete: "橙色混凝土", yellow_concrete: "黄色混凝土", lime_concrete: "黄绿色混凝土",
  green_concrete: "绿色混凝土", cyan_concrete: "青色混凝土", light_blue_concrete: "淡蓝色混凝土",
  blue_concrete: "蓝色混凝土", purple_concrete: "紫色混凝土", magenta_concrete: "品红色混凝土",
  pink_concrete: "粉色混凝土",
  white_wool: "白色羊毛", red_wool: "红色羊毛", light_blue_wool: "淡蓝色羊毛",
  white_carpet: "白色地毯", pink_carpet: "粉色地毯",
  white_stained_glass: "白色染色玻璃", red_stained_glass: "红色染色玻璃",
  yellow_stained_glass: "黄色染色玻璃", lime_stained_glass: "黄绿色染色玻璃",
  white_stained_glass_pane: "白色染色玻璃板", lime_stained_glass_pane: "黄绿色染色玻璃板",
  pink_stained_glass_pane: "粉色染色玻璃板", glass: "玻璃", tinted_glass: "遮光玻璃",
  hopper: "漏斗", observer: "侦测器", piston: "活塞", sticky_piston: "粘性活塞", piston_head: "活塞头",
  dispenser: "发射器", dropper: "投掷器", crafter: "合成器", chest: "箱子", trapped_chest: "陷阱箱",
  ender_chest: "末影箱", barrel: "木桶", furnace: "熔炉", crafting_table: "工作台", composter: "堆肥桶",
  note_block: "音符盒", jukebox: "唱片机", target: "标靶", lever: "拉杆", stone_button: "石按钮",
  repeater: "红石中继器", comparator: "红石比较器", rail: "铁轨", powered_rail: "动力铁轨",
  detector_rail: "探测铁轨", activator_rail: "激活铁轨", scaffolding: "脚手架", ladder: "梯子",
  lantern: "灯笼", soul_lantern: "灵魂灯笼", soul_campfire: "灵魂营火", campfire: "营火",
  torch: "火把", soul_fire: "灵魂火", fire: "火", deal: "告示牌",
  beacon: "信标", anvil: "铁砧", stonecutter: "切石机", smithing_table: "锻造台",
  cartography_table: "制图台", loom: "织布机", grindstone: "砂轮", brewing_stand: "酿造台",
  decorated_pot: "饰纹陶罐", shulker_box: "潜影盒", chiseled_bookshelf: "雕纹书架",
  bookshelf: "书架", mangrove_roots: "红树根", turtle_egg: "海龟蛋", sea_pickle: "海泡菜",
  glow_lichen: "发光地衣", tube_coral_fan: "管珊瑚扇", ochre_froglight: "赭黄蛙明灯",
  pearlescent_froglight: "珠光蛙明灯", netherrack: "下界岩", nether_bricks: "下界砖块",
  end_stone: "末地石", prismarine: "海晶石", nether_portal: "下界传送门", slime_block: "黏液块",
  honey_block: "蜂蜜块", bubble_column: "气泡柱", iron_trapdoor: "铁活板门", iron_door: "铁门",
  lava_cauldron: "装有熔岩的炼药锅", heavy_weighted_pressure_plate: "重质测重压力板",
  player_wall_head: "墙上的玩家头颅", wither_skeleton_wall_skull: "墙上的凋灵骷髅头",
  tripwire: "绊线", tripwire_hook: "绊线钩", powder_snow_cauldron: "装有细雪的炼药锅",
  cactus: "仙人掌", sugar_cane: "甘蔗", vine: "藤蔓", lily_pad: "睡莲", bamboo: "竹子",
  tall_grass: "高草丛", grass: "草", fern: "蕨", moss_block: "苔藓块", sculk: "幽匿",
  cherry_planks_slab: "樱花木台阶", smooth_stone_slab: "平滑石头台阶", polished_blackstone_slab: "磨制黑石台阶",
  polished_blackstone_stairs: "磨制黑石楼梯", diorite_wall: "闪长岩墙", glowstone_dust: "荧石粉",
  // mock 专用
  oak_wood: "橡木", spruce_wood: "云杉木",
};

function humanize(path) {
  return path
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function fallbackZhName(blockId) {
  const path = blockId.replace(/^minecraft:/, "");
  if (ZH[path]) return ZH[path];
  // 常见派生：<color>_stained_glass / <color>_concrete 等已在 NAMED/DYE 里，这里给人话名字
  const m = path.match(/^([a-z_]+?)_(concrete|wool|stained_glass|stained_glass_pane|carpet|terracotta|shulker_box)$/);
  if (m) {
    const dyeZh = { white: "白色", orange: "橙色", magenta: "品红色", light_blue: "淡蓝色", yellow: "黄色", lime: "黄绿色", pink: "粉色", gray: "灰色", light_gray: "淡灰色", cyan: "青色", purple: "紫色", blue: "蓝色", brown: "棕色", green: "绿色", red: "红色", black: "黑色" };
    const kindZh = { concrete: "混凝土", wool: "羊毛", stained_glass: "染色玻璃", stained_glass_pane: "染色玻璃板", carpet: "地毯", terracotta: "陶瓦", shulker_box: "潜影盒" };
    if (dyeZh[m[1]] && kindZh[m[2]]) return dyeZh[m[1]] + kindZh[m[2]];
  }
  const woodZh = { oak: "橡木", spruce: "云杉", birch: "桦木", jungle: "丛林木", acacia: "金合欢木", dark_oak: "深色橡木", cherry: "樱花木", bamboo: "竹", mangrove: "红树木", crimson: "绯红", warped: "诡异" };
  const wm = path.match(/^(oak|spruce|birch|jungle|acacia|dark_oak|cherry|bamboo|mangrove|crimson|warped)_(.+)$/);
  if (wm && woodZh[wm[1]]) {
    const rest = wm[2];
    const restZh = { stairs: "楼梯", slab: "台阶", fence: "栅栏", fence_gate: "栅栏门", door: "门", trapdoor: "活板门", sign: "告示牌", wall_sign: "墙上的告示牌", planks: "木板", log: "原木", leaves: "树叶", button: "按钮", pressure_plate: "压力板", sapling: "树苗" }[rest];
    if (restZh) return woodZh[wm[1]] + restZh;
  }
  return humanize(path);
}

// ---------------------------------------------------------------- 打包
export function createFallbackPack() {
  const atlasTexture = createFallbackAtlasTexture();
  const manifest = {
    format: 1,
    mcVersions: ["内置兜底"],
    dataVersion: null,
    atlas: { file: null, size: FALLBACK_ATLAS_SIZE, padding: 0 },
    textureScale: 16,
    fallback: true,
  };
  const meta = {
    generated: new Date().toISOString(),
    fallback: true,
    blockCount: 0,
    modelCount: 0,
    quadCount: 0,
    textureCount: 16,
    atlasUsage: 0,
    missingBlocks: [],
    missingTextures: [],
    notes: ["内置兜底资产：assets/ 未加载，使用程序化图集与几何"],
  };
  return { manifest, meta, atlasTexture, atlasSize: FALLBACK_ATLAS_SIZE, lang: null };
}
