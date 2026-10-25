#!/usr/bin/env node
/**
 * 资产 + 解析器交叉审核（Lead 用的独立 QA，不属于三个人任何一方）
 *
 *   node tools/audit_assets.mjs
 *
 * 做四件事：
 *   1. 用 src/core 解析 5 个 fixture，与 tests/parser/expected.json 逐项比对（等于独立复核解析器）
 *   2. 收集所有 fixture 里真实出现的方块状态，统计 assets/blocks.json 的解析覆盖率
 *   3. 校验 blocks.json / models.json 的契约自洽（model 引用、quad 字段、render、tintColors、air）
 *   4. 校验 atlas.png 尺寸与 manifest 一致
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import process from 'node:process';
import { readNbtRoot } from '../src/core/nbt.js';
import { parseLitematic } from '../src/core/litematic.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const FIX = path.join(ROOT, 'tests', 'fixtures');
const A = path.join(ROOT, 'assets');

const C = { r: '\x1b[0m', d: '\x1b[2m', b: '\x1b[1m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m' };
let problems = 0;
const bad = (m) => { problems++; console.log(`  ${C.red}✗${C.r} ${m}`); };
const good = (m) => console.log(`  ${C.green}✓${C.r} ${m}`);
const note = (m) => console.log(`  ${C.yellow}!${C.r} ${m}`);
const head = (m) => console.log(`\n${C.cyan}${C.b}▸ ${m}${C.r}`);

// ---------- 1. 解析器 vs oracle ----------
function unfold(buf) {
  if (buf[0] === 0x1f && buf[1] === 0x8b) return gunzipSync(buf);
  return buf;
}

function summaryOf(s) {
  const t = (v) => (v && typeof v === 'object' ? [v.x, v.y, v.z] : v);
  return {
    blockCount: s.stats.blockCount,
    regionCount: s.stats.regionCount,
    blockEntityCount: s.stats.blockEntityCount,
    entityCount: s.stats.entityCount,
    volume: s.stats.volume,
    size: t(s.size), min: t(s.min), max: t(s.max),
    paletteSize: s.stats.palette ? s.stats.palette.length : 0,
  };
}

function eq(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => v === b[i]);
  }
  return a === b;
}

// ---------- 2. 极简 blocks.json 解析器（按契约 §3 语义）----------
let BLOCKS = null;
let MODELS = null;

function splitState(key) {
  const i = key.indexOf('[');
  if (i < 0) return { id: key, props: {} };
  const id = key.slice(0, i);
  const body = key.slice(i + 1, key.lastIndexOf(']'));
  const props = {};
  if (body.trim()) {
    for (const part of body.split(',')) {
      const j = part.indexOf('=');
      if (j > 0) props[part.slice(0, j).trim()] = part.slice(j + 1).trim();
    }
  }
  return { id, props };
}

function whenMatches(when, props) {
  if (!when) return true;
  for (const k of Object.keys(when)) {
    if (props[k] !== when[k]) return false;
  }
  return true;
}

function resolveModels(stateKey) {
  const def = BLOCKS[stateKey.split('[')[0]];
  if (!def) return null;
  const { props } = splitState(stateKey);
  if (def.kind === 'invisible' || def.kind === 'missing') return { kind: def.kind, models: [], def };
  if (def.kind === 'multipart') {
    const out = [];
    for (const part of def.parts || []) if (whenMatches(part.when, props)) out.push(...(part.models || []));
    return { kind: 'multipart', models: out, def };
  }
  if (def.kind === 'variants') {
    for (const v of def.variants || []) if (whenMatches(v.when, props)) return { kind: 'variants', models: v.models || [], def };
    if (def.default) return { kind: 'variants', models: def.default, def };
    return { kind: 'variants', models: [], def };
  }
  return null;
}

// ---------- 3. PNG 尺寸 ----------
function pngSize(file) {
  const b = readFileSync(file);
  if (b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

async function main() {
  head('加载资产');
  for (const f of ['manifest.json', 'blocks.json', 'models.json', 'lang.json', 'meta.json', 'atlas.png']) {
    if (!existsSync(path.join(A, f))) { bad(`缺少 assets/${f}`); process.exitCode = 1; return; }
  }
  const manifest = JSON.parse(readFileSync(path.join(A, 'manifest.json'), 'utf8'));
  const meta = JSON.parse(readFileSync(path.join(A, 'meta.json'), 'utf8'));
  const blocksDoc = JSON.parse(readFileSync(path.join(A, 'blocks.json'), 'utf8'));
  const modelsDoc = JSON.parse(readFileSync(path.join(A, 'models.json'), 'utf8'));
  const lang = JSON.parse(readFileSync(path.join(A, 'lang.json'), 'utf8'));
  BLOCKS = blocksDoc.blocks;
  MODELS = modelsDoc.models;
  good(`blocks=${Object.keys(BLOCKS).length} models=${Object.keys(MODELS).length} lang.zh=${Object.keys(lang.zh_cn || {}).length} lang.en=${Object.keys(lang.en_us || {}).length}`);

  // ---- manifest ----
  head('manifest / atlas');
  const png = pngSize(path.join(A, 'atlas.png'));
  if (!png) bad('atlas.png 无法解析');
  else if (png.w !== manifest.atlas.size) bad(`atlas 实际 ${png.w}×${png.h} ≠ manifest.atlas.size ${manifest.atlas.size}`);
  else good(`atlas ${png.w}×${png.h}，textureScale=${manifest.textureScale}`);
  if (manifest.format !== 1) bad('manifest.format 不是 1');

  // ---- blocks 契约 ----
  head('blocks.json 契约');
  const airDef = BLOCKS['minecraft:air'];
  if (!airDef) bad('minecraft:air 缺失（渲染器无法跳过空气）');
  else if (airDef.kind !== 'invisible') bad(`minecraft:air 的 kind=${airDef.kind}，应为 invisible`);
  else good('minecraft:air 存在且 invisible');

  const kinds = {};
  let noRender = 0, noTintShape = 0, badRefs = 0, refTotal = 0, tintBlocks = 0;
  const missingModelRefs = new Set();
  for (const [id, def] of Object.entries(BLOCKS)) {
    kinds[def.kind] = (kinds[def.kind] || 0) + 1;
    if (!def.render) noRender++;
    if (def.tintColors) {
      tintBlocks++;
      for (const [k, v] of Object.entries(def.tintColors)) {
        if (!/^\d+$/.test(k) || !Array.isArray(v) || v.length !== 3 || v.some((x) => typeof x !== 'number' || x < 0 || x > 1)) noTintShape++;
      }
    }
    const lists = def.kind === 'multipart' ? (def.parts || []).map((p) => p.models || []) : (def.variants || []).map((v) => v.models || []);
    for (const l of lists) for (const m of l) { refTotal++; if (!MODELS[m]) { badRefs++; missingModelRefs.add(m); } }
    for (const m of def.default || []) { refTotal++; if (!MODELS[m]) { badRefs++; missingModelRefs.add(m); } }
  }
  good(`kind 分布: ${JSON.stringify(kinds)}`);
  if (noRender) bad(`${noRender} 个 BlockDef 缺少 render 字段`); else good('所有 BlockDef 都有 render 字段');
  if (noTintShape) bad(`${noTintShape} 个 tintColors 条目格式非法`); else good(`tintColors 格式合法（${tintBlocks} 个方块带 tint）`);
  if (badRefs) { bad(`${badRefs}/${refTotal} 个 model 引用解析不到，例：${[...missingModelRefs].slice(0, 5).join(', ')}`); }
  else good(`${refTotal} 个 model 引用全部可解析`);

  // ---- models 契约 ----
  head('models.json 契约');
  let quadTotal = 0, badQuads = 0, badN = 0, badP = 0, badUV = 0, tintnegs = 0;
  const badSample = [];
  for (const [mid, mdl] of Object.entries(MODELS)) {
    for (const q of mdl.quads || []) {
      quadTotal++;
      if (!Array.isArray(q.p) || q.p.length !== 12 || q.p.some((x) => typeof x !== 'number' || !isFinite(x))) { badP++; badQuads++; if (badSample.length < 3) badSample.push(`${mid}.p`); }
      else if (q.p.some((x) => x < -1e-6 || x > 16.000001)) { /* 允许 0..16 */ }
      if (!Array.isArray(q.uv) || q.uv.length !== 8) { badUV++; badQuads++; if (badSample.length < 3) badSample.push(`${mid}.uv`); }
      if (!Number.isInteger(q.n) || q.n < 0 || q.n > 5) { badN++; badQuads++; if (badSample.length < 3) badSample.push(`${mid}.n=${q.n}`); }
      if (typeof q.tint !== 'number') { tintnegs++; }
    }
  }
  good(`models=${Object.keys(MODELS).length} quads=${quadTotal}`);
  if (badP) bad(`${badP} 个 quad 的 p 非法`); else good('quad.p 全部是 12 个有限数字');
  if (badUV) bad(`${badUV} 个 quad 的 uv 非法`); else good('quad.uv 全部是 8 个数字');
  if (badN) bad(`${badN} 个 quad 的 n 越界`); else good('quad.n 全部在 0..5');
  if (tintnegs) bad(`${tintnegs} 个 quad 的 tint 不是数字`);
  if (badQuads) console.log(`  ${C.d}例：${badSample.join(', ')}${C.r}`);

  // ---- lang ----
  head('lang.json');
  const zhKeys = Object.keys(lang.zh_cn || {});
  const enKeys = Object.keys(lang.en_us || {});
  if (!zhKeys.length) bad('zh_cn 为空（A 方案没落地？）');
  else {
    const emptyZh = zhKeys.filter((k) => !lang.zh_cn[k]).length;
    good(`zh_cn ${zhKeys.length} 条，en_us ${enKeys.length} 条，空值 ${emptyZh}`);
    if (emptyZh) note(`${emptyZh} 条中文为空（运行期回退英文，属预期）`);
  }

  // ---- 2'. 解析器 vs oracle ----
  head('解析器 vs Python oracle');
  const exp = JSON.parse(readFileSync(path.join(ROOT, 'tests', 'parser', 'expected.json'), 'utf8')).files;
  const expByName = new Map(exp.map((e) => [e.fileName, e]));
  const files = readdirSync(FIX).filter((f) => f.toLowerCase().endsWith('.litematic')).sort();
  const allStates = new Map(); // stateKey -> count
  let parserFail = 0;
  for (const name of files) {
    const raw = readFileSync(path.join(FIX, name));
    let s;
    try {
      const plain = unfold(raw);
      const ab = plain.buffer.slice(plain.byteOffset, plain.byteOffset + plain.byteLength);
      const wrapper = readNbtRoot(ab);
      s = parseLitematic(wrapper && wrapper.value ? wrapper.value : wrapper);
    } catch (e) {
      bad(`${name}: 解析抛错 ${e.message}`); parserFail++; continue;
    }
    // 收集状态
    for (const r of s.regions) {
      const idx = r.indices;
      for (let i = 0; i < idx.length; i++) {
        const k = r.palette[idx[i]];
        if (k === undefined) { allStates.set('<越界索引>', (allStates.get('<越界索引>') || 0) + 1); continue; }
        allStates.set(k, (allStates.get(k) || 0) + 1);
      }
    }
    const e = expByName.get(name);
    if (!e) { note(`${name}: expected.json 无此项`); continue; }
    const got = summaryOf(s);
    const diffs = [];
    for (const k of ['blockCount', 'regionCount', 'blockEntityCount', 'entityCount', 'paletteSize', 'volume']) {
      if (!eq(e[k], got[k])) diffs.push(`${k} 期望 ${e[k]} 实际 ${got[k]}`);
    }
    for (const k of ['size', 'min', 'max']) if (!eq(e[k], got[k])) diffs.push(`${k} 期望 [${e[k]}] 实际 [${got[k]}]`);
    if (diffs.length) { bad(`${name}: ${diffs.join(' | ')}`); parserFail++; }
    else good(`${name}  ← 与 oracle 完全一致`);
  }

  // ---- 覆盖率 ----
  head('方块状态解析覆盖率（全部 fixture 的真实状态）');
  let total = 0, resolved = 0, invisible = 0, nomodel = 0, unresolved = 0;
  const unresolvedSample = [];
  for (const [k, n] of allStates) {
    if (k === '<越界索引>') { bad('索引越界（解析器 bug）'); continue; }
    total += n;
    const r = resolveModels(k);
    if (!r) { unresolved += n; if (unresolvedSample.length < 8) unresolvedSample.push(k); continue; }
    if (r.kind === 'invisible' || r.kind === 'missing') { invisible += n; resolved += n; continue; }
    if (!r.models.length) { nomodel += n; if (unresolvedSample.length < 8) unresolvedSample.push(k + ' (无模型)'); continue; }
    if (r.models.some((m) => !MODELS[m])) { nomodel += n; if (unresolvedSample.length < 8) unresolvedSample.push(k + ' (模型缺失)'); continue; }
    resolved += n;
  }
  const pct = total ? ((resolved / total) * 100).toFixed(2) : '0';
  console.log(`  ${C.b}状态种类 ${allStates.size}，方块实例 ${total}${C.r}`);
  console.log(`  可渲染/可选跳过 ${resolved}（${pct}%）；invisible ${invisible}；无模型/模型缺失 ${nomodel}；完全无法识别 ${unresolved}`);
  if (unresolved || nomodel) {
    note(`未完全覆盖示例：${unresolvedSample.slice(0, 8).join(', ')}`);
  }
  if (pct !== '100.00' && unresolved === 0 && nomodel === 0) good('100% 覆盖');
  else if (unresolved + nomodel === 0) good('100% 覆盖');

  head('结论');
  if (problems === 0 && parserFail === 0) {
    console.log(`  ${C.green}${C.b}全部通过${C.r}`);
  } else {
    console.log(`  ${C.red}${C.b}${problems} 个资产问题 / ${parserFail} 个解析器问题${C.r}`);
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(2); });
