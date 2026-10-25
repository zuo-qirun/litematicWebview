// mcviewer —— 侧边栏面板离线截图 + 断言脚本
//
//   node tests/ui/panels-shot.mjs                 // 全部 7 个场景
//   node tests/ui/panels-shot.mjs --only=default  // 只跑一个
//
// 流程：esbuild 把 tests/ui/panels-entry.js 打包成 iife → file:// 打开 tests/ui/panels.html
//      → puppeteer-core 用本机 Chrome 截图（整页 1440×900 + 左栏裁切 + 卡片裁切）
//      → 断言布局/交互状态 + 收集 console/pageerror。
// 产物：tests/ui/_shots/panels-<scenario>.png、panels-<scenario>-rail.png、
//      panels-<scenario>-cards.png、panels-report.json

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const ENTRY = path.join(HERE, "panels-entry.js");
const BUNDLE_DIR = path.join(HERE, "_tmp");
const BUNDLE = path.join(BUNDLE_DIR, "panels.bundle.js");
const PAGE = path.join(HERE, "panels.html");
const SHOTS = path.join(HERE, "_shots");

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

const SCENARIOS = ["default", "upload45", "error", "empty", "offline", "auth", "hover", "xss"];

function resolveChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`找不到 Chrome，请设置 CHROME_PATH 环境变量。已尝试：\n${CHROME_CANDIDATES.join("\n")}`);
}

