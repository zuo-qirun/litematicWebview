// mcviewer —— 几何独立审计（Lead 侧 QA，不依赖 bake 的自检）
// 目的：bake 刚刚修过一次「面顶点顺序用光栅序而非 TL/BL/BR/TR」的 bug，
//      导致一半的面绕序反转（朝内）。这里用几何本身反推法线，独立复核：
//   1) 每个 quad 的 4 个三角形法线是否同向（自洽）
//   2) 推出来的法线主分量/sign 是否与 quad.n 一致（0=-Y 1=+Y 2=-Z 3=+Z 4=-X 5=+X）
//   3) 四点是否共面、是否有零面积退化
//   4) 顶点是否在 0..16 模型空间内
//   5) uv 是否为轴对齐矩形（2 个不同 u、2 个不同 v）
//   6) 每个方块的每个状态是否都有可用几何（invisible 除外）
// 用法：node tools/audit_geometry.mjs [--assets assets]
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const argv = process.argv.slice(2);
const ai = argv.findIndex((a) => a === "--assets");
const ASSETS = resolve(ROOT, ai >= 0 ? argv[ai + 1] : "assets");

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  ok: (s) => `\x1b[32m✓\x1b[0m ${s}`,
  bad: (s) => `\x1b[31m✗\x1b[0m ${s}`,
  warn: (s) => `\x1b[33m!\x1b[0m ${s}`,
  head: (s) => `\x1b[36m\x1b[1m▸ ${s}\x1b[0m`,
};

const AXES = [
  [0, -1, 0], // 0 下
  [0, 1, 0], // 1 上
  [0, 0, -1], // 2 北
  [0, 0, 1], // 3 南
  [-1, 0, 0], // 4 西
  [1, 0, 0], // 5 东
];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

let failures = 0;
const fail = (msg) => {
  failures++;
  if (failures <= 40) console.log("  " + c.bad(msg));
};

console.log(c.head("加载资产"));
const modelsRaw = JSON.parse(readFileSync(join(ASSETS, "models.json"), "utf8"));
const blocksRaw = JSON.parse(readFileSync(join(ASSETS, "blocks.json"), "utf8"));
const models = modelsRaw.models || modelsRaw;
const blocks = blocksRaw.blocks || blocksRaw;
const modelIds = Object.keys(models);
const blockIds = Object.keys(blocks);
console.log(`  ${modelIds.length} models / ${blockIds.length} blocks`);

// ── 1. 每个 quad 的几何自洽性 ────────────────────────────────────────────────
console.log(c.head("quad 绕序 / 法线 / 共面 / 范围"));
let quadCount = 0;
let nonAxis = 0;
let mirrored = 0;
let degenerate = 0;
let nonPlanar = 0;
let outOfRange = 0;
let badWinding = 0;
let nHist = [0, 0, 0, 0, 0, 0];
const worst = [];

