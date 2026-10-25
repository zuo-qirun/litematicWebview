// 切片 QA：在同一份投影上逐层扫描，确认实例数单调下降、且切口干净（截图）。
// 用法：node tests/ui/slice-qa.mjs "<file.litematic>" [--levels 0,20,40,60] [--port 5198]
import { spawn } from "node:child_process";
import { promises as fsp } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
};
const file = argv.find((a) => !a.startsWith("--") && a !== flag("--levels") && a !== flag("--port"));
if (!file) {
  console.error('用法: node tests/ui/slice-qa.mjs "<file.litematic>" [--levels 0,20,40] [--port 5198]');
  process.exit(2);
}
const FILE = resolve(ROOT, file);
const LEVELS = flag("--levels", "0,20,40,60,80,100").split(",").map(Number);
const PORT = Number(flag("--port", "5198"));
const CHROMES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

let server = null;
let browser = null;
try {
  server = spawn(process.execPath, ["server.mjs", "--port", String(PORT), "--no-open", "--no-api"], {
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) break; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 120));
  }
  let chrome = CHROMES[0];
  for (const c of CHROMES) { try { await fsp.access(c); chrome = c; break; } catch { /* next */ } }
  browser = await puppeteer.launch({
    executablePath: chrome, headless: true,
    args: ["--enable-unsafe-swiftshader", "--no-sandbox", "--hide-scrollbars"],
    defaultViewport: { width: 1280, height: 800 },
  });
  const page = await browser.newPage();
  const errs = [];
  page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction("window.__APP_READY__ === true", { timeout: 30000 });
  const b64 = (await fsp.readFile(FILE)).toString("base64");
  await page.evaluate((d, n) => {
    const bin = atob(d);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return window.__VIEWER__.openFile(arr, n);
  }, b64, basename(FILE));
  await page.waitForFunction("window.__VIEWER__.state().loaded === true", { timeout: 90000 });

  const rows = [];
  for (const lv of LEVELS) {
    const r = await page.evaluate((level) => {
      const sc = window.__VIEWER__.scene();
      sc.setSlice(true, level);
      return { level: sc.slice.level, drawn: sc.drawnInstances() };
    }, lv);
    rows.push(r);
    await new Promise((res) => setTimeout(res, 220));
  }
  await page.evaluate(() => { window.__VIEWER__.scene().applyPreset("iso"); window.__VIEWER__.scene().frameAll(); });
  await new Promise((r) => setTimeout(r, 500));
  const out = join(HERE, "_shots", "slice-" + basename(FILE, ".litematic") + "-" + LEVELS[Math.floor(LEVELS.length / 2)] + ".png");
  await page.screenshot({ path: out });
  const full = await page.evaluate(() => {
    const sc = window.__VIEWER__.scene();
    sc.setSlice(false);
    return sc.drawnInstances();
  });
  console.log("全量实例:", full);
  console.log("逐层:", rows.map((r) => `L${r.level}=${r.drawn}`).join("  "));
  const mono = rows.every((r, i) => i === 0 || r.drawn >= rows[i - 1].drawn);
  console.log(mono ? "✓ 实例数随层数单调不减（层越高保留越多）" : "✗ 实例数非单调（有问题）");
  console.log("截图:", out, "| console errors:", errs.length ? errs.slice(0, 2) : "无");
  if (!mono) process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill();
}
