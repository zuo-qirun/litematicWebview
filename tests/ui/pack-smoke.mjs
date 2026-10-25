// 材质包端到端冒烟：上传 zip → 服务端烘焙 → 侧栏启用 → 画面贴图真的变了。
// 用法：node tests/ui/pack-smoke.mjs [--port 5182] [--headful]
import { spawn } from "node:child_process";
import { promises as fsp } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
};
const PORT = Number(flag("--port", "5182"));
const TOKEN = "test-token-9f3a";
const CHROMES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];
const STONE = join(ROOT, "tests", "_synthetic", "stone-qa.litematic");
const PACK = join(ROOT, "tests", "_data_pack", "red-stone.zip");
const SHOTS = join(HERE, "_shots");

let pass = 0;
let fail = 0;
function ok(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  \u2713 ${name}`);
  } else {
    fail++;
    console.log(`  \u2717 ${name}${detail ? "  — " + detail : ""}`);
  }
}

let server = null;
let browser = null;
let tmpData = null;
try {
  await fsp.mkdir(SHOTS, { recursive: true });
  tmpData = await fsp.mkdtemp(join(os.tmpdir(), "mcviewer-pack-"));
  console.log("材质包端到端冒烟");
  server = spawn(
    process.execPath,
    ["server.mjs", "--port", String(PORT), "--no-open", "--data", tmpData, "--token", TOKEN, "--max-upload-mb", "8"],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );
  server.stderr.on("data", (d) => {
    const s = String(d).trim();
    if (s) console.log("  [server]", s.slice(0, 300));
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/api/capabilities`)).ok) break;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  // 1. 上传材质包
  const zipBytes = await fsp.readFile(PACK);
  const up = await fetch(`http://127.0.0.1:${PORT}/api/packs`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "x-file-name": encodeURIComponent("red-stone.zip"),
      "content-type": "application/zip",
    },
    body: zipBytes,
  });
  const upBody = await up.json().catch(() => ({}));
  ok("上传材质包返回 202", up.status === 202, `status=${up.status}`);
  const packId = upBody.item?.id || upBody.pack?.id || upBody.id;
  ok("返回材质包 id", !!packId, JSON.stringify(upBody).slice(0, 200));

  // 2. 轮询烘焙
  let pack = null;
  const tBake = Date.now();
  while (Date.now() - tBake < 240000) {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/packs/${packId}`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const b = await r.json();
    pack = b.item || b.pack || b;
    if (pack.status === "ready" || pack.status === "error") break;
    await new Promise((x) => setTimeout(x, 700));
  }
  ok("烘焙完成且状态 ready", pack && pack.status === "ready", pack ? `status=${pack.status} ${pack.message || ""}` : "无响应");
  const bakeSec = ((Date.now() - tBake) / 1000).toFixed(1);
  console.log(`  · 烘焙耗时 ${bakeSec}s，assetsUrl=${pack && pack.assetsUrl}`);

  // 3. 静态资源可访问
  const assetsUrl = pack && pack.assetsUrl;
  const mf = await fetch(`http://127.0.0.1:${PORT}${assetsUrl}manifest.json`);
  ok("烘焙产物 manifest.json 可访问", mf.ok, `status=${mf.status}`);
  const bl = await (await fetch(`http://127.0.0.1:${PORT}${assetsUrl}blocks.json`)).json();
  const stoneDef = bl.blocks["minecraft:stone"];
  ok(
    "stone 已被材质包改指自定义模型",
    JSON.stringify(stoneDef).includes("stone_custom"),
    JSON.stringify(stoneDef).slice(0, 120),
  );

  // 4. 浏览器里加载石头投影 → 应用材质包 → 看画面变化
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
    headless: !argv.includes("--headful"),
    args: ["--enable-unsafe-swiftshader", "--no-sandbox", "--hide-scrollbars"],
    defaultViewport: { width: 1280, height: 800 },
  });
  const page = await browser.newPage();
  const errs = [];
  page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  await page.evaluateOnNewDocument((tok) => {
    try {
      localStorage.setItem("mcviewer.apiToken", tok);
    } catch {
      /* ignore */
    }
  }, TOKEN);
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction("window.__APP_READY__ === true", { timeout: 30000 });

  const buf = await fsp.readFile(STONE);
  await page.evaluate(
    (b64, fname) => {
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return window.__VIEWER__.openFile(arr, fname);
    },
    buf.toString("base64"),
    "stone-qa.litematic",
  );
  await page.waitForFunction("window.__VIEWER__.state().loaded === true", { timeout: 60000 });
  await page.evaluate(() => {
    const sc = window.__VIEWER__.scene();
    sc.applyPreset("iso");
    sc.frameAll();
    const cam = sc.camera;
    const t = sc.controls.target;
    const dir = cam.position.clone().sub(t).normalize();
    cam.position.copy(t.clone().add(dir.multiplyScalar(9)));
    sc.controls.update();
  });
  await new Promise((r) => setTimeout(r, 900));
  await page.screenshot({ path: join(SHOTS, "pack-before.png") });

  // 侧栏材质包卡片：点「使用」
  const rows = await page.$$(".card-packs .pack-row");
  ok("材质包列表出现条目", rows.length >= 1, `rows=${rows.length}`);
  const clicked = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".card-packs .pack-row")];
    const row = rows.find((r) => !r.classList.contains("is-active"));
    if (!row) return null;
    const btn = [...row.querySelectorAll("button")].find((b) => /使用|已启用/.test(b.textContent || ""));
    if (!btn) return null;
    btn.click();
    return (btn.textContent || "").trim();
  });
  ok("点击「使用」按钮", !!clicked, String(clicked));
  const tApply = Date.now();
  let applied = false;
  while (Date.now() - tApply < 120000) {
    applied = await page.evaluate(() => !!document.querySelector(".card-packs .pack-row.is-active"));
    if (applied) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  ok("材质包进入「已启用」状态", applied);
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: join(SHOTS, "pack-after.png") });

  const st = await page.evaluate(() => window.__VIEWER__.state());
  ok("应用材质包后模型仍在场景中", st.loaded && st.blockCount === 8, `blocks=${st.blockCount}`);
  ok("控制台无错误", errs.length === 0, errs.slice(0, 3).join(" | "));

  console.log(`\nRESULT: ${fail === 0 ? "PASS" : "FAIL"}  (${pass} 通过 / ${fail} 失败)`);
  if (fail > 0) process.exitCode = 1;
} catch (err) {
  console.error("异常:", err && err.stack ? err.stack : err);
  process.exitCode = 2;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill();
  if (tmpData) await fsp.rm(tmpData, { recursive: true, force: true }).catch(() => {});
}