for (const mid of modelIds) {
  const qs = models[mid].quads;
  if (!Array.isArray(qs)) {
    fail(`model ${mid} 缺少 quads 数组`);
    continue;
  }
  for (let qi = 0; qi < qs.length; qi++) {
    const q = qs[qi];
    quadCount++;
    const tag = `${mid}#${qi}`;
    if (!Array.isArray(q.p) || q.p.length !== 12) {
      fail(`${tag} p 不是 12 个数`);
      continue;
    }
    if (q.p.some((v) => !Number.isFinite(v))) {
      fail(`${tag} p 含非有限数`);
      continue;
    }
    const V = [0, 1, 2, 3].map((i) => [q.p[i * 3], q.p[i * 3 + 1], q.p[i * 3 + 2]]);
    if (V.some((v) => v.some((x) => x < -0.001 || x > 16.001))) outOfRange++;

    // 三角化两两法线
    const n1 = cross(sub(V[1], V[0]), sub(V[2], V[0]));
    const n2 = cross(sub(V[2], V[0]), sub(V[3], V[0]));
    const a1 = len(n1);
    const a2 = len(n2);
    if (a1 < 1e-9 || a2 < 1e-9) {
      degenerate++;
      continue;
    }
    const u1 = [n1[0] / a1, n1[1] / a1, n1[2] / a1];
    const u2 = [n2[0] / a2, n2[1] / a2, n2[2] / a2];
    // 两三角同向？（异构面允许微差，0.9 已够宽松）
    if (dot(u1, u2) < 0.9) {
      badWinding++;
      if (worst.length < 6) worst.push(`${tag} 三角绕序不一致 dot=${dot(u1, u2).toFixed(3)}`);
      continue;
    }
    // 共面：v3 到 v0/v1/v2 平面距离
    const planeD = dot(sub(V[3], V[0]), u1);
    if (Math.abs(planeD) > 0.02) nonPlanar++;

    // 与 n 的主轴/sign 对照
    const n = q.n;
    if (!(n >= 0 && n <= 5)) {
      fail(`${tag} n 非法：${n}`);
      continue;
    }
    nHist[n]++;
    const ax = AXES[n];
    const d = dot(u1, ax);
    if (d <= 0) {
      // 绕序反了（法线朝着 n 的反方向）——这是致命的
      badWinding++;
      if (worst.length < 12) worst.push(`${tag} n=${n} 法线朝反 dot=${d.toFixed(3)}`);
    } else if (d < 0.999) {
      nonAxis++; // 斜面（楼梯/草/铁栏杆等），只要求主轴方向一致
      // 主轴必须是 n 的轴，否则 n 标注错了
      const absN = [Math.abs(u1[0]), Math.abs(u1[1]), Math.abs(u1[2])];
      const axisOfN = n < 2 ? 1 : n < 4 ? 2 : 0;
      if (absN[axisOfN] < 0.3) fail(`${tag} n=${n} 但法线主轴不符 n=${u1.map((x) => x.toFixed(2))}`);
    }
  }
}

console.log(`  ${c.dim("quad 总数")}        ${quadCount}`);
console.log(`  ${c.dim("n 分布")}          下${nHist[0]} 上${nHist[1]} 北${nHist[2]} 南${nHist[3]} 西${nHist[4]} 东${nHist[5]}`);
console.log(`  ${c.dim("斜面/非轴对齐")}    ${nonAxis} ${c.dim("(楼梯、草、栏杆、火把等，正常)")}`);
console.log(`  ${c.dim("严格轴对齐")}       ${quadCount - nonAxis - degenerate - badWinding - nonPlanar}`);
if (degenerate) console.log("  " + c.warn(`退化 quad（面积为 0）：${degenerate}`));
if (nonPlanar) console.log("  " + c.warn(`非共面 quad（顶点偏差 >0.02）：${nonPlanar}`));
if (outOfRange) fail(`顶点越出 0..16 模型空间：${outOfRange} 个 quad`);
if (badWinding) fail(`绕序/法线错误：${badWinding} 个 quad`);
else if (!degenerate) console.log("  " + c.ok("全部 quad 绕序与 n 一致（法线朝向正确）"));
for (const w of worst) console.log("     " + c.dim(w));

// ── 2. uv 矩形性 ─────────────────────────────────────────────────────────────
console.log(c.head("uv 矩形性 / 图集范围"));
const manifest = JSON.parse(readFileSync(join(ASSETS, "manifest.json"), "utf8"));
const atlasSize = manifest.atlas?.size ?? 1024;
let uvBad = 0;
let uvOut = 0;
let uvMirror = 0;
let uvChecked = 0;
for (const mid of modelIds) {
  for (const q of models[mid].quads) {
    const uv = q.uv;
    if (!Array.isArray(uv) || uv.length !== 8) {
      uvBad++;
      continue;
    }
    uvChecked++;
    if (uv.some((v) => !Number.isFinite(v) || v < -0.01 || v > atlasSize + 0.01)) uvOut++;
    const us = [uv[0], uv[2], uv[4], uv[6]];
    const vs = [uv[1], uv[3], uv[5], uv[7]];
    const du = new Set(us.map((x) => x.toFixed(2))).size;
    const dv = new Set(vs.map((x) => x.toFixed(2))).size;
    if (du !== 2 || dv !== 2) uvBad++; // 期望轴对齐矩形
    else {
      // 检查矩形对角：0/2 对角、1/3 对角（顺序为 TL,BL,BR,TR 时 0-2 与 1-3 应互为对角）
      const diag02 = Math.abs(us[0] - us[2]) > 0.01 && Math.abs(vs[0] - vs[2]) > 0.01;
      const diag13 = Math.abs(us[1] - us[3]) > 0.01 && Math.abs(vs[1] - vs[3]) > 0.01;
      if (!diag02 || !diag13) uvMirror++;
    }
  }
}
console.log(`  检查 ${uvChecked} 个 quad 的 uv`);
if (uvOut) fail(`uv 越出图集范围（0..${atlasSize}）：${uvOut}`);
if (uvBad) fail(`uv 不是轴对齐矩形：${uvBad}`);
else console.log("  " + c.ok("uv 全部为 2×2 轴对齐矩形"));
if (uvMirror) console.log("  " + c.warn(`uv 顶点顺序不是对角式（可能贴图翻转）：${uvMirror}`));
else console.log("  " + c.ok("uv 顶点顺序与对角关系一致"));

