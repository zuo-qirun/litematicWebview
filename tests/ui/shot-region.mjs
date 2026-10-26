#!/usr/bin/env node
// QA：打开一个 .litematic，聚焦某个 region 后截图（用来检查实体图标、方块细节）。
// 用法：node tests/ui/shot-region.mjs <file.litematic> <region 名片段> [--out 名字.png] [--dist 40]
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const SHOTS = join(HERE, "_shots");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const args = process.argv.slice(2);
const file = args[0];
const regionPart = args[1];
const opt = { out: "shot-region.png", dist: 40, port: 5197 };
for (let i = 2; i < args.length; i++) {
  if (args[i] === "--out") opt.out = args[++i];
  else if (args[i] === "--dist") opt.dist = Number(args[++i]);
  else if (args[i] === "--port") opt.port = Number(args[++i]);
}
if (!file || !regionPart) {
  console.error("用法: node tests/ui/shot-region.mjs <file.litematic> <region 名片段> [--out x.png] [--dist 40]");
  process.exit(2);
}
mkdirSync(SHOTS, { recursive: true });

const server = spawn(process.execPath, [join(ROOT, "server.mjs"), "--port", String(opt.port), "--dir", join(ROOT, "dist"), "--no-open", "--no-api"], {
  cwd: ROOT, stdio: "ignore", windowsHide: true,
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let browser;
try {
  await wait(700);
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--disable-gpu-sandbox", "--window-size=1280,800"],
    defaultViewport: { width: 1280, height: 800 },
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${opt.port}/?mock=0`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction("window.__APP_READY__ === true", { timeout: 30000 });
  const bytes = Array.from(readFileSync(file));
  const info = await page.evaluate(async (bytes, name) => {
    const v = window.__VIEWER__;
    await v.openFile(new Uint8Array(bytes), name);
    const sc = v.scene();
    const hit = (sc.regionList || []).find((r) => String(r.name).includes(name));
    if (!hit) return { ok: false, regions: (sc.regionList || []).map((r) => r.name) };
    sc.focusRegion(hit.name);
    return { ok: true, region: hit.name, entities: sc.entityCount, icons: sc.entityIconCount };
  }, bytes, regionPart);
  if (!info.ok) {
    console.error("找不到 region:", regionPart, info.regions);
    process.exitCode = 1;
  }
  await wait(600);
  await page.evaluate((d) => {
    const sc = window.__VIEWER__.scene();
    const cam = sc.camera;
    const c = sc.controls.target;
    const dir = cam.position.clone().sub(c).normalize();
    cam.position.copy(c).addScaledVector(dir, d);
  }, opt.dist);
  await wait(400);
  const out = join(SHOTS, opt.out);
  await page.screenshot({ path: out });
  console.log(`截图: ${out}`, JSON.stringify(info), errors.length ? `pageerror: ${errors.join(" | ")}` : "");
} finally {
  if (browser) await browser.close();
  server.kill();
}
