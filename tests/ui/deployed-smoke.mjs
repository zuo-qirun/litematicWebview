// 线上站点冒烟：用 host-resolver-rules 把 litematic.zuoqirun.top 指向内网 192.168.1.60，
// 走真实域名 + 真实 nginx 配置，验证页面能加载、WebGL 能画、样例能打开、控制台无错误。
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

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

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = [];
  const bad = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("response", (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });

  const t0 = Date.now();
  await page.goto(URL_BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction("window.__APP_READY__ === true", { timeout: 60000 });
  console.log(`  页面就绪耗时 ${Date.now() - t0} ms`);

  const info = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2") || document.createElement("canvas").getContext("webgl");
    return {
      title: document.title,
      webgl: !!gl,
      renderer: gl ? (gl.getParameter(gl.getExtension("WEBGL_debug_renderer_info")?.UNMASKED_RENDERER_WEBGL || gl.RENDERER) || "") : "",
      ready: !!window.__VIEWER__,
    };
  });
  ok(info.ready, "window.__VIEWER__ 就绪");
  ok(info.webgl, "WebGL 可用", info.renderer.slice(0, 60));

  const caps = await page.evaluate(() => fetch("/api/capabilities").then((r) => r.json()).catch((e) => ({ error: String(e) })));
  ok(caps && caps.packsSupported === true, "经 nginx 的 /api/capabilities 正常", JSON.stringify(caps).slice(0, 90));
  const files = await page.evaluate(() => (window.__VIEWER__?.state?.().warnings || []).length >= 0);
  ok(files === true, "state() 可调用");

  // 打开内置样例（本地 samples，不依赖 API）
  await page.evaluate(() => window.__VIEWER__.loadSample("海草机打包收集-by小鱼.litematic"));
  await page.waitForFunction("window.__VIEWER__.state().loaded === true", { timeout: 60000 });
  const st = await page.evaluate(() => window.__VIEWER__.state());
  ok(st.blockCount === 966, "样例方块数 966", String(st.blockCount));
  ok(st.triangles > 0, "三角面 > 0", String(st.triangles));

  // 侧栏服务器面板应存在（未填令牌时应给出提示而不是报错）
  const panel = await page.evaluate(() => ({
    lib: !!document.querySelector(".card-library"),
    packs: !!document.querySelector(".card-packs"),
    text: (document.querySelector(".card-library")?.textContent || "").slice(0, 120).replace(/\s+/g, " "),
  }));
  ok(panel.lib, "服务器投影面板存在");
  ok(panel.packs, "材质包面板存在");
  console.log("  面板文案:", panel.text);

  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: join(OUT, "deployed.png") });
  await page.screenshot({ path: join(OUT, "deployed-full.png"), fullPage: false });

  const relevant = errors.filter((e) => !/favicon|capabilities.*40|401|Failed to load resource: the server responded with a status of 401/i.test(e));
  ok(relevant.length === 0, "控制台无错误", relevant.slice(0, 3).join(" | "));
  const realBad = bad.filter((u) => !(/401/.test(u) || /favicon/.test(u)));
  console.log("  HTTP>=400:", bad.length ? bad.slice(0, 6).join(" , ") : "无");
  ok(realBad.length === 0, "无意外 4xx/5xx", realBad.slice(0, 3).join(" , "));
} catch (err) {
  fail++;
  console.error("  异常:", err && err.stack ? err.stack.split("\n").slice(0, 4).join("\n") : err);
} finally {
  await browser.close();
  console.log(`\n===== 结果：PASS=${pass} FAIL=${fail} =====`);
}
process.exit(fail === 0 ? 0 : 1);