async function buildBundle() {
  mkdirSync(BUNDLE_DIR, { recursive: true });
  await esbuild.build({
    entryPoints: [ENTRY],
    outfile: BUNDLE,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["chrome110"],
    charset: "utf8",
    logLevel: "warning",
    sourcemap: false,
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runScenario(browser, name) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(String((err && err.stack) || err)));

  const url = `${pathToFileURL(PAGE).href}?scenario=${encodeURIComponent(name)}`;
  await page.goto(url, { waitUntil: "load", timeout: 20000 });
  await page.waitForFunction(() => window.__APP_READY__ === true, { timeout: 20000 });

  if (name === "upload45") {
    await page.waitForFunction(() => {
      const el = document.querySelector(".lib-progress-pct");
      return el && el.textContent === "45%";
    }, { timeout: 6000 });
  }
  if (name === "hover") {
    await page.hover(".lib-row");
  }
  await sleep(260); // 字体/过渡稳定

  const metrics = await page.evaluate(() => {
    const rail = document.querySelector(".rail-left");
    const lib = document.querySelector(".lib-card");
    const pack = document.querySelector(".pack-card");
    const firstName = document.querySelector(".lib-name");
    const acts = document.querySelector(".lib-row .lib-row-acts");
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const text = (sel) => {
      const el = document.querySelector(sel);
      return el ? el.textContent.trim() : "";
    };
    return {
      viewport: { w: innerWidth, h: innerHeight },
      bodyOverflowX: document.documentElement.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth,
      rail: rail
        ? {
            x: Math.round(rail.getBoundingClientRect().x),
            y: Math.round(rail.getBoundingClientRect().y),
            w: Math.round(rail.getBoundingClientRect().width),
            h: Math.round(rail.getBoundingClientRect().height),
            clientH: rail.clientHeight,
            scrollH: rail.scrollHeight,
            clientW: rail.clientWidth,
            scrollW: rail.scrollWidth,
            scrollable: rail.scrollHeight > rail.clientHeight + 1,
          }
        : null,
      libRect: rect(lib),
      packRect: rect(pack),
      firstName: firstName
        ? {
            text: firstName.textContent,
            ellipsis: getComputedStyle(firstName).textOverflow === "ellipsis",
            clipped: firstName.scrollWidth > firstName.clientWidth + 1,
            clientW: firstName.clientWidth,
          }
        : null,
      rowActsOpacity: acts ? Number(getComputedStyle(acts).opacity) : null,
      counts: {
        libRows: document.querySelectorAll(".lib-row").length,
        packRows: document.querySelectorAll(".pack-row").length,
        libAlerts: document.querySelectorAll(".lib-card .lib-alert").length,
        packAlerts: document.querySelectorAll(".pack-card .pack-alert").length,
        tokenInputs: document.querySelectorAll(".lib-token-input").length,
        libOffline: document.querySelectorAll(".lib-card .lib-offline").length,
        imgs: document.querySelectorAll(".lib-card img, .pack-card img").length,
        xssHit: Boolean(window.__XSS__),
      },
      texts: {
        libCount: text(".lib-card .pill-count"),
        packCount: text(".pack-card .pill-count"),
        libEmptyTitle: text(".lib-card .lib-empty-title"),
        packEmptyTitle: text(".pack-card .pack-empty-title"),
        progressPct: text(".lib-progress-pct"),
        bakingBadge: text(".pack-card .pack-badge.is-baking"),
        currentName: text(".pack-current-name"),
        libFoot: text(".lib-card .lib-foot"),
      },
      disabled: {
        libRefresh: Boolean(document.querySelector(".lib-card .lib-refresh")?.disabled),
        packRefresh: Boolean(document.querySelector(".pack-card .pack-refresh")?.disabled),
      },
      cards: [...document.querySelectorAll(".rail-left > .card")].map((el) => ({
        cls: el.className,
        h: Math.round(el.getBoundingClientRect().height),
      })),
    };
  });

  const safe = name;
  const fullShot = path.join(SHOTS, `panels-${safe}.png`);
  await page.screenshot({ path: fullShot });

  const railClip = { x: metrics.rail.x, y: metrics.rail.y, width: metrics.rail.w, height: metrics.rail.h };
  const railShot = path.join(SHOTS, `panels-${safe}-rail.png`);
  await page.screenshot({ path: railShot, clip: railClip });

  let cardsShot = null;
  if (metrics.libRect && metrics.packRect) {
    const top = Math.min(metrics.libRect.y, metrics.packRect.y);
    const bottom = Math.max(metrics.libRect.y + metrics.libRect.h, metrics.packRect.y + metrics.packRect.h);
    cardsShot = path.join(SHOTS, `panels-${safe}-cards.png`);
    await page.screenshot({
      path: cardsShot,
      clip: {
        x: metrics.rail.x,
        y: top,
        width: metrics.rail.w,
        height: Math.min(900 - top, bottom - top),
      },
    });
  }

  // ---- 交互验证（截图之后再做，避免影响基准图） ----
  const interaction = { notes: [], failures: [] };
  const interactFail = (msg) => interaction.failures.push(`${name}: ${msg}`);

  if (name === "default") {
    await page.hover(".lib-row");
    await page.evaluate(() => {
      const acts = document.querySelector(".lib-row .lib-row-acts");
      const del = acts && acts.querySelector(".lib-act.is-danger");
      if (del) del.click();
    });
    // 鼠标移开：确认条必须常驻（is-confirming）
    await page.mouse.move(900, 600);
    await sleep(120);
    const confirming = await page.evaluate(() => {
      const row = document.querySelector(".lib-row.is-confirming");
      const acts = row && row.querySelector(".lib-row-acts");
      const danger = row && row.querySelector(".lib-act.is-danger");
      return {
        has: Boolean(row),
        opacity: acts ? Number(getComputedStyle(acts).opacity) : 0,
        label: danger ? danger.textContent.trim() : "",
      };
    });
    if (!confirming.has) interactFail("确认删除时行缺少 is-confirming 状态类");
    else interaction.notes.push("确认态行带 is-confirming");
    if (confirming.opacity < 0.9) interactFail(`鼠标移开后确认按钮应仍然可见（opacity=${confirming.opacity}）`);
    if (confirming.label !== "确认删除") interactFail(`行内删除未出现「确认删除」二次确认（实际「${confirming.label}」）`);
    await page.screenshot({ path: path.join(SHOTS, `panels-${safe}-confirm.png`) });
    await page.evaluate(() => {
      const acts = document.querySelector(".lib-row.is-confirming .lib-row-acts");
      const cancel = acts && [...acts.querySelectorAll(".lib-act")].find((b) => b.textContent.trim() === "取消");
      if (cancel) cancel.click();
    });
    await sleep(100);
    const rowsAfterCancel = await page.evaluate(() => document.querySelectorAll(".lib-row").length);
    const confirmGone = await page.evaluate(() => document.querySelectorAll(".lib-row.is-confirming").length);
    if (rowsAfterCancel !== 3) interactFail(`取消删除后列表应恢复 3 行，实际 ${rowsAfterCancel}`);
    else if (confirmGone !== 0) interactFail(`取消删除后仍残留 ${confirmGone} 行确认态`);
    else interaction.notes.push("取消删除恢复正常");
    interaction.notes.push("删除二次确认正常");

    // 材质包：取消使用 → 内置默认，再对就绪包点「使用」
    const clearVisible = await page.evaluate(() => {
      const btn = document.querySelector(".pack-clear");
      return Boolean(btn && !btn.hidden);
    });
    if (!clearVisible) interactFail("当前材质条缺少「取消使用」");
    await page.click(".pack-clear");
    try {
      await page.waitForFunction(
        () => {
          const strip = document.querySelector(".pack-current");
          const name = document.querySelector(".pack-current-name");
          return Boolean(strip && strip.classList.contains("is-builtin") && name && name.textContent.trim() === "内置默认");
        },
        { timeout: 3000 }
      );
      interaction.notes.push("取消使用恢复内置默认");
    } catch (err) {
      interactFail("取消使用后当前材质未恢复为「内置默认」");
    }
    await page.evaluate(() => {
      const row = document.querySelector(".pack-row");
      const act = row && [...row.querySelectorAll(".pack-act")].find((b) => b.textContent.trim() === "使用");
      if (act) act.click();
    });
    try {
      await page.waitForFunction(
        () => {
          const strip = document.querySelector(".pack-current");
          const name = document.querySelector(".pack-current-name");
          return Boolean(strip && !strip.classList.contains("is-builtin") && name && name.textContent.includes("我的材质包"));
        },
        { timeout: 3000 }
      );
      interaction.notes.push("点「使用」后当前材质条同步更新");
    } catch (err) {
      interactFail("点「使用」后当前材质条没有更新");
    }
  }

  if (name === "auth") {
    await page.type(".lib-token-input", "demo-token-123", { delay: 0 });
    await page.evaluate(() => {
      const card = document.querySelector(".lib-card");
      const save = card && [...card.querySelectorAll("button")].find((b) => b.textContent.trim() === "保存");
      if (save) save.click();
    });
    try {
      await page.waitForFunction(
        () =>
          document.querySelectorAll(".lib-token-input").length === 0 &&
          document.querySelectorAll(".lib-row").length === 3 &&
          document.querySelectorAll(".pack-row").length === 2,
        { timeout: 6000 }
      );
      interaction.notes.push("保存令牌后两张卡片同时解锁并加载列表");
    } catch (err) {
      interactFail("保存令牌后两张卡片没有同时解锁/刷新");
    }
    await page.screenshot({ path: path.join(SHOTS, `panels-${safe}-unlocked.png`) });
  }

  if (name === "xss") {
    interaction.notes.push("恶意文件名按纯文本渲染");
  }

  const failures = [];
  const fail = (msg) => failures.push(`${name}: ${msg}`);

  if (metrics.bodyOverflowX) fail("页面出现横向滚动");
  if (!metrics.rail || !metrics.rail.scrollable) fail(`左栏没有纵向滚动（scrollH=${metrics.rail?.scrollH} clientH=${metrics.rail?.clientH}）`);
  if (!metrics.libRect || metrics.libRect.h < 110) fail(`服务器投影卡片被压扁（h=${metrics.libRect?.h}）`);
  if (!metrics.packRect || metrics.packRect.h < 90) fail(`材质包卡片被压扁（h=${metrics.packRect?.h}）`);
  if (metrics.rail && metrics.rail.scrollW > metrics.rail.clientW + 1) fail("左栏出现横向滚动");
  if (consoleErrors.length) fail(`console.error: ${consoleErrors.join(" | ")}`);
  if (pageErrors.length) fail(`pageerror: ${pageErrors.join(" | ")}`);

  const expect = (cond, msg) => {
    if (!cond) fail(msg);
  };
  switch (name) {
    case "default":
      expect(metrics.counts.libRows === 3, `投影行数应为 3，实际 ${metrics.counts.libRows}`);
      expect(metrics.counts.packRows === 2, `材质包行数应为 2，实际 ${metrics.counts.packRows}`);
      expect(metrics.texts.progressPct === "", "默认态不应显示上传进度");
      expect(metrics.texts.bakingBadge.includes("37%"), `烘焙中徽标应含 37%，实际「${metrics.texts.bakingBadge}」`);
      expect(metrics.texts.currentName.includes("我的材质包"), `当前材质包名不符：「${metrics.texts.currentName}」`);
      expect(metrics.firstName && metrics.firstName.ellipsis && metrics.firstName.clipped, "长文件名未显示省略号");
      expect(metrics.texts.libFoot.includes("已用"), `容量脚注缺失：「${metrics.texts.libFoot}」`);
      expect(metrics.rowActsOpacity < 0.05, `未悬停时行内操作不应可见（opacity=${metrics.rowActsOpacity}）`);
      break;
    case "upload45":
      expect(metrics.texts.progressPct === "45%", `上传进度应为 45%，实际 ${metrics.texts.progressPct}`);
      expect(metrics.counts.libRows === 3, "上传中列表不应消失");
      break;
    case "error":
      expect(metrics.counts.libAlerts >= 1 && metrics.counts.packAlerts >= 1, "错误态缺少卡片内错误条");
      break;
    case "empty":
      expect(metrics.texts.libEmptyTitle === "还没有服务器投影", `空态标题不符：「${metrics.texts.libEmptyTitle}」`);
      expect(metrics.texts.packEmptyTitle === "还没有材质包", `空态标题不符：「${metrics.texts.packEmptyTitle}」`);
      break;
    case "offline":
      expect(metrics.counts.libOffline >= 1, "未连接服务器时缺少灰态说明");
      expect(metrics.disabled.libRefresh && metrics.disabled.packRefresh, "离线时刷新按钮应禁用");
      break;
    case "auth":
      expect(metrics.counts.tokenInputs === 2, `令牌提示应在两张卡片各出现一次，实际 ${metrics.counts.tokenInputs}`);
      break;
    case "hover":
      expect(metrics.rowActsOpacity > 0.9, `悬停时行内操作应可见（opacity=${metrics.rowActsOpacity}）`);
      break;
    case "xss":
      expect(metrics.counts.imgs === 0, `文件名中的 HTML 被解析成了元素（img=${metrics.counts.imgs}）`);
      expect(metrics.counts.xssHit === false, "文件名里的 onerror 被执行（XSS）");
      expect(metrics.firstName && metrics.firstName.text.startsWith("<img"), "恶意文件名没有按纯文本显示");
      break;
    default:
      break;
  }

  failures.push(...interaction.failures);

  await page.close();
  return {
    scenario: name,
    url,
    shots: { full: fullShot, rail: railShot, cards: cardsShot },
    metrics,
    interaction,
    failures,
  };
}

async function main() {
  const onlyArg = process.argv.find((arg) => arg.startsWith("--only="));
  const only = onlyArg ? onlyArg.slice("--only=".length).split(",") : null;
  const scenarios = only ? SCENARIOS.filter((s) => only.includes(s)) : SCENARIOS;
  if (!scenarios.length) throw new Error(`没有匹配的场景：${onlyArg}`);

  mkdirSync(SHOTS, { recursive: true });
  await buildBundle();
  console.log(`[panels-shot] bundle → ${path.relative(ROOT, BUNDLE)}`);

  const executablePath = resolveChrome();
  console.log(`[panels-shot] chrome  → ${executablePath}`);

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      "--allow-file-access-from-files",
      "--force-color-profile=srgb",
      "--font-render-hinting=none",
      "--disable-lcd-text",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
    ],
    defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
  });

  const results = [];
  let failed = false;
  try {
    for (const scenario of scenarios) {
      process.stdout.write(`[panels-shot] ${scenario} … `);
      const result = await runScenario(browser, scenario);
      results.push(result);
      const rail = result.metrics.rail;
      console.log(
        `rail ${rail ? `${rail.w}x${rail.h} scrollH=${rail.scrollH}` : "?"}, ` +
          `lib=${result.metrics.libRect?.h}px pack=${result.metrics.packRect?.h}px, ` +
          `${result.failures.length ? `FAIL(${result.failures.length})` : "ok"}`
      );
      for (const failure of result.failures) console.log(`   ✗ ${failure}`);
      for (const note of (result.interaction && result.interaction.notes) || []) console.log(`   ✓ ${note}`);
      if (result.failures.length) failed = true;
    }
  } finally {
    await browser.close();
  }

  const report = {
    generatedAt: new Date().toISOString(),
    viewport: { width: 1440, height: 900 },
    browser: executablePath,
    results,
    ok: !failed,
  };
  const reportPath = path.join(SHOTS, "panels-report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`[panels-shot] report  → ${path.relative(ROOT, reportPath)}`);
  console.log(`[panels-shot] shots   → ${path.relative(ROOT, SHOTS)}\\panels-*.png`);
  if (failed) {
    console.error("[panels-shot] 存在断言失败");
    process.exitCode = 1;
  } else {
    console.log("[panels-shot] 全部场景通过");
  }
}

main().catch((err) => {
  console.error("[panels-shot] 运行失败：", err);
  process.exitCode = 1;
});
