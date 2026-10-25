// mcviewer —— 应用装配层
//
// 职责：把「解析器（src/core）」+「静态资产（assets/）+ BlockDB」+「three.js 场景（src/render/scene）」
// 和「界面（src/ui）」粘起来，并对外暴露契约 §6 的 window.__VIEWER__ 测试钩子。
//
// 数据流：
//   ArrayBuffer ──loadSchematic──▶ Schematic ──scene.build──▶ InstancedMesh（按完整方块状态分组）
//   assets/*.json ──BlockDB.load──▶ 状态 → 模型 → 图集 uv

import { loadSchematic } from "./core/index.js";
import { BlockDB } from "./render/db.js";
import { ViewerScene } from "./render/scene.js";
import { HoverPicker, describeBlock } from "./render/picking.js";
import { buildMockSchematic, MOCK_FILE_NAME } from "./render/mock-schematic.js";
import { buildShell, hideBoot } from "./ui/app-shell.js";
import {
  clearFileCard,
  renderFileCard,
  clearRegions,
  renderRegions,
  clearLegend,
  renderLegend,
} from "./ui/panels.js";
import { Inspector } from "./ui/inspector.js";
import {
  setEmpty,
  setError,
  clearError,
  startLoading,
  setSliceHud,
  StatsBadge,
  openHelp,
  closeHelp,
  isHelpOpen,
  setDragOverlay,
  setPressed,
} from "./ui/overlays.js";
import { Toaster } from "./ui/toast.js";
import { fmtInt } from "./ui/dom.js";
import { createLibrary } from "./ui/library.js";
import { createPackPanel } from "./ui/packs.js";
import { api as apiClient } from "./ui/api-client.js";

/* ---------------------------------------------------------------- 常量与工具 */

const SAMPLES = [
  "25w简易海草机by-half_kite.litematic",
  "xianyu-MIS_configured_v2.1.litematic",
  "沼泽刷怪塔_黑山大叔_1.21.1.litematic",
  "海草机打包收集-by小鱼.litematic",
  "豪华版mis正式版v1.7.litematic",
];

const params = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
const AIR_IDS = new Set(["minecraft:air", "minecraft:cave_air", "minecraft:void_air"]);
const PACK_STORAGE_KEY = "mcviewer.packId";

/** 内置资产的根路径（?assets= 可覆盖） */
const defaultAssetsBase = () => params.get("assets") || "./assets/";

const toArr = (v) => (!v ? [0, 0, 0] : Array.isArray(v) ? [v[0], v[1], v[2]] : [v.x | 0, v.y | 0, v.z | 0]);
const baseName = (p) => String(p || "").split(/[\\/]/).pop();
const extName = (p) => String(p || "").replace(/\.(litematic|zip)$/i, "");

/* ---------------------------------------------------------------- 运行期状态 */

const state = {
  db: null,
  schematic: null,
  beIndex: null,
  entityIndex: null,
  pickCtx: null,
  legend: [],
  regions: [],
  fileName: "",
  parseMs: 0,
  buildMs: 0,
  loaded: false,
  errors: [],
  pinned: false,
  selectedHit: null,
  lastHit: null,
  scene: null,
  refs: null,
  inspector: null,
  toaster: null,
  badge: null,
  library: null,
  packs: null,
  activePackId: null,
};

let resolveReady;
let rejectReady;
const readyPromise = new Promise((res, rej) => {
  resolveReady = res;
  rejectReady = rej;
});

/* ---------------------------------------------------------------- 契约 §6 钩子 */

