import puppeteer from "puppeteer-core";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [
    "--no-sandbox",
    "--enable-unsafe-swiftshader",
    "--ignore-certificate-errors",
    "--disable-features=HttpsUpgrades,HttpsFirstModeV2,HttpsFirstBalancedModeAutoEnable",
    "--host-resolver-rules=MAP litematic.zuoqirun.top 192.168.1.60",
  ],
});
const page = await browser.newPage();
page.on("console", (m) => console.log("[console]", m.type(), m.text().slice(0, 200)));
page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 300)));
page.on("requestfailed", (r) => console.log("[reqfail]", r.url().slice(0, 120), r.failure()?.errorText));
page.on("response", (r) => { if (r.status() >= 400 || /api|app\.js|index/.test(r.url())) console.log("[resp]", r.status(), r.url().slice(0, 110)); });
const resp = await page.goto("http://litematic.zuoqirun.top/", { waitUntil: "domcontentloaded", timeout: 45000 });
console.log("doc status:", resp && resp.status(), "url:", page.url());
await new Promise((r) => setTimeout(r, 8000));
const info = await page.evaluate(() => ({
  ready: window.__APP_READY__,
  hasViewer: !!window.__VIEWER__,
  title: document.title,
  appJs: document.querySelectorAll('script[src*="app.js"]').length,
  bodyLen: document.body.innerText.length,
  bootVisible: !!document.querySelector("#boot"),
  text: document.body.innerText.slice(0, 200),
}));
console.log("info:", JSON.stringify(info));
await page.screenshot({ path: "D:/Github/tempproject/temp/_deploy/_shots/debug.png" });
await browser.close();
