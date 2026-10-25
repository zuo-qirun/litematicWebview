#!/usr/bin/env node
/**
 * 箱子材质修复的浏览器端验收截图（puppeteer-core + 本机 Chrome）。
 *
 * 做四件事：
 *   1. 把 dist 的页面文件 + 仓库里**当前**的 assets/ 同步到 `_dl/qa/site`（不写 dist/）
 *   2. 若 5182 端口还没人监听，自己 `node server.mjs --port 5182` 起一个，结束时杀掉
 *   3. 通过契约钩子 `window.__VIEWER__.openFile()` 载入合成投影
 *   4. 按 iso / front / top 三个预设视角截图，并把画布裁切图一起存下来
 *
 * 用法：
 *   node tools/qa/shot_chest.mjs [--url=http://127.0.0.1:5182/]
 *        [--file=_dl/qa/chest_showcase.litematic] [--outdir=_dl/qa] [--width=1600] [--height=1000]
 *        [--site=_dl/qa/site] [--data=_dl/qa/data] [--noserve]
 *
 * 产物：<outdir>/chest_app.png（整窗）、chest_iso.png、chest_iso_opposite.png、chest_front.png、
 *      chest_top.png（画布裁切）、<outdir>/chest_shot-report.json
 * 退出码：0 全部成功；1 有错误（页面错误 / 控制台错误 / 断言失败）；2 环境问题（缺 Chrome/投影）
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import zlib from "node:zlib";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, "..", "..");

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

function findChrome() {
  for (const p of CHROME_CANDIDATES) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const opts = {
    url: "http://127.0.0.1:5182/",
    file: "_dl/qa/chest_showcase.litematic",
    outdir: "_dl/qa",
    site: "_dl/qa/site",
    data: "_dl/qa/data",
    serve: true,
    width: 1600,
    height: 1000,
    dpr: 1.5,
    wait: 20000,
  };
  for (const a of argv) {
    const m = /^--([a-z]+)=(.*)$/.exec(a);
    if (!m) continue;
    if (m[1] === "url") opts.url = m[2];
    else if (m[1] === "file") opts.file = m[2];
    else if (m[1] === "outdir") opts.outdir = m[2];
    else if (m[1] === "site") opts.site = m[2];
    else if (m[1] === "data") opts.data = m[2];
    else if (m[1] === "noserve") opts.serve = false;
    else if (m[1] === "width") opts.width = Number(m[2]) || opts.width;
    else if (m[1] === "height") opts.height = Number(m[2]) || opts.height;
    else if (m[1] === "dpr") opts.dpr = Number(m[2]) || opts.dpr;
    else if (m[1] === "wait") opts.wait = Number(m[2]) || opts.wait;
  }
  opts.fileAbs = path.resolve(PROJECT, opts.file);
  opts.outAbs = path.resolve(PROJECT, opts.outdir);
  opts.siteAbs = path.resolve(PROJECT, opts.site);
  opts.dataAbs = path.resolve(PROJECT, opts.data);
  const u = new URL(opts.url);
  opts.port = Number(u.port || 80);
  return opts;
}

/** 把 dist 的页面文件 + 当前 assets/ 同步到临时站点目录（只写 _dl/，不动 dist/）。 */
function syncSite(opts) {
  const site = opts.siteAbs;
  const distDir = path.join(PROJECT, "dist");
  const needShell = !fs.existsSync(path.join(site, "index.html"));
  if (needShell) {
    if (!fs.existsSync(path.join(distDir, "index.html"))) {
      throw new Error(`没有站点文件：${site} 不存在且 ${distDir} 也没有构建产物（先 node build.mjs）`);
    }
    fs.mkdirSync(site, { recursive: true });
    for (const name of ["index.html", "styles.css", "app.js"]) {
      const src = path.join(distDir, name);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(site, name));
    }
    const samples = path.join(distDir, "samples");
    if (fs.existsSync(samples)) fs.cpSync(samples, path.join(site, "samples"), { recursive: true });
  }
  // assets 每次都重新同步，保证截到的是仓库里最新的资产
  const assetsSrc = path.join(PROJECT, "assets");
  const assetsDst = path.join(site, "assets");
  fs.mkdirSync(assetsDst, { recursive: true });
  for (const name of fs.readdirSync(assetsSrc)) {
    fs.copyFileSync(path.join(assetsSrc, name), path.join(assetsDst, name));
  }
}

