/**
 * litematic.js — 把 NBT 对象树解析成契约 §2 的 Schematic。
 *
 * 纯 ESM，零依赖，浏览器 / Node 双端可用。
 * 关键点（docs/CONTRACT.md §0/§2）：
 *  - Region.Size 任意轴可为负：minCorner = min(Position, Position + Size - sign(Size))
 *  - 容器索引始终从 minCorner 出发朝正方向：index = x + |sx|*z + |sx|*|sz|*y
 *  - BlockStates 为连续位打包（TightLongBackedIntArray），bits = max(2, 32 - clz32(paletteSize-1))
 *  - TileEntities 两种写法都支持；Entities 的 Pos 相对 region.Position（起始角，非 minCorner）
 *  - 所有异常只进 warnings，不抛异常
 */

import { RawLongArray } from './nbt.js';

/** 空气的方块状态字符串。 */
export const AIR = 'minecraft:air';

/** 单条越界信息最多报几次，之后合并成计数（避免 100 万方块刷爆 warnings）。 */
const MAX_DETAILED_WARNINGS = 5;

/**
 * 每个 palette 下标需要的位数（与 Litematica ArrayBlockContainer.getRequiredBitWidth 一致）。
 * paletteSize <= 1 时返回 0（此时 BlockStates 无需读取，全部为 0）。
 * @param {number} paletteSize
 * @returns {number} 2..32 / 0
 */
export function requiredBits(paletteSize) {
  if (!(paletteSize > 0)) return 0;
  return Math.max(2, 32 - Math.clz32(paletteSize - 1));
}

/** volume 个索引在 bits 位打包下需要多少个 long。 */
export function longCountFor(volume, bits) {
  if (!(volume > 0) || bits <= 0) return 0;
  return Math.ceil((volume * bits) / 64);
}

/** 把 BigInt64Array/BigUint64Array 形式的 long 数组拆成 lo/hi 两个 32 位半部。 */
function bigIntLongsToWords(longs) {
  const n = longs.length;
  const lo = new Uint32Array(n);
  const hi = new Uint32Array(n);
  const BIG = 0x100000000n;
  for (let i = 0; i < n; i++) {
    const v = BigInt.asUintN(64, BigInt(longs[i]));
    lo[i] = Number(v % BIG);
    hi[i] = Number(v / BIG);
  }
  return { length: n, lo, hi };
}

/** 把 number 数组（有符号 64 位）形式的 long 数组拆成 lo/hi 两个 32 位半部。 */
function numberLongsToWords(longs) {
  const n = longs.length;
  const lo = new Uint32Array(n);
  const hi = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const v = longs[i];
    lo[i] = v >>> 0;
    hi[i] = Math.floor(v / 4294967296) >>> 0;
  }
  return { length: n, lo, hi };
}

/**
 * 把任意受支持的 long 数组形式统一成 { length, lo: Uint32Array, hi: Uint32Array }。
 * 返回 null 表示不支持 / 缺失。
 * @param {RawLongArray|BigInt64Array|BigUint64Array|Array<number>|{length:number,lo:Uint32Array,hi:Uint32Array}|null|undefined} source
 */
function toLongWords(source) {
  if (!source) return null;
  if (source instanceof RawLongArray) {
    const n = source.length;
    const lo = new Uint32Array(n);
    const hi = new Uint32Array(n);
    const dv = source.dataView;
    const base = source.byteOffset;
    for (let i = 0; i < n; i++) {
      hi[i] = dv.getUint32(base + (i << 3));
      lo[i] = dv.getUint32(base + (i << 3) + 4);
    }
    return { length: n, lo, hi };
  }
  if (source instanceof BigInt64Array || source instanceof BigUint64Array) {
    return bigIntLongsToWords(source);
  }
  if (source && source.lo instanceof Uint32Array && source.hi instanceof Uint32Array) {
    return source;
  }
  if (Array.isArray(source)) {
    return numberLongsToWords(source);
  }
  return null;
}

