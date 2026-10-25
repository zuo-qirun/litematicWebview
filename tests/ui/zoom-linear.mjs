// 线性缩放自检：连续滚轮每格的相机距离变化量必须相等（而不是按比例指数变化）。
// 用法：node tests/ui/zoom-linear.mjs [--headful]
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)), "..");
const PORT = 5196;
const SHOTS = join(ROOT, "tests", "ui", "_shots");
mkdirSync(SHOTS, { recursive: true });

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
];
const headful = process.argv.includes("--headful");

let pass = 0;
let fail = 0;
function ok(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}${detail ? "  " + detail : ""}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? "  " + detail : ""}`);
  }
}

async function waitBoot(base, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(base);
      if (r.ok) return true;
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

const server = spawn(process.execPath, [join(ROOT, "server.mjs"), "--port", String(PORT), "--no-open", "--no-api"], {
  cwd: ROOT,
  stdio: "ignore",
});

const browser = await puppeteer.launch({
  executablePath: CHROME.find((p) => existsSync(p)) || undefined,
  headless: !headful,
  args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--window-size=1440,900"],
});

try {
  const base = `http://127.0.0.1:${PORT}`;
  await waitBoot(base + "/index.html");
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(base + "/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction("window.__APP_READY__ === true", { timeout: 30000 });

  const sample = "海草机打包收集-by小鱼.litematic";
  await page.evaluate((s) => window.__VIEWER__.loadSample(s), sample);
  await page.waitForFunction("window.__VIEWER__.state().loaded === true", { timeout: 30000 });
  await page.evaluate(() => window.__VIEWER__.resetCamera());
  await new Promise((r) => setTimeout(r, 400));

  const readDist = () =>
    page.evaluate(() => {
      const s = window.__VIEWER__.scene();
      return {
        dist: s.camera.position.distanceTo(s.controls.target),
        step: s._zoomStepSize(),
        min: s.controls.minDistance,
        max: s.controls.maxDistance,
      };
    });

  const start = await readDist();
  console.log(`  起点距离 ${start.dist.toFixed(3)}，每格 ${start.step.toFixed(3)}（min ${start.min.toFixed(2)} / max ${start.max.toFixed(2)}）`);

  await page.mouse.move(720, 460);
  const deltas = [];
  let prev = start.dist;
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel({ deltaY: 100 }); // 下滚 = 拉远
    await new Promise((r) => setTimeout(r, 260));
    const d = (await readDist()).dist;
    deltas.push(d - prev);
    prev = d;
  }
  console.log("  每格距离增量：" + deltas.map((v) => v.toFixed(3)).join(", "));
  const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  ok("五格滚轮的距离增量基本相等（线性）", deltas.every((v) => Math.abs(v - avg) < Math.max(0.02, Math.abs(avg) * 0.05)), `avg ${avg.toFixed(3)}`);
  ok("下滚 = 拉远（增量同号且为正）", deltas.every((v) => v > 0), deltas.map((v) => v.toFixed(2)).join(","));
  ok("单格增量约等于 _zoomStepSize()", Math.abs(Math.abs(avg) - start.step) < Math.max(0.02, start.step * 0.15), `step ${start.step.toFixed(3)}`);

  // 拉近 8 格后再看：增量仍应是同一个常数（指数缩放会变小）
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel({ deltaY: -100 });
    await new Promise((r) => setTimeout(r, 200));
  }
  await new Promise((r) => setTimeout(r, 250));
  const nearStart = await readDist();
  let nearPrev = nearStart.dist;
  const nearDeltas = [];
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel({ deltaY: -100 });
    await new Promise((r) => setTimeout(r, 260));
    const d = (await readDist()).dist;
    nearDeltas.push(d - nearPrev);
    nearPrev = d;
  }
  console.log(`  近处（${nearStart.dist.toFixed(2)}）增量：` + nearDeltas.map((v) => v.toFixed(3)).join(", "));
  ok("近处缩放的绝对值与远处一致（不随距离衰减）", nearDeltas.every((v) => Math.abs(Math.abs(v) - Math.abs(avg)) < Math.max(0.03, Math.abs(avg) * 0.2)));

  ok("相机不会越过 minDistance", nearPrev >= nearStart.min - 1e-6, `${nearPrev.toFixed(2)} >= ${nearStart.min.toFixed(2)}`);
  await page.screenshot({ path: join(SHOTS, "zoom-linear.png") });
} catch (err) {
  fail++;
  console.error("  异常：" + (err && err.stack ? err.stack : err));
} finally {
  await browser.close().catch(() => {});
  server.kill();
}

console.log(`\n===== 结果：PASS=${pass} FAIL=${fail} =====`);
process.exit(fail ? 1 : 0);
