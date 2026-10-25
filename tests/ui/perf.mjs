// 线上站点性能采集：走真实 Chrome，分三段量
//   A. 首屏（空态）：HTML/JS/CSS/manifest/meta
//   B. 打开一个投影：+ models/blocks/lang/atlas + 建几何
//   C. 二次访问：缓存命中后还要下多少字节
// 用法：node tests/ui/perf.mjs [--host 192.168.1.60] [--domain litematic.zuoqirun.top] [--sample 名称]
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");

const args = process.argv.slice(2);
const arg = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const HOST = arg("--host", "192.168.1.60");
const DOMAIN = arg("--domain", "litematic.zuoqirun.top");
const SAMPLE = arg("--sample", "海草机打包收集-by小鱼.litematic");
const CHROME = process.env.CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const fmt = (b) => (b >= 1048576 ? (b / 1048576).toFixed(2) + " MB" : (b / 1024).toFixed(1) + " KB");

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    "--host-resolver-rules=MAP " + DOMAIN + " " + HOST,
    "--disable-features=HttpsUpgrades,HttpsFirstModeV2,HttpsFirstBalancedModeAutoEnable",
    "--enable-unsafe-swiftshader",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--window-size=1440,900",
  ],
});

const readResources = (page) =>
  page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] || {};
    const res = performance.getEntriesByType("resource").map((e) => ({
      name: e.name.replace(location.origin, ""),
      transfer: e.transferSize,
      encoded: e.encodedBodySize,
      decoded: e.decodedBodySize,
      ms: Math.round(e.duration),
    }));
    return {
      domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0),
      loadEvent: Math.round(nav.loadEventEnd || 0),
      resources: res.filter((r) => r.transfer > 0 || r.decoded > 0),
    };
  });

const table = (list, total) => {
  const rows = list
    .slice()
    .sort((a, b) => (b.transfer || 0) - (a.transfer || 0))
    .map((r) => `${fmt(r.transfer || r.encoded).padStart(9)}  ${String(r.ms).padStart(6)}ms  ${r.name}`);
  console.log(rows.join("\n"));
  console.log(`  合计 ${fmt(total)} / ${list.length} 个请求`);
};

// ---------------- A. 首屏 ----------------
const page = await browser.newPage();
await page.setCacheEnabled(false);
const tA = Date.now();
await page.goto(`http://${DOMAIN}/`, { waitUntil: "networkidle2", timeout: 180000 });
await page.waitForFunction(() => window.__APP_READY__ === true, { timeout: 180000 });
const readyA = Date.now() - tA;
await new Promise((r) => setTimeout(r, 1200));
const a = await readResources(page);
const totalA = a.resources.reduce((s, r) => s + (r.transfer || 0), 0);
console.log("── A. 首屏（空态，无缓存）──");
console.log(`  就绪 ${readyA} ms · DOMContentLoaded ${a.domContentLoaded} ms · load ${a.loadEvent} ms`);
table(a.resources, totalA);

// ---------------- B. 打开一个投影 ----------------
const seenA = new Set(a.resources.map((r) => r.name));
const tB = Date.now();
await page.evaluate((name) => window.__VIEWER__.loadSample(name), SAMPLE);
await page.waitForFunction(() => window.__VIEWER__.state().loaded === true, { timeout: 180000 });
// 等几何建完
await page.waitForFunction(() => window.__VIEWER__.state().drawnInstances > 0, { timeout: 180000 });
const readyB = Date.now() - tB;
await new Promise((r) => setTimeout(r, 600));
const b = await readResources(page);
const freshB = b.resources.filter((r) => !seenA.has(r.name));
const totalB = freshB.reduce((s, r) => s + (r.transfer || 0), 0);
const st = await page.evaluate(() => {
  const s = window.__VIEWER__.state();
  return { blocks: s.blockCount, drawCalls: s.drawCalls, triangles: s.triangles, regions: s.regionCount };
});
console.log("\n── B. 打开投影（新增下载 + 建几何）──");
console.log(`  用时 ${readyB} ms · 方块 ${st.blocks} · 绘制 ${st.drawCalls} · 三角面 ${st.triangles} · region ${st.regions}`);
table(freshB, totalB);

// ---------------- C. 二次访问（缓存）----------------
const page2 = await browser.newPage();
await page2.setCacheEnabled(true);
await page2.goto(`http://${DOMAIN}/`, { waitUntil: "networkidle2", timeout: 180000 });
await page2.waitForFunction(() => window.__APP_READY__ === true, { timeout: 180000 });
const tC = Date.now();
await page2.evaluate((name) => window.__VIEWER__.loadSample(name), SAMPLE);
await page2.waitForFunction(() => window.__VIEWER__.state().drawnInstances > 0, { timeout: 180000 });
const readyC = Date.now() - tC;
const c = await readResources(page2);
const totalC = c.resources.reduce((s, r) => s + (r.transfer || 0), 0);
console.log("\n── C. 二次访问（走浏览器缓存）──");
console.log(`  打开投影用时 ${readyC} ms`);
table(c.resources, totalC);

console.log("\n── 汇总 ──");
console.log(`  首屏 ${fmt(totalA)} → 打开投影再下 ${fmt(totalB)}；二次访问总计 ${fmt(totalC)}`);
await browser.close();