/**
 * 连续位打包解包（TightLongBackedIntArray.getAt 的等价实现）。
 *
 * 性能关键路径：不分配 per-value 对象，用 lo/hi 两个 32 位半部做 32 位整数运算，
 * 避免 BigInt。1.5M long 的 BlockStates 解包在本机约 10~20 ms。
 *
 * @param {RawLongArray|BigInt64Array|BigUint64Array|Array<number>|{length:number,lo:Uint32Array,hi:Uint32Array}} source
 * @param {number} bits 每个 entry 的位数（0 表示全部为 0）
 * @param {number} count 需要解出的 entry 个数
 * @param {Uint32Array} [out] 可选输出数组（长度必须 >= count，未覆盖部分保持原值）
 * @returns {Uint32Array} 解出的索引数组
 */
export function unpackStates(source, bits, count, out) {
  const n = Math.max(0, count | 0);
  const indices = out instanceof Uint32Array && out.length >= n ? out : new Uint32Array(n);
  if (bits <= 0 || n === 0) return indices;
  if (bits > 32) throw new Error(`unpackStates: bits=${bits} 超出支持范围（1..32）`);

  const mask = bits === 32 ? 0xFFFFFFFF : (1 << bits) - 1;

  if (source instanceof RawLongArray) {
    // 零拷贝快速路径：直接读原始 NBT 字节（大端 64 位）
    const dv = source.dataView;
    const base = source.byteOffset;
    const available = Math.min(n, Math.floor((source.length * 64) / bits));
    let a = 0;
    let off = 0;
    for (let i = 0; i < available; i++) {
      const p = base + (a << 3);
      const hiWord = dv.getUint32(p);
      const loWord = dv.getUint32(p + 4);
      let v;
      if (off < 32) {
        if (off + bits <= 32) {
          v = loWord >>> off;
        } else {
          v = (loWord >>> off) | (hiWord << (32 - off));
        }
      } else {
        const o2 = off - 32;
        if (o2 + bits <= 32) {
          v = hiWord >>> o2;
        } else {
          v = (hiWord >>> o2) | (dv.getUint32(p + 12) << (32 - o2));
        }
      }
      indices[i] = v & mask;
      off += bits;
      while (off >= 64) {
        off -= 64;
        a++;
      }
    }
    return indices;
  }

  const words = toLongWords(source);
  if (!words) return indices;
  const lo = words.lo;
  const hi = words.hi;
  const available = Math.min(n, Math.floor((words.length * 64) / bits));
  let a = 0;
  let off = 0;
  for (let i = 0; i < available; i++) {
    const loWord = lo[a];
    const hiWord = hi[a];
    let v;
    if (off < 32) {
      if (off + bits <= 32) {
        v = loWord >>> off;
      } else {
        v = (loWord >>> off) | (hiWord << (32 - off));
      }
    } else {
      const o2 = off - 32;
      if (o2 + bits <= 32) {
        v = hiWord >>> o2;
      } else {
        v = (hiWord >>> o2) | (lo[a + 1] << (32 - o2));
      }
    }
    indices[i] = v & mask;
    off += bits;
    while (off >= 64) {
      off -= 64;
      a++;
    }
  }
  return indices;
}

/**
 * 把索引数组重新打包成 lo/hi 两个 32 位半部（用于与原始 BlockStates 逐 long 比对）。
 * @param {Uint32Array|number[]} indices
 * @param {number} bits
 * @returns {{length:number, lo:Uint32Array, hi:Uint32Array}}
 */
