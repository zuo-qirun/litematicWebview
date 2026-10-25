// mcviewer —— 内置示例数据（合成 schematic）
//
// 用途：解析器（src/core）与资产（assets/）就绪之前，用真实形状的 Schematic
// 驱动整条渲染 + UI 链路，保证产品可独立验收。状态字符串全部是真实现代 MC 语法。
//
// 契约 §2：Region.palette 是「状态字符串数组」，indices 是 Uint32Array（palette 下标）。

const AIR = "minecraft:air";

class RegionBuilder {
  constructor(name, size) {
    this.name = name;
    this.size = { x: size[0], y: size[1], z: size[2] };
    this.cells = new Map();
    this.blockEntities = [];
    this.entities = [];
    this.ticks = [];
  }

  k(x, y, z) {
    return x * 1000000 + y * 1000 + z;
  }

  set(x, y, z, state) {
    const { x: sx, y: sy, z: sz } = this.size;
    if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) return this;
    this.cells.set(this.k(x, y, z), { x, y, z, state });
    return this;
  }

  /** 实心长方体（含端点） */
  fill(x0, y0, z0, x1, y1, z1, state) {
    const [ax, bx] = x0 <= x1 ? [x0, x1] : [x1, x0];
    const [ay, by] = y0 <= y1 ? [y0, y1] : [y1, y0];
    const [az, bz] = z0 <= z1 ? [z0, z1] : [z1, z0];
    for (let y = ay; y <= by; y++) {
      for (let x = ax; x <= bx; x++) {
        for (let z = az; z <= bz; z++) this.set(x, y, z, state);
      }
    }
    return this;
  }

  /** 空心长方体（只放壳，四周 + 上下） */
  shell(x0, y0, z0, x1, y1, z1, state) {
    const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)];
    const [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
    const [az, bz] = [Math.min(z0, z1), Math.max(z0, z1)];
    for (let y = ay; y <= by; y++) {
      for (let x = ax; x <= bx; x++) {
        for (let z = az; z <= bz; z++) {
          const edge = x === ax || x === bx || y === ay || y === by || z === az || z === bz;
          if (edge) this.set(x, y, z, state);
        }
      }
    }
    return this;
  }

  be(x, y, z, id, nbt) {
    this.blockEntities.push({ x, y, z, id, nbt: Object.assign({ id }, nbt || {}) });
    return this;
  }

  entity(type, pos, nbt) {
    this.entities.push({ type, pos, nbt: Object.assign({ id: type }, nbt || {}) });
    return this;
  }

  tick(x, y, z, type) {
    this.ticks.push({ x, y, z, type, delay: 1, priority: 0 });
    return this;
  }

  finish(position) {
    const { x: sx, y: sy, z: sz } = this.size;
    const palette = [];
    const paletteIndex = new Map();
    const indices = new Uint32Array(sx * sy * sz);
    let i = 0;
    for (let y = 0; y < sy; y++) {
      for (let z = 0; z < sz; z++) {
        for (let x = 0; x < sx; x++) {
          const cell = this.cells.get(this.k(x, y, z));
          const state = cell ? cell.state : AIR;
          let pi = paletteIndex.get(state);
          if (pi === undefined) {
            pi = palette.length;
            palette.push(state);
            paletteIndex.set(state, pi);
          }
          indices[i++] = pi;
        }
      }
    }
    return {
      name: this.name,
      position: position || { x: 0, y: 0, z: 0 },
      size: { x: sx, y: sy, z: sz },
      absSize: { x: sx, y: sy, z: sz },
      volume: sx * sy * sz,
      palette,
      indices,
      blockEntities: this.blockEntities,
      entities: this.entities,
      ticks: this.ticks,
    };
  }
}

/* ------------------------------------------------------------------ */
/* 小屋 + 红石海草机的小立体透视场景                                      */
/* ------------------------------------------------------------------ */