// ── 3. 每个方块的几何可解析性 ───────────────────────────────────────────────
console.log(c.head("方块状态 → 几何"));
function resolveModels(def, props) {
  // 简化求值：variants 取 when 全匹配者（无 when 者兜底），multipart OR
  const out = [];
  const matchWhen = (when) => {
    if (!when) return true;
    for (const [k, want] of Object.entries(when)) {
      const have = String(props[k] ?? "");
      const alts = String(want).split("|");
      if (!alts.includes(have)) return false;
    }
    return true;
  };
  const defs = Array.isArray(def) ? def : def.models ? [def] : [];
  if (def.kind === "multipart") {
    for (const part of def.parts || []) if (matchWhen(part.when)) for (const m of part.models || []) out.push(m);
    return out;
  }
  for (const v of def.kind === "variants" ? def.variants : defs) {
    if (matchWhen(v.when)) for (const m of v.models || []) out.push(typeof m === "string" ? { model: m } : m);
  }
  return out;
}
let states = 0;
let noGeom = 0;
let unresolved = 0;
let emptyModels = 0;
const noGeomSamples = [];
for (const bid of blockIds) {
  const def = blocks[bid];
  if (def.kind === "invisible") continue;
  const variants = def.kind === "variants" ? def.variants || [] : null;
  const propSets = [];
  if (variants && variants.length) {
    for (const v of variants) propSets.push({ when: v.when, models: v.models });
  } else if (def.kind === "multipart") {
    propSets.push({ when: null, models: null });
  }
  for (const ps of propSets) {
    states++;
    let ids;
    if (ps.models) ids = ps.models.map((m) => (typeof m === "string" ? m : m.model));
    else {
      // multipart：直接用 meta 的 fallback 清单判断，避免穷举属性
      ids = [];
      for (const part of def.parts || []) {
        for (const m of part.models || []) ids.push(typeof m === "string" ? m : m.model);
      }
      if (!ids.length) ids = def.parts ? [] : [];
    }
    let quads = 0;
    let missing = 0;
    for (const id of ids) {
      if (!models[id]) {
        // 烘焙期的旋转 id 可能带 #：退回 base
        const base = String(id).split("#")[0];
        if (!models[base]) {
          missing++;
          continue;
        }
        quads += models[base].quads.length;
        continue;
      }
      quads += models[id].quads.length;
    }
    if (missing) unresolved++;
    if (!quads) {
      noGeom++;
      if (noGeomSamples.length < 8) noGeomSamples.push(bid);
      if (ids.length && ids.every((id) => models[id] && models[id].quads.length === 0)) emptyModels++;
    }
  }
}
console.log(`  检查 ${states} 个状态，${blockIds.length} 个方块`);
if (unresolved) fail(`${unresolved} 个状态引用了不存在的 model`);
else console.log("  " + c.ok("所有 model 引用均可解析"));
if (noGeom) {
  // 允许：液体/方块实体占位在 bake 侧换成整方块，正常应为 0
  console.log("  " + c.warn(`${noGeom} 个状态没有任何几何（前几个：${noGeomSamples.join(", ")}）`));
} else console.log("  " + c.ok("所有非 invisible 状态都有几何"));

console.log("");
if (failures) {
  console.log(`\x1b[31m\x1b[1m✗ 几何审计失败：${failures} 项\x1b[0m`);
  process.exit(1);
}
console.log("\x1b[32m\x1b[1m✓ 几何审计通过\x1b[0m");
