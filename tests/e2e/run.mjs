#!/usr/bin/env node
/**
 * mcviewer 端到端测试
 *
 *   node tests/e2e/run.mjs                # 构建 + 起服务 + 跑全部 fixture + 截图
 *   node tests/e2e/run.mjs --no-build     # 复用已有 dist/
 *   node tests/e2e/run.mjs --headful      # 可视化调试
 *   node tests/e2e/run.mjs --port 5199    # 换端口
 *
 * 断言来源：tests/parser/expected.json（tools/truth.py 生成的独立 oracle）
 * 页面接口：window.__APP_READY__ + window.__VIEWER__（见 docs/CONTRACT.md §6）
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures');
const EXPECTED = path.join(ROOT, 'tests', 'parser', 'expected.json');
const SHOTS = path.join(ROOT, 'tests', 'e2e', '_shots');

const argv = new Set(process.argv.slice(2));
const NO_BUILD = argv.has('--no-build');
const HEADFUL = argv.has('--headful');
const PORT = Number(process.env.E2E_PORT || 5199);
const BASE = `http://127.0.0.1:${PORT}`;

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', magenta: '\x1b[35m',
};
const log = (...a) => console.log(...a);
const step = (s) => log(`\n${C.cyan}${C.bold}▸ ${s}${C.reset}`);
const ok = (s) => log(`  ${C.green}✓${C.reset} ${s}`);
const bad = (s) => log(`  ${C.red}✗${C.reset} ${s}`);
const warn = (s) => log(`  ${C.yellow}!${C.reset} ${s}`);
const dim = (s) => log(`  ${C.dim}${s}${C.reset}`);

function findChrome() {
  const cands = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  for (const p of cands) if (existsSync(p)) return p;
  throw new Error('找不到 Chrome/Edge，请用 CHROME_PATH 环境变量指定可执行文件');
}

function runBuild() {
  step('构建 dist/');
  const r = spawnSync(process.execPath, ['build.mjs'], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`build.mjs 失败（exit ${r.status}）`);
}

async function waitForServer(timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(BASE + '/', { method: 'GET' });
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await sleep(120);
  }
  throw new Error(`本地服务 ${BASE} 在 ${timeoutMs}ms 内未就绪`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer() {
  step(`启动本地服务 ${BASE}`);
  const proc = spawn(process.execPath, ['server.mjs', '--port', String(PORT), '--host', '127.0.0.1'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = [];
  proc.stdout.on('data', (d) => out.push(String(d)));
  proc.stderr.on('data', (d) => out.push(String(d)));
  proc.diag = () => out.join('');
  return proc;
}

/** 期望值与页面统计量的比较（严格相等，全部按数字/数组比较） */
function compare(exp, got) {
  const diffs = [];
  const num = (k) => {
    if (exp[k] === undefined) return;
    if (got[k] !== exp[k]) diffs.push(`${k}: 期望 ${exp[k]} 实际 ${got[k]}`);
  };
  const arr = (k) => {
    if (!exp[k]) return;
    const g = got[k];
    if (!Array.isArray(g) || g.length !== exp[k].length || g.some((v, i) => v !== exp[k][i])) {
      diffs.push(`${k}: 期望 [${exp[k]}] 实际 ${g ? `[${g}]` : String(g)}`);
    }
  };
  num('blockCount'); num('regionCount'); num('blockEntityCount'); num('entityCount');
  num('tickCount'); num('volume'); num('paletteSize');
  arr('size'); arr('min'); arr('max');
  return diffs;
}

const FILTER_WORDS = [
  'Download the React DevTools',
  'Multiple instances of Three.js',
  'WebGL: INVALID_OPERATION',
];

