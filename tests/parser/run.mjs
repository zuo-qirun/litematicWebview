#!/usr/bin/env node
/**
 * tests/parser/run.mjs — 解析器自检（`node tests/parser/run.mjs`）。
 *
 * 覆盖：
 *  A. 真实 fixture（tests/fixtures/*.litematic）全量解析 + 与 tests/parser/expected.json
 *     （Lead 的独立 Python oracle）逐项零容差比对；
 *  B. 结构性断言：indices 长度、索引范围、repack 回 long 数组逐 long 相等、
 *     方块实体 / 实体 / tick 坐标合法性；
 *  C. 合成单元测试：Variant A 方块实体（Pos + TileNBT）、Variant B 内联写法、
 *     负 size、NBT 全 tag 覆盖、双环境 gzip 路径、非法输入降级；
 *  D. 性能：fixture 单文件耗时、10 万 / 100 万方块合成数据解析耗时。
 *
 * 退出码：全部通过 0，否则 1（`pnpm test` / e2e 依赖此约定）。
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadSchematic, isLitematic, inflateGzip } from '../../src/core/index.js';
import { readNbt, RawLongArray, TAG } from '../../src/core/nbt.js';
import {
  parseLitematic,
  requiredBits,
  longCountFor,
  packStates,
  packStatesWords,
  unpackStates,
  AIR,
} from '../../src/core/litematic.js';

// ---------------------------------------------------------------------------
// 测试框架（极简）
// ---------------------------------------------------------------------------

let checkCount = 0;
const failures = [];

/** BigInt 不能直接 JSON.stringify，统一转成字符串表示再比较（不影响数值相等性）。 */
function toComparableJson(v) {
  if (ArrayBuffer.isView(v)) v = Array.from(v);
  try {
    return JSON.stringify(v, (_k, val) => (typeof val === 'bigint' ? `${val}n` : val));
  } catch {
    return String(v);
  }
}

function fmtValue(v) {
  const s = toComparableJson(v);
  return s === undefined ? String(v) : s.length > 160 ? `${s.slice(0, 160)}…` : s;
}

function deepEqual(a, b) {
  return toComparableJson(a) === toComparableJson(b);
}

/** 断言相等（零容差）。 */
function check(label, actual, expected) {
  checkCount++;
  if (!deepEqual(actual, expected)) {
    failures.push({ label, actual: fmtValue(actual), expected: fmtValue(expected) });
    return false;
  }
  return true;
}

/** 断言为 true。 */
function assert(label, cond, detail = '') {
  checkCount++;
  if (!cond) {
    failures.push({ label, actual: `false${detail ? ` (${detail})` : ''}`, expected: 'true' });
    return false;
  }
  return true;
}

const log = (s = '') => process.stdout.write(`${s}\n`);
const hr = (ch = '─', n = 108) => log(ch.repeat(n));

// ---------------------------------------------------------------------------
// 表格排版（CJK 宽度感知）
// ---------------------------------------------------------------------------

function displayWidth(s) {
  let w = 0;
  for (const ch of String(s)) {
    const cp = ch.codePointAt(0);
    const wide =
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe6f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f300 && cp <= 0x1faff);
    w += wide ? 2 : 1;
  }
  return w;
}

const padR = (s, n) => `${s}${' '.repeat(Math.max(0, n - displayWidth(s)))}`;
const padL = (s, n) => `${' '.repeat(Math.max(0, n - displayWidth(s)))}${s}`;

function printTable(header, rows) {
  const widths = header.map((h, i) => Math.max(displayWidth(h), ...rows.map((r) => displayWidth(r[i]))));
  log(header.map((h, i) => padR(h, widths[i])).join('  '));
  log(widths.map((w) => '─'.repeat(w)).join('  '));
  for (const row of rows) log(row.map((c, i) => padR(c, widths[i])).join('  '));
}

// ---------------------------------------------------------------------------
// 路径
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(here, '..', '..');
const fixturesDir = path.join(rootDir, 'tests', 'fixtures');
const expectedPath = path.join(here, 'expected.json');

// ---------------------------------------------------------------------------
// A. fixture 解析 + ground truth 比对
// ---------------------------------------------------------------------------

const state = { fixtureRows: [], perFileMs: new Map() };

