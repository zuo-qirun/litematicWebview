// mcviewer —— UI 自检台（不经构建，直接跑 src/ 源码）
//
// 目的：在 src/app.js（Lead 负责）就绪前，用同一套 app-shell + ViewerScene + 内置 mock 场景
// 把整个界面跑起来，供 tests/ui/shot.mjs 截图与视觉审阅。
// 只做最小接线，不承载产品逻辑。

import { buildShell, hideBoot } from "/src/ui/app-shell.js";
import { ViewerScene } from "/src/render/scene.js";
import { BlockDB } from "/src/render/db.js";
import { buildMockSchematic, MOCK_FILE_NAME } from "/src/render/mock-schematic.js";
import { HoverPicker, describeBlock, indexBlockEntities, indexEntities } from "/src/render/picking.js";
import { Inspector } from "/src/ui/inspector.js";
import { Toaster } from "/src/ui/toast.js";
import { renderFileCard, renderRegions, renderLegend } from "/src/ui/panels.js";
import {
  setEmpty, setSliceHud, StatsBadge, setPressed, openHelp, closeHelp, isHelpOpen,
  startLoading, setError,
} from "/src/ui/overlays.js";

const errors = [];
window.addEventListener("error", (e) => errors.push(String((e.error && e.error.stack) || e.message)));
window.addEventListener("unhandledrejection", (e) => errors.push(String((e.reason && e.reason.stack) || e.reason)));

const refs = buildShell(document.querySelector("#app"));
const toaster = new Toaster(refs.toasts);
const scene = new ViewerScene(refs.canvas);
const insp = new Inspector(refs.inspectorBody, refs.inspectorFoot);
const badge = new StatsBadge(refs);
const params = new URLSearchParams(location.search);

let db = null;
let schematic = null;
let beIndex = new Map();
let entityIndex = new Map();
let loaded = false;
let parseMs = 0;
let pinned = false;

/* ------------------------------------------------------------------ 统计 */