async function main() {
  const t0 = Date.now();
  if (!existsSync(EXPECTED)) throw new Error(`缺少 ${EXPECTED}，先跑 tools/truth.py`);
  const expected = JSON.parse(readFileSync(EXPECTED, 'utf8')).files || [];
  const expByName = new Map(expected.map((e) => [e.fileName, e]));

  if (!NO_BUILD) runBuild();

  rmSync(SHOTS, { recursive: true, force: true });
  mkdirSync(SHOTS, { recursive: true });

  const server = startServer();
  const cleanup = () => { try { server.kill(); } catch {} };
  process.on('exit', cleanup);

  let browser;
  let failed = 0;
  const results = [];
  try {
    await waitForServer();
    ok('服务已就绪');

    step('启动 Chrome');
    const chromePath = findChrome();
    dim(`executable: ${chromePath}`);
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: HEADFUL ? false : 'new',
      defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
      args: [
        '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars',
        '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
        '--force-device-scale-factor=1', '--disable-lcd-text',
        '--font-render-hinting=none', '--mute-audio',
      ],
    });
    const page = await browser.newPage();
    const consoleErrors = [];
    const consoleWarns = [];
    const httpFails = [];
    page.on('console', (m) => {
      const txt = m.text();
      if (FILTER_WORDS.some((w) => txt.includes(w))) return;
      if (m.type() === 'error') consoleErrors.push(txt);
      else if (m.type() === 'warning') consoleWarns.push(txt);
    });
    page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + (e && e.message ? e.message : String(e))));
    page.on('requestfailed', (r) => {
      if (!/favicon/.test(r.url())) httpFails.push(`${r.url()} ${r.failure()?.errorText || ''}`);
    });
    page.on('response', (r) => {
      if (r.status() >= 400 && !/favicon/.test(r.url())) httpFails.push(`${r.url()} HTTP ${r.status()}`);
    });

    // ---- 0. 页面 + WebGL ----
    step('打开页面');
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const gl = await page.evaluate(() => {
      const c = document.createElement('canvas');
      const g = c.getContext('webgl2') || c.getContext('webgl');
      if (!g) return null;
      const dbg = g.getExtension('WEBGL_debug_renderer_info');
      return {
        version: g.getParameter(g.VERSION),
        renderer: dbg ? g.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER),
      };
    });
    if (!gl) { bad('浏览器没有可用的 WebGL 上下文'); throw new Error('WebGL 不可用'); }
    ok(`WebGL: ${gl.version} | ${gl.renderer}`);

    await page.waitForFunction('window.__APP_READY__ === true', { timeout: 30000 });
    ok('__APP_READY__ = true');
    const hasViewer = await page.evaluate(() => !!window.__VIEWER__ && typeof window.__VIEWER__.state === 'function');
    if (!hasViewer) throw new Error('页面没有挂载 window.__VIEWER__（见 CONTRACT §6）');
    ok('window.__VIEWER__ 已挂载');

    // ---- 1. 空态外观 ----
    step('空状态截图');
    await sleep(400);
    await page.screenshot({ path: path.join(SHOTS, '00-empty.png') });
    const layout = await page.evaluate(() => ({
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
      appChildren: document.getElementById('app') ? document.getElementById('app').childElementCount : -1,
      bootHidden: (() => { const b = document.getElementById('boot'); if (!b) return true; const s = getComputedStyle(b); return s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < 0.05; })(),
    }));
    if (layout.overflowX) { bad('页面出现横向滚动条（布局溢出）'); failed++; } else ok('无横向溢出');
    if (layout.appChildren <= 0) { bad('#app 没有内容'); failed++; } else ok(`#app 已渲染（${layout.appChildren} 个子节点）`);
    if (!layout.bootHidden) { warn('启动画面 #boot 似乎仍在显示'); } else ok('启动画面已收起');

    // ---- 2. mock 冒烟 ----
    step('mock 数据冒烟（?mock=1）');
    await page.goto(BASE + '/?mock=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('window.__APP_READY__ === true', { timeout: 30000 });
    const mockReady = await page.evaluate(() => {
      const w = window.__VIEWER__;
      if (typeof w.loadMock === 'function') return w.loadMock();
      if (window.__MOCK_SCHEMATIC__) return w.openMock ? w.openMock() : false;
      return null;
    }).catch(() => null);
    await sleep(800);
    const mockState = await page.evaluate(() => window.__VIEWER__.state());
    if (mockState && mockState.blockCount > 0) ok(`mock 渲染 ${mockState.blockCount} 方块 / ${mockState.regionCount} region / triangles=${mockState.triangles}`);
    else warn('mock 模式没有自动载入数据（如果 UI 需要点击"查看示例"可忽略）');
    await page.screenshot({ path: path.join(SHOTS, '01-mock.png') });

    // ---- 3. 真实 fixture ----
    const files = readdirSync(FIXTURES).filter((f) => f.toLowerCase().endsWith('.litematic')).sort();
    step(`真实文件：${files.length} 个`);
    for (const [i, name] of files.entries()) {
      const buf = readFileSync(path.join(FIXTURES, name));
      const b64 = buf.toString('base64');
      const exp = expByName.get(name);
      let got = null;
      let err = null;
      try {
        got = await page.evaluate(async (b64, name) => {
          const bin = atob(b64);
          const u8 = new Uint8Array(bin.length);
          for (let k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k);
          const summary = await window.__VIEWER__.openFile(u8, name);
          await new Promise((r) => setTimeout(r, 250));
          return { summary, state: window.__VIEWER__.state() };
        }, b64, name);
      } catch (e) {
        err = e && e.message ? e.message : String(e);
      }

      if (err) {
        bad(`${name} → openFile 抛错: ${err.split('\n')[0]}`);
        results.push({ name, pass: false, info: err.split('\n')[0] });
        failed++;
        continue;
      }
      const st = got.state;
      const diffs = exp ? compare(exp, st) : ['expected.json 里没有这个文件的期望值'];
      const visualOk = st.triangles > 0 && st.drawCalls > 0;
      const runtimeOk = !(st.errors && st.errors.length);
      const consoleOk = consoleErrors.length === 0;

      const slug = String(i + 1).padStart(2, '0') + '-' + name.replace(/\.litematic$/i, '').replace(/[^\w\u4e00-\u9fa5-]+/g, '_').slice(0, 40);
      await page.screenshot({ path: path.join(SHOTS, slug + '.png') });
      await page.evaluate(() => window.__VIEWER__.resetCamera());

      const pass = diffs.length === 0 && visualOk && runtimeOk && consoleOk;
      if (!pass) failed++;
      results.push({ name, pass, info: diffs.slice(0, 3).join(' | ') });

      log(`\n  ${pass ? C.green + '✓' : C.red + '✗'} ${name}`);
      dim(`方块 ${st.blockCount} / region ${st.regionCount} / 方块实体 ${st.blockEntityCount} / 实体 ${st.entityCount} / 状态数 ${st.paletteCount}`);
      dim(`尺寸 [${st.size}] min [${st.min}] max [${st.max}] | drawCalls=${st.drawCalls} triangles=${st.triangles}`);
      if (diffs.length) diffs.forEach((d) => bad(d));
      if (!visualOk) bad('没有渲染出任何几何（triangles/drawCalls 为 0）');
      if (!runtimeOk) bad('运行期错误: ' + st.errors.slice(0, 3).join(' / '));
      if (!consoleOk) bad('控制台错误: ' + consoleErrors.slice(-3).join(' / '));
      if (st.warnings && st.warnings.length) warn(`解析警告 ${st.warnings.length} 条: ${st.warnings.slice(0, 2).join(' ; ')}`);
    }

    // ---- 4. 交互（切片 / region / 图例） ----
    step('交互检查（切片 / region 显隐 / 截图 API）');
    const inter = await page.evaluate(async () => {
      const w = window.__VIEWER__;
      const out = {};
      const s0 = w.state();
      out.sliceGone = null;
      if (typeof w.setSlice === 'function' && s0.max) {
        const midY = Math.floor((s0.min[1] + s0.max[1]) / 2);
        w.setSlice(midY);
        await new Promise((r) => setTimeout(r, 200));
        out.sliceGone = s0.drawnInstances - w.state().drawnInstances;
        w.setSlice(null);
        await new Promise((r) => setTimeout(r, 200));
        out.sliceRestored = w.state().drawnInstances === s0.drawnInstances;
      }
      out.shot = typeof w.screenshot === 'function' ? String(w.screenshot()).startsWith('data:image/png') : false;
      return out;
    });
    if (inter.sliceGone === null) warn('没有实现 setSlice（跳过）');
    else if (inter.sliceGone > 0 && inter.sliceRestored) ok(`切片生效（隐藏 ${inter.sliceGone} 个实例，可还原）`);
    else { bad(`切片行为异常: ${JSON.stringify(inter)}`); failed++; }
    if (inter.shot) ok('screenshot() 返回 PNG dataURL'); else { bad('screenshot() 不可用'); failed++; }
    await page.evaluate(() => { const w = window.__VIEWER__; const s = w.state(); if (typeof w.setSlice === 'function' && s.max) w.setSlice(Math.floor((s.min[1] + s.max[1]) / 2)); });
    await sleep(300);
    await page.screenshot({ path: path.join(SHOTS, '90-slice.png') });
    await page.evaluate(() => window.__VIEWER__.setSlice && window.__VIEWER__.setSlice(null));

    // ---- 5. 收尾 ----
    step('控制台 / 资源');
    if (consoleErrors.length) { consoleErrors.slice(0, 5).forEach((e) => bad('console: ' + e)); failed += consoleErrors.length; }
    else ok('控制台无 error');
    if (httpFails.length) { httpFails.slice(0, 5).forEach((e) => bad('资源: ' + e)); failed += httpFails.length; }
    else ok('没有失败/4xx 的资源请求');
    if (consoleWarns.length) dim(`警告 ${consoleWarns.length} 条（不判失败）: ${consoleWarns.slice(0, 2).join(' / ')}`);

    step('结果');
    for (const r of results) log(`  ${r.pass ? C.green + 'PASS' : C.red + 'FAIL'}${C.reset}  ${r.name}${r.pass ? '' : '  ' + C.dim + (r.info || '') + C.reset}`);
    dim(`截图目录: tests/e2e/_shots/`);
    dim(`耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    if (failed) { log(`\n${C.red}${C.bold}RESULT: FAIL${C.reset} (${failed} 项问题)\n`); process.exitCode = 1; }
    else log(`\n${C.green}${C.bold}RESULT: PASS${C.reset}\n`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    cleanup();
  }
}

main().catch((e) => {
  console.error(`\n${C.red}${C.bold}e2e 失败：${C.reset}${e && e.stack ? e.stack : e}\n`);
  process.exit(2);
});