async function runFixtureTests() {
  log('══ A. 真实 fixture 解析 + ground truth（tests/parser/expected.json）比对 ══');
  if (!existsSync(expectedPath)) {
    assert('tests/parser/expected.json 存在', false, '缺失，无法做 ground truth 比对');
    return;
  }
  const expected = JSON.parse(readFileSync(expectedPath, 'utf8'));
  const fixtures = readdirSync(fixturesDir)
    .filter((f) => f.toLowerCase().endsWith('.litematic'))
    .sort();
  check('fixture 文件数', fixtures.length, expected.files.length);
  for (const f of expected.files) {
    assert(`fixture 存在: ${f.fileName}`, fixtures.includes(f.fileName));
    assert(`fixture 尺寸一致: ${f.fileName}`, readFileSync(path.join(fixturesDir, f.fileName)).length === f.fileSize);
  }

  // 预热（首次调用包含模块初始化 / DecompressionStream 启动开销，不计入单文件耗时）
  try {
    await loadSchematic(readFileSync(path.join(fixturesDir, expected.files[0].fileName)), 'warmup');
  } catch {
    /* 预热失败不影响正式断言 */
  }

  for (const exp of expected.files) {
    const fileFailStart = failures.length;
    const filePath = path.join(fixturesDir, exp.fileName);
    const buf = readFileSync(filePath);
    assert(`isLitematic: ${exp.fileName}`, isLitematic(buf) === true);

    const t0 = performance.now();
    const sch = await loadSchematic(buf, exp.fileName);
    const ms = performance.now() - t0;
    state.perFileMs.set(exp.fileName, ms);

    // 独立读取原始 long 数组（用于 repack 逐 long 比对）
    const rawRoot = readNbt(new Uint8Array(gunzipSync(buf)), { longArrayAs: 'raw' });

    const f = exp.fileName;
    check(`${f} format`, sch.format, 'litematic');
    check(`${f} fileName`, sch.fileName, exp.fileName);
    check(`${f} version`, sch.version, exp.version);
    check(`${f} subVersion`, sch.subVersion, exp.subVersion);
    check(`${f} dataVersion`, sch.dataVersion, exp.dataVersion);

    // ---- 文件级统计 ----
    check(`${f} regionCount`, sch.regions.length, exp.regionCount);
    check(`${f} stats.regionCount`, sch.stats.regionCount, exp.regionCount);
    check(`${f} blockCount`, sch.stats.blockCount, exp.blockCount);
    check(`${f} volume`, sch.stats.volume, exp.volume);
    check(`${f} blockEntityCount`, sch.stats.blockEntityCount, exp.blockEntityCount);
    check(`${f} entityCount`, sch.stats.entityCount, exp.entityCount);
    const tickSum = sch.regions.reduce((n, r) => n + r.ticks.length, 0);
    check(`${f} tickCount`, tickSum, exp.tickCount);
    check(`${f} min`, [sch.min.x, sch.min.y, sch.min.z], exp.min);
    check(`${f} max`, [sch.max.x, sch.max.y, sch.max.z], exp.max);
    check(`${f} size`, [sch.size.x, sch.size.y, sch.size.z], exp.size);
    check(`${f} paletteSize`, sch.stats.palette.length, exp.paletteSize);

    // palette 按 count 降序、count 求和 = 非空方块数、无空气条目
    let prevCount = Infinity;
    let sumPalette = 0;
    let airInPalette = 0;
    for (const entry of sch.stats.palette) {
      assert(`${f} palette 降序(${entry.id})`, entry.count <= prevCount, `${entry.count} > ${prevCount}`);
      prevCount = entry.count;
      sumPalette += entry.count;
      if (entry.id === AIR) airInPalette++;
      assert(`${f} palette id/name 一致(${entry.id})`, entry.name === entry.id.split('[')[0]);
    }
    check(`${f} palette count 总和 = blockCount`, sumPalette, exp.blockCount);
    check(`${f} palette 不含空气`, airInPalette, 0);

    // 与 Python oracle 的 top-N palette 逐项比对（id + count，顺序敏感）
    const topN = Math.min(exp.paletteTop.length, sch.stats.palette.length);
    check(
      `${f} paletteTop 前 ${topN} 项`,
      sch.stats.palette.slice(0, topN).map((e) => ({ id: e.id, count: e.count })),
      exp.paletteTop.slice(0, topN),
    );

    // ---- region 级 ----
    check(`${f} region 数量`, sch.regions.length, exp.regions.length);
    let regionVolumeSum = 0;
    let regionBlockSum = 0;
    let regionBeSum = 0;
    let regionEntSum = 0;
    let regionTickSum = 0;
    let invalidIndexCount = 0;
    let repackLongDiffs = 0;
    let beCoordBad = 0;
    let entFar = 0;
    let tickBad = 0;
    let tickBoundary = 0;

    for (let ri = 0; ri < Math.min(sch.regions.length, exp.regions.length); ri++) {
      const region = sch.regions[ri];
      const er = exp.regions[ri];
      const tag = `${f} / region[${ri}] ${er.name}`;

      check(`${tag} name`, region.name, er.name);
      check(`${tag} position`, [region.position.x, region.position.y, region.position.z], er.position);
      check(`${tag} size`, [region.size.x, region.size.y, region.size.z], er.size);
      check(`${tag} absSize`, [region.absSize.x, region.absSize.y, region.absSize.z], er.absSize);
      check(`${tag} min`, [region.min.x, region.min.y, region.min.z], er.min);
      check(`${tag} max`, [region.max.x, region.max.y, region.max.z], er.max);
      check(`${tag} dataVersion`, region.dataVersion, er.dataVersion);

      const volume = region.absSize.x * region.absSize.y * region.absSize.z;
      check(`${tag} volume`, volume, er.volume);
      regionVolumeSum += volume;
      check(`${tag} volume = expected`, volume, er.volume);

      const bits = requiredBits(region.palette.length);
      check(`${tag} bits`, bits, er.bits);
      check(`${tag} paletteSize`, region.palette.length, er.paletteSize);
      check(`${tag} indices.length = absSize 乘积`, region.indices.length, volume);

      // 所有 index < palette.length
      let regionInvalid = 0;
      for (let i = 0; i < region.indices.length; i++) {
        if (region.indices[i] >= region.palette.length) regionInvalid++;
      }
      invalidIndexCount += regionInvalid;
      check(`${tag} indices 全部 < paletteSize`, regionInvalid, 0);

      // 独立重算非空方块 / 空气
      let nonAir = 0;
      for (let i = 0; i < region.indices.length; i++) {
        const v = region.indices[i];
        if (v === 0 || region.palette[v] === AIR) continue;
        nonAir++;
      }
      const air = volume - nonAir;
      check(`${tag} blockCount（独立重算）`, nonAir, er.blockCount);
      check(`${tag} airCount（独立重算）`, air, er.airCount);
      regionBlockSum += nonAir;

      // repack 回 long 数组，与原文件 BlockStates **逐 long** 比对（lo/hi 两个 32 位半部）
      const rawLongs = rawRoot && rawRoot.Regions && rawRoot.Regions[er.name] && rawRoot.Regions[er.name].BlockStates;
      if (!(rawLongs instanceof RawLongArray)) {
        assert(`${tag} 原始 BlockStates 为 TAG_Long_Array`, false);
      } else {
        check(`${tag} longCount`, rawLongs.length, er.longCount);
        const words = packStatesWords(region.indices, bits);
        check(`${tag} repack long 数`, words.length, rawLongs.length);
        const n = Math.min(rawLongs.length, words.length);
        let diff = 0;
        let firstDiff = -1;
        for (let i = 0; i < n; i++) {
          if (rawLongs.getLo(i) !== words.lo[i] || rawLongs.getHi(i) !== words.hi[i]) {
            diff++;
            if (firstDiff < 0) firstDiff = i;
          }
        }
        repackLongDiffs += diff;
        check(`${tag} repack 逐 long 相等`, diff, 0);
        if (diff > 0) {
          log(
            `    ! ${tag} 首个差异 long #${firstDiff}: 原始 lo/hi=${rawLongs.getLo(firstDiff).toString(16)}/${rawLongs
              .getHi(firstDiff)
              .toString(16)}，repack lo/hi=${words.lo[firstDiff].toString(16)}/${words.hi[firstDiff].toString(16)}`,
          );
        }
      }

      // 方块实体：容器索引 ∈ [0, absSize)
      for (const be of region.blockEntities) {
        const ok = be.x >= 0 && be.x < region.absSize.x && be.y >= 0 && be.y < region.absSize.y && be.z >= 0 && be.z < region.absSize.z;
        if (!ok) beCoordBad++;
      }
      check(`${tag} blockEntityCount`, region.blockEntities.length, er.blockEntityCount);

      // 实体：Pos 相对 region.Position，换算到 schematic 空间后落在 region 包围盒 ±32 内
      for (const ent of region.entities) {
        const wx = region.position.x + ent.pos[0];
        const wy = region.position.y + ent.pos[1];
        const wz = region.position.z + ent.pos[2];
        const m = 32;
        const ok =
          wx >= region.min.x - m &&
          wx <= region.max.x + m &&
          wy >= region.min.y - m &&
          wy <= region.max.y + m &&
          wz >= region.min.z - m &&
          wz <= region.max.z + m;
        if (!ok) entFar++;
      }
      check(`${tag} entityCount`, region.entities.length, er.entityCount);

      // tick：实测存在落在排他上界（absSize）上的历史遗留坐标 → 允许 ==absSize，但必须 warning
      let regionBoundary = 0;
      for (const tk of region.ticks) {
        const inRange = tk.x >= 0 && tk.x <= region.absSize.x && tk.y >= 0 && tk.y <= region.absSize.y && tk.z >= 0 && tk.z <= region.absSize.z;
        if (!inRange) tickBad++;
        const onBoundary =
          tk.x === region.absSize.x || tk.y === region.absSize.y || tk.z === region.absSize.z;
        if (onBoundary) regionBoundary++;
      }
      tickBoundary += regionBoundary;
      if (regionBoundary > 0) {
        const hasWarning = sch.warnings.some(
          (w) => w.includes(region.name) && w.includes(`${regionBoundary} 个 tick 坐标越界`),
        );
        assert(`${tag} tick 越界有 warning`, hasWarning, `期望含 "${regionBoundary} 个 tick 坐标越界" 的 warning`);
      }
      check(`${tag} tickCount`, region.ticks.length, er.tickCount);
      regionTickSum += region.ticks.length;
      regionBeSum += region.blockEntities.length;
      regionEntSum += region.entities.length;
    }

    check(`${f} region volume 求和`, regionVolumeSum, exp.volume);
    check(`${f} region blockCount 求和`, regionBlockSum, exp.blockCount);
    check(`${f} region blockEntityCount 求和`, regionBeSum, exp.blockEntityCount);
    check(`${f} region entityCount 求和`, regionEntSum, exp.entityCount);
    check(`${f} region tickCount 求和`, regionTickSum, exp.tickCount);
    check(`${f} 无越界方块索引`, invalidIndexCount, 0);
    check(`${f} repack 全部 long 相等`, repackLongDiffs, 0);
    check(`${f} 方块实体坐标全部在 [0,absSize)`, beCoordBad, 0);
    check(`${f} 实体位置全部在 region bbox ±32`, entFar, 0);
    check(`${f} tick 坐标全部在 [0,absSize]（允许排他上界）`, tickBad, 0);

    // metadata 自检（契约要求字段齐全；TotalBlocks/TotalVolume 仅作信息展示，可能不准）
    const md = sch.metadata;
    assert(`${f} metadata.name 是字符串`, typeof md.name === 'string');
    assert(`${f} metadata.author 是字符串`, typeof md.author === 'string');
    assert(`${f} metadata.enclosingSize 三轴齐全`, ['x', 'y', 'z'].every((k) => typeof md.enclosingSize[k] === 'number'));
    assert(`${f} metadata.timeCreated 是 number`, typeof md.timeCreated === 'number');
    check(`${f} metadata.name = 文件名?`, typeof md.name, 'string');

    state.fixtureRows.push({
      result: failures.length === fileFailStart ? 'PASS' : 'FAIL',
      file: f,
      regions: `${sch.regions.length}`,
      volume: `${sch.stats.volume}`,
      blocks: `${sch.stats.blockCount}`,
      blockEntities: `${sch.stats.blockEntityCount}`,
      entities: `${sch.stats.entityCount}`,
      ticks: `${tickSum}`,
      bbox: `${sch.size.x}×${sch.size.y}×${sch.size.z}`,
      ms: `${ms.toFixed(1)} ms`,
      warnings: `${sch.warnings.length}`,
    });

    for (const w of sch.warnings) log(`    [warn] ${w}`);
    if (tickBoundary > 0) {
      log(`    [已知异常] ${tickBoundary} 个 tick 坐标落在排他上界（absSize），已保留原值并记 warning`);
    }
    log(
      `  ${failures.length === fileFailStart ? '[PASS]' : '[FAIL]'} ${f}: ${sch.regions.length} region, ${sch.stats.blockCount} 非空方块, ` +
        `${ms.toFixed(1)} ms, warnings=${sch.warnings.length}`,
    );
  }

  // 第二个解析路径：默认 readNbt（long array 展开成 BigInt64Array）应与 raw 路径结果一致
  const smallFile = '25w简易海草机by-half_kite.litematic';
  const smallBuf = readFileSync(path.join(fixturesDir, smallFile));
  const cleanRoot = readNbt(new Uint8Array(gunzipSync(smallBuf)));
  const schClean = parseLitematic(cleanRoot, { fileName: smallFile });
  const schRaw = await loadSchematic(smallBuf, smallFile);
  check(`${smallFile} 双路径 regionCount`, schClean.regions.length, schRaw.regions.length);
  check(`${smallFile} 双路径 blockCount`, schClean.stats.blockCount, schRaw.stats.blockCount);
  check(`${smallFile} 双路径 indices`, Array.from(schClean.regions[0].indices), Array.from(schRaw.regions[0].indices));
  check(`${smallFile} 双路径 palette`, schClean.regions[0].palette, schRaw.regions[0].palette);
}