function countsByState() {
  const counts = new Map();
  for (const region of schematic?.regions || []) {
    const palette = region.palette || [];
    const indices = region.indices || [];
    for (let i = 0; i < indices.length; i++) {
      const key = typeof palette[indices[i]] === "string" ? palette[indices[i]] : palette[indices[i]]?.stateKey;
      if (!key || key === "minecraft:air" || key === "air") continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return counts;
}

function legendEntries() {
  const entries = [...countsByState().entries()].map(([stateKey, count]) => {
    const id = stateKey.split("[")[0];
    return { stateKey, id, name: db ? db.displayName(id) : id, count, color: db ? db.color(stateKey) : null };
  });
  entries.sort((a, b) => b.count - a.count);
  return entries;
}

function totalVolume() {
  let n = 0;
  for (const r of schematic?.regions || []) n += r.volume || (r.size ? r.size.x * r.size.y * r.size.z : 0);
  return n;
}

function fileInfo() {
  const regions = schematic?.regions || [];
  return {
    fileName: MOCK_FILE_NAME,
    author: schematic?.author || "",
    description: schematic?.description || "",
    size: schematic?.size || null,
    blocks: totalVolume(),
    regions: regions.length,
    mcVersion: schematic?.mcVersion || "",
    dataVersion: schematic?.dataVersion || 0,
    warnings: schematic?.warnings || [],
    buildMs: scene.stats?.buildMs || 0,
    parseMs,
    missing: db?.missingCount || 0,
    missingSample: db && db.missingSample ? db.missingSample(4) : [],
    fallbackAssets: !!db?.isFallback,
  };
}

/* ------------------------------------------------------------------ 加载 */

async function init() {
  const loading = startLoading(refs, "正在加载方块资产…", MOCK_FILE_NAME);
  try {
    db = await BlockDB.load("/assets/");
  } catch (err) {
    db = BlockDB.fallback(String((err && err.message) || err));
    toaster.warn("资产包不可用，已降级为内置简化模型", String(err && err.message ? err.message : ""));
  }
  insp.setDb(db);
  loading.set(45, "构建实例化网格…");

  const t0 = performance.now();
  schematic = buildMockSchematic();
  parseMs = performance.now() - t0;
  beIndex = indexBlockEntities(schematic);
  entityIndex = indexEntities(schematic);

  await scene.build(schematic, db, { onProgress: (f, txt) => loading.set(45 + f * 50, txt) });
  loading.set(100, "就绪");
  loading.hide();

  renderFileCard(refs, fileInfo());
  renderRegions(
    refs,
    (schematic.regions || []).map((r, i) => ({
      name: r.name || `region-${i}`,
      size: r.size,
      volume: r.volume,
      stateCount: (r.palette || []).length,
      blockEntities: (r.blockEntities || []).length,
    })),
    {
      onToggle(name, checked) { scene.setRegionVisible(name, checked); },
      onFocus(name) { scene.focusRegion(name); },
      onHover(name) { scene.highlightRegion(name, !!name); },
    }
  );
  renderLegend(refs, legendEntries(), {
    db,
    onSelect(entry) {
      if (!entry) return;
      scene.highlightState(entry.stateKey);
      toaster.info("已高亮该方块", `${entry.name} · ${entry.count} 个`);
    },
  });

  setEmpty(refs, false);
  hideBoot();
  loaded = true;

  const tick = () => {
    badge.update({
      fps: scene.fps || 0,
      triangles: scene.info?.triangles || 0,
      blocks: scene.drawnInstances ? scene.drawnInstances() : 0,
      drawCalls: scene.info?.drawCalls || 0,
    });
  };
  scene.onFrame(tick);
  setInterval(tick, 600);

  window.__APP_READY__ = true;
}

/* ------------------------------------------------------------------ 拾取 */

const picker = new HoverPicker(scene, (hit) => {
  if (hit) {
    insp.show(describeBlock(hit, { db, beIndex, entityIndex }), { pinned });
  } else if (!pinned) {
    insp.showEmpty();
  }
});

/* ------------------------------------------------------------------ 交互 */

document.addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-act],[data-view]");
  if (!btn) return;
  const act = btn.dataset.act;
  const view = btn.dataset.view;
  const sliceMax = Math.max(0, Math.ceil(scene.bounds?.sy || 1) - 1);
  if (view) {
    scene.applyPreset(view);
    for (const b of refs.viewButtons || []) setPressed(b, b === btn);
  } else if (act === "slice") {
    const on = !scene.slice.enabled;
    const level = scene.setSlice(on, scene.slice.level);
    setPressed(btn, on);
    setSliceHud(refs, on, level, sliceMax);
  } else if (act === "grid") {
    scene.setGridVisible(!scene.gridOn);
    setPressed(btn, scene.gridOn);
  } else if (act === "wire") {
    scene.setWireframe(!scene.wireframe);
    setPressed(btn, scene.wireframe);
  } else if (act === "shot") {
    const a = document.createElement("a");
    a.href = scene.screenshot();
    a.download = "mcviewer.png";
    a.click();
    toaster.success("截图已导出");
  } else if (act === "full") {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  } else if (act === "help") {
    openHelp(refs, "自检台：1/2/3/4 切换视角，[ ] 逐层切片，G 网格，X 线框，Esc 关闭弹层。");
  } else if (act === "close-help") {
    closeHelp(refs);
  } else if (act === "open") {
    refs.fileInput?.click();
  }
});

refs.resetViewBtn?.addEventListener("click", () => scene.frameAll());

refs.legendSearch?.addEventListener("input", () => {
  renderLegend(refs, legendEntries(), { db, filter: refs.legendSearch.value });
});