const api = {
  version: "1",
  ready: readyPromise,

  /** @param {Uint8Array|ArrayBuffer} bytes @param {string} name */
  async openFile(bytes, name) {
    const ab =
      bytes instanceof Uint8Array
        ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
        : bytes instanceof ArrayBuffer
          ? bytes
          : null;
    if (!ab) throw new Error("openFile 需要 Uint8Array 或 ArrayBuffer");
    await openBytes(ab, name || "未命名.litematic");
    return api.state();
  },

  async loadSample(name) {
    const file = name || SAMPLES[0];
    const res = await fetch(`./samples/${encodeURIComponent(file)}`, { cache: "no-cache" });
    if (!res.ok) throw new Error(`示例加载失败：HTTP ${res.status} ${file}`);
    const ab = await res.arrayBuffer();
    await openBytes(ab, file);
    return api.state();
  },

  state() {
    const sc = state.scene;
    const sch = state.schematic;
    const st = sch?.stats || {};
    const b = sc?.bounds || { sx: 0, sy: 0, sz: 0 };
    let tickCount = 0;
    let regionVol = 0;
    for (const rg of sch?.regions || []) {
      tickCount += (rg.ticks || []).length;
      const a = rg.absSize || {};
      const v = Math.abs(a.x | 0) * Math.abs(a.y | 0) * Math.abs(a.z | 0);
      regionVol += v || 0;
    }
    const paletteSize = state.paletteSize || 0;
    return {
      loaded: !!state.loaded,
      fileName: state.fileName,
      size: toArr(sch?.size || { x: b.sx, y: b.sy, z: b.sz }),
      min: toArr(sch?.min || { x: 0, y: 0, z: 0 }),
      max: toArr(sch?.max || { x: 0, y: 0, z: 0 }),
      blockCount: st.blockCount || 0,
      drawnInstances: sc ? sc.drawnInstances() : 0,
      regionCount: (sch?.regions || []).length,
      paletteCount: paletteSize,
      paletteSize, // 别名：e2e/oracle 用 paletteSize 命名
      blockEntityCount: st.blockEntityCount || 0,
      entityCount: st.entityCount || 0,
      entityLabels: sc?.entityCount || 0,
      entityLabelsVisible: sc ? sc.entitiesOn !== false : true,
      sliceEnabled: !!(sc && sc.slice && sc.slice.enabled),
      tickCount,
      volume: st.volume || regionVol,
      drawCalls: sc?.info?.drawCalls || 0,
      triangles: sc?.info?.triangles || 0,
      states: sc?.stats?.states || 0,
      fps: sc?.fps || 0,
      warnings: (sch?.warnings || []).slice(0, 40),
      errors: state.errors.slice(),
    };
  },

  getBlocks(filter) {
    const q = String(filter || "").trim().toLowerCase();
    const list = q
      ? state.legend.filter(
          (e) =>
            (e.name && e.name.toLowerCase().includes(q)) ||
            e.id.toLowerCase().includes(q) ||
            e.stateKey.toLowerCase().includes(q)
        )
      : state.legend;
    return list.slice(0, 2000).map((e) => ({
      stateKey: e.stateKey,
      id: e.id,
      name: e.name,
      count: e.count,
      first: e.first || null,
    }));
  },

  setSlice(y) {
    const sc = state.scene;
    if (!sc || !state.loaded) return null;
    if (y === null || y === undefined) {
      sc.setSlice(false);
      setSliceHud(state.refs, false);
      return { enabled: false, level: sc.slice.level, max: sliceMax() };
    }
    const lvl = sc.setSlice(true, y);
    setSliceHud(state.refs, true, lvl, sliceMax());
    return { enabled: true, level: lvl, max: sliceMax() };
  },

  setRegionVisible(name, visible) {
    const sc = state.scene;
    if (!sc) return false;
    sc.setRegionVisible(name, !!visible);
    const row = state.regions.find((r) => r.name === name);
    if (row) {
      row.visible = !!visible;
      row.hidden = !visible;
    }
    renderRegions(state.refs, state.regions, regionHandlers());
    return true;
  },

  resetCamera() {
    const sc = state.scene;
    if (!sc) return;
    sc.applyPreset("iso");
    sc.frameAll();
    setViewButton("iso");
  },

  screenshot() {
    return state.scene ? state.scene.screenshot() : null;
  },

  /** 附加（非契约必需）：调试用 */
  scene: () => state.scene,
  db: () => state.db,
};

/* ---------------------------------------------------------------- 启动 */

async function boot() {
  const root = document.getElementById("app");
  const refs = buildShell(root);
  state.refs = refs;

  const toaster = new Toaster(refs.toasts);
  const badge = new StatsBadge(refs);
  const inspector = new Inspector(refs.inspectorBody, refs.inspectorFoot);
  const scene = new ViewerScene(refs.canvas);
  const picker = new HoverPicker(scene, onHover);
  state.toaster = toaster;
  state.badge = badge;
  state.inspector = inspector;
  state.scene = scene;

  inspector.showEmpty("把鼠标移到方块上查看详情");
  clearFileCard(refs);
  clearRegions(refs);
  clearLegend(refs);
  setEmpty(refs, true);

  bindUi(refs, scene, picker, inspector, toaster);

  // 服务器功能（投影库 / 材质包）异步挂载，纯静态部署时自动降级
  void mountServerPanels(refs, scene, toaster);

  // 资产：优先外置 assets/，失败退内置程序化兜底（渲染仍然可用）
  const assetsBase = defaultAssetsBase();
  try {
    state.db = await BlockDB.loadStaged(assetsBase);
  } catch (err) {
    console.warn("[mcviewer] 资产加载失败，改用内置兜底贴图：", err);
    state.db = BlockDB.fallback(String(err?.message || err));
    toaster.warn("资产目录不可用，已使用内置兜底贴图", String(err?.message || err));
  }
  scene.db = state.db;
  inspector.setDb(state.db);

  // 统计徽章：每帧回调里刷新（StatsBadge 内部已限流到 ~4Hz）
  scene.onFrame(() => {
    if (!state.loaded) return;
    badge.update({
      fps: scene.fps,
      triangles: scene.info.triangles,
      blocks: state.schematic?.stats?.blockCount || 0,
      drawCalls: scene.info.drawCalls,
    });
  });

  const ro = new ResizeObserver(() => scene.resize());
  ro.observe(refs.stage);

  // 自动打开：?mock=1 / ?sample=<文件名>
  const autoSample = params.get("sample");
  if (params.get("mock") === "1") {
    try {
      await openMock();
    } catch (err) {
      pushError(err);
      showFatal(err);
    }
  } else if (autoSample) {
    try {
      await api.loadSample(autoSample);
    } catch (err) {
      pushError(err);
      toaster.error("示例打开失败", String(err?.message || err));
    }
  }

  hideBoot();
  window.__APP_READY__ = true;
  resolveReady(api);
}

