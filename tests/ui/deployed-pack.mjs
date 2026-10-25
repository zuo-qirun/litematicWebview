// 线上站点：材质包启用链路（真实 nginx + Node API + 服务器烘焙产物）
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const URL_BASE = process.env.SITE_URL || "http://litematic.zuoqirun.top/";
const OUT = "D:/Github/tempproject/temp/_deploy/_shots";
mkdirSync(OUT, { recursive: true });
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [
    "--no-sandbox",
    "--enable-unsafe-swiftshader",
    "--use-gl=angle",
    "--ignore-certificate-errors",
    "--disable-features=HttpsUpgrades,HttpsFirstModeV2,HttpsFirstBalancedModeAutoEnable",
    "--host-resolver-rules=MAP litematic.zuoqirun.top 192.168.1.60",
    "--window-size=1440,900",
  ],
});

let pass = 0, fail = 0;
const ok = (cond, label, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${extra ? "  [" + extra + "]" : ""}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

  await page.goto(URL_BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction("window.__APP_READY__ === true", { timeout: 60000 });

  // 打开一个投影
  await page.evaluate(() => window.__VIEWER__.loadSample("海草机打包收集-by小鱼.litematic"));
  await page.waitForFunction("window.__VIEWER__.state().loaded === true", { timeout: 120000 });
  const before = await page.evaluate(() => window.__VIEWER__.state());
  ok(before.blockCount > 0, "投影已加载", `blocks=${before.blockCount}`);

  // 材质包面板
  const rows = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".card-packs .pack-row")).map((el) => el.textContent.replace(/\s+/g, " ").trim()));
  console.log("  包列表:", JSON.stringify(rows).slice(0, 240));
  ok(rows.length >= 1, "材质包列表非空");
  ok(rows.some((t) => /\d+ 覆盖/.test(t)), "面板显示覆盖数量（数字）", rows[0] || "");

  // 点「使用」
  const clicked = await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll(".card-packs .pack-row"))
      .find((el) => !el.classList.contains("is-active"));
    if (!row) return false;
    const btn = Array.from(row.querySelectorAll("button")).find((b) => /使用/.test(b.textContent));
    if (!btn) return false;
    btn.click();
    return true;
  });
  ok(clicked, "点击「使用」");
  await page.waitForFunction(() => !!document.querySelector(".card-packs .pack-row.is-active"), { timeout: 180000 });
  const packId = await page.evaluate(() => localStorage.getItem("mcviewer.packId"));
  ok(!!packId, "localStorage 记住材质包", String(packId));

  // 等场景重建完成
  await page.waitForFunction(() => {
    const s = window.__VIEWER__.state();
    return s.loaded && s.drawnInstances > 0;
  }, { timeout: 180000 });
  await sleep(1200);
  const after = await page.evaluate(() => window.__VIEWER__.state());
  ok(after.blockCount === before.blockCount, "切换材质包后方块数不变",
    `${before.blockCount} → ${after.blockCount}`);
  ok(after.drawnInstances > 0, "场景用新材质重建", `instances=${after.drawnInstances}`);
  await page.screenshot({ path: `${OUT}/deployed-pack.png` });

  // 取消使用
  const cleared = await page.evaluate(() => {
    const btn = document.querySelector(".card-packs .pack-clear");
    if (!btn) return false;
    btn.click();
    return true;
  });
  ok(cleared, "点击「取消使用」");
  await page.waitForFunction(() => !localStorage.getItem("mcviewer.packId"), { timeout: 120000 });
  ok(true, "取消后清除本地记录");
  await sleep(800);
  await page.screenshot({ path: `${OUT}/deployed-pack-off.png` });

  const realErrors = errors.filter((e) => !/favicon/.test(e));
  ok(realErrors.length === 0, "控制台无错误", realErrors.slice(0, 2).join(" | "));
} finally {
  await browser.close();
}
console.log(`\n===== 结果：PASS=${pass} FAIL=${fail} =====`);
if (fail > 0) process.exitCode = 1;
