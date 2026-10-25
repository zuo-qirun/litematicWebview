#!/usr/bin/env node
// mcviewer —— UI 视觉自检截图脚本（puppeteer-core + 本机 Chrome）
//
// 用法：
//   node tests/ui/shot.mjs <url> <out.png> [width] [height] [options]
//
// 选项：
//   --scenario=empty|loaded|slice|inspect|legend|help|wire|top   预置交互（可重复给出，按顺序执行）
//   --actions="wait:300;click:[data-act=shot];move:800,450;key:]"  自定义动作，`;` 分隔
//       支持：wait:ms | click:<css> | dblclick:<css> | move:x,y | key:<key> | press:<key>
//             eval:<js> | shot:<name> | scenario:<name>
//   --wait=<ms>             等待 APP_READY 的超时，默认 20000
//   --settle=<ms>           截图前静置时间，默认 350
//   --outdir=<dir>          截图目录，默认 tests/ui/_shots
//   --allow-console-error   有 console.error 也返回 0（默认视为失败）
//
// 约定：页面必须设置 window.__APP_READY__ = true（也可用 ?mock=1 直接进 mock 场景）。
// 结束后打印：控制台消息、pageerror、失败请求、__VIEWER__.state()、截图路径清单。

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, "../..");

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
    } catch (e) { /* ignore */ }
  }
  return null;
}