/* ---------------------------------------------------------------- 服务器功能（投影库 / 材质包） */

/** 在左栏插入一个空卡片并返回它 */
function makeCard(className) {
  const sec = document.createElement("section");
  sec.className = className;
  return sec;
}

/**
 * 挂载「服务器投影」与「材质包」两张卡片。
 * 纯静态部署（没有 /api）时自动置灰，不影响本地打开文件。
 */
async function mountServerPanels(refs, scene, toaster) {
  const left = refs.leftRail;
  if (!left) return;

  const libSection = makeCard("card card-library");
  left.insertBefore(libSection, left.firstChild);
  const packSection = makeCard("card card-packs");
  left.appendChild(packSection);

  state.library = createLibrary(libSection, {
    onOpen: openServerProject,
    onError: (err) => {
      toaster.error("服务器投影操作失败", String(err?.message || err));
    },
  });
  state.packs = createPackPanel(packSection, {
    onApply: applyPack,
    onClear: clearPack,
    onError: (err) => {
      toaster.error("材质包操作失败", String(err?.message || err));
    },
  });

  let caps = null;
  try {
    caps = await apiClient.capabilities(true);
  } catch {
    caps = null; // 没有 /api（静态部署 / 只读模式）
  }
  const apiOn = Boolean(caps && caps.projects);
  state.library.setEnabled(apiOn);
  // 材质包面板自己读 capabilities.packsSupported，只有「服务器接口不可用」时才整体置灰
  state.packs.setEnabled(apiOn);

  if (!apiOn) return;

  // 恢复上次启用的材质包（只认仍存在且已就绪的）
  const savedPack = safeStorageGet(PACK_STORAGE_KEY);
  if (savedPack && caps.packs) {
    try {
      const pack = await apiClient.getPack(savedPack);
      if (pack && pack.status === "ready" && pack.assetsUrl) {
        await loadAssets(pack.assetsUrl);
        state.activePackId = pack.id;
        state.packs.setActive(pack.id);
      } else {
        safeStorageRemove(PACK_STORAGE_KEY);
      }
    } catch {
      safeStorageRemove(PACK_STORAGE_KEY);
    }
  }

  state.library.refresh({ silent: true }).catch(() => {});
  state.packs.refresh({ silent: true }).catch(() => {});
}

function safeStorageGet(key) {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}
function safeStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 隐私模式可能禁用 localStorage */
  }
}
function safeStorageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** 加载一套资产（内置或材质包烘焙产物），失败时保留旧资产并抛错 */
async function loadAssets(baseUrl) {
  const db = await BlockDB.loadStaged(baseUrl);
  await db.ensureLoaded();
  state.db = db;
  if (state.scene) state.scene.db = db;
  if (state.inspector) state.inspector.setDb(db);
  return db;
}

/**
 * 首屏只加载 manifest/meta；真正要画方块时再拉 blocks/models/lang/atlas。
 * 这一层保证并发调用只触发一次重资产下载。
 */
let assetLoadingPromise = null;
function ensureAssets(onProgress) {
  const db = state.db;
  if (!db || db.isFallback || db.isReady) return Promise.resolve(db);
  if (assetLoadingPromise) return assetLoadingPromise;
  assetLoadingPromise = db
    .ensureLoaded((frac, msg) => {
      try {
        onProgress && onProgress(Math.max(0, Math.min(1, Number(frac) || 0)), msg);
      } catch {
        /* 进度回调不影响加载 */
      }
    })
    .finally(() => {
      assetLoadingPromise = null;
    });
  return assetLoadingPromise;
}

/** 换资产后重建几何：保留视角，重建图例与拾取上下文 */
async function rebuildWithAssets(silent = true) {
  const scene = state.scene;
  const refs = state.refs;
  if (!state.loaded || !state.schematic || !scene) return;

  const camPos = scene.camera?.position?.clone?.();
  const camTarget = scene.controls?.target?.clone?.();
  const loading = silent ? null : startLoading(refs, "正在应用外观", "重新生成方块几何…");
  try {
    const stats = await scene.build(state.schematic, state.db, {
      onProgress: (frac, phase) => loading?.set(8 + Math.min(1, Number(frac) || 0) * 90, phase || "生成几何…"),
    });
    state.buildMs = stats?.buildMs ?? state.buildMs;
  } finally {
    loading?.hide();
  }

  if (camPos && camTarget) {
    scene.camera.position.copy(camPos);
    scene.controls.target.copy(camTarget);
    scene.controls.update?.();
  }

  state.pickCtx = { db: state.db, beIndex: state.beIndex, entityIndex: state.entityIndex };
  state.legend = buildLegend(state.schematic, state.db);
  if (refs?.legendList) {
    renderLegend(refs, state.legend, { db: state.db, onSelect: onLegendClick, filter: refs.legendSearch?.value || "" });
  }
}

/** 材质包面板：启用某个已就绪的包 */
async function applyPack(pack) {
  if (!pack || pack.status !== "ready" || !pack.assetsUrl) {
    throw new Error("材质包尚未就绪，请等待烘焙完成");
  }
  await loadAssets(pack.assetsUrl);
  await rebuildWithAssets(true);
  state.activePackId = pack.id;
  state.packs?.setActive(pack.id);
  safeStorageSet(PACK_STORAGE_KEY, pack.id);
  state.toaster?.success("已启用材质包", pack.name || pack.id);
}