// ---------------------------------------------------------------------------
// B. 合成 NBT 写入器（仅测试用，验证 NBT 读取器全 tag 覆盖）
// ---------------------------------------------------------------------------

class SyntheticNbtWriter {
  constructor() {
    this.bytes = [];
  }

  u8(v) {
    this.bytes.push(v & 0xff);
  }

  i16(v) {
    const x = v & 0xffff;
    this.bytes.push((x >>> 8) & 0xff, x & 0xff);
  }

  i32(v) {
    const x = v >>> 0;
    this.bytes.push((x >>> 24) & 0xff, (x >>> 16) & 0xff, (x >>> 8) & 0xff, x & 0xff);
  }

  i64(v) {
    const b = BigInt.asUintN(64, BigInt(v));
    for (let shift = 56n; shift >= 0n; shift -= 8n) this.bytes.push(Number((b >> shift) & 0xffn));
  }

  f32(v) {
    const ab = new ArrayBuffer(4);
    new DataView(ab).setFloat32(0, v);
    for (const b of new Uint8Array(ab)) this.bytes.push(b);
  }

  f64(v) {
    const ab = new ArrayBuffer(8);
    new DataView(ab).setFloat64(0, v);
    for (const b of new Uint8Array(ab)) this.bytes.push(b);
  }

