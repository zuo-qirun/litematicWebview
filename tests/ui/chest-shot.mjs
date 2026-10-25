// 独立 QA：在真实投影里把镜头对准箱子，截图肉眼确认箱子几何/贴图。
// 用法：node tests/ui/chest-shot.mjs [--sample 豪华版mis正式版v1.7.litematic] [--port 5194]
import { spawn } from "node:child_process";
import { promises as fsp } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
const PORT = Number(arg("--port", "5194"));
const SAMPLE = arg("--sample", "豪华版mis正式版v1.7.litematic");
const SHOTS = join(HERE, "_shots");
const CHROMES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

let server = null;
let browser = null;
try {
  await fsp.mkdir(SHOTS, { recursive: true });
  server = spawn(process.execPath, ["server.mjs", "--port", String(PORT), "--no-open", "--no-api"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) break;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  let chrome = CHROMES[0];
  for (const c of CHROMES) {
    try {
      await fsp.access(c);
      chrome = c;
      break;
    } catch {
      /* next */
    }
  }
  browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ["--enable-unsafe-swiftshader", "--no-sandbox", "--hide-scrollbars"],
    defaultViewport: { width: 1280, height: 800 },
  });
  const page = await browser.newPage();
  const errs = [];
  page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  await page.goto(`http://127.0.0.1:${PORT}/?sample=${encodeURIComponent(SAMPLE)}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction("window.__APP_READY__ === true", { timeout: 30000 });
  await page.waitForFunction("window.__VIEWER__.state().loaded === true", { timeout: 60000 });

  const target = await page.evaluate(() => {
    const v = window.__VIEWER__;
    const list = v.getBlocks("chest");
    const names = list.slice(0, 6).map((b) => `${b.id}×${b.count}@${b.first ? `${b.first.x},${b.first.y},${b.first.z}` : "?"}`);
    const normal = list.find((b) => b.id === "minecraft:chest") || list[0];
    const trapped = list.find((b) => b.id === "minecraft:trapped_chest");
    const ender = list.find((b) => b.id === "minecraft:ender_chest");
    const pick = normal || trapped || ender;
    if (pick && pick.first) {
      v.scene().focusBlock(pick.first.x, pick.first.y, pick.first.z);
      v.scene().frameAll && null;
    }
    return {
      names,
      picked: pick ? { id: pick.id, count: pick.count, first: pick.first } : null,
      counts: { chest: normal?.count, trapped: trapped?.count, ender: ender?.count },
    };
  });
  console.log("箱子族统计:", JSON.stringify(target.counts), "| 图例前几项:", target.names.join(", "));
  console.log("镜头对准:", JSON.stringify(target.picked));
  await new Promise((r) => setTimeout(r, 1500));
  // 把相机拉近：沿当前视线方向靠近目标
  await page.evaluate(() => {
    const sc = window.__VIEWER__.scene();
    const cam = sc.camera;
    const t = sc.controls.target;
    const dir = cam.position.clone().sub(t).setLength(9);
    cam.position.copy(t.clone().add(dir));
    sc.controls.update();
  });
  await new Promise((r) => setTimeout(r, 900));
  const out = join(SHOTS, "chest-real.png");
  await page.screenshot({ path: out });
  console.log("截图:", out, "| console errors:", errs.length ? errs.slice(0, 3) : "无");
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill();
}