document.addEventListener("keydown", (ev) => {
  if (ev.target && /input|textarea/i.test(ev.target.tagName)) return;
  const k = ev.key;
  const max = Math.ceil((scene.bounds?.sy || 1)) - 1;
  if (k === "1") scene.applyPreset("iso");
  else if (k === "2") scene.applyPreset("top");
  else if (k === "3") scene.applyPreset("front");
  else if (k === "4") scene.applyPreset("side");
  else if (k === "[") setSliceHud(refs, scene.slice.enabled, scene.stepSlice(-1), max);
  else if (k === "]") setSliceHud(refs, scene.slice.enabled, scene.stepSlice(1), max);
  else if (k === "g" || k === "G") { scene.setGridVisible(!scene.gridOn); setPressed(refs.actButtons?.find((b) => b.dataset.act === "grid"), scene.gridOn); }
  else if (k === "x" || k === "X") { scene.setWireframe(!scene.wireframe); setPressed(refs.actButtons?.find((b) => b.dataset.act === "wire"), scene.wireframe); }
  else if (k === "f" || k === "F") document.documentElement.requestFullscreen?.();
  else if (k === "Escape") {
    if (isHelpOpen(refs)) closeHelp(refs);
    else setSliceHud(refs, false, 0, 0);
  }
});

/* ------------------------------------------------------------------ 测试钩子（等价于契约 §6，正式版由 app.js 实现） */

window.__VIEWER__ = {
  version: "0.1.0-harness",
  ready: true,
  async openFile() { throw new Error("自检台不支持打开文件，请用正式 dist 页面"); },
  async loadSample() { throw new Error("自检台不支持示例文件"); },
  state() {
    const regions = schematic?.regions || [];
    return {
      loaded,
      fileName: MOCK_FILE_NAME,
      size: schematic?.size || null,
      min: scene.bounds ? { x: scene.bounds.minX, y: scene.bounds.minY, z: scene.bounds.minZ } : null,
      max: scene.bounds ? { x: scene.bounds.maxX, y: scene.bounds.maxY, z: scene.bounds.maxZ } : null,
      blockCount: totalVolume(),
      drawnInstances: scene.drawnInstances ? scene.drawnInstances() : 0,
      regionCount: regions.length,
      paletteCount: regions.reduce((n, r) => n + (r.palette || []).length, 0),
      blockEntityCount: regions.reduce((n, r) => n + (r.blockEntities || []).length, 0),
      entityCount: regions.reduce((n, r) => n + (r.entities || []).length, 0),
      drawCalls: scene.info?.drawCalls || 0,
      triangles: scene.info?.triangles || 0,
      warnings: schematic?.warnings || [],
      errors,
    };
  },
  getBlocks(filter = {}) {
    const limit = Math.max(1, Math.min(filter.limit || filter.max || 20, 2000));
    const want = filter.state || filter.id ? String(filter.state || filter.id) : null;
    const out = [];
    for (const region of schematic?.regions || []) {
      const idx = region.indices || [];
      const palette = region.palette || [];
      const size = region.size || { x: 0, y: 0, z: 0 };
      for (let i = 0; i < idx.length && out.length < limit; i++) {
        const state = palette[idx[i]];
        const stateKey = typeof state === "string" ? state : state?.stateKey;
        if (!stateKey) continue;
        if (want && !stateKey.includes(want)) continue;
        const x = i % size.x;
        const y = Math.floor(i / (size.x * size.z));
        const z = Math.floor(i / size.x) % size.z;
        out.push({ x, y, z, state: stateKey, region: region.name });
      }
    }
    return out;
  },
  setSlice(y) {
    const on = y !== null && y !== undefined;
    const level = scene.setSlice(on, on ? y : scene.slice.level);
    setSliceHud(refs, on, level, Math.ceil((scene.bounds?.sy || 1)) - 1);
    return { enabled: on, level };
  },
  setRegionVisible(name, visible) { return scene.setRegionVisible(name, visible); },
  resetCamera() { scene.frameAll(); },
  screenshot() { return scene.screenshot(); },
};

init().catch((err) => {
  errors.push(String((err && err.stack) || err));
  setError(refs, "自检台初始化失败", String((err && err.message) || err));
  hideBoot();
  console.error(err);
});

if (params.get("scenario") === "empty") {
  window.addEventListener("load", () => setEmpty(refs, true));
}

// 自检台辅助钩子：用于截取空状态 / 强制检查器内容
window.__harnessEmpty = () => setEmpty(refs, true);
window.__harnessState = () => ({ loaded, errors });