export function packStatesWords(indices, bits) {
  const n = indices ? indices.length : 0;
  if (bits <= 0 || n === 0) {
    return { length: 0, lo: new Uint32Array(0), hi: new Uint32Array(0) };
  }
  if (bits > 32) throw new Error(`packStatesWords: bits=${bits} 超出支持范围（1..32）`);
  const longCount = Math.ceil((n * bits) / 64);
  const lo = new Uint32Array(longCount);
  const hi = new Uint32Array(longCount);
  const mask = bits === 32 ? 0xFFFFFFFF : (1 << bits) - 1;
  let a = 0;
  let off = 0;
  for (let i = 0; i < n; i++) {
    const v = indices[i] & mask;
    if (off < 32) {
      lo[a] = (lo[a] | (v << off)) >>> 0;
      if (off + bits > 32) {
        hi[a] = (hi[a] | (v >>> (32 - off))) >>> 0;
      }
    } else {
      const o2 = off - 32;
      hi[a] = (hi[a] | (v << o2)) >>> 0;
      if (o2 + bits > 32) {
        lo[a + 1] = (lo[a + 1] | (v >>> (32 - o2))) >>> 0;
      }
    }
    off += bits;
    while (off >= 64) {
      off -= 64;
      a++;
    }
  }
  return { length: longCount, lo, hi };
}

/**
 * 把索引数组重新打包成 BigInt64Array（TAG_Long 语义，方便与 readNbt 默认输出比较）。
 * @param {Uint32Array|number[]} indices
 * @param {number} bits
 * @returns {BigInt64Array}
 */
export function packStates(indices, bits) {
  const words = packStatesWords(indices, bits);
  const out = new BigInt64Array(words.length);
  for (let i = 0; i < words.length; i++) {
    out[i] = BigInt.asIntN(64, (BigInt(words.hi[i]) << 32n) | BigInt(words.lo[i]));
  }
  return out;
}

/** 读取 {x,y,z} 形式的 vec3（也容忍 [x,y,z] 数组 / 缺字段）。 */
function readVec3(node) {
  if (Array.isArray(node)) {
    return { x: num(node[0]), y: num(node[1]), z: num(node[2]) };
  }
  if (node && typeof node === 'object') {
    return { x: num(node.x), y: num(node.y), z: num(node.z) };
  }
  return { x: 0, y: 0, z: 0 };
}

function num(v, fallback = 0) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'bigint') return Number(v);
  return fallback;
}

function str(v, fallback = '') {
  return typeof v === 'string' ? v : fallback;
}

/** palette[i] -> "minecraft:oak_stairs[facing=north,half=bottom]" */
function paletteEntryToString(entry, index, regionName, warnings) {
  let name = AIR;
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    if (typeof entry.Name === 'string' && entry.Name.length > 0) {
      name = entry.Name;
    } else {
      warnings.push(`region "${regionName}": palette[${index}] 缺少 Name，按 ${AIR} 处理`);
    }
    const props = entry.Properties;
    if (props && typeof props === 'object' && !Array.isArray(props)) {
      const keys = Object.keys(props);
      if (keys.length > 0) {
        keys.sort();
        const parts = new Array(keys.length);
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i];
          const pv = props[k];
          parts[i] = `${k}=${typeof pv === 'string' ? pv : String(pv)}`;
        }
        return `${name}[${parts.join(',')}]`;
      }
    }
    return name;
  }
  warnings.push(`region "${regionName}": palette[${index}] 不是 compound，按 ${AIR} 处理`);
  return AIR;
}

/**
 * 递归把输出 nbt 里残留的 RawLongArray 换成 BigInt64Array（skip 集合里的除外，
 * 即各 region 的 BlockStates —— 它们要在解包后直接丢弃，不需要展开）。
 */
function convertRawLongArrays(node, skip, depth = 0) {
  if (node === null || typeof node !== 'object' || depth > 512) return;
  if (ArrayBuffer.isView(node) || node instanceof RawLongArray) return;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const v = node[i];
      if (v instanceof RawLongArray) {
        if (!skip.has(v)) node[i] = v.toBigInt64Array();
      } else {
        convertRawLongArrays(v, skip, depth + 1);
      }
    }
    return;
  }
  for (const key of Object.keys(node)) {
    const v = node[key];
    if (v instanceof RawLongArray) {
      if (!skip.has(v)) node[key] = v.toBigInt64Array();
    } else {
      convertRawLongArrays(v, skip, depth + 1);
    }
  }
}