function buildWorkshop() {
  const W = 14;
  const H = 9;
  const D = 14;
  const r = new RegionBuilder("示例工地 · 主区", [W, H, D]);

  const grass = "minecraft:grass_block[snowy=false]";
  const planks = "minecraft:cherry_planks";
  const white = "minecraft:white_concrete";
  const pink = "minecraft:pink_concrete";
  const stone = "minecraft:stone";
  const smooth = "minecraft:smooth_stone";
  const glass = "minecraft:glass";
  const pane = "minecraft:white_stained_glass_pane[east=true,north=false,south=false,waterlogged=false,west=false]";
  const log = "minecraft:cherry_log[axis=y]";
  const leaves = "minecraft:cherry_leaves[distance=2,persistent=true,waterlogged=false]";
  const leafSmall = "minecraft:cherry_leaves[distance=4,persistent=true,waterlogged=false]";
  const water = "minecraft:water[level=0]";
  const lamp = "minecraft:redstone_lamp[lit=true]";
  const wire = "minecraft:redstone_wire[east=none,north=none,power=15,south=none,west=none]";
  const wireLine = "minecraft:redstone_wire[east=side,north=none,power=0,south=none,west=side]";
  const brick = "minecraft:bricks";
  const torch = "minecraft:torch";
  const seaLantern = "minecraft:sea_lantern";
  const fence = "minecraft:oak_fence[east=false,north=false,south=false,waterlogged=false,west=false]";

  // ── 地面：草地 + 石板小径 ─────────────────────────────────────────
  r.fill(0, 0, 0, W - 1, 0, D - 1, grass);
  for (let z = 4; z <= 12; z++) r.set(4, 0, z, smooth);
  for (let x = 4; x <= 8; x++) r.set(x, 0, 9, smooth);
  r.fill(0, 0, 0, W - 1, 0, 0, stone); // 边界压边

  // ── 小木屋：x 1..7 / z 1..7，墙高 y 1..4 ────────────────────────
  r.fill(1, 0, 1, 7, 0, 7, planks); // 地板
  r.fill(1, 1, 1, 7, 1, 7, white); // 墙基
  for (let y = 2; y <= 4; y++) {
    for (let x = 1; x <= 7; x++) {
      for (let z = 1; z <= 7; z++) {
        const wallX = x === 1 || x === 7;
        const wallZ = z === 1 || z === 7;
        if (!wallX && !wallZ) continue;
        const corner = wallX && wallZ;
        r.set(x, y, z, corner ? log : y === 4 ? pink : white);
      }
    }
  }
  // 窗户
  r.set(2, 2, 1, pane).set(2, 3, 1, pane).set(6, 2, 1, pane).set(6, 3, 1, pane);
  r.set(1, 2, 3, pane).set(1, 2, 5, pane).set(7, 2, 3, pane).set(7, 2, 5, pane);
  // 门洞（x=4,z=1）
  r.set(4, 1, 1, AIR).set(4, 2, 1, AIR);
  r.set(4, 0, 0, smooth);
  r.set(3, 1, 1, torch);
  // 屋顶：两坡
  r.fill(0, 5, 0, 8, 5, 8, planks);
  for (let x = 0; x <= 8; x++) {
    for (let z = 0; z <= 8; z++) {
      const rim = x === 0 || x === 8 || z === 0 || z === 8;
      if (rim) {
        const facing = z === 0 ? "north" : z === 8 ? "south" : x === 0 ? "west" : "east";
        r.set(x, 5, z, `minecraft:cherry_stairs[facing=${facing},half=bottom,shape=straight,waterlogged=false]`);
      }
    }
  }
  r.fill(2, 6, 2, 6, 6, 6, planks);
  r.fill(3, 7, 3, 5, 7, 5, planks);
  r.set(3, 8, 3, seaLantern);
  // 烟囱
  r.fill(2, 6, 2, 2, 8, 2, brick);

  // ── 屋顶下的吊灯 + 室内陈设 ─────────────────────────────────────
  r.set(4, 4, 4, seaLantern);
  r.set(2, 1, 5, `minecraft:chest[facing=west,type=single,waterlogged=false]`);
  r.set(3, 1, 5, `minecraft:chest[facing=west,type=single,waterlogged=false]`);
  r.set(6, 1, 6, `minecraft:barrel[facing=up,open=false]`);
  r.set(6, 1, 2, `minecraft:furnace[facing=north,lit=true]`);
  r.set(5, 1, 5, `minecraft:crafting_table`);
  r.set(2, 1, 2, `minecraft:bookshelf`);
  r.set(1, 1, 2, `minecraft:bookshelf`);

  // ── 院子：栅栏 + 花 + 樱桃树 ────────────────────────────────────
  for (let x = 9; x <= 13; x++) r.set(x, 1, 12, fence);
  for (let z = 9; z <= 12; z++) r.set(13, 1, z, fence);
  // 树 1
  r.fill(3, 1, 10, 3, 4, 10, log);
  r.fill(1, 5, 8, 5, 5, 12, leafSmall);
  r.fill(2, 6, 9, 4, 6, 11, leafSmall);
  r.set(3, 6, 10, leaves);
  r.set(3, 7, 10, leaves);
  // 树 2（小）
  r.fill(11, 1, 3, 11, 2, 3, log);
  r.fill(10, 3, 2, 12, 3, 4, leafSmall);
  r.set(11, 4, 3, leaves);

  // ── 红石海草机：玻璃水槽 + 活塞 + 观察者 + 漏斗收集 ──────────────
  // 水槽 x 9..12 / z 5..9，玻璃壳 y 1..3
  for (let y = 1; y <= 3; y++) {
    for (let x = 9; x <= 12; x++) {
      for (let z = 5; z <= 9; z++) {
        const edge = x === 9 || x === 12 || z === 5 || z === 9;
        if (edge) r.set(x, y, z, glass);
      }
    }
  }
  r.fill(10, 1, 6, 11, 2, 8, water);
  r.set(10, 1, 7, "minecraft:sea_pickle[pickles=4,waterlogged=true]");
  r.set(11, 1, 7, "minecraft:sea_pickle[pickles=2,waterlogged=true]");
  r.set(11, 1, 8, "minecraft:sea_pickle[pickles=4,waterlogged=true]");
  r.set(10, 1, 8, "minecraft:kelp[age=12]");
  r.set(11, 1, 6, "minecraft:kelp[age=23]");
  // 活塞 + 观察者（机头）
  r.set(10, 0, 5, stone);
  r.set(10, 1, 4, `minecraft:observer[facing=south,powered=false]`);
  r.set(10, 2, 4, `minecraft:piston[extended=false,facing=south]`);
  r.set(11, 1, 4, `minecraft:observer[facing=south,powered=true]`);
  // 红石线
  for (let x = 9; x <= 12; x++) r.set(x, 1, 3, wireLine);
  r.set(12, 1, 3, wire);
  r.set(9, 1, 3, `minecraft:repeater[delay=2,facing=east,locked=false,powered=true]`);
  r.set(10, 1, 2, `minecraft:redstone_wire[east=none,north=side,power=15,south=side,west=none]`);
  r.set(10, 1, 1, lamp);
  r.set(10, 2, 1, `minecraft:redstone_wall_torch[facing=south,lit=true]`);
  r.set(9, 2, 1, `minecraft:lever[face=wall,facing=east,powered=true]`);
  r.set(13, 1, 1, `minecraft:note_block[instrument=harp,note=12,powered=false]`);
  // 收集漏斗 → 箱子
  r.set(10, 0, 9, `minecraft:hopper[enabled=true,facing=down]`);
  r.set(11, 0, 9, `minecraft:hopper[enabled=true,facing=west]`);
  r.set(12, 0, 9, `minecraft:chest[facing=south,type=single,waterlogged=false]`);
  r.set(11, 0, 10, smooth);
  r.set(11, 1, 9, "minecraft:scaffolding[bottom=true,distance=0,waterlogged=false]");

  // ── 方块实体（NBT）─────────────────────────────────────────────
  r.be(12, 1, 5, "minecraft:chest", {
    CustomName: '{"text":"海草回收箱","color":"aqua"}',
    Items: [
      { Slot: 0, id: "minecraft:sea_pickle", Count: 32 },
      { Slot: 1, id: "minecraft:kelp", Count: 64 },
      { Slot: 2, id: "minecraft:kelp", Count: 12 },
      { Slot: 4, id: "minecraft:redstone", Count: 5 },
      { Slot: 13, id: "minecraft:diamond", Count: 3, tag: { Damage: 0 } },
      { Slot: 26, id: "minecraft:name_tag", Count: 1, tag: { display: { Name: '{"text":"海草机 v2"}' } } },
    ],
  });
  r.be(10, 1, 9, "minecraft:hopper", {
    Items: [{ Slot: 0, id: "minecraft:sea_pickle", Count: 64 }],
    TransferCooldown: 8,
  });
  r.be(2, 1, 5, "minecraft:chest", {
    Items: [
      { Slot: 0, id: "minecraft:cherry_planks", Count: 64 },
      { Slot: 1, id: "minecraft:white_concrete", Count: 48 },
      { Slot: 2, id: "minecraft:cherry_stairs", Count: 24 },
      { Slot: 5, id: "minecraft:torch", Count: 16 },
      { Slot: 9, id: "minecraft:oak_fence", Count: 30 },
    ],
  });
  r.be(6, 1, 6, "minecraft:barrel", {
    Items: [
      { Slot: 0, id: "minecraft:bone_meal", Count: 64 },
      { Slot: 1, id: "minecraft:bone_meal", Count: 21 },
    ],
  });
  r.be(6, 1, 2, "minecraft:furnace", { BurnTime: 400, CookTime: 87, CookTimeTotal: 200 });
  r.be(11, 0, 9, "minecraft:hopper", {
    Items: [{ Slot: 0, id: "minecraft:kelp", Count: 9 }],
  });
  // 实体
  r.entity("minecraft:armor_stand", [4.5, 1, 3.5], { Invisible: 0, ShowArms: 1 });
  r.entity("minecraft:item", [10.5, 1.2, 6.5], { Item: { id: "minecraft:kelp", Count: 1 } });
  // 计划刻
  r.tick(10, 1, 4, "minecraft:repeater");
  r.tick(10, 1, 3, "minecraft:redstone_wire");

  return r.finish({ x: 0, y: 0, z: 0 });
}

