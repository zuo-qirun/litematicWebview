// 诊断：浏览器实际发出的 Accept-Encoding 与收到的 Content-Encoding
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");

const CHROME = process.env.CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    "--host-resolver-rules=MAP litematic.zuoqirun.top 192.168.1.60",
    "--disable-features=HttpsUpgrades,HttpsFirstModeV2,HttpsFirstBalancedModeAutoEnable",
    "--no-sandbox",
  ],
});
const page = await browser.newPage();
page.on("request", (req) => {
  const u = req.url();
  if (/app\.js|models\.json|blocks\.json|atlas|styles\.css/.test(u)) {
    console.log("REQ ", u.replace("http://litematic.zuoqirun.top", ""), "| accept-encoding:", req.headers()["accept-encoding"]);
  }
});
page.on("response", async (res) => {
  const u = res.url();
  if (/app\.js|models\.json|blocks\.json|atlas|styles\.css/.test(u)) {
    const h = res.headers();
    console.log("RES ", u.replace("http://litematic.zuoqirun.top", ""), "| enc:", h["content-encoding"], "| len:", h["content-length"], "| status:", res.status());
  }
});
await page.goto("http://litematic.zuoqirun.top/", { waitUntil: "networkidle2", timeout: 180000 });
await page.waitForFunction(() => window.__APP_READY__ === true, { timeout: 120000 });
await page.evaluate(() => window.__VIEWER__.loadSample("海草机打包收集-by小鱼.litematic"));
await page.waitForFunction(() => window.__VIEWER__.state().drawnInstances > 0, { timeout: 120000 });
await new Promise((r) => setTimeout(r, 800));
const timing = await page.evaluate(() =>
  performance.getEntriesByType("resource")
    .filter((e) => /app\.js|models\.json|blocks\.json|atlas|styles\.css/.test(e.name))
    .map((e) => ({ n: e.name.split("/").pop().slice(0, 40), transfer: e.transferSize, enc: e.encodedBodySize, dec: e.decodedBodySize }))
);
console.log("\nresource timing:");
for (const t of timing) console.log(`  ${t.n}  transfer=${t.transfer}  encoded=${t.enc}  decoded=${t.dec}`);
await browser.close();