  str(s) {
    const enc = new TextEncoder().encode(s);
    this.i16(enc.length);
    for (const b of enc) this.bytes.push(b);
  }

  raw(arr) {
    for (const b of arr) this.bytes.push(b);
  }

  toBytes() {
    return new Uint8Array(this.bytes);
  }
}

function writePayload(w, type, value) {
  switch (type) {
    case TAG.BYTE:
      w.u8(value);
      break;
    case TAG.SHORT:
      w.i16(value);
      break;
    case TAG.INT:
      w.i32(value);
      break;
    case TAG.LONG:
      w.i64(value);
      break;
    case TAG.FLOAT:
      w.f32(value);
      break;
    case TAG.DOUBLE:
      w.f64(value);
      break;
    case TAG.BYTE_ARRAY: {
      const arr = value instanceof Uint8Array ? value : Uint8Array.from(value);
      w.i32(arr.length);
      w.raw(arr);
      break;
    }
    case TAG.STRING:
      w.str(value);
      break;
    case TAG.LIST: {
      const items = value.items || [];
      w.u8(value.type);
      w.i32(items.length);
      for (const item of items) writePayload(w, value.type, item);
      break;
    }
    case TAG.COMPOUND:
      for (const key of Object.keys(value)) writeTag(w, value[key].type, key, value[key].value);
      w.u8(TAG.END);
      break;
    case TAG.INT_ARRAY:
      w.i32(value.length);
      for (const v of value) w.i32(v);
      break;
    case TAG.LONG_ARRAY:
      w.i32(value.length);
      for (const v of value) w.i64(v);
      break;
    default:
      throw new Error(`writer: 未知 tag 类型 ${type}`);
  }
}

function writeTag(w, type, name, value) {
  w.u8(type);
  w.str(name);
  writePayload(w, type, value);
}

/** 构造一个无名根 TAG_Compound 的完整 NBT 字节。 */
function buildNbt(fields) {
  const w = new SyntheticNbtWriter();
  w.u8(TAG.COMPOUND);
  w.str('');
  writePayload(w, TAG.COMPOUND, fields);
  return w.toBytes();
}

// ---------------------------------------------------------------------------
// C1. NBT 读取器：全 tag 覆盖
// ---------------------------------------------------------------------------

function runNbtTests() {
  log('');
  log('══ C1. NBT 读取器全 tag 覆盖 ══');
  const fields = {
    Byte: { type: TAG.BYTE, value: -5 },
    Short: { type: TAG.SHORT, value: -12345 },
    Int: { type: TAG.INT, value: 123456789 },
    Long: { type: TAG.LONG, value: 9007199254740991 },
    NegLong: { type: TAG.LONG, value: -1234567890123 },
    Float: { type: TAG.FLOAT, value: 0.5 },
    Double: { type: TAG.DOUBLE, value: -1.25e-7 },
    Bytes: { type: TAG.BYTE_ARRAY, value: new Uint8Array([0, 1, 2, 127, 128, 255]) },
    Str: { type: TAG.STRING, value: '中文 ✓ emoji 🐟' },
    ListInt: { type: TAG.LIST, value: { type: TAG.INT, items: [1, 2, 3] } },
    EmptyList: { type: TAG.LIST, value: { type: TAG.END, items: [] } },
    ListCompound: {
      type: TAG.LIST,
      value: { type: TAG.COMPOUND, items: [{ a: { type: TAG.INT, value: 1 } }, { b: { type: TAG.STRING, value: 'x' } }] },
    },
    ListList: { type: TAG.LIST, value: { type: TAG.LIST, items: [{ type: TAG.INT, items: [1] }, { type: TAG.INT, items: [2, 3] }] } },
    Ints: { type: TAG.INT_ARRAY, value: new Int32Array([-1, 0, 2147483647]) },
    Longs: { type: TAG.LONG_ARRAY, value: [1n, -1n, 1234567890123456789n] },
    Nested: { type: TAG.COMPOUND, value: { inner: { type: TAG.COMPOUND, value: { deep: { type: TAG.BYTE, value: 1 } } } } },
  };
  const bytes = buildNbt(fields);
  // 手工追加一个 __proto__ key 的 compound 字段：直接改写 bytes 太麻烦，单独构造
  const protoBytes = (() => {
    const w = new SyntheticNbtWriter();
    w.u8(TAG.COMPOUND);
    w.str('');
    writeTag(w, TAG.STRING, '__proto__', 'polluted');
    writeTag(w, TAG.COMPOUND, 'after', { ok: { type: TAG.INT, value: 7 } });
    w.u8(TAG.END);
    return w.toBytes();
  })();

  const root = readNbt(bytes);
  check('NBT Byte', root.Byte, -5);
  check('NBT Short', root.Short, -12345);
  check('NBT Int', root.Int, 123456789);
  check('NBT Long', root.Long, 9007199254740991);
  check('NBT NegLong', root.NegLong, -1234567890123);
  assert('NBT Float', Math.abs(root.Float - 0.5) < 1e-6, `got ${root.Float}`);
  assert('NBT Double', Math.abs(root.Double - -1.25e-7) < 1e-15, `got ${root.Double}`);
  check('NBT Byte_Array', Array.from(root.Bytes), [0, 1, 2, 127, 128, 255]);
  check('NBT String UTF-8', root.Str, '中文 ✓ emoji 🐟');
  check('NBT List<Int>', root.ListInt, [1, 2, 3]);
  check('NBT List 空', root.EmptyList, []);
  check('NBT List<Compound>', root.ListCompound, [{ a: 1 }, { b: 'x' }]);
  check('NBT List<List<Int>>', root.ListList, [[1], [2, 3]]);
  check('NBT Int_Array -> Int32Array', root.Ints instanceof Int32Array, true);
  check('NBT Int_Array 值', Array.from(root.Ints), [-1, 0, 2147483647]);
  check('NBT Long_Array -> BigInt64Array', root.Longs instanceof BigInt64Array, true);
  check('NBT Long_Array 值', Array.from(root.Longs), [1n, -1n, 1234567890123456789n]);
  check('NBT 嵌套 Compound', root.Nested.inner.deep, 1);
  check('NBT 顶层 key 数', Object.keys(root).length, Object.keys(fields).length);

  // raw 模式：long array 返回零拷贝视图
  const rawRoot = readNbt(bytes, { longArrayAs: 'raw' });
  assert('NBT raw Long_Array -> RawLongArray', rawRoot.Longs instanceof RawLongArray, String(rawRoot.Longs));
  check('NBT raw Long_Array length', rawRoot.Longs.length, 3);
  check('NBT raw Long_Array 值', Array.from(rawRoot.Longs.toBigInt64Array()), [1n, -1n, 1234567890123456789n]);
  const rawV = 1234567890123456789n;
  check('NBT raw Long_Array getLo/getHi #2', [rawRoot.Longs.getLo(2), rawRoot.Longs.getHi(2)], [
    Number(rawV & 0xffffffffn),
    Number((rawV >> 32n) & 0xffffffffn),
  ]);
  check('NBT raw 其它字段仍正常', rawRoot.Str, '中文 ✓ emoji 🐟');

  // 原型污染防御
  const protoRoot = readNbt(protoBytes);
  check('NBT __proto__ 作为普通 key 保留', Object.prototype.hasOwnProperty.call(protoRoot, '__proto__'), true);
  check('NBT __proto__ 值与原型未被污染', [protoRoot.__proto__, {}.polluted], ['polluted', undefined]);
  check('NBT __proto__ 之后字段正常', protoRoot.after.ok, 7);

  // 空/损坏输入
  check('NBT 空字节 -> null', readNbt(new Uint8Array([TAG.END])), null);
  let threw = false;
  try {
    readNbt(new Uint8Array([TAG.COMPOUND, 0x00, 0x00, TAG.INT]));
  } catch {
    threw = true;
  }
  assert('NBT 截断数据抛错', threw);
}