/** 第二个 Region：一个小展台，用来验证 region 显隐 / 偏移坐标 */
function buildShowcase() {
  const r = new RegionBuilder("示例展台", [4, 4, 4]);
  const smooth = "minecraft:smooth_stone";
  const seaLantern = "minecraft:sea_lantern";
  r.fill(0, 0, 0, 3, 0, 3, smooth);
  r.fill(0, 0, 0, 3, 1, 0, "minecraft:polished_andesite");
  r.set(1, 1, 1, seaLantern).set(2, 1, 2, seaLantern);
  r.set(1, 1, 2, "minecraft:gold_block");
  r.set(1, 2, 1, "minecraft:diamond_block");
  r.set(2, 1, 1, "minecraft:emerald_block");
  // 玻璃罩
  for (let y = 2; y <= 3; y++) {
    for (let x = 1; x <= 2; x++) {
      for (let z = 1; z <= 2; z++) {
        const edge = y === 2 || x === 1 || x === 2 || z === 1 || z === 2;
        if (edge) r.set(x, y, z, "minecraft:glass");
      }
    }
  }
  r.set(3, 1, 3, "minecraft:lantern[hanging=false,waterlogged=false]");
  r.be(3, 1, 0, "minecraft:chest", {
    Items: [{ Slot: 0, id: "minecraft:diamond_block", Count: 1 }],
  });
  return r.finish({ x: 14, y: 0, z: 1 });
}

/** 生成示例 Schematic（契约 §2 结构） */
export function buildMockSchematic() {
  const regions = [buildWorkshop(), buildShowcase()];
  let blockCount = 0;
  for (const reg of regions) {
    for (const st of reg.palette) if (st !== AIR) blockCount += 0;
    // 统计非空气方块
    const airIdx = new Set();
    reg.palette.forEach((st, i) => {
      if (st === AIR) airIdx.add(i);
    });
    for (let i = 0; i < reg.indices.length; i++) if (!airIdx.has(reg.indices[i])) blockCount++;
  }
  return {
    name: "示例 · 红石海草机",
    author: "mcviewer 内置",
    description: "无需文件即可预览：小屋、樱桃树与一台带观察者/活塞的海草收集机。",
    mcVersion: "1.21.1",
    dataVersion: 3955,
    size: { x: 18, y: 9, z: 14 },
    regions,
    warnings: [],
    stats: { blockCount, regionCount: regions.length },
    blockCount,
  };
}

export const MOCK_FILE_NAME = "示例 · 红石海草机.litematic";
