// 线上 UI 复核：令牌提示应隐藏、面板可交互、首屏加载耗时
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");
import { join } from "node:path";

const CHROME = process.env.CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const OUT = join(process.cwd(), "tests/ui/_shots");
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    "--host-resolver-rules=MAP litematic.zuoqirun.top 192.168.1.60",
    "--disable-features=HttpsUpgrades,HttpsFirstModeV2,HttpsFirstBalancedModeAutoEnable",
    "--enable-unsafe-swiftshader",
    "--no-sandbox",
    "--window-size=1440,900",
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const t0 = Date.now();
await page.goto("http://litematic.zuoqirun.top/", { waitUntil: "networkidle2", timeout: 180000 });
await page.waitForFunction(() => window.__APP_READY__ === true, { timeout: 120000 });
const ready = Date.now() - t0;
await new Promise((r) => setTimeout(r, 900));

const info = await page.evaluate(() => {
  const vis = (el) => !!el && !el.hidden && el.offsetParent !== null;
  const card = document.querySelector(".card-library");
  const tokenInput =
    card && card.querySelector('input[type="password"], input[name*="token" i], .lib-token');
  return {
    auth: window.__VIEWER__ && window.__VIEWER__.state().errors,
    hasLibrary: !!card,
    items: card ? card.querySelectorAll(".lib-list .lib-act").length : 0,
    tokenVisible: vis(tokenInput),
    capabilitiesText: (document.querySelector(".card-packs") || {}).textContent?.slice(0, 60) || "",
  };
});
await page.screenshot({ path: join(OUT, "deployed-optimized.png") });

await page.evaluate(() => window.__VIEWER__.loadSample("海草机打包收集-by小鱼.litematic"));
await page.waitForFunction(() => window.__VIEWER__.state().drawnInstances > 0, { timeout: 120000 });
await new Promise((r) => setTimeout(r, 900));
await page.screenshot({ path: join(OUT, "deployed-optimized-loaded.png") });

console.log(`就绪 ${ready} ms`);
console.log("令牌输入可见:", info.tokenVisible, "| 投影条目:", info.items, "| 面板:", info.hasLibrary);
console.log("材质包卡:", info.capabilitiesText.replace(/\s+/g, " ").trim());
await browser.close();