/** 从 region 节点解析方块实体列表（兼容 Litematica 原生 / 实测内联两种写法）。 */
function parseBlockEntities(regionNode, regionName, absSize, warnings) {
  const list = regionNode.TileEntities;
  const out = [];
  if (list === undefined || list === null) return out;
  if (!Array.isArray(list)) {
    warnings.push(`region "${regionName}": TileEntities 不是 TAG_List，已忽略`);
    return out;
  }
  let badCoord = 0;
  let badData = 0;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e || typeof e !== 'object' || Array.isArray(e)) {
      badData++;
      continue;
    }
    let x;
    let y;
    let z;
    let hasPos = false;
    if (Array.isArray(e.Pos) && e.Pos.length >= 3) {
      x = num(e.Pos[0], NaN);
      y = num(e.Pos[1], NaN);
      z = num(e.Pos[2], NaN);
      hasPos = Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
    } else if (typeof e.x === 'number' || typeof e.y === 'number' || typeof e.z === 'number') {
      x = num(e.x, NaN);
      y = num(e.y, NaN);
      z = num(e.z, NaN);
      hasPos = Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
    }
    if (!hasPos) {
      badData++;
      continue;
    }
    let nbt;
    const tileNbt = e.TileNBT;
    if (tileNbt && typeof tileNbt === 'object' && !Array.isArray(tileNbt)) {
      nbt = tileNbt;
    } else {
      // 实测变体：方块实体 NBT 直接内联，x/y/z 是坐标、不属于 NBT 内容
      nbt = {};
      for (const key of Object.keys(e)) {
        if (key === 'x' || key === 'y' || key === 'z' || key === 'Pos' || key === 'TileNBT') continue;
        nbt[key] = e[key];
      }
    }
    const id = typeof nbt.id === 'string' ? nbt.id : str(e.id);
    if (!(x >= 0 && x < absSize.x && y >= 0 && y < absSize.y && z >= 0 && z < absSize.z)) {
      badCoord++;
    }
    if (id.length === 0) badData++;
    out.push({ x, y, z, id, nbt });
  }
  if (badCoord > 0) {
    warnings.push(`region "${regionName}": ${badCoord} 个方块实体坐标越界（保留原值）`);
  }
  if (badData > 0) {
    warnings.push(`region "${regionName}": ${badData} 个方块实体缺少坐标或 id（已跳过/置空）`);
  }
  return out;
}

/** 从 region 节点解析实体列表；Pos 是相对 region.Position 的偏移。 */
function parseEntities(regionNode, regionName, absSize, position, warnings) {
  const list = regionNode.Entities;
  const out = [];
  if (list === undefined || list === null) return out;
  if (!Array.isArray(list)) {
    warnings.push(`region "${regionName}": Entities 不是 TAG_List，已忽略`);
    return out;
  }
  let badPos = 0;
  let farAway = 0;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e || typeof e !== 'object' || Array.isArray(e)) {
      badPos++;
      continue;
    }
    const p = e.Pos;
    if (!Array.isArray(p) || p.length < 3) {
      badPos++;
      continue;
    }
    const pos = [num(p[0]), num(p[1]), num(p[2])];
    const id = str(e.id);
    // 实体 Pos 相对 region.Position（起始角）。换算到 schematic 空间后应落在 region 包围盒 ±32 内。
    const wx = position.x + pos[0];
    const wy = position.y + pos[1];
    const wz = position.z + pos[2];
    const margin = 32;
    if (
      wx < position.x - margin ||
      wy < position.y - margin ||
      wz < position.z - margin ||
      wx > position.x + absSize.x + margin ||
      wy > position.y + absSize.y + margin ||
      wz > position.z + absSize.z + margin
    ) {
      farAway++;
    }
    out.push({ pos, id, nbt: e });
  }
  if (badPos > 0) {
    warnings.push(`region "${regionName}": ${badPos} 个实体缺少 Pos，已跳过`);
  }
  if (farAway > 0) {
    warnings.push(`region "${regionName}": ${farAway} 个实体位置超出 region 包围盒 ±32，保留原值`);
  }
  return out;
}