// ---------------------------------------------------------------------------
// C2. 合成 litematic：两种方块实体写法 / 负 size / ticks / gzip 路径
// ---------------------------------------------------------------------------

const intTag = (v) => ({ type: TAG.INT, value: v });
const strTag = (v) => ({ type: TAG.STRING, value: v });
const longTag = (v) => ({ type: TAG.LONG, value: v });
const vec3Tag = (vec) => ({
  type: TAG.COMPOUND,
  value: { x: intTag(vec.x), y: intTag(vec.y), z: intTag(vec.z) },
});
const rawLongArrayTag = (bigints) => ({ type: TAG.LONG_ARRAY, value: Array.from(bigints) });

function listTag(type, items) {
  return { type: TAG.LIST, value: { type, items } };
}

function compoundTag(obj) {
  return { type: TAG.COMPOUND, value: obj };
}

function paletteTag(entries) {
  return listTag(
    TAG.COMPOUND,
    entries.map((e) => {
      const o = { Name: strTag(e.name) };
      if (e.props) {
        const props = {};
        for (const k of Object.keys(e.props)) props[k] = strTag(e.props[k]);
        o.Properties = compoundTag(props);
      }
      return o;
    }),
  );
}

function buildSyntheticLitematic() {
  const r1Palette = [
    { name: 'minecraft:air' },
    { name: 'minecraft:stone' },
    { name: 'minecraft:oak_stairs', props: { half: 'bottom', facing: 'north' } },
  ];
  // r1: position (-5,3,-2), size (-2,1,2) -> min (-6,3,-2), absSize (2,1,2)
  const r1Abs = { x: 2, y: 1, z: 2 };
  const bits = requiredBits(r1Palette.length);
  const r1Indices = new Uint32Array([0, 1, 2, 1]);
  const r1BlockStates = rawLongArrayTag(packStates(r1Indices, bits));

  const r2Palette = [{ name: 'minecraft:air' }];
  const r2Indices = new Uint32Array([0]);
  const r2BlockStates = rawLongArrayTag(packStates(r2Indices, requiredBits(1)));

  const regions = {
    r1: compoundTag({
      Position: vec3Tag({ x: -5, y: 3, z: -2 }),
      Size: vec3Tag({ x: -2, y: 1, z: 2 }),
      DataVersion: intTag(4444),
      BlockStatePalette: paletteTag(r1Palette),
      BlockStates: r1BlockStates,
      // Variant A: Litematica 原生 { Pos:[x,y,z], TileNBT:{...} }
      TileEntities: listTag(TAG.COMPOUND, [
        {
          Pos: listTag(TAG.INT, [0, 0, 1]),
          TileNBT: compoundTag({
            id: strTag('minecraft:chest'),
            Items: listTag(TAG.COMPOUND, [
              { Slot: { type: TAG.BYTE, value: 0 }, Count: intTag(3) },
            ]),
            Seed: longTag(42),
            Longs: rawLongArrayTag([1n, -1n]),
          }),
        },
      ]),
      Entities: listTag(TAG.COMPOUND, [
        {
          id: strTag('minecraft:armor_stand'),
          Pos: listTag(TAG.DOUBLE, [1.5, 0, 1.5]),
        },
      ]),
      PendingBlockTicks: listTag(TAG.COMPOUND, [
        {
          x: intTag(0),
          y: intTag(0),
          z: intTag(1),
          Block: strTag('minecraft:stone'),
          Time: intTag(5),
          Priority: intTag(0),
          SubTick: intTag(1),
        },
        // 越界 tick：x == absSize.x（实测历史遗留），应保留并 warning
        {
          x: intTag(2),
          y: intTag(0),
          z: intTag(0),
          Block: strTag('minecraft:stone'),
          Time: intTag(7),
          Priority: intTag(1),
          SubTick: intTag(2),
        },
      ]),
      PendingFluidTicks: listTag(TAG.COMPOUND, [
        {
          x: intTag(1),
          y: intTag(0),
          z: intTag(0),
          Fluid: strTag('minecraft:water'),
          Time: intTag(10),
          Priority: intTag(0),
          SubTick: intTag(0),
        },
      ]),
    }),
    r2: compoundTag({
      Position: vec3Tag({ x: 10, y: 0, z: 0 }),
      Size: vec3Tag({ x: 1, y: 1, z: 1 }),
      BlockStatePalette: paletteTag(r2Palette),
      BlockStates: r2BlockStates,
      // Variant B: 内联 {x,y,z,id,...}
      TileEntities: listTag(TAG.COMPOUND, [
        {
          x: intTag(0),
          y: intTag(0),
          z: intTag(0),
          id: strTag('minecraft:chest'),
          CustomName: strTag('箱子'),
        },
      ]),
    }),
  };

  const fields = {
    Version: intTag(7),
    SubVersion: intTag(1),
    MinecraftDataVersion: intTag(3955),
    Metadata: compoundTag({
      Name: strTag('合成测试投影'),
      Author: strTag('parser-core'),
      Description: strTag('synthetic unit test'),
      TimeCreated: longTag(1700000000000),
      TimeModified: longTag(1700000001000),
      TotalBlocks: intTag(999999), // 故意不准确，验证不信任元数据
      TotalVolume: intTag(888888),
      EnclosingSize: vec3Tag({ x: 17, y: 4, z: 3 }),
      RegionCount: intTag(2),
    }),
    Regions: compoundTag(regions),
  };
  void r1Abs;
  void r1BlockStates;
  return buildNbt(fields);
}