/** 材质包面板：恢复内置材质 */
async function clearPack() {
  await loadAssets(defaultAssetsBase());
  await rebuildWithAssets(true);
  state.activePackId = null;
  state.packs?.setActive(null);
  safeStorageRemove(PACK_STORAGE_KEY);
  state.toaster?.info("已恢复内置材质");
}

/** 点击左栏的服务器投影：下载并打开 */
async function openServerProject(project) {
  if (!project?.url) throw new Error("投影地址无效");
  const token = apiClient.getToken?.() || "";
  const res = await fetch(project.url, {
    credentials: "same-origin",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (res.status === 401) throw new Error("需要访问令牌：请在「服务器投影」卡片里填入令牌");
  if (!res.ok) throw new Error(`下载投影失败（HTTP ${res.status}）`);
  const ab = await res.arrayBuffer();
  const name = project.name || baseName(project.url);
  await openBytes(ab, name);
  state.toaster?.success("已从服务器加载", name);
  return state.schematic;
}

/* ---------------------------------------------------------------- 错误 */

function pushError(err) {
  const msg = err && err.stack ? String(err.stack).split("\n").slice(0, 3).join(" | ") : String(err);
  state.errors.push(msg);
  console.error("[mcviewer]", err);
}

function showFatal(err) {
  const refs = state.refs;
  if (!refs) return;
  setEmpty(refs, false);
  setError(refs, "无法打开投影", String(err?.message || err));
}

/* ---------------------------------------------------------------- 索引与统计 */

function paletteKeyOf(entry) {
  if (entry == null) return "minecraft:air";
  if (typeof entry === "string") return entry;
  if (entry.stateKey) return entry.stateKey;
  const id = entry.id || entry.Name || "minecraft:air";
  const props = entry.props || entry.Properties || null;
  if (!props) return id;
  const keys = Object.keys(props).sort();
  return keys.length ? `${id}[${keys.map((k) => `${k}=${props[k]}`).join(",")}]` : id;
}

/** 方块实体 / 实体索引：键统一为「最小角基准的世界坐标」（与 scene.pickAt 的 hit 一致） */
function buildPickingIndexes(schematic) {
  const beIndex = new Map();
  const entityIndex = new Map();
  for (const rg of schematic.regions || []) {
    if (!rg) continue;
    const name = rg.name || "region";
    const min = rg.min || rg.position || { x: 0, y: 0, z: 0 };
    const org = rg.position || min;

    const beMap = new Map();
    for (const be of rg.blockEntities || []) {
      if (!be) continue;
      beMap.set(`${min.x + (be.x | 0)},${min.y + (be.y | 0)},${min.z + (be.z | 0)}`, be);
    }
    beIndex.set(name, beMap);

    const em = new Map();
    for (const e of rg.entities || []) {
      const p = e && (e.pos || e.Pos);
      if (!p) continue;
      const k = `${Math.floor(org.x + p[0])},${Math.floor(org.y + p[1])},${Math.floor(org.z + p[2])}`;
      if (!em.has(k)) em.set(k, []);
      em.get(k).push(e);
    }
    entityIndex.set(name, em);
  }
  return { beIndex, entityIndex };
}

/** 图例/统计口径：用到的不同方块状态数（排除 minecraft:air，含被标记为 invisible 的状态） */
function computePaletteSize(schematic) {
  const used = new Set();
  for (const rg of schematic.regions || []) {
    if (!rg || !rg.indices) continue;
    const palette = rg.palette || [];
    const keys = palette.map(paletteKeyOf);
    for (let i = 0; i < rg.indices.length; i++) {
      const k = keys[rg.indices[i]];
      if (k && k !== "minecraft:air") used.add(k);
    }
  }
  return used.size;
}

/** 方块图例：按完整状态字符串聚合（数量 + 首次出现坐标） */
function buildLegend(schematic, db) {
  const agg = new Map();
  for (const rg of schematic.regions || []) {
    if (!rg || !rg.indices) continue;
    const palette = rg.palette || [];
    const indices = rg.indices;
    const min = rg.min || rg.position || { x: 0, y: 0, z: 0 };
    const abs = rg.absSize || { x: 1, y: 1, z: 1 };
    const sx = Math.max(1, abs.x | 0);
    const sz = Math.max(1, abs.z | 0);
    const sxz = sx * sz;
    const keys = palette.map(paletteKeyOf);
    for (let i = 0; i < indices.length; i++) {
      const pi = indices[i];
      if (pi >= keys.length) continue;
      const sk = keys[pi];
      const id = sk.split("[")[0];
      if (AIR_IDS.has(id)) continue;
      if (db.isInvisible(sk)) continue;
      let e = agg.get(sk);
      if (!e) {
        const x = i % sx;
        const z = ((i / sx) | 0) % sz;
        const y = (i / sxz) | 0;
        e = { stateKey: sk, id, count: 0, first: { x: min.x + x, y: min.y + y, z: min.z + z } };
        agg.set(sk, e);
      }
      e.count++;
    }
  }
  const out = [...agg.values()];
  for (const e of out) e.name = state.db.displayName(e.id) || e.id;
  out.sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  return out;
}

const sliceMax = () => {
  const sc = state.scene;
  if (!sc) return 0;
  return Math.max(0, Math.ceil(sc.bounds.sy) - 1);
};

/* ---------------------------------------------------------------- 打开文件 */

async function openBytes(ab, fileName) {
  const refs = state.refs;
  const scene = state.scene;
  const t0 = performance.now();
  clearError(refs);
  setEmpty(refs, false);
  inspectorReset();

  const loading = startLoading(refs, "正在解析投影", baseName(fileName));
  const timer = setInterval(() => loading.creep(84, "解析 NBT 与方块状态…"), 90);

  try {
    const schematic = await loadSchematic(ab, fileName);
    state.parseMs = performance.now() - t0;
    await ensureAssets((frac, msg) => loading.set(12 + frac * 72, msg || "加载方块资源…"));
    loading.set(86, "建立索引与图例…");

    // 索引 / 图例（在拿到 schematic 后、建几何前完成，界面数据先就绪）
    const { beIndex, entityIndex } = buildPickingIndexes(schematic);
    state.schematic = schematic;
    state.beIndex = beIndex;
    state.entityIndex = entityIndex;
    state.pickCtx = { db: state.db, beIndex, entityIndex };
    state.legend = buildLegend(schematic, state.db);
    state.paletteSize = computePaletteSize(schematic);
    state.regions = (schematic.regions || []).map((rg, i) => {
      const abs = rg.absSize || { x: 0, y: 0, z: 0 };
      return {
        name: rg.name || `region-${i}`,
        size: { x: Math.abs(abs.x | 0), y: Math.abs(abs.y | 0), z: Math.abs(abs.z | 0) },
        volume: Math.abs(abs.x | 0) * Math.abs(abs.y | 0) * Math.abs(abs.z | 0),
        visible: true,
        hidden: false,
      };
    });

    const t1 = performance.now();
    loading.set(88, "生成实例化几何…");
    const stats = await scene.build(schematic, state.db, {
      onProgress: (frac, phase) => loading.set(88 + Math.max(0, Math.min(1, frac)) * 11, phase || "生成几何…"),
    });
    state.buildMs = stats.buildMs ?? Math.round(performance.now() - t1);

    // 界面填充
    state.fileName = fileName || schematic.fileName || "未命名.litematic";
    renderFileCard(refs, {
      fileName: state.fileName,
      author: schematic.metadata?.author || "",
      description: schematic.metadata?.description || "",
      size: schematic.size || { x: 0, y: 0, z: 0 },
      blocks: schematic.stats?.blockCount || 0,
      regions: (schematic.regions || []).length,
      mcVersion: schematic.mcVersion || "",
      dataVersion: schematic.dataVersion ?? null,
      warnings: schematic.warnings || [],
      buildMs: state.buildMs,
      parseMs: state.parseMs,
      missing: state.db.missingCount,
      missingSample: state.db.missingSample ? state.db.missingSample(6) : [],
      fallbackAssets: !!state.db.isFallback,
    });
    renderRegions(refs, state.regions, regionHandlers());
    renderLegend(refs, state.legend, { db: state.db, onSelect: onLegendClick, filter: "" });
    refs.legendSearch.value = "";

    state.loaded = true;
    scene.applyPreset("iso");
    scene.frameAll();
    setViewButton("iso");
    setSliceHud(refs, false);

    loading.set(100, "完成");
    const warnN = (schematic.warnings || []).length;
    if (warnN) state.toaster.warn(`已打开 ${baseName(state.fileName)}`, `${warnN} 条解析警告（左栏可展开）`);
    else state.toaster.success(`已打开 ${baseName(state.fileName)}`, `${fmtInt(schematic.stats?.blockCount || 0)} 方块`);
  } catch (err) {
    pushError(err);
    state.loaded = false;
    showFatal(err);
    state.toaster.error("打开失败", String(err?.message || err));
    throw err;
  } finally {
    clearInterval(timer);
    loading.hide();
  }
  return state.schematic;
}

async function openMock() {
  const schematic = buildMockSchematic();
  await openBytesMock(schematic, MOCK_FILE_NAME);
}

/** mock 直接走内存 schematic，跳过解压/解析 */
async function openBytesMock(schematic, fileName) {
  const refs = state.refs;
  const scene = state.scene;
  clearError(refs);
  setEmpty(refs, false);
  inspectorReset();
  const loading = startLoading(refs, "正在载入示例", fileName);
  try {
    await ensureAssets((frac, msg) => loading.set(20 + frac * 60, msg || "加载方块资源…"));
    const { beIndex, entityIndex } = buildPickingIndexes(schematic);
    state.schematic = schematic;
    state.beIndex = beIndex;
    state.entityIndex = entityIndex;
    state.pickCtx = { db: state.db, beIndex, entityIndex };
    state.legend = buildLegend(schematic, state.db);
    state.paletteSize = computePaletteSize(schematic);
    state.regions = (schematic.regions || []).map((rg, i) => {
      const abs = rg.absSize || { x: 0, y: 0, z: 0 };
      return {
        name: rg.name || `region-${i}`,
        size: { x: Math.abs(abs.x | 0), y: Math.abs(abs.y | 0), z: Math.abs(abs.z | 0) },
        volume: Math.abs(abs.x | 0) * Math.abs(abs.y | 0) * Math.abs(abs.z | 0),
        visible: true,
        hidden: false,
      };
    });
    loading.set(40, "生成实例化几何…");
    const stats = await scene.build(schematic, state.db, {
      onProgress: (frac, phase) => loading.set(40 + Math.max(0, Math.min(1, frac)) * 58, phase || "生成几何…"),
    });
    state.parseMs = 0;
    state.buildMs = stats.buildMs || 0;
    state.fileName = fileName || MOCK_FILE_NAME;
    renderFileCard(refs, {
      fileName: state.fileName,
      author: schematic.author || "",
      description: schematic.description || "",
      size: schematic.size || { x: 0, y: 0, z: 0 },
      blocks: schematic.stats?.blockCount || 0,
      regions: (schematic.regions || []).length,
      mcVersion: schematic.mcVersion || "",
      dataVersion: schematic.dataVersion ?? null,
      warnings: schematic.warnings || [],
      buildMs: state.buildMs,
      parseMs: 0,
      missing: state.db.missingCount,
      missingSample: state.db.missingSample ? state.db.missingSample(6) : [],
      fallbackAssets: !!state.db.isFallback,
    });
    renderRegions(refs, state.regions, regionHandlers());
    renderLegend(refs, state.legend, { db: state.db, onSelect: onLegendClick, filter: "" });
    refs.legendSearch.value = "";
    state.loaded = true;
    scene.applyPreset("iso");
    scene.frameAll();
    setViewButton("iso");
    setSliceHud(refs, false);
    loading.set(100, "完成");
  } catch (err) {
    pushError(err);
    showFatal(err);
    throw err;
  } finally {
    loading.hide();
  }
}

async function openSampleFile(name) {
  const file = name || SAMPLES[Math.floor(Math.random() * SAMPLES.length)];
  try {
    await api.loadSample(file);
  } catch (err) {
    pushError(err);
    if (params.get("mock") === "1" || state.db?.isFallback) {
      // 没有 samples/ 时退回内置示例，保证「打开示例」始终可用
      await openMock().catch(() => {});
    } else {
      state.toaster.error("示例打开失败", String(err?.message || err));
    }
  }
}

function openLocalFile(file) {
  if (!file) return;
  if (!/\.(litematic|litematica)$/i.test(file.name)) {
    state.toaster.warn("文件类型不对", "请选择 .litematic 投影文件");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    openBytes(reader.result, file.name).catch(() => {});
  };
  reader.onerror = () => state.toaster.error("读取文件失败", String(reader.error || ""));
  reader.readAsArrayBuffer(file);
}

/* ---------------------------------------------------------------- 交互 */

function inspectorReset() {
  state.selectedHit = null;
  state.lastHit = null;
  state.pinned = false;
  if (state.scene) {
    state.scene.setHover(null, null, null, false);
    state.scene.setSelected(null, null, null, false);
    state.scene.highlightState(null);
  }
  if (state.inspector) state.inspector.showEmpty("把鼠标移到方块上查看详情");
  if (state.refs?.inspectorPinBtn) setPressed(state.refs.inspectorPinBtn, false);
}

function onHover(hit) {
  const scene = state.scene;
  if (!scene) return;
  if (!hit) {
    scene.setHover(null, null, null, false);
    if (!state.pinned && state.selectedHit) {
      // 鼠标离开画面时回到「已选中」的方块，避免检查器闪烁
      scene.setHover(state.selectedHit.x, state.selectedHit.y, state.selectedHit.z, false);
    }
    if (!state.pinned && state.inspector) {
      const info = state.selectedHit
        ? describeBlock(state.selectedHit, state.pickCtx)
        : null;
      if (info) state.inspector.show(info, { pinned: false });
      else state.inspector.showEmpty("把鼠标移到方块上查看详情");
    }
    state.lastHit = null;
    return;
  }
  state.lastHit = hit;
  scene.setHover(hit.x, hit.y, hit.z, true, hit.stateKey);
  if (!state.pinned && state.inspector && state.pickCtx) {
    const info = describeBlock(hit, state.pickCtx);
    if (info) state.inspector.show(info, { pinned: false });
  }
}

function selectHit(hit) {
  const scene = state.scene;
  if (!scene) return;
  if (!hit) {
    state.selectedHit = null;
    scene.setSelected(null, null, null, false);
    if (!state.pinned) {
      state.inspector.showEmpty("把鼠标移到方块上查看详情");
      setPressed(state.refs.inspectorPinBtn, false);
    }
    return;
  }
  state.selectedHit = hit;
  scene.setSelected(hit.x, hit.y, hit.z, true, hit.stateKey);
  if (state.inspector && state.pickCtx) {
    const info = describeBlock(hit, state.pickCtx);
    if (info) state.inspector.show(info, { pinned: state.pinned });
  }
}

function regionHandlers() {
  return {
    onToggle(name, checked) {
      state.scene?.setRegionVisible(name, checked);
      const row = state.regions.find((r) => r.name === name);
      if (row) {
        row.visible = checked;
        row.hidden = !checked;
      }
    },
    onFocus(name) {
      state.scene?.focusRegion(name);
    },
    onHover(name) {
      if (!state.scene) return;
      if (name) state.scene.highlightRegion(name, true);
      else for (const r of state.regions) state.scene.highlightRegion(r.name, false);
    },
  };
}

function onLegendClick(entry) {
  const scene = state.scene;
  if (!scene || !entry) return;
  const n = scene.highlightState(entry.stateKey);
  if (entry.first) {
    scene.focusBlock(entry.first.x, entry.first.y, entry.first.z);
    scene.setSelected(entry.first.x, entry.first.y, entry.first.z, true, entry.stateKey);
  }
  if (state.toaster) {
    if (n > 0) state.toaster.info(`${entry.name}`, `${fmtInt(n)} 个实例已高亮`);
    else state.toaster.warn(`${entry.name}`, "当前不可见（可能被 Region 显隐或切片隐藏）");
  }
}

function setViewButton(name) {
  const refs = state.refs;
  if (!refs) return;
  for (const b of refs.viewButtons) {
    const on = b.dataset.view === name;
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  }
}

function downloadDataUrl(dataUrl, name) {
  if (!dataUrl) return;
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function bindUi(refs, scene, picker, inspector, toaster) {
  /* 顶部动作按钮 + 浮层按钮（data-act） */
  for (const btn of refs.actButtons) {
    btn.addEventListener("click", () => {
      const act = btn.dataset.act;
      switch (act) {
        case "open":
          refs.fileInput.click();
          break;
        case "sample":
          openSampleFile();
          break;
        case "shot": {
          const url = scene.screenshot();
          if (!url) {
            toaster.warn("还没有可截图的内容");
            break;
          }
          downloadDataUrl(url, `${extName(state.fileName) || "mcviewer"}.png`);
          toaster.success("已导出 PNG", "保存到浏览器下载目录");
          break;
        }
        case "full":
          if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
          else (refs.root.requestFullscreen ? refs.root.requestFullscreen() : Promise.reject()).catch(() => {
            toaster.warn("全屏不可用", "当前环境不允许进入全屏");
          });
          break;
        case "help":
          openHelp(refs, `mcviewer · three.js r${scene.version || "?"} · blocks/assets ${state.db ? "已加载" : "未加载"}`);
          break;
        case "close-help":
          closeHelp(refs);
          break;
        case "slice": {
          if (!state.loaded) break;
          const on = !scene.slice.enabled;
          const lvl = scene.setSlice(on, scene.slice.level || Math.floor(sliceMax() / 2));
          setSliceHud(refs, on, lvl, sliceMax());
          setPressed(btn, on);
          break;
        }
        case "slice-off":
          if (!state.loaded) break;
          scene.setSlice(false);
          setSliceHud(refs, false);
          for (const b of refs.actButtons) if (b.dataset.act === "slice") setPressed(b, false);
          break;
        case "grid": {
          const on = !scene.gridOn;
          scene.setGridVisible(on);
          setPressed(btn, on);
          break;
        }
        case "wire": {
          const on = !scene.wireframe;
          scene.setWireframe(on);
          setPressed(btn, on);
          break;
        }
        case "entities": {
          const on = scene.entitiesOn === false;
          scene.setEntitiesVisible(on);
          setPressed(btn, on);
          toaster.info(on ? "显示实体标记" : "隐藏实体标记");
          break;
        }
        case "open-inspector":
          refs.rightRail.hidden = false;
          refs.root.classList.remove("inspector-off");
          break;
        case "close-inspector":
          refs.rightRail.hidden = true;
          refs.root.classList.add("inspector-off");
          break;
        default:
          break;
      }
    });
  }

  /* 视角预设 */
  for (const btn of refs.viewButtons) {
    btn.addEventListener("click", () => {
      if (!state.loaded) return;
      const name = btn.dataset.view || "iso";
      scene.applyPreset(name);
      setViewButton(name);
    });
  }

  refs.resetViewBtn?.addEventListener("click", () => {
    scene.applyPreset("iso");
    scene.frameAll();
    setViewButton("iso");
  });

  /* 文件选择 / 拖放 */
  refs.fileInput.addEventListener("change", () => {
    const f = refs.fileInput.files && refs.fileInput.files[0];
    refs.fileInput.value = "";
    if (f) openLocalFile(f);
  });

  let dragDepth = 0;
  const onDragEnter = (ev) => {
    if (!ev.dataTransfer || ![...ev.dataTransfer.types].includes("Files")) return;
    ev.preventDefault();
    dragDepth++;
    setDragOverlay(refs, true);
  };
  const onDragOver = (ev) => {
    if (!ev.dataTransfer || ![...ev.dataTransfer.types].includes("Files")) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "copy";
  };
  const onDragLeave = (ev) => {
    ev.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) setDragOverlay(refs, false);
  };
  const onDrop = (ev) => {
    ev.preventDefault();
    dragDepth = 0;
    setDragOverlay(refs, false);
    const f = ev.dataTransfer?.files?.[0];
    if (f) openLocalFile(f);
  };
  for (const el of [refs.root, window]) {
    el.addEventListener("dragenter", onDragEnter);
    el.addEventListener("dragover", onDragOver);
    el.addEventListener("dragleave", onDragLeave);
    el.addEventListener("drop", onDrop);
  }

  /* 切片滑杆 */
  refs.sliceRange.addEventListener("input", () => {
    if (!state.loaded) return;
    const lvl = scene.setSlice(true, Number(refs.sliceRange.value) || 0);
    setSliceHud(refs, true, lvl, sliceMax());
    for (const b of refs.actButtons) if (b.dataset.act === "slice") setPressed(b, true);
  });

  /* 图例搜索 */
  let legendRaf = 0;
  refs.legendSearch.addEventListener("input", () => {
    if (legendRaf) cancelAnimationFrame(legendRaf);
    legendRaf = requestAnimationFrame(() => {
      legendRaf = 0;
      renderLegend(refs, state.legend, {
        db: state.db,
        onSelect: onLegendClick,
        filter: refs.legendSearch.value || "",
      });
    });
  });

  /* 画布：选择 / 双击聚焦 */
  const canvas = refs.canvas;
  canvas.addEventListener("click", (ev) => {
    if (!state.loaded) return;
    const hit = scene.pickAt(ev.clientX, ev.clientY);
    selectHit(hit);
  });
  canvas.addEventListener("dblclick", (ev) => {
    if (!state.loaded) return;
    const hit = scene.pickAt(ev.clientX, ev.clientY);
    if (hit) {
      scene.focusBlock(hit.x, hit.y, hit.z);
      selectHit(hit);
    } else {
      scene.frameAll();
    }
  });

  /* 检查器固定按钮 */
  refs.inspectorPinBtn?.addEventListener("click", () => {
    state.pinned = !state.pinned;
    setPressed(refs.inspectorPinBtn, state.pinned);
    if (state.pinned && state.selectedHit) {
      const info = describeBlock(state.selectedHit, state.pickCtx);
      if (info) inspector.show(info, { pinned: true });
    } else if (state.pinned && state.lastHit) {
      state.selectedHit = state.lastHit;
      const info = describeBlock(state.lastHit, state.pickCtx);
      if (info) inspector.show(info, { pinned: true });
    }
  });

  /* 键盘快捷键 */
  window.addEventListener("keydown", (ev) => {
    const t = ev.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
      if (ev.key === "Escape" && t === refs.legendSearch) {
        refs.legendSearch.value = "";
        renderLegend(refs, state.legend, { db: state.db, onSelect: onLegendClick, filter: "" });
        t.blur();
      }
      return;
    }
    if (ev.key === "Escape") {
      if (isHelpOpen(refs)) {
        closeHelp(refs);
        return;
      }
      selectHit(null);
      return;
    }
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    switch (ev.key) {
      case "1":
      case "2":
      case "3":
      case "4": {
        if (!state.loaded) return;
        const name = { 1: "iso", 2: "top", 3: "front", 4: "side" }[ev.key];
        scene.applyPreset(name);
        setViewButton(name);
        break;
      }
      case "[":
        if (!state.loaded) return;
        setSliceHud(refs, true, scene.stepSlice(-1), sliceMax());
        for (const b of refs.actButtons) if (b.dataset.act === "slice") setPressed(b, true);
        break;
      case "]":
        if (!state.loaded) return;
        setSliceHud(refs, true, scene.stepSlice(1), sliceMax());
        for (const b of refs.actButtons) if (b.dataset.act === "slice") setPressed(b, true);
        break;
      case "g":
      case "G": {
        const on = !scene.gridOn;
        scene.setGridVisible(on);
        for (const b of refs.actButtons) if (b.dataset.act === "grid") setPressed(b, on);
        break;
      }
      case "x":
      case "X": {
        const on = !scene.wireframe;
        scene.setWireframe(on);
        for (const b of refs.actButtons) if (b.dataset.act === "wire") setPressed(b, on);
        break;
      }
      case "e":
      case "E": {
        const on = scene.entitiesOn === false;
        scene.setEntitiesVisible(on);
        for (const b of refs.actButtons) if (b.dataset.act === "entities") setPressed(b, on);
        break;
      }
      case "o":
      case "O":
        refs.fileInput.click();
        break;
      case "f":
      case "F":
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else refs.root.requestFullscreen?.().catch(() => {});
        break;
      default:
        break;
    }
  });

  /* 窗口尺寸 */
  window.addEventListener("resize", () => scene.resize());

  /* 全局错误收集（e2e 会读 state().errors） */
  window.addEventListener("error", (ev) => pushError(ev.error || ev.message));
  window.addEventListener("unhandledrejection", (ev) => pushError(ev.reason));
}

/* ---------------------------------------------------------------- 对外 & 启动 */

window.__VIEWER__ = api;

boot().catch((err) => {
  pushError(err);
  showFatal(err);
  window.__APP_READY__ = true;
  window.__VIEWER__.bootError = String(err?.message || err);
  try {
    rejectReady(err);
  } catch {
    /* ignore */
  }
});