/** 解析 PendingBlockTicks / PendingFluidTicks。坐标是容器索引。 */
function parseTicks(regionNode, regionName, absSize, warnings) {
  const out = [];
  let outOfRange = 0;
  let bad = 0;
  const pushList = (list, kind) => {
    if (list === undefined || list === null) return;
    if (!Array.isArray(list)) {
      warnings.push(`region "${regionName}": ${kind} 不是 TAG_List，已忽略`);
      return;
    }
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!t || typeof t !== 'object' || Array.isArray(t)) {
        bad++;
        continue;
      }
      const x = num(t.x, NaN);
      const y = num(t.y, NaN);
      const z = num(t.z, NaN);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        bad++;
        continue;
      }
      const block = typeof t.Block === 'string' ? t.Block : typeof t.Fluid === 'string' ? t.Fluid : '';
      // PendingBlockTicks 用 Block，PendingFluidTicks 用 Fluid
      // 注意：实测部分文件的 tick 坐标会落在 [0,absSize) 的排他上界（== absSize），
      // 这是 Litematica 保存端的历史遗留；按契约口径算越界，但保留原值，只记 warning。
      if (!(x >= 0 && x < absSize.x && y >= 0 && y < absSize.y && z >= 0 && z < absSize.z)) {
        outOfRange++;
      }
      out.push({
        x,
        y,
        z,
        block,
        delay: num(t.Time),
        priority: num(t.Priority),
      });
    }
  };
  pushList(regionNode.PendingBlockTicks, 'PendingBlockTicks');
  pushList(regionNode.PendingFluidTicks, 'PendingFluidTicks');
  if (outOfRange > 0) {
    warnings.push(`region "${regionName}": ${outOfRange} 个 tick 坐标越界（保留原值）`);
  }
  if (bad > 0) {
    warnings.push(`region "${regionName}": ${bad} 个 tick 缺少坐标，已跳过`);
  }
  return out;
}