async function runSyntheticLitematicTests() {
  log('');
  log('══ C2. 合成 litematic 单元测试（Variant A/B、负 size、ticks、gzip） ══');
  const nbtBytes = buildSyntheticLitematic();
  const gz = new Uint8Array(gzipSync(nbtBytes));

  check('isLitematic(gzip)', isLitematic(gz), true);
  check('isLitematic(裸 NBT)', isLitematic(nbtBytes), true);
  check('isLitematic(乱码)', isLitematic(new Uint8Array([0x50, 0x4b, 0x03, 0x04])), false);
  check('isLitematic(空)', isLitematic(new Uint8Array(0)), false);

  // 两条解压路径结果一致
  const viaStream = new Uint8Array(await inflateGzip(gz));
  check('inflateGzip 结果长度', viaStream.length, nbtBytes.length);
  check('inflateGzip 结果内容', Array.from(viaStream), Array.from(nbtBytes));

  // Node 兜底分支：临时隐藏 DecompressionStream，强制走 node:zlib 动态导入
  const savedDecompressionStream = Object.getOwnPropertyDescriptor(globalThis, 'DecompressionStream');
  try {
    Object.defineProperty(globalThis, 'DecompressionStream', { value: undefined, configurable: true, writable: true });
    const viaZlib = new Uint8Array(await inflateGzip(gz));
    check('inflateGzip zlib 兜底结果', Array.from(viaZlib), Array.from(nbtBytes));
    const schViaZlib = await loadSchematic(gz, 'synthetic-zlib.litematic');
    check('loadSchematic zlib 兜底 region 数', schViaZlib.regions.length, 2);
  } finally {
    if (savedDecompressionStream) Object.defineProperty(globalThis, 'DecompressionStream', savedDecompressionStream);
  }

  const sch = await loadSchematic(gz, 'synthetic.litematic');
  check('合成 version', sch.version, 7);
  check('合成 subVersion', sch.subVersion, 1);
  check('合成 dataVersion', sch.dataVersion, 3955);
  check('合成 metadata.name', sch.metadata.name, '合成测试投影');
  check('合成 metadata.timeCreated', sch.metadata.timeCreated, 1700000000000);
  check('合成 metadata.totalBlocks 原样保留', sch.metadata.totalBlocks, 999999);
  check('合成 metadata.enclosingSize', sch.metadata.enclosingSize, { x: 17, y: 4, z: 3 });
  check('合成 region 数', sch.regions.length, 2);

  const r1 = sch.regions[0];
  check('合成 r1 name', r1.name, 'r1');
  check('合成 r1 position', [r1.position.x, r1.position.y, r1.position.z], [-5, 3, -2]);
  check('合成 r1 size', [r1.size.x, r1.size.y, r1.size.z], [-2, 1, 2]);
  check('合成 r1 absSize', [r1.absSize.x, r1.absSize.y, r1.absSize.z], [2, 1, 2]);
  check('合成 r1 min（负 size）', [r1.min.x, r1.min.y, r1.min.z], [-6, 3, -2]);
  check('合成 r1 max', [r1.max.x, r1.max.y, r1.max.z], [-4, 4, 0]);
  check('合成 r1 dataVersion（region 覆盖）', r1.dataVersion, 4444);
  check('合成 r1 palette 状态字符串（属性排序）', r1.palette, [
    'minecraft:air',
    'minecraft:stone',
    'minecraft:oak_stairs[facing=north,half=bottom]',
  ]);
  check('合成 r1 indices', Array.from(r1.indices), [0, 1, 2, 1]);
  check('合成 r1 非空方块数', sch.stats.blockCount, 3);

  // Variant A 方块实体
  check('合成 r1 方块实体数', r1.blockEntities.length, 1);
  const beA = r1.blockEntities[0];
  check('Variant A 坐标（容器索引）', [beA.x, beA.y, beA.z], [0, 0, 1]);
  check('Variant A id', beA.id, 'minecraft:chest');
  check('Variant A nbt.Items', beA.nbt.Items, [{ Slot: 0, Count: 3 }]);
  check('Variant A nbt.Seed（long 标量）', beA.nbt.Seed, 42);
  assert('Variant A nbt.Longs 已展开成 BigInt64Array', beA.nbt.Longs instanceof BigInt64Array, String(beA.nbt.Longs));
  check('Variant A nbt.Longs 值', Array.from(beA.nbt.Longs), [1n, -1n]);

  // Entities：Pos 相对 region.Position
  check('合成 r1 实体数', r1.entities.length, 1);
  check('合成实体 pos 相对 Position 原样', r1.entities[0].pos, [1.5, 0, 1.5]);
  check('合成实体 id', r1.entities[0].id, 'minecraft:armor_stand');
  check('合成实体 nbt.id', r1.entities[0].nbt.id, 'minecraft:armor_stand');

  // Ticks：Block + Fluid 合并，Time -> delay，Priority -> priority
  check('合成 r1 tick 数（block 2 + fluid 1）', r1.ticks.length, 3);
  check('合成 tick[0]', r1.ticks[0], { x: 0, y: 0, z: 1, block: 'minecraft:stone', delay: 5, priority: 0 });
  check('合成 tick[2] Block/Fluid 归一', r1.ticks[2].block, 'minecraft:water');
  check('合成 tick[2] delay', r1.ticks[2].delay, 10);
  check('合成 tick 越界有 warning', sch.warnings.some((w) => w.includes('tick 坐标越界')), true);

  // Variant B 方块实体（内联，坐标不残留在 nbt 里）
  const r2 = sch.regions[1];
  check('合成 r2 absSize', [r2.absSize.x, r2.absSize.y, r2.absSize.z], [1, 1, 1]);
  check('合成 r2 方块实体数', r2.blockEntities.length, 1);
  const beB = r2.blockEntities[0];
  check('Variant B 坐标', [beB.x, beB.y, beB.z], [0, 0, 0]);
  check('Variant B id', beB.id, 'minecraft:chest');
  check('Variant B nbt 保留业务字段', beB.nbt.CustomName, '箱子');
  check('Variant B nbt 不含坐标', [beB.nbt.x, beB.nbt.y, beB.nbt.z], [undefined, undefined, undefined]);
  check('合成 r2 dataVersion 回退到根', r2.dataVersion, 3955);
  check('合成 r2 全 air', sch.stats.blockCount, 3);

  // 全局包围盒 / 统计
  check('合成全局 min', [sch.min.x, sch.min.y, sch.min.z], [-6, 0, -2]);
  check('合成全局 max', [sch.max.x, sch.max.y, sch.max.z], [11, 4, 1]);
  check('合成全局 size', [sch.size.x, sch.size.y, sch.size.z], [17, 4, 3]);
  check('合成 volume', sch.stats.volume, 4 + 1);
  check('合成 blockEntityCount', sch.stats.blockEntityCount, 2);
  check('合成全局 palette', sch.stats.palette.map((e) => e.id), [
    'minecraft:stone',
    'minecraft:oak_stairs[facing=north,half=bottom]',
  ]);
}

