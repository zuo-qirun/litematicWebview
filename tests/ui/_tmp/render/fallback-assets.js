// src/render/fallback-assets.js
import * as THREE from "three";
var CELL_PX = 16;
var GRID = 16;
var FALLBACK_ATLAS_SIZE = GRID * CELL_PX;
var CELL = {
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
  white: 15
};
function mulberry32(seed) {
  let a = seed >>> 0;
  return function() {
    a = a + 1831565813 >>> 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
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
function makePainter(data, size, cell) {
  const ox = cell % 4 * CELL_PX;
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
      for (let k = 0; k < 5; k++) {
        const x = Math.floor(r() * 15), y = Math.floor(r() * 15);
        p(x, y, 0.42);
        p(x + 1, y, 0.46);
        p(x, y + 1, 0.47);
      }
    }],
    [CELL.smooth, (p, r) => {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p(x, y, 0.86 + (r() - 0.5) * 0.05);
      for (let i = 1; i < 16; i++) {
        p(i, 0, 0.76);
        p(0, i, 0.76);
      }
      p(15, 15, 0.9);
      p(14, 15, 0.9);
    }],
    [CELL.planks, (p, r) => {
      for (let y = 0; y < 16; y++) {
        const band = Math.floor(y / 4);
        const base = 0.74 + (r() - 0.5) * 0.1;
        for (let x = 0; x < 16; x++) {
          let v = base + (r() - 0.5) * 0.07;
          if (y % 4 === 3) v = 0.55;
          if ((x + band * 5) % 8 === 0 && y % 4 !== 3) v *= 0.9;
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
          p(x, y, 0.84 + ((bx * 7 + by * 13) % 5 - 2) * 0.012 + (n - 0.5) * 0.05);
        }
      }
    }],
    [CELL.leaves, (p, r) => {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const a = r();
          if (a < 0.26) {
            p(x, y, 0, 0);
            continue;
          }
          p(x, y, 0.5 + (r() - 0.5) * 0.5, 255);
        }
      }
    }],
    [CELL.glass, (p, r) => {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const border = x === 0 || y === 0 || x === 15 || y === 15;
          if (border) {
            p(x, y, 0.86 + (r() - 0.5) * 0.08);
            continue;
          }
          if (x === y + 2 || x === y - 9 && y < 6) p(x, y, 0.95, 210);
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
      for (let k = 0; k < 6; k++) {
        p(Math.floor(r() * 14) + 1, Math.floor(r() * 14) + 1, 1);
      }
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
      for (let x = 0; x < 16; x++) {
        p(x, 3, 0.97);
        p(x, 12, 0.78);
      }
    }],
    [CELL.plant, (p, r) => {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const stem = Math.abs(x - 7.5) < 1.2;
          const leaf = r() < 0.42 && y < 13 && Math.abs(x - 7.5) < 6;
          if (stem) {
            p(x, y, 0.62 + (r() - 0.5) * 0.15);
            continue;
          }
          if (leaf) {
            p(x, y, 0.55 + (r() - 0.5) * 0.35);
            continue;
          }
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
    }]
  ];
  for (const [cell, fn] of cells) {
    const p = makePainter(data, size, cell);
    fn(p, mulberry32(2654435769 + cell * 7919));
  }
  return data;
}
function createFallbackAtlasTexture() {
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
var DYE = {
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
  black: [0.11, 0.11, 0.11]
};
var NAMED = {
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
  mossy_cobblestone: [0.4, 0.45, 0.33]
};
var PLANTISH = /(sapling|_flower|tulip|dandelion|poppy|orchid|allium|bluet|daisy|cornflower|wheat|carrots|potatoes|beetroots|melon_stem|pumpkin_stem|_bush|_fern|^fern|kelp|seagrass|coral|lichen|^vine|sugar_cane|_rose|sunflower|lilac|peony|azalea|_roots|hanging_roots|nether_sprouts|warped_roots|crimson_roots|soul_fire|^fire|torch|_torch)/;
var TRANSLUCENT = /(^minecraft:water$|flowing_water|^minecraft:lava$|_ice$|^minecraft:ice$|slime_block|honey_block|nether_portal|stained_glass$|tinted_glass|^minecraft:glass$|glass_pane|powder_snow|bubble_column|beacon$)/;
function fallbackColor(blockId) {
  const path = blockId.replace(/^minecraft:/, "");
  if (NAMED[path]) return NAMED[path];
  const m = path.match(/^([a-z_]+?)_(concrete|wool|stained_glass|stained_glass_pane|carpet|terracotta|shulker_box|glazed_terracotta|bed|banner|wall_banner|concrete_powder)$/);
  if (m && DYE[m[1]]) {
    const base = DYE[m[1]];
    if (/concrete$/.test(m[2])) return base;
    if (m[2] === "wool" || m[2] === "carpet") return base.map((c) => c * 0.98 + 0.02);
    if (/glass/.test(m[2])) return base.map((c) => 0.55 + c * 0.45);
    if (m[2] === "terracotta") return base.map((c) => 0.55 + c * 0.45);
    return base;
  }
  const wood = path.match(/^(oak|spruce|birch|jungle|acacia|dark_oak|cherry|bamboo|mangrove|crimson|warped|crimson_stem|warped_stem)/);
  if (wood && NAMED[wood[1] + "_planks"]) return NAMED[wood[1] + "_planks"];
  const stoneish = path.match(/^(stone|cobble|andesite|diorite|granite|deepslate|blackstone|tuff|calcite)/);
  if (stoneish) return NAMED[path] || [0.5, 0.5, 0.5];
  const h = hashStr(path);
  const hue = h % 360 / 360;
  const sat = 0.12 + (h >>> 9) % 24 / 100;
  const lum = 0.36 + (h >>> 17) % 26 / 100;
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
function fallbackCell(stateKey) {
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
function cellUv(cell) {
  const cx = cell % 4 * CELL_PX;
  const cy = Math.floor(cell / 4) * CELL_PX;
  return { u0: cx, v0: cy, u1: cx + CELL_PX, v1: cy + CELL_PX };
}
function quad(verts, n, cell) {
  const { u0, v0, u1, v1 } = cellUv(cell);
  const p = [];
  for (const v of verts) p.push(v[0], v[1], v[2]);
  return { p, uv: [u0, v1, u1, v1, u1, v0, u0, v0], n, tint: 0, tex: "fallback/auto" };
}
function boxQuads(from, to, cell, opts = {}) {
  const [x0, y0, z0] = from;
  const [x1, y1, z1] = to;
  const c = opts.cells || {};
  const quads = [];
  quads.push(quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], 0, c.down ?? cell));
  quads.push(quad([[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], 1, c.up ?? cell));
  quads.push(quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], 2, c.north ?? cell));
  quads.push(quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], 3, c.south ?? cell));
  quads.push(quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], 4, c.west ?? cell));
  quads.push(quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], 5, c.east ?? cell));
  return quads;
}
function stairsQuads(facing, half, cell) {
  const q = [];
  const upper = half === "top";
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
function fallbackModelFor(id, props, cell) {
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
var ZH = {
  stone: "\u77F3\u5934",
  smooth_stone: "\u5E73\u6ED1\u77F3\u5934",
  cobblestone: "\u5706\u77F3",
  cobbled_deepslate: "\u6DF1\u677F\u5CA9\u5706\u77F3",
  andesite: "\u5B89\u5C71\u5CA9",
  diorite: "\u95EA\u957F\u5CA9",
  granite: "\u82B1\u5C97\u5CA9",
  polished_andesite: "\u78E8\u5236\u5B89\u5C71\u5CA9",
  deepslate: "\u6DF1\u677F\u5CA9",
  blackstone: "\u9ED1\u77F3",
  obsidian: "\u9ED1\u66DC\u77F3",
  crying_obsidian: "\u54ED\u6CE3\u7684\u9ED1\u66DC\u77F3",
  dirt: "\u6CE5\u571F",
  grass_block: "\u8349\u65B9\u5757",
  podzol: "\u7070\u5316\u571F",
  mud: "\u6CE5\u5DF4",
  sand: "\u6C99\u5B50",
  gravel: "\u6C99\u783E",
  soul_sand: "\u7075\u9B42\u6C99",
  soul_soil: "\u7075\u9B42\u571F",
  clay: "\u9ECF\u571F",
  snow_block: "\u96EA\u5757",
  powder_snow: "\u7EC6\u96EA",
  ice: "\u51B0",
  packed_ice: "\u6D6E\u51B0",
  blue_ice: "\u84DD\u51B0",
  frosted_ice: "\u971C\u51B0",
  water: "\u6C34",
  lava: "\u7194\u5CA9",
  redstone_block: "\u7EA2\u77F3\u5757",
  redstone_wire: "\u7EA2\u77F3\u7C89",
  redstone_torch: "\u7EA2\u77F3\u706B\u628A",
  redstone_wall_torch: "\u5899\u4E0A\u7EA2\u77F3\u706B\u628A",
  redstone_lamp: "\u7EA2\u77F3\u706F",
  glowstone: "\u8367\u77F3",
  sea_lantern: "\u6D77\u6676\u706F",
  shroomlight: "\u83CC\u5149\u4F53",
  jack_o_lantern: "\u5357\u74DC\u706F",
  magma_block: "\u5CA9\u6D46\u5757",
  iron_block: "\u94C1\u5757",
  gold_block: "\u91D1\u5757",
  diamond_block: "\u94BB\u77F3\u5757",
  emerald_block: "\u7EFF\u5B9D\u77F3\u5757",
  netherite_block: "\u4E0B\u754C\u5408\u91D1\u5757",
  quartz_block: "\u77F3\u82F1\u5757",
  smooth_quartz: "\u5E73\u6ED1\u77F3\u82F1",
  quartz_pillar: "\u77F3\u82F1\u67F1",
  quartz_slab: "\u77F3\u82F1\u53F0\u9636",
  quartz_stairs: "\u77F3\u82F1\u697C\u68AF",
  smooth_quartz_slab: "\u5E73\u6ED1\u77F3\u82F1\u53F0\u9636",
  smooth_quartz_stairs: "\u5E73\u6ED1\u77F3\u82F1\u697C\u68AF",
  oak_planks: "\u6A61\u6728\u6728\u677F",
  spruce_planks: "\u4E91\u6749\u6728\u677F",
  birch_planks: "\u6866\u6728\u6728\u677F",
  cherry_planks: "\u6A31\u82B1\u6728\u677F",
  oak_log: "\u6A61\u6728\u539F\u6728",
  spruce_log: "\u4E91\u6749\u539F\u6728",
  cherry_log: "\u6A31\u82B1\u539F\u6728",
  birch_log: "\u6866\u6728\u539F\u6728",
  oak_leaves: "\u6A61\u6811\u6811\u53F6",
  cherry_leaves: "\u6A31\u82B1\u6811\u53F6",
  oak_stairs: "\u6A61\u6728\u697C\u68AF",
  oak_slab: "\u6A61\u6728\u53F0\u9636",
  cherry_stairs: "\u6A31\u82B1\u6728\u697C\u68AF",
  cherry_fence: "\u6A31\u82B1\u6728\u6805\u680F",
  cherry_fence_gate: "\u6A31\u82B1\u6728\u6805\u680F\u95E8",
  cherry_trapdoor: "\u6A31\u82B1\u6728\u6D3B\u677F\u95E8",
  cherry_door: "\u6A31\u82B1\u6728\u95E8",
  cherry_sign: "\u6A31\u82B1\u6728\u544A\u793A\u724C",
  cherry_wall_sign: "\u5899\u4E0A\u7684\u6A31\u82B1\u6728\u544A\u793A\u724C",
  oak_wall_sign: "\u5899\u4E0A\u7684\u6A61\u6728\u544A\u793A\u724C",
  birch_wall_sign: "\u5899\u4E0A\u7684\u6866\u6728\u544A\u793A\u724C",
  oak_fence_gate: "\u6A61\u6728\u6805\u680F\u95E8",
  oak_trapdoor: "\u6A61\u6728\u6D3B\u677F\u95E8",
  oak_pressure_plate: "\u6A61\u6728\u538B\u529B\u677F",
  cherry_pressure_plate: "\u6A31\u82B1\u6728\u538B\u529B\u677F",
  stone_bricks: "\u77F3\u7816",
  stone_brick_stairs: "\u77F3\u7816\u697C\u68AF",
  stone_brick_wall: "\u77F3\u7816\u5899",
  mossy_cobblestone: "\u82D4\u77F3",
  brick: "\u7816\u5757",
  terracotta: "\u9676\u74E6",
  white_concrete: "\u767D\u8272\u6DF7\u51DD\u571F",
  red_concrete: "\u7EA2\u8272\u6DF7\u51DD\u571F",
  light_gray_concrete: "\u6DE1\u7070\u8272\u6DF7\u51DD\u571F",
  gray_concrete: "\u7070\u8272\u6DF7\u51DD\u571F",
  black_concrete: "\u9ED1\u8272\u6DF7\u51DD\u571F",
  brown_concrete: "\u68D5\u8272\u6DF7\u51DD\u571F",
  orange_concrete: "\u6A59\u8272\u6DF7\u51DD\u571F",
  yellow_concrete: "\u9EC4\u8272\u6DF7\u51DD\u571F",
  lime_concrete: "\u9EC4\u7EFF\u8272\u6DF7\u51DD\u571F",
  green_concrete: "\u7EFF\u8272\u6DF7\u51DD\u571F",
  cyan_concrete: "\u9752\u8272\u6DF7\u51DD\u571F",
  light_blue_concrete: "\u6DE1\u84DD\u8272\u6DF7\u51DD\u571F",
  blue_concrete: "\u84DD\u8272\u6DF7\u51DD\u571F",
  purple_concrete: "\u7D2B\u8272\u6DF7\u51DD\u571F",
  magenta_concrete: "\u54C1\u7EA2\u8272\u6DF7\u51DD\u571F",
  pink_concrete: "\u7C89\u8272\u6DF7\u51DD\u571F",
  white_wool: "\u767D\u8272\u7F8A\u6BDB",
  red_wool: "\u7EA2\u8272\u7F8A\u6BDB",
  light_blue_wool: "\u6DE1\u84DD\u8272\u7F8A\u6BDB",
  white_carpet: "\u767D\u8272\u5730\u6BEF",
  pink_carpet: "\u7C89\u8272\u5730\u6BEF",
  white_stained_glass: "\u767D\u8272\u67D3\u8272\u73BB\u7483",
  red_stained_glass: "\u7EA2\u8272\u67D3\u8272\u73BB\u7483",
  yellow_stained_glass: "\u9EC4\u8272\u67D3\u8272\u73BB\u7483",
  lime_stained_glass: "\u9EC4\u7EFF\u8272\u67D3\u8272\u73BB\u7483",
  white_stained_glass_pane: "\u767D\u8272\u67D3\u8272\u73BB\u7483\u677F",
  lime_stained_glass_pane: "\u9EC4\u7EFF\u8272\u67D3\u8272\u73BB\u7483\u677F",
  pink_stained_glass_pane: "\u7C89\u8272\u67D3\u8272\u73BB\u7483\u677F",
  glass: "\u73BB\u7483",
  tinted_glass: "\u906E\u5149\u73BB\u7483",
  hopper: "\u6F0F\u6597",
  observer: "\u4FA6\u6D4B\u5668",
  piston: "\u6D3B\u585E",
  sticky_piston: "\u7C98\u6027\u6D3B\u585E",
  piston_head: "\u6D3B\u585E\u5934",
  dispenser: "\u53D1\u5C04\u5668",
  dropper: "\u6295\u63B7\u5668",
  crafter: "\u5408\u6210\u5668",
  chest: "\u7BB1\u5B50",
  trapped_chest: "\u9677\u9631\u7BB1",
  ender_chest: "\u672B\u5F71\u7BB1",
  barrel: "\u6728\u6876",
  furnace: "\u7194\u7089",
  crafting_table: "\u5DE5\u4F5C\u53F0",
  composter: "\u5806\u80A5\u6876",
  note_block: "\u97F3\u7B26\u76D2",
  jukebox: "\u5531\u7247\u673A",
  target: "\u6807\u9776",
  lever: "\u62C9\u6746",
  stone_button: "\u77F3\u6309\u94AE",
  repeater: "\u7EA2\u77F3\u4E2D\u7EE7\u5668",
  comparator: "\u7EA2\u77F3\u6BD4\u8F83\u5668",
  rail: "\u94C1\u8F68",
  powered_rail: "\u52A8\u529B\u94C1\u8F68",
  detector_rail: "\u63A2\u6D4B\u94C1\u8F68",
  activator_rail: "\u6FC0\u6D3B\u94C1\u8F68",
  scaffolding: "\u811A\u624B\u67B6",
  ladder: "\u68AF\u5B50",
  lantern: "\u706F\u7B3C",
  soul_lantern: "\u7075\u9B42\u706F\u7B3C",
  soul_campfire: "\u7075\u9B42\u8425\u706B",
  campfire: "\u8425\u706B",
  torch: "\u706B\u628A",
  soul_fire: "\u7075\u9B42\u706B",
  fire: "\u706B",
  deal: "\u544A\u793A\u724C",
  beacon: "\u4FE1\u6807",
  anvil: "\u94C1\u7827",
  stonecutter: "\u5207\u77F3\u673A",
  smithing_table: "\u953B\u9020\u53F0",
  cartography_table: "\u5236\u56FE\u53F0",
  loom: "\u7EC7\u5E03\u673A",
  grindstone: "\u7802\u8F6E",
  brewing_stand: "\u917F\u9020\u53F0",
  decorated_pot: "\u9970\u7EB9\u9676\u7F50",
  shulker_box: "\u6F5C\u5F71\u76D2",
  chiseled_bookshelf: "\u96D5\u7EB9\u4E66\u67B6",
  bookshelf: "\u4E66\u67B6",
  mangrove_roots: "\u7EA2\u6811\u6839",
  turtle_egg: "\u6D77\u9F9F\u86CB",
  sea_pickle: "\u6D77\u6CE1\u83DC",
  glow_lichen: "\u53D1\u5149\u5730\u8863",
  tube_coral_fan: "\u7BA1\u73CA\u745A\u6247",
  ochre_froglight: "\u8D6D\u9EC4\u86D9\u660E\u706F",
  pearlescent_froglight: "\u73E0\u5149\u86D9\u660E\u706F",
  netherrack: "\u4E0B\u754C\u5CA9",
  nether_bricks: "\u4E0B\u754C\u7816\u5757",
  end_stone: "\u672B\u5730\u77F3",
  prismarine: "\u6D77\u6676\u77F3",
  nether_portal: "\u4E0B\u754C\u4F20\u9001\u95E8",
  slime_block: "\u9ECF\u6DB2\u5757",
  honey_block: "\u8702\u871C\u5757",
  bubble_column: "\u6C14\u6CE1\u67F1",
  iron_trapdoor: "\u94C1\u6D3B\u677F\u95E8",
  iron_door: "\u94C1\u95E8",
  lava_cauldron: "\u88C5\u6709\u7194\u5CA9\u7684\u70BC\u836F\u9505",
  heavy_weighted_pressure_plate: "\u91CD\u8D28\u6D4B\u91CD\u538B\u529B\u677F",
  player_wall_head: "\u5899\u4E0A\u7684\u73A9\u5BB6\u5934\u9885",
  wither_skeleton_wall_skull: "\u5899\u4E0A\u7684\u51CB\u7075\u9AB7\u9AC5\u5934",
  tripwire: "\u7ECA\u7EBF",
  tripwire_hook: "\u7ECA\u7EBF\u94A9",
  powder_snow_cauldron: "\u88C5\u6709\u7EC6\u96EA\u7684\u70BC\u836F\u9505",
  cactus: "\u4ED9\u4EBA\u638C",
  sugar_cane: "\u7518\u8517",
  vine: "\u85E4\u8513",
  lily_pad: "\u7761\u83B2",
  bamboo: "\u7AF9\u5B50",
  tall_grass: "\u9AD8\u8349\u4E1B",
  grass: "\u8349",
  fern: "\u8568",
  moss_block: "\u82D4\u85D3\u5757",
  sculk: "\u5E7D\u533F",
  cherry_planks_slab: "\u6A31\u82B1\u6728\u53F0\u9636",
  smooth_stone_slab: "\u5E73\u6ED1\u77F3\u5934\u53F0\u9636",
  polished_blackstone_slab: "\u78E8\u5236\u9ED1\u77F3\u53F0\u9636",
  polished_blackstone_stairs: "\u78E8\u5236\u9ED1\u77F3\u697C\u68AF",
  diorite_wall: "\u95EA\u957F\u5CA9\u5899",
  glowstone_dust: "\u8367\u77F3\u7C89",
  // mock 专用
  oak_wood: "\u6A61\u6728",
  spruce_wood: "\u4E91\u6749\u6728"
};
function humanize(path) {
  return path.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
function fallbackZhName(blockId) {
  const path = blockId.replace(/^minecraft:/, "");
  if (ZH[path]) return ZH[path];
  const m = path.match(/^([a-z_]+?)_(concrete|wool|stained_glass|stained_glass_pane|carpet|terracotta|shulker_box)$/);
  if (m) {
    const dyeZh = { white: "\u767D\u8272", orange: "\u6A59\u8272", magenta: "\u54C1\u7EA2\u8272", light_blue: "\u6DE1\u84DD\u8272", yellow: "\u9EC4\u8272", lime: "\u9EC4\u7EFF\u8272", pink: "\u7C89\u8272", gray: "\u7070\u8272", light_gray: "\u6DE1\u7070\u8272", cyan: "\u9752\u8272", purple: "\u7D2B\u8272", blue: "\u84DD\u8272", brown: "\u68D5\u8272", green: "\u7EFF\u8272", red: "\u7EA2\u8272", black: "\u9ED1\u8272" };
    const kindZh = { concrete: "\u6DF7\u51DD\u571F", wool: "\u7F8A\u6BDB", stained_glass: "\u67D3\u8272\u73BB\u7483", stained_glass_pane: "\u67D3\u8272\u73BB\u7483\u677F", carpet: "\u5730\u6BEF", terracotta: "\u9676\u74E6", shulker_box: "\u6F5C\u5F71\u76D2" };
    if (dyeZh[m[1]] && kindZh[m[2]]) return dyeZh[m[1]] + kindZh[m[2]];
  }
  const woodZh = { oak: "\u6A61\u6728", spruce: "\u4E91\u6749", birch: "\u6866\u6728", jungle: "\u4E1B\u6797\u6728", acacia: "\u91D1\u5408\u6B22\u6728", dark_oak: "\u6DF1\u8272\u6A61\u6728", cherry: "\u6A31\u82B1\u6728", bamboo: "\u7AF9", mangrove: "\u7EA2\u6811\u6728", crimson: "\u7EEF\u7EA2", warped: "\u8BE1\u5F02" };
  const wm = path.match(/^(oak|spruce|birch|jungle|acacia|dark_oak|cherry|bamboo|mangrove|crimson|warped)_(.+)$/);
  if (wm && woodZh[wm[1]]) {
    const rest = wm[2];
    const restZh = { stairs: "\u697C\u68AF", slab: "\u53F0\u9636", fence: "\u6805\u680F", fence_gate: "\u6805\u680F\u95E8", door: "\u95E8", trapdoor: "\u6D3B\u677F\u95E8", sign: "\u544A\u793A\u724C", wall_sign: "\u5899\u4E0A\u7684\u544A\u793A\u724C", planks: "\u6728\u677F", log: "\u539F\u6728", leaves: "\u6811\u53F6", button: "\u6309\u94AE", pressure_plate: "\u538B\u529B\u677F", sapling: "\u6811\u82D7" }[rest];
    if (restZh) return woodZh[wm[1]] + restZh;
  }
  return humanize(path);
}
function createFallbackPack() {
  const atlasTexture = createFallbackAtlasTexture();
  const manifest = {
    format: 1,
    mcVersions: ["\u5185\u7F6E\u515C\u5E95"],
    dataVersion: null,
    atlas: { file: null, size: FALLBACK_ATLAS_SIZE, padding: 0 },
    textureScale: 16,
    fallback: true
  };
  const meta = {
    generated: (/* @__PURE__ */ new Date()).toISOString(),
    fallback: true,
    blockCount: 0,
    modelCount: 0,
    quadCount: 0,
    textureCount: 16,
    atlasUsage: 0,
    missingBlocks: [],
    missingTextures: [],
    notes: ["\u5185\u7F6E\u515C\u5E95\u8D44\u4EA7\uFF1Aassets/ \u672A\u52A0\u8F7D\uFF0C\u4F7F\u7528\u7A0B\u5E8F\u5316\u56FE\u96C6\u4E0E\u51E0\u4F55"]
  };
  return { manifest, meta, atlasTexture, atlasSize: FALLBACK_ATLAS_SIZE, lang: null };
}
export {
  CELL,
  FALLBACK_ATLAS_SIZE,
  createFallbackAtlasTexture,
  createFallbackPack,
  fallbackCell,
  fallbackColor,
  fallbackModelFor,
  fallbackZhName
};