/** 解析单个 region。任何局部异常都在内部降级为 warning。 */
function parseRegion(name, regionNode, rootDataVersion, globalPalette, warnings) {
  const region = {
    name,
    position: { x: 0, y: 0, z: 0 },
    size: { x: 0, y: 0, z: 0 },
    absSize: { x: 0, y: 0, z: 0 },
    min: { x: 0, y: 0, z: 0 },
    max: { x: 0, y: 0, z: 0 },
    dataVersion: rootDataVersion,
    palette: [],
    indices: new Uint32Array(0),
    blockEntities: [],
    entities: [],
    ticks: [],
  };

  if (!regionNode || typeof regionNode !== 'object' || Array.isArray(regionNode)) {
    warnings.push(`region "${name}": 内容不是 TAG_Compound，已跳过`);
    return region;
  }

  try {
    const position = region.position;
    const size = region.size;
    const absSize = region.absSize;
    position.x = Math.trunc(readVec3(regionNode.Position).x);
    position.y = Math.trunc(readVec3(regionNode.Position).y);
    position.z = Math.trunc(readVec3(regionNode.Position).z);
    const rawSize = readVec3(regionNode.Size);
    size.x = Math.trunc(rawSize.x);
    size.y = Math.trunc(rawSize.y);
    size.z = Math.trunc(rawSize.z);
    absSize.x = Math.abs(size.x);
    absSize.y = Math.abs(size.y);
    absSize.z = Math.abs(size.z);

    for (const axis of ['x', 'y', 'z']) {
      const p = position[axis];
      const s = size[axis];
      const sign = Math.sign(s);
      region.min[axis] = Math.min(p, p + s - sign);
      region.max[axis] = region.min[axis] + absSize[axis];
    }

    region.dataVersion = num(regionNode.DataVersion, rootDataVersion);

    // palette
    const paletteNode = regionNode.BlockStatePalette;
    if (Array.isArray(paletteNode)) {
      for (let i = 0; i < paletteNode.length; i++) {
        region.palette.push(paletteEntryToString(paletteNode[i], i, name, warnings));
      }
    } else {
      warnings.push(`region "${name}": 缺少 BlockStatePalette`);
    }

    const volume = absSize.x * absSize.y * absSize.z;
    const bits = requiredBits(region.palette.length);
    const expectedLongs = longCountFor(volume, bits);
    const blockStates = regionNode.BlockStates;
    let actualLongs = 0;
    if (blockStates === undefined || blockStates === null) {
      if (volume > 0) warnings.push(`region "${name}": 缺少 BlockStates（${volume} 个方块按 air 处理）`);
    } else if (blockStates instanceof RawLongArray) {
      actualLongs = blockStates.length;
    } else if (ArrayBuffer.isView(blockStates) || Array.isArray(blockStates)) {
      actualLongs = blockStates.length;
    } else {
      warnings.push(`region "${name}": BlockStates 类型无法识别（按全 air 处理）`);
    }

    if (volume > 0) {
      if (actualLongs > expectedLongs) {
        warnings.push(`region "${name}": BlockStates 长度 ${actualLongs} 长于期望 ${expectedLongs}`);
      } else if (actualLongs < expectedLongs) {
        warnings.push(
          `region "${name}": BlockStates 长度 ${actualLongs} 短于期望 ${expectedLongs}（缺失部分按 air 处理）`,
        );
      }
      let indices;
      try {
        indices = new Uint32Array(volume);
      } catch (e) {
        warnings.push(`region "${name}": 体积 ${volume} 过大，无法分配索引数组（${e.message}）`);
        region.indices = new Uint32Array(0);
        // 仍然解析实体/方块实体/tick，便于 UI 展示元数据
        region.blockEntities = parseBlockEntities(regionNode, name, absSize, warnings);
        region.entities = parseEntities(regionNode, name, absSize, position, warnings);
        region.ticks = parseTicks(regionNode, name, absSize, warnings);
        return region;
      }
      const availableValues = bits > 0 ? Math.floor((actualLongs * 64) / bits) : 0;
      const unpackCount = Math.min(volume, availableValues);
      if (unpackCount > 0) {
        unpackStates(blockStates, bits, unpackCount, indices);
      }
      region.indices = indices;

      // 统计：非空方块 / 空气 / palette 计数（按首次出现顺序聚合，与 ground truth 一致）
      const paletteSize = region.palette.length;
      const counts = paletteSize > 0 ? new Uint32Array(paletteSize) : null;
      const firstPos = paletteSize > 0 ? new Uint32Array(paletteSize) : null;
      if (firstPos) firstPos.fill(0xFFFFFFFF);
      let blockCount = 0;
      let airCount = 0;
      let maxIndex = -1;
      let outOfRange = 0;
      for (let i = 0; i < volume; i++) {
        const v = indices[i];
        if (v >= paletteSize) {
          // 越界索引：按非空方块计，但不进 palette 统计
          blockCount++;
          outOfRange++;
          if (v > maxIndex) maxIndex = v;
          continue;
        }
        // 空气只按状态名判定：Litematica 生成的调色板通常把 air 放在 0 号，
        // 但格式本身并不保证这一点（合成/第三方工具产出的文件可能 0 号是实体方块）。
        const key = region.palette[v];
        if (key === AIR || key === undefined) {
          airCount++;
          continue;
        }
        blockCount++;
        counts[v]++;
        if (firstPos[v] === 0xFFFFFFFF) firstPos[v] = i;
      }
      if (outOfRange > 0) {
        warnings.push(
          `region "${name}": ${outOfRange} 个方块索引超出 palette（最大 ${maxIndex}，palette 长度 ${paletteSize}）`,
        );
      }
      region.absSize.volume = volume; // 内部使用，输出前删除
      region._blockCount = blockCount;
      region._airCount = airCount;
      region._paletteCounts = counts;
      region._paletteFirstPos = firstPos;
      if (counts && globalPalette) {
        // 按首次出现位置排序后并入全局 palette 计数，保证与 Python oracle 的顺序一致
        const order = [];
        for (let v = 0; v < paletteSize; v++) {
          if (counts[v] > 0 && region.palette[v] !== AIR) {
            order.push([firstPos[v], region.palette[v], counts[v]]);
          }
        }
        order.sort((a, b) => a[0] - b[0]);
        for (let i = 0; i < order.length; i++) {
          const key = order[i][1];
          const cnt = order[i][2];
          const prev = globalPalette.get(key);
          globalPalette.set(key, prev === undefined ? cnt : prev + cnt);
        }
      }
    } else if (region.palette.length > 0) {
      // 空 region（存在 0 长度轴）：保留 palette 元信息
    }

    region.blockEntities = parseBlockEntities(regionNode, name, absSize, warnings);
    region.entities = parseEntities(regionNode, name, absSize, position, warnings);
    region.ticks = parseTicks(regionNode, name, absSize, warnings);
  } catch (e) {
    warnings.push(`region "${name}" 解析失败: ${e && e.message ? e.message : String(e)}`);
  }
  return region;
}