// ---------------------------------------------------------------------------
// C3. 非法 / 极端输入：不抛异常，降级为 warnings
// ---------------------------------------------------------------------------

async function runRobustnessTests() {
  log('');
  log('══ C3. 非法输入降级（不抛异常） ══');

  const cases = [
    ['null 根', null],
    ['空对象', {}],
    ['Regions 不是 compound', { Regions: 5 }],
    ['region 内容是 number', { Regions: { bad: 42 } }],
    ['region 没有 palette/BlockStates', { Regions: { bad: {} } }],
    ['BlockStates 长度不足', { Regions: { bad: { Position: { x: 0, y: 0, z: 0 }, Size: { x: 4, y: 1, z: 1 }, BlockStatePalette: [{ Name: 'minecraft:stone' }], BlockStates: [0n] } } }],
    ['palette 条目缺 Name', { Regions: { bad: { Position: { x: 0, y: 0, z: 0 }, Size: { x: 1, y: 1, z: 1 }, BlockStatePalette: [{}], BlockStates: [0n] } } }],
    ['Volume 过大导致无法分配', { Regions: { bad: { Position: { x: 0, y: 0, z: 0 }, Size: { x: 100000, y: 100000, z: 100000 }, BlockStatePalette: [{ Name: 'minecraft:stone' }], BlockStates: [0n] } } }],
  ];
  for (const [label, tree] of cases) {
    let sch = null;
    let error = null;
    try {
      sch = parseLitematic(tree, { fileName: 'bad.litematic' });
    } catch (e) {
      error = e;
    }
    assert(`降级不抛异常: ${label}`, error === null, error ? error.message : '');
    if (sch) {
      assert(`降级有 warning: ${label}`, sch.warnings.length > 0, `warnings=${sch.warnings.length}`);
      assert(`降级仍返回契约字段: ${label}`, Array.isArray(sch.regions) && typeof sch.stats === 'object' && Array.isArray(sch.warnings));
    }
  }

  // 非法文件字节 -> reject 带 message 的 Error
  for (const [label, bytes] of [
    ['非 litematic 魔数', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00])],
    ['gzip 包垃圾', new Uint8Array(gzipSync(new Uint8Array([1, 2, 3, 4, 5])))],
  ]) {
    let message = '';
    try {
      await loadSchematic(bytes, 'bad.litematic');
    } catch (e) {
      message = e && e.message ? e.message : String(e);
    }
    assert(`非法文件 reject: ${label}`, message.length > 0, message);
  }

  // unpackStates 对 bits=0 与 bits=32 的边界
  check('unpackStates bits=0 全 0', Array.from(unpackStates(null, 0, 4)), [0, 0, 0, 0]);
  const words32 = packStatesWords(Uint32Array.from([1, 0xffffffff, 0x80000000]), 32);
  check('packStatesWords bits=32 long 数', words32.length, 2);
  const back32 = unpackStates(words32, 32, 3);
  check('unpackStates bits=32 往返', Array.from(back32), [1, 4294967295, 2147483648]);

  // 随机往返：bits 2..12 各 997 个值
  let roundtripBad = 0;
  for (let bits = 2; bits <= 12; bits++) {
    const n = 997;
    const indices = new Uint32Array(n);
    let seed = bits * 2654435761;
    for (let i = 0; i < n; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      indices[i] = seed % (1 << bits);
    }
    const words = packStatesWords(indices, bits);
    const back = unpackStates(words, bits, n);
    for (let i = 0; i < n; i++) if (back[i] !== indices[i]) roundtripBad++;
    if (words.length !== longCountFor(n, bits)) roundtripBad++;
  }
  check('packStates/unpackStates 随机往返', roundtripBad, 0);
}