function parseArgs(argv) {
  const opts = {
    url: null, out: null, width: 1440, height: 900,
    actions: [], wait: 20000, settle: 350,
    outdir: path.join(HERE, "_shots"),
    allowConsoleError: false, keepOpen: false,
    clip: null, dpr: 1,
  };
  const positional = [];
  for (const a of argv) {
    if (a.startsWith("--scenario=")) opts.actions.push("scenario:" + a.slice(11));
    else if (a.startsWith("--actions=")) opts.actions.push(...a.slice(10).split(";").map((s) => s.trim()).filter(Boolean));
    else if (a.startsWith("--wait=")) opts.wait = Number(a.slice(7)) || 20000;
    else if (a.startsWith("--settle=")) opts.settle = Number(a.slice(9)) || 350;
    else if (a.startsWith("--outdir=")) opts.outdir = path.resolve(PROJECT, a.slice(9));
    else if (a.startsWith("--clip=")) opts.clip = a.slice(7).split(",").map(Number);
    else if (a.startsWith("--dpr=")) opts.dpr = Number(a.slice(6)) || 1;
    else if (a === "--allow-console-error") opts.allowConsoleError = true;
    else if (a === "--keep-open") opts.keepOpen = true;
    else if (a.startsWith("--")) opts.actions.push(a.slice(2)); // 允许裸 `--wait:300` 简化写法
    else positional.push(a);
  }
  if (positional[0]) opts.url = positional[0];
  if (positional[1]) opts.out = positional[1];
  if (positional[2]) opts.width = Number(positional[2]) || 1440;
  if (positional[3]) opts.height = Number(positional[3]) || 900;
  if (!opts.out) opts.out = "shot.png";
  return opts;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 截图（支持 --clip=x,y,w,h 与 --dpr 缩放，方便近距离看细节） */
function snapOptions(opts, file) {
  return opts.clip
    ? { path: file, clip: { x: opts.clip[0], y: opts.clip[1], width: opts.clip[2], height: opts.clip[3] } }
    : { path: file };
}

/* ------------------------------------------------------------------ 场景预置 */

async function runScenario(page, name, log, ctx) {
  const V = () => page.evaluate(() => window.__VIEWER__ || null);
  switch (name) {
    case "empty":
      await sleep(250);
      break;

    case "loaded":
      await page.waitForFunction(
        "window.__VIEWER__ && window.__VIEWER__.state && window.__VIEWER__.state().loaded",
        { timeout: 15000 }
      ).catch(() => {});
      await sleep(400);
      break;

    case "slice": {
      const st = await page.evaluate(() => (window.__VIEWER__ ? window.__VIEWER__.state() : null)).catch(() => null);
      const num = (v) => (Array.isArray(v) ? v[1] : v && typeof v === "object" ? v.y : v);
      const stMinY = st ? num(st.min) : undefined;
      const stMaxY = st ? num(st.max) : undefined;
      const sizeY = st && st.size ? (Array.isArray(st.size) ? st.size[1] : st.size.y) : undefined;
      const lo = Number.isFinite(stMinY) ? stMinY : 0;
      const hi = Number.isFinite(stMaxY) && stMaxY > lo ? stMaxY : Number.isFinite(sizeY) ? lo + sizeY - 1 : lo + 8;
      const mid = Math.round((lo + hi) / 2);
      if (st && st.loaded) {
        const ok = await page.evaluate((y) => {
          try { window.__VIEWER__.setSlice(y); return true; } catch (e) { return false; }
        }, mid).catch(() => false);
        if (!ok) log.bump(`slice: setSlice 不可用（${mid}）`);
      } else {
        // 退化方案：点顶栏切片按钮，再用 ] 逐层
        await page.evaluate(() => document.querySelector('[data-act="slice"]')?.click());
        for (let i = 0; i < 6; i++) { await page.keyboard.press("]"); await sleep(60); }
      }
      await sleep(450);
      break;
    }

    case "inspect": {
      // 在画布中心附近扫描，直到检查器出现方块信息
      const box = await page.evaluate(() => {
        const c = document.querySelector("canvas");
        const r = c.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      });
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      const pts = [];
      for (let dy = -80; dy <= 80; dy += 40) for (let dx = -120; dx <= 120; dx += 40) pts.push([cx + dx, cy + dy]);
      pts.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
      for (const [x, y] of pts) {
        await page.mouse.move(x, y, { steps: 3 });
        await sleep(70);
        const hit = await page.evaluate(() => {
          const el = document.querySelector("#inspectorBody .insp-name, #inspectorBody .insp-id");
          return el ? el.textContent.trim() : null;
        });
        if (hit) { ctx.inspectHit = hit; break; }
      }
      await sleep(250);
      // 尝试打开「原始 NBT」折叠块，让截图里能看到方块实体内容
      await page.evaluate(() => {
        const d = document.querySelector("#inspectorBody details.nbt");
        if (d) { d.open = true; d.scrollIntoView({ block: "nearest" }); }
      });
      await sleep(220);
      break;
    }

    case "legend": {
      await page.evaluate(() => {
        const row = document.querySelector("#legendList .legend-row");
        if (row) row.click();
      });
      await sleep(400);
      break;
    }

    case "help":
      await page.evaluate(() => document.querySelector('[data-act="help"]')?.click());
      await sleep(350);
      break;

    case "wire":
      await page.evaluate(() => document.querySelector('[data-act="wire"]')?.click());
      await sleep(350);
      break;

    case "top":
      await page.evaluate(() => document.querySelector('[data-view="top"]')?.click());
      await sleep(450);
      break;

    case "grid":
      await page.evaluate(() => document.querySelector('[data-act="grid"]')?.click());
      await sleep(300);
      break;

    default:
      log.bump(`未知 scenario：${name}`);
  }
}

/* ------------------------------------------------------------------ 主流程 */

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.url) {
    console.error("用法：node tests/ui/shot.mjs <url> <out.png> [width] [height] [--scenario=...] [--actions=...]");
    process.exit(2);
  }
  const chrome = findChrome();
  if (!chrome) {
    console.error("找不到 Chrome，可用环境变量 CHROME_PATH 指定可执行文件路径");
    process.exit(2);
  }

  const messages = [];
  const errors = [];
  const failedRequests = [];
  const badResponses = [];
  const shots = [];
  const log = { bump: (m) => messages.push({ type: "note", text: m }) };

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

  let exitCode = 0;
  try {
    const page = await browser.newPage();
    page.on("console", (msg) => {
      const type = msg.type();
      const text = msg.text();
      messages.push({ type, text });
      if (type === "error") errors.push(text);
    });
    page.on("pageerror", (err) => {
      const text = `${err && err.name ? err.name + ": " : ""}${err && err.message ? err.message : String(err)}`;
      errors.push(text);
      messages.push({ type: "pageerror", text });
    });
    page.on("requestfailed", (req) => {
      failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText || "failed"}`);
    });
    page.on("response", (res) => {
      if (res.status() >= 400) badResponses.push(`${res.status()} ${res.url()}`);
    });

    await page.goto(opts.url, { waitUntil: "networkidle0", timeout: 45000 });

    let ready = true;
    try {
      await page.waitForFunction("window.__APP_READY__ === true", { timeout: opts.wait, polling: 120 });
    } catch (e) {
      ready = false;
      errors.push(`等待 window.__APP_READY__ 超时（${opts.wait}ms）`);
    }

    const webgl = await page.evaluate(() => {
      try {
        const c = document.createElement("canvas");
        return !!(c.getContext("webgl2") || c.getContext("webgl"));
      } catch (e) { return false; }
    });
    if (!webgl) {
      errors.push("WebGL 不可用（headless 环境可能缺少 SwiftShader）");
    }

    // 让首帧动画稳定
    await sleep(260);

    const ctx = {};
    for (const act of opts.actions) {
      const idx = act.indexOf(":");
      const cmd = idx < 0 ? act : act.slice(0, idx);
      const arg = idx < 0 ? "" : act.slice(idx + 1);
      if (cmd === "scenario") await runScenario(page, arg, log, ctx);
      else if (cmd === "wait") await sleep(Number(arg) || 200);
      else if (cmd === "click") await page.click(arg).catch((e) => errors.push(`click(${arg}) 失败：${e.message}`));
      else if (cmd === "dblclick") await page.mouse.click(...(arg.split(",").map(Number)), { clickCount: 2 }).catch(() => {});
      else if (cmd === "move") {
        const [x, y] = arg.split(",").map(Number);
        await page.mouse.move(x, y, { steps: 4 });
      } else if (cmd === "key" || cmd === "press") await page.keyboard.press(arg);
      else if (cmd === "eval") await page.evaluate(arg).catch((e) => errors.push(`eval 失败：${e.message}`));
      else if (cmd === "shot") {
        await sleep(opts.settle);
        const name = arg || `shot-${shots.length + 1}`;
        const file = path.join(opts.outdir, name.endsWith(".png") ? name : name + ".png");
        fs.mkdirSync(path.dirname(file), { recursive: true });
        await page.screenshot(snapOptions(opts, file));
        shots.push(file);
      } else log.bump(`忽略未知动作：${act}`);
    }

    // 最终截图
    await sleep(opts.settle);
    fs.mkdirSync(path.dirname(opts.out), { recursive: true });
    const outFile = path.resolve(PROJECT, opts.out);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    await page.screenshot(snapOptions(opts, outFile));
    shots.push(outFile);

    // 导出一份页面状态，方便肉眼核对
    const state = await page.evaluate(() => {
      const v = window.__VIEWER__;
      if (!v) return null;
      try { return typeof v.state === "function" ? v.state() : null; } catch (e) { return null; }
    }).catch(() => null);
    const title = await page.title();
    if (state) fs.writeFileSync(outFile.replace(/\.png$/, ".state.json"), JSON.stringify(state, null, 2));

    /* ---------------- 报告 ---------------- */
    const line = "─".repeat(64);
    console.log(line);
    console.log(`页面：${opts.url}`);
    console.log(`标题：${title}  ·  视口：${opts.width}×${opts.height}  ·  APP_READY：${ready ? "是" : "否"}`);
    console.log(`截图：\n  ${shots.join("\n  ")}`);
    if (state) {
      const pick = (o, keys) => keys.map((k) => `${k}=${JSON.stringify(o[k])}`).join("  ");
      console.log("状态：" + pick(state, ["loaded", "fileName", "blockCount", "drawnInstances", "regionCount", "paletteCount", "drawCalls", "triangles"]));
      if (state.size) console.log(`尺寸：${JSON.stringify(state.size)}  min=${JSON.stringify(state.min)}  max=${JSON.stringify(state.max)}`);
      if (state.warnings && state.warnings.length) console.log(`警告：${JSON.stringify(state.warnings).slice(0, 600)}`);
      if (state.errors && state.errors.length) console.log(`状态错误：${JSON.stringify(state.errors).slice(0, 600)}`);
    } else {
      console.log("状态：window.__VIEWER__.state() 不可用");
    }
    if (ctx.inspectHit) console.log(`检查器命中：${ctx.inspectHit}`);

    const notes = messages.filter((m) => m.type === "note");
    if (notes.length) console.log("备注：\n  " + notes.map((n) => n.text).join("\n  "));

    const warnings = messages.filter((m) => m.type === "warning");
    if (warnings.length) {
      console.log(`控制台警告 ${warnings.length} 条：`);
      for (const w of warnings.slice(0, 20)) console.log("  ⚠ " + w.text);
    }
    if (failedRequests.length) {
      console.log(`请求失败 ${failedRequests.length} 条：`);
      for (const r of failedRequests.slice(0, 20)) console.log("  ✗ " + r);
    }
    if (badResponses.length) {
      console.log(`HTTP >=400 ${badResponses.length} 条：`);
      for (const r of badResponses.slice(0, 20)) console.log("  ✗ " + r);
    }
    if (errors.length) {
      console.log(`\n❌ 错误 ${errors.length} 条：`);
      for (const e of errors.slice(0, 30)) console.log("  ✗ " + e);
      if (!opts.allowConsoleError) exitCode = 1;
    } else {
      console.log("\n✅ 无控制台错误 / 页面异常");
    }
    console.log(line);
  } catch (err) {
    console.error("截图流程异常：", err && err.stack ? err.stack : err);
    exitCode = 1;
  } finally {
    if (!opts.keepOpen) await browser.close();
  }
  process.exit(exitCode);
}

main();