/** 解析 Metadata 子标签（容忍缺失）。 */
function parseMetadata(root) {
  const md = root.Metadata;
  const out = {
    name: '',
    author: '',
    description: '',
    timeCreated: 0,
    timeModified: 0,
    totalBlocks: 0,
    totalVolume: 0,
    enclosingSize: { x: 0, y: 0, z: 0 },
  };
  if (!md || typeof md !== 'object' || Array.isArray(md)) return out;
  out.name = str(md.Name);
  out.author = str(md.Author);
  out.description = str(md.Description);
  out.timeCreated = num(md.TimeCreated);
  out.timeModified = num(md.TimeModified);
  out.totalBlocks = num(md.TotalBlocks);
  out.totalVolume = num(md.TotalVolume);
  out.enclosingSize = readVec3(md.EnclosingSize);
  return out;
}

/**
 * 把 NBT 根对象解析成契约 §2 的 Schematic。
 *
 * @param {object} nbtRoot readNbt() 的结果（BlockStates 可以是 RawLongArray 或 BigInt64Array）
 * @param {object} [options]
 * @param {string} [options.fileName=""]
 * @returns {object} Schematic
 */
export function parseLitematic(nbtRoot, options = {}) {
  const fileName = str(options.fileName);
  const warnings = [];

  const schematic = {
    fileName,
    format: 'litematic',
    version: -1,
    subVersion: -1,
    dataVersion: -1,
    metadata: {
      name: '',
      author: '',
      description: '',
      timeCreated: 0,
      timeModified: 0,
      totalBlocks: 0,
      totalVolume: 0,
      enclosingSize: { x: 0, y: 0, z: 0 },
    },
    size: { x: 0, y: 0, z: 0 },
    min: { x: 0, y: 0, z: 0 },
    max: { x: 0, y: 0, z: 0 },
    regions: [],
    stats: {
      blockCount: 0,
      volume: 0,
      regionCount: 0,
      blockEntityCount: 0,
      entityCount: 0,
      palette: [],
    },
    warnings,
  };

  if (!nbtRoot || typeof nbtRoot !== 'object' || Array.isArray(nbtRoot)) {
    warnings.push('NBT 根标签不是 TAG_Compound，无法解析 .litematic');
    return schematic;
  }

  schematic.version = num(nbtRoot.Version, -1);
  schematic.subVersion = num(nbtRoot.SubVersion, -1);
  schematic.dataVersion = num(nbtRoot.MinecraftDataVersion, -1);
  schematic.metadata = parseMetadata(nbtRoot);

  // 输出给 UI 的 NBT 必须是"干净"对象：把残留的 RawLongArray 展开成 BigInt64Array，
  // 但保留各 region 的 BlockStates（解包后即丢弃，不需要展开）。
  const keepRaw = new Set();
  const regionsNode = nbtRoot.Regions;
  if (regionsNode && typeof regionsNode === 'object' && !Array.isArray(regionsNode)) {
    for (const regionName of Object.keys(regionsNode)) {
      const rn = regionsNode[regionName];
      if (rn && typeof rn === 'object' && rn.BlockStates instanceof RawLongArray) {
        keepRaw.add(rn.BlockStates);
      }
    }
    convertRawLongArrays(nbtRoot, keepRaw);
  } else {
    convertRawLongArrays(nbtRoot, keepRaw);
    if (regionsNode !== undefined && regionsNode !== null) {
      warnings.push('Regions 不是 TAG_Compound，按空 schematic 处理');
    } else {
      warnings.push('缺少 Regions 标签，按空 schematic 处理');
    }
  }

  const globalPalette = new Map();
  let totalBlockCount = 0;
  let totalVolume = 0;
  let totalBlockEntities = 0;
  let totalEntities = 0;
  const bboxMin = { x: Infinity, y: Infinity, z: Infinity };
  const bboxMax = { x: -Infinity, y: -Infinity, z: -Infinity };

  if (regionsNode && typeof regionsNode === 'object' && !Array.isArray(regionsNode)) {
    for (const regionName of Object.keys(regionsNode)) {
      const region = parseRegion(regionName, regionsNode[regionName], schematic.dataVersion, globalPalette, warnings);
      // 内部临时字段（不进入契约输出）
      if (region._blockCount !== undefined) totalBlockCount += region._blockCount;
      if (region.absSize) totalVolume += region.absSize.x * region.absSize.y * region.absSize.z;
      totalBlockEntities += region.blockEntities.length;
      totalEntities += region.entities.length;
      if (region.indices.length > 0 || region.absSize.x * region.absSize.y * region.absSize.z > 0) {
        for (const axis of ['x', 'y', 'z']) {
          if (region.min[axis] < bboxMin[axis]) bboxMin[axis] = region.min[axis];
          if (region.max[axis] > bboxMax[axis]) bboxMax[axis] = region.max[axis];
        }
      }
      delete region._blockCount;
      delete region._airCount;
      delete region._paletteCounts;
      delete region._paletteFirstPos;
      if (region.absSize && region.absSize.volume !== undefined) delete region.absSize.volume;
      schematic.regions.push(region);
    }
  }

  if (Number.isFinite(bboxMin.x) && Number.isFinite(bboxMin.y) && Number.isFinite(bboxMin.z)) {
    schematic.min = { x: bboxMin.x, y: bboxMin.y, z: bboxMin.z };
    schematic.max = { x: bboxMax.x, y: bboxMax.y, z: bboxMax.z };
    schematic.size = {
      x: bboxMax.x - bboxMin.x,
      y: bboxMax.y - bboxMin.y,
      z: bboxMax.z - bboxMin.z,
    };
  }

  // 全局 palette：按 count 降序（稳定排序，count 相同保持首次出现顺序）
  const palette = [];
  for (const [id, count] of globalPalette) {
    const bracket = id.indexOf('[');
    palette.push({ id, name: bracket >= 0 ? id.slice(0, bracket) : id, count });
  }
  palette.sort((a, b) => b.count - a.count);

  schematic.stats.blockCount = totalBlockCount;
  schematic.stats.volume = totalVolume;
  schematic.stats.regionCount = schematic.regions.length;
  schematic.stats.blockEntityCount = totalBlockEntities;
  schematic.stats.entityCount = totalEntities;
  schematic.stats.palette = palette;
  schematic.warnings = warnings;
  return schematic;
}
