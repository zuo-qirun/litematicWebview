// 通用 QA：把任意本地 .litematic 丢进 viewer，摆好等距机位截图。
// 用法：node tests/ui/shot-file.mjs <path/to/file.litematic> [--dist 14] [--port 5195] [--out name.png] [--view iso|front]
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
const file = argv.find((a) => !a.startsWith("--") && a !== flag("--dist") && a !== flag("--port") && a !== flag("--out") && a !== flag("--view") && a !== flag("--slice"));
if (!file) {
  console.error("用法: node tests/ui/shot-file.mjs <file.litematic> [--dist 14] [--port 5195] [--out name.png] [--view iso]");
  process.exit(2);
}
const FILE = resolve(ROOT, file);
const DIST = Number(flag("--dist", "14"));
const PORT = Number(flag("--port", "5195"));
const OUT = join(HERE, "_shots", flag("--out", "shot-" + basename(FILE, ".litematic") + ".png"));
const VIEW = flag("--view", "iso");
const SLICE = flag("--slice", null);
const PICK = argv.includes("--pick");
const CHROMES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

let server = null;
let browser = null;
try {
  await fsp.mkdir(join(HERE, "_shots"), { recursive: true });
  server = spawn(process.execPath, ["server.mjs", "--port", String(PORT), "--no-open", "--no-api"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) break;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 120));
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
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction("window.__APP_READY__ === true", { timeout: 30000 });

  const buf = await fsp.readFile(FILE);
  const b64 = buf.toString("base64");
  const name = basename(FILE);
  await page.evaluate(
    (b64data, fname) => {
      const bin = atob(b64data);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return window.__VIEWER__.openFile(arr, fname);
    },
    b64,
    name,
  );
  await page.waitForFunction("window.__VIEWER__.state().loaded === true", { timeout: 60000 });
  const st = await page.evaluate(() => window.__VIEWER__.state());
  console.log("已加载:", st.fileName, "| 方块", st.blockCount, "| 尺寸", JSON.stringify(st.size));

  await page.evaluate(
    (dist, view) => {
      const sc = window.__VIEWER__.scene();
      sc.applyPreset(view === "front" ? "front" : "iso");
      sc.frameAll();
      const cam = sc.camera;
      const t = sc.controls.target;
      const dir = cam.position.clone().sub(t).normalize();
      cam.position.copy(t.clone().add(dir.multiplyScalar(dist)));
      sc.controls.update();
    },
    DIST,
    VIEW,
  );
  const before = await page.evaluate(() => ({
    drawn: window.__VIEWER__.scene().drawnInstances(),
    full: window.__VIEWER__.scene().meshes.reduce((a, m) => a + (m.userData.fullCount != null ? m.userData.fullCount : m.count), 0),
    entityLabels: window.__VIEWER__.state().entityLabels,
    entityLabelsVisible: window.__VIEWER__.state().entityLabelsVisible,
  }));
  if (SLICE !== null) {
    const level = await page.evaluate((lv) => window.__VIEWER__.scene().setSlice(true, Number(lv)), SLICE);
    console.log("切片 level =", level);
  }
  if (PICK) {
    const vp = page.viewport();
    const info = await page.evaluate((cx, cy) => {
      const sc = window.__VIEWER__.scene();
      sc.applyPreset("iso");
      sc.frameAll();
      const hit = sc.pickAt(cx, cy);
      if (!hit) return null;
      sc.setSelected(hit.x, hit.y, hit.z, true, hit.stateKey);
      return { hit, scale: sc.selBox.scale.toArray().map((v) => +v.toFixed(3)), pos: sc.selBox.position.toArray().map((v) => +v.toFixed(3)) };
    }, Math.round(vp.width / 2), Math.round(vp.height / 2));
    console.log("拾取:", JSON.stringify(info));
    await page.evaluate(() => window.__VIEWER__.scene().frameAll());
  }
  await new Promise((r) => setTimeout(r, 1200));
  const after = await page.evaluate(() => ({ drawn: window.__VIEWER__.scene().drawnInstances() }));
  console.log("实例:", JSON.stringify(before), "→ 切片后 drawn =", after.drawn);
  await page.screenshot({ path: OUT });
  console.log("截图:", OUT, "| console errors:", errs.length ? errs.slice(0, 3) : "无");
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill();
}
