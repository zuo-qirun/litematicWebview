// 服务器功能冒烟测试：投影库上传→侧栏加载→材质包面板可见性。
// 用法：node tests/ui/server-smoke.mjs [--port 5191] [--data tests/_data_ui] [--headful]
import { spawn } from "node:child_process";
import { promises as fsp } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const PORT = Number(arg("--port", "5191"));
const DATA = resolve(ROOT, arg("--data", "tests/_data_ui"));
const SHOTS = join(HERE, "_shots");
const FIXTURE = join(ROOT, "tests", "fixtures", "海草机打包收集-by小鱼.litematic");
const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

const failures = [];
const ok = (name, cond, detail) => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${name}${cond || !detail ? "" : "  → " + detail}`);
  if (!cond) failures.push(name);
};

async function chromePath() {
  for (const p of CHROME_CANDIDATES) {
    try {
      await fsp.access(p);
      return p;
    } catch {
      /* next */
    }
  }
  throw new Error("找不到 Chrome/Edge");
}

let server = null;
let browser = null;

try {
  await fsp.mkdir(SHOTS, { recursive: true });
  await fsp.rm(DATA, { recursive: true, force: true });

  // 1) 起服务端（dist + API）
  server = spawn(process.execPath, ["server.mjs", "--port", String(PORT), "--no-open", "--data", DATA], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let bootLog = "";
  server.stdout.on("data", (d) => (bootLog += d));
  server.stderr.on("data", (d) => (bootLog += d));
  const deadline = Date.now() + 20000;
  let up = false;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/capabilities`);
      if (r.ok) {
        up = true;
        break;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  ok("服务端启动", up, bootLog.slice(0, 300));

  // 2) 通过 API 上传一个投影（模拟另一台设备/浏览器负责上传）
  const bytes = await fsp.readFile(FIXTURE);
  const upRes = await fetch(`http://127.0.0.1:${PORT}/api/projects`, {
    method: "POST",
    headers: { "x-file-name": encodeURIComponent("海草机打包收集-by小鱼.litematic") },
    body: bytes,
  });
  ok("API 上传投影", upRes.status === 201, `HTTP ${upRes.status}`);
  const upJson = await upRes.json();

  // 3) 打开页面
  browser = await puppeteer.launch({
    executablePath: await chromePath(),
    headless: !args.includes("--headful"),
    args: [
      "--enable-unsafe-swiftshader",
      "--disable-dev-shm-usage",
      "--window-size=1440,900",
      "--no-sandbox",
      "--disable-gpu-sandbox",
      "--hide-scrollbars",
    ],
    defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction("window.__APP_READY__ === true", { timeout: 30000 });
  ok("页面加载完成", true);

  // 4) 左栏出现「服务器投影」卡片且列表里有条目
  await page.waitForSelector(".lib-list .lib-act", { timeout: 15000 }).catch(() => null);
  const libInfo = await page.evaluate(() => {
    const card = document.querySelector(".card-library");
    const list = document.querySelector(".lib-list");
    return {
      cardExists: !!card,
      itemCount: list ? list.querySelectorAll(".lib-act").length : 0,
      title: card ? (card.textContent || "").replace(/\s+/g, " ").slice(0, 60) : "",
    };
  });
  ok("左栏挂载了服务器投影卡片", libInfo.cardExists);
  ok("服务器投影列表有 1 条", libInfo.itemCount >= 1, `实际 ${libInfo.itemCount}`);
  console.log(`    卡片文本: ${libInfo.title}`);

  // 5) 点击「加载到视图」，应下载并渲染
  await page.evaluate(() => {
    const list = document.querySelector(".lib-list");
    const btn = list && list.querySelector(".lib-act");
    if (btn) btn.click();
  });
  const loaded = await page
    .waitForFunction(
      () => {
        const st = window.__VIEWER__ && window.__VIEWER__.state ? window.__VIEWER__.state() : null;
        return !!(st && st.loaded && st.blockCount > 0);
      },
      { timeout: 45000, polling: 200 },
    )
    .then(() => true)
    .catch(() => false);
  const st = await page.evaluate(() => window.__VIEWER__.state());
  ok("从侧栏加载投影成功", loaded, JSON.stringify({ loaded: st.loaded, blocks: st.blockCount, err: st.errors?.slice(0, 2) }));
  ok("方块数与预期一致(966)", st.blockCount === 966, `实际 ${st.blockCount}`);
  ok("文件名来自服务器记录", /海草机打包收集/.test(st.fileName || ""), st.fileName);

  await new Promise((r) => setTimeout(r, 900));
  await page.screenshot({ path: join(SHOTS, "server-loaded.png") });

  // 6) 材质包卡片存在（本机缺少 pack.py 时应显示不可用说明）
  const packInfo = await page.evaluate(() => {
    const card = document.querySelector(".card-packs");
    return { exists: !!card, text: card ? (card.textContent || "").replace(/\s+/g, " ").slice(0, 120) : "", disabled: card ? card.classList.contains("is-off") : null };
  });
  ok("左栏挂载了材质包卡片", packInfo.exists);
  console.log(`    材质包卡片: ${packInfo.text}`);

  // 7) 拖拽/上传控件存在（文件 input）
  const hasInput = await page.evaluate(() => !!document.querySelector(".card-library input[type=file]"));
  ok("投影卡片带文件选择控件", hasInput);

  // 8) 刷新页面后能自动恢复上次投影列表 + 不报错
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction("window.__APP_READY__ === true", { timeout: 30000 });
  await page.waitForSelector(".lib-list .lib-act", { timeout: 15000 }).catch(() => null);
  const afterReload = await page.evaluate(() => {
    const list = document.querySelector(".lib-list");
    return { items: list ? list.querySelectorAll(".lib-act").length : 0 };
  });
  ok("刷新后列表仍能拉到", afterReload.items >= 1, `实际 ${afterReload.items}`);

  await page.screenshot({ path: join(SHOTS, "server-panels.png") });
  ok("控制台无 error", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

  console.log(`\n截图: ${join(SHOTS, "server-panels.png")}`);
  console.log(`上传记录 id: ${upJson?.item?.id}`);
} catch (err) {
  failures.push(String(err?.message || err));
  console.error(err);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) {
    server.kill();
    await new Promise((r) => setTimeout(r, 400));
  }
}

console.log("");
if (failures.length) {
  console.log(`✗ 服务器 UI 冒烟失败 ${failures.length} 项：${failures.join(" / ")}`);
  process.exit(1);
}
console.log("✓ 服务器 UI 冒烟通过");