// ---------------------------------------------------------------------------
// D. 性能
// ---------------------------------------------------------------------------

function wordsToRawLongArray(words) {
  const buf = new ArrayBuffer(words.length * 8);
  const dv = new DataView(buf);
  for (let i = 0; i < words.length; i++) {
    dv.setUint32(i << 3, words.hi[i]);
    dv.setUint32((i << 3) + 4, words.lo[i]);
  }
  return new RawLongArray(dv, 0, words.length);
}

function makePerfTree(volume, dims, paletteSize) {
  const bits = requiredBits(paletteSize);
  const indices = new Uint32Array(volume);
  let seed = 0x12345678;
  for (let i = 0; i < volume; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    indices[i] = seed % paletteSize;
  }
  const words = packStatesWords(indices, bits);
  const raw = wordsToRawLongArray(words);
  const palette = [];
  for (let p = 0; p < paletteSize; p++) palette.push({ Name: p === 0 ? AIR : `minecraft:perf_block_${p}` });
  let nonAir = 0;
  for (let i = 0; i < volume; i++) if (indices[i] !== 0) nonAir++;
  const region = {
    Position: { x: 0, y: 0, z: 0 },
    Size: { x: dims.x, y: dims.y, z: dims.z },
    BlockStatePalette: palette,
    BlockStates: raw,
    TileEntities: [],
    Entities: [],
    PendingBlockTicks: [],
    PendingFluidTicks: [],
  };
  return {
    tree: { Version: 7, SubVersion: 1, MinecraftDataVersion: 3955, Regions: { perf: region } },
    expected: { volume, nonAir, bits, longCount: words.length },
  };
}

function runPerformanceTests() {
  log('');
  log('══ D. 性能 ══');
  log('fixture 解析耗时（loadSchematic 全流程 = gzip + NBT + 位解包 + 统计）：');
  const rows = [...state.perFileMs.entries()].map(([name, ms]) => [name, `${ms.toFixed(2)} ms`]);
  printTable(['文件', '耗时'], rows);
  const maxFixtureMs = Math.max(...state.perFileMs.values());
  const slowestFile = [...state.perFileMs.entries()].sort((a, b) => b[1] - a[1])[0][0];

  // 100k 方块（1.21.1 典型规模，目标 < 150 ms）
  const t100k = makePerfTree(100000, { x: 100, y: 10, z: 100 }, 300);
  const t0 = performance.now();
  const sch100k = parseLitematic(t100k.tree, { fileName: 'perf-100k' });
  const ms100k = performance.now() - t0;
  check('perf 100k indices length', sch100k.regions[0].indices.length, t100k.expected.volume);
  check('perf 100k blockCount', sch100k.stats.blockCount, t100k.expected.nonAir);
  const pass100k = ms100k < 150;
  assert('perf 100k < 150 ms', pass100k, `实际 ${ms100k.toFixed(2)} ms`);

  // 1M 方块（目标 < 1500 ms）
  const t1m = makePerfTree(1000000, { x: 100, y: 100, z: 100 }, 600);
  const t1 = performance.now();
  const sch1m = parseLitematic(t1m.tree, { fileName: 'perf-1M' });
  const ms1m = performance.now() - t1;
  check('perf 1M indices length', sch1m.regions[0].indices.length, t1m.expected.volume);
  check('perf 1M blockCount', sch1m.stats.blockCount, t1m.expected.nonAir);
  check('perf 1M bits', requiredBits(600), t1m.expected.bits);
  const pass1m = ms1m < 1500;
  assert('perf 1M < 1500 ms', pass1m, `实际 ${ms1m.toFixed(2)} ms`);

  printTable(
    ['场景', '规模', 'bits', 'BlockStates long 数', '解析耗时', '目标', '结果'],
    [
      ['fixture 最慢文件', slowestFile, '-', '-', `${maxFixtureMs.toFixed(2)} ms`, '-', '-'],
      ['合成 10 万方块', '100,000', `${t100k.expected.bits}`, `${t100k.expected.longCount}`, `${ms100k.toFixed(2)} ms`, '< 150 ms', pass100k ? 'PASS' : 'FAIL'],
      ['合成 100 万方块', '1,000,000', `${t1m.expected.bits}`, `${t1m.expected.longCount}`, `${ms1m.toFixed(2)} ms`, '< 1500 ms', pass1m ? 'PASS' : 'FAIL'],
    ],
  );
  log(`  解包吞吐：10 万 ≈ ${((100000 / ms100k) / 1000).toFixed(1)}M 方块/秒，100 万 ≈ ${((1000000 / ms1m) / 1000).toFixed(1)}M 方块/秒（本机 Node ${process.version}）`);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  log('mcviewer 解析器自检（node tests/parser/run.mjs）');
  log(`Node ${process.version} · platform ${process.platform} · ${new Date().toISOString()}`);
  hr('═');

  await runFixtureTests();

  log('');
  log('══ 解析结果统计表 ══');
  printTable(
    ['结果', '文件', '区域', '体积', '非空方块', '方块实体', '实体', 'tick', '包围盒', '耗时', '告警'],
    state.fixtureRows.map((r) => [
      r.result,
      r.file,
      r.regions,
      r.volume,
      r.blocks,
      r.blockEntities,
      r.entities,
      r.ticks,
      r.bbox,
      r.ms,
      r.warnings,
    ]),
  );

  runNbtTests();
  await runSyntheticLitematicTests();
  await runRobustnessTests();
  runPerformanceTests();

  hr('═');
  if (failures.length === 0) {
    log(`✅ 全部断言通过：${checkCount} 项检查，0 失败`);
    process.exitCode = 0;
  } else {
    log(`❌ ${checkCount} 项检查中 ${failures.length} 项失败：`);
    for (const f of failures.slice(0, 60)) {
      log(`  - ${f.label}`);
      log(`      期望: ${f.expected}`);
      log(`      实际: ${f.actual}`);
    }
    if (failures.length > 60) log(`  … 其余 ${failures.length - 60} 项省略`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  log(`\n❌ 自检脚本自身异常: ${e && e.stack ? e.stack : e}`);
  process.exitCode = 1;
});