/** 探测 url 是否已经有服务在监听（有就不重复起）。 */
function probe(url, timeout = 1200) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode > 0);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(timeout, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** 自己起一个 server.mjs（端口被占用时报错，避免误占别人的）。 */
async function startServer(opts) {
  const args = [
    path.join(PROJECT, "server.mjs"),
    "--port", String(opts.port),
    "--host", "127.0.0.1",
    "--dir", opts.siteAbs,
    "--data", opts.dataAbs,
    "--no-open",
  ];
  const proc = spawn(process.execPath, args, { cwd: PROJECT, stdio: ["ignore", "pipe", "pipe"] });
  proc.stdout.setEncoding("utf8");
  proc.stderr.setEncoding("utf8");
  let log = "";
  proc.stdout.on("data", (d) => { log += d; });
  proc.stderr.on("data", (d) => { log += d; });
  // 本进程异常退出/被 Ctrl-C 时也要把服务带走，别把 5182 端口留着
  const reap = () => { try { if (proc.exitCode == null) proc.kill(); } catch { /* ignore */ } };
  process.once("exit", reap);
  process.once("SIGINT", () => { reap(); process.exit(130); });
  process.once("SIGTERM", () => { reap(); process.exit(143); });
  const deadline = Date.now() + opts.wait;
  for (;;) {
    if (proc.exitCode != null) throw new Error(`server.mjs 提前退出（${proc.exitCode}）：\n${log}`);
    if (await probe(opts.url)) return { proc, log: () => log };
    if (Date.now() > deadline) {
      proc.kill();
      throw new Error(`server.mjs 启动超时：\n${log}`);
    }
    await sleep(250);
  }
}

/**
 * 把相机摆到「以某方块为中心、按预设朝向、距离 dist」的位置。
 * 注意 scene.focusBlock() 只会居中不会拉近（radius = cur/2.4 反推距离），所以这里直接改
 * controls.target / camera.position：两者都基于已有 Vector3 的 clone/copy，不需要引入 three。
 */
const CAM = `(x, y, z, preset, dist, flip, tilt) => {
  const sc = window.__VIEWER__.scene();
  if (preset) sc.applyPreset(preset);
  const target = sc.worldOf(x + 0.5, y + 0.5, z + 0.5);
  const dir = sc.camera.position.clone().sub(sc.controls.target).normalize();
  if (flip) { dir.x = -dir.x; dir.z = -dir.z; }
  if (tilt) { dir.z += tilt; dir.normalize(); }
  sc.controls.target.copy(target);
  sc.camera.position.copy(target).addScaledVector(dir, dist);
  sc.controls.minDistance = 0.1;
  sc.controls.maxDistance = 400;
  sc.camera.updateProjectionMatrix();
  sc.controls.update();
  sc._needRender = true;
  return { target: [target.x, target.y, target.z], dist: sc.camera.position.distanceTo(sc.controls.target) };
}`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(opts.fileAbs)) {
    console.error(`找不到投影文件：${opts.fileAbs}（先跑 python tools/qa/make_chest_schematic.py）`);
    process.exit(2);
  }
  const chrome = findChrome();
  if (!chrome) {
    console.error("找不到 Chrome，可用环境变量 CHROME_PATH 指定可执行文件路径");
    process.exit(2);
  }
  fs.mkdirSync(opts.outAbs, { recursive: true });

  let server = null;
  try {
    syncSite(opts);
    const already = await probe(opts.url);
    if (already) {
      console.log(`复用 ${opts.url} 上已有的服务`);
    } else if (opts.serve) {
      server = await startServer(opts);
      console.log(`已启动 server.mjs（pid ${server.proc.pid}，port ${opts.port}）`);
    } else {
      throw new Error(`${opts.url} 没有服务，且传了 --noserve`);
    }
  } catch (err) {
    console.error(String((err && err.message) || err));
    process.exit(2);
  }

  const bytes = zlib.gunzipSync(fs.readFileSync(opts.fileAbs)); // 页面侧自己也会解 gzip，这里给原始 NBT
  const b64 = bytes.toString("base64");
  const fileName = path.basename(opts.fileAbs);

  const report = { url: opts.url, file: fileName, size: bytes.length, shots: [], consoleErrors: [], pageErrors: [], state: null };
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--hide-scrollbars",
      "--mute-audio",
      "--force-device-scale-factor=1",
      "--enable-unsafe-swiftshader",
      `--window-size=${opts.width},${opts.height}`,
    ],
    defaultViewport: { width: opts.width, height: opts.height, deviceScaleFactor: opts.dpr },
  });

  let code = 0;
  try {
    const page = await browser.newPage();
    page.on("console", (m) => {
      if (m.type() === "error") report.consoleErrors.push(m.text());
    });
    page.on("pageerror", (e) => report.pageErrors.push(String((e && e.message) || e)));

    await page.goto(opts.url, { waitUntil: "networkidle0", timeout: 45000 });
    await page.waitForFunction("window.__APP_READY__ === true", { timeout: opts.wait, polling: 100 });
    await sleep(300);

    const webgl = await page.evaluate(() => {
      try {
        const c = document.createElement("canvas");
        return !!(c.getContext("webgl2") || c.getContext("webgl"));
      } catch {
        return false;
      }
    });
    report.webgl = webgl;
    if (!webgl) report.pageErrors.push("WebGL 不可用（headless 可能缺 SwiftShader）");

    // 载入合成投影
    const st = await page.evaluate(async (b64data, name) => {
      const raw = atob(b64data);
      const u8 = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) u8[i] = raw.charCodeAt(i);
      await window.__VIEWER__.openFile(u8, name);
      return window.__VIEWER__.state();
    }, b64, fileName);
    report.state = {
      loaded: st.loaded,
      size: st.size,
      blockCount: st.blockCount,
      paletteCount: st.paletteCount,
      drawnInstances: st.drawnInstances,
      warnings: st.warnings,
      errors: st.errors,
    };
    if (!st.loaded) throw new Error("投影没有加载成功");
    // 等「已打开 xxx」的 toast 自己消失，别让它糊在裁切图上
    await sleep(4600);

    // 画布位置（裁切用）
    const canvasBox = await page.evaluate(() => {
      const c = document.querySelector("#stage canvas") || document.querySelector("canvas");
      const r = c.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });

    const clipSnap = async (name) => {
      const file = path.join(opts.outAbs, name);
      await sleep(260);
      await page.screenshot({
        path: file,
        clip: { x: canvasBox.x, y: canvasBox.y, width: canvasBox.width, height: canvasBox.height },
      });
      report.shots.push({ name, path: path.relative(PROJECT, file), clip: canvasBox });
      return file;
    };

    // 1) 整窗：默认 iso 全景（能看到左栏图例/统计徽章，证明是真实界面）
    await page.evaluate(() => {
      const V = window.__VIEWER__;
      V.resetCamera();
      V.scene().setGridVisible(false);
    });
    await sleep(320);
    const appShot = path.join(opts.outAbs, "chest_app.png");
    await page.screenshot({ path: appShot });
    report.shots.push({ name: "chest_app.png", path: path.relative(PROJECT, appShot), clip: null });

    // 2) iso 特写（相机在 -X/-Z 一侧）：锁扣朝向镜头，能一次看到橡木箱 / 诱捕箱 / 末影箱
    report.aimIso = await page.evaluate(`(${CAM})(5, 1, 2, "iso", 6.0, true)`);
    await clipSnap("chest_iso.png");

    // 3) 另一个方向的 iso（相机在 +X/+Z 一侧）：facing=east/west 的侧面
    report.aimIso2 = await page.evaluate(`(${CAM})(6, 1, 2, "iso", 7.0)`);
    await clipSnap("chest_iso_opposite.png");

    // 4) front 正视：末影箱正面（锁扣必须居中、朝向正确）
    report.aimFront = await page.evaluate(`(${CAM})(8, 1, 6, "front", 5.2)`);
    await clipSnap("chest_front.png");

    // 5) 高角度俯视：盖子顶面（橡木=木板 / 末影=黑曜石）
    report.aimTop = await page.evaluate(`(${CAM})(6, 1, 4, "top", 13.0, false, 0.55)`);
    await clipSnap("chest_top.png");

    if (report.consoleErrors.length || report.pageErrors.length) code = 1;
    if (!report.state || report.state.errors.length) code = 1;
  } catch (err) {
    report.fatal = String((err && err.stack) || err);
    code = 1;
  } finally {
    if (server) {
      server.proc.kill();
      if (server.proc.exitCode == null) await sleep(200);
      console.log(`已关闭自己起的 server.mjs（pid ${server.proc.pid}）`);
    }
    await browser.close();
    const out = path.join(opts.outAbs, "chest_shot-report.json");
    fs.writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    console.log(`\n退出码 ${code}；报告 ${path.relative(PROJECT, out)}`);
  }
  process.exit(code);
}

main();
