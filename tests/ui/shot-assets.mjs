// QA：用指定资产目录（?assets=）渲染同一个 .litematic，用于「材质包前 / 后」肉眼对比。
//
// 用法：
//   node tests/ui/shot-assets.mjs --file tests/_pack_out/terrain-qa.litematic \
//        --assets-base /assets/ --assets-pack /tests/_pack_out/ [--dist 18] [--view iso]
//
// 说明：viewer 支持 ?assets=<资产根 URL>（src/app.js 的 defaultAssetsBase）。
// 这台机器上 dist/ 是构建产物，所以用 `server.mjs --dir <仓库根>` 启动，
// 打开 /dist/index.html?assets=...，这样既能拿到构建好的 app.js，又能读取任意资产目录。
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
const flags = (n) => {
  const out = [];
  for (let i = 0; i < argv.length - 1; i++) if (argv[i] === n) out.push(argv[i + 1]);
  return out;
};
const file = flag("--file");
if (!file) {
  console.error("用法: node tests/ui/shot-assets.mjs --file <x.litematic> --assets-pack /tests/_pack_out/ [--assets-base /assets/]");
  process.exit(2);
}
const FILE = resolve(ROOT, file);
const DIST = Number(flag("--dist", "18"));
const PORT = Number(flag("--port", "5196"));
const VIEW = flag("--view", "iso");
const PREFIX = flag("--out", "assets-compare");
const shots = [];
for (const [name, value] of [
  ["base", flag("--assets-base")],
  ["pack", flag("--assets-pack")],
  ...flags("--assets").map((v, i) => ["assets" + i, v]),
]) {
  if (value) shots.push({ name, url: value.startsWith("/") ? value : "/" + value.replace(/\\/g, "/").replace(/^\/+/, "") + "/" });
}
if (shots.length === 0) shots.push({ name: "base", url: "/assets/" });

const CHROMES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

let server = null;
let browser = null;
try {
  await fsp.mkdir(join(HERE, "_shots"), { recursive: true });
  // --dir 指向仓库根：/dist/index.html 提供构建好的 viewer，/tests/_pack_out/... 提供烘焙产物
  server = spawn(process.execPath, ["server.mjs", "--port", String(PORT), "--no-open", "--no-api", "--dir", ROOT], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => {
    const s = String(d).trim();
    if (s) console.log("  [server]", s.slice(0, 200));
  });
  const t0 = Date.now();
  let up = false;
  while (Date.now() - t0 < 20000) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/dist/index.html`)).ok) {
        up = true;
        break;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  if (!up) throw new Error("server 未在 20s 内就绪");

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
  const buf = await fsp.readFile(FILE);
  const b64 = buf.toString("base64");
  const name = basename(FILE);

  for (const shot of shots) {
    const page = await browser.newPage();
    const errs = [];
    page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
    page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
    const netFails = [];
    page.on("response", (r) => {
      if (r.status() >= 400) netFails.push(`${r.status()} ${r.url()}`);
    });
    page.on("requestfailed", (r) => netFails.push(`FAILED ${r.url()} (${r.failure()?.errorText || "?"})`));
    const url = `http://127.0.0.1:${PORT}/dist/index.html?assets=${encodeURIComponent(shot.url)}`;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForFunction("window.__APP_READY__ === true", { timeout: 40000 });
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
    await page.waitForFunction("window.__VIEWER__.state().loaded === true", { timeout: 90000 });
    const st = await page.evaluate(() => window.__VIEWER__.state());
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
    await new Promise((r) => setTimeout(r, 1400));
    const out = join(HERE, "_shots", `${PREFIX}-${shot.name}.png`);
    await page.screenshot({ path: out });
    const info = await page.evaluate(() => {
      const db = window.__VIEWER__;
      return db.assetsInfo ? db.assetsInfo() : null;
    });
    console.log(
      `[${shot.name}] assets=${shot.url} blocks=${st.blockCount} 截图=${out}` +
        ` console errors=${errs.length ? JSON.stringify(errs.slice(0, 3)) : "无"}` +
        ` net4xx=${netFails.length ? JSON.stringify(netFails.slice(0, 4)) : "无"}` +
        (info ? ` assetsInfo=${JSON.stringify(info).slice(0, 200)}` : ""),
    );
    await page.close();
  }
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill();
}
