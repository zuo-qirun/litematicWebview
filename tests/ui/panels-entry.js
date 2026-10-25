// mcviewer —— 侧边栏面板离线 harness（tests/ui/panels.html 的入口）
//
// 目的：在没有 server.mjs / HTTP 后端的情况下，用假的 fetch + XHR 把
//      「服务器投影」「材质包」两张卡片渲染出来，覆盖下列状态：
//        default   正常列表（3 个投影 / 2 个材质包，其中一个烘焙中 37%）
//        upload45  上传进度 45%（XHR 卡在 45%）
//        error     列表接口 500 → 卡片内错误条 + 重试
//        empty     空列表 → 空态
//        offline   capabilities 404 → 服务器未连接灰态
//        auth      服务端开启令牌 + 401 → 令牌输入提示
//        hover     正常列表 + 悬停第一行（由截图脚本触发）
//
// 只依赖 src/ui/ 下已交付的模块，不 import three / 渲染器，可 file:// 直接打开。

import { buildShell, hideBoot } from "../../src/ui/app-shell.js";
import { renderFileCard, renderRegions, renderLegend } from "../../src/ui/panels.js";
import { createLibrary } from "../../src/ui/library.js";
import { createPackPanel } from "../../src/ui/packs.js";
import { api } from "../../src/ui/api-client.js";
import { h } from "../../src/ui/dom.js";

const params = new URLSearchParams(location.search);
const scenario = params.get("scenario") || "default";

/* ------------------------------------------------------------------ mock 数据 */

const NOW = Date.now();
const ago = (minutes) => new Date(NOW - minutes * 60 * 1000).toISOString();

const PROJECTS = [
  {
    id: "prj_end_tower",
    name: "末地要塞_主塔_最终版_v3_带内饰完整存档.litematic",
    size: 1287364,
    blocks: 182740,
    regions: 6,
    author: "Devon",
    mcVersion: "1.21.4",
    createdAt: ago(3),
    url: "/api/projects/prj_end_tower/file",
  },
  {
    id: "prj_redstone_cpu",
    name: "红石计算器_8bit_优化版.litematic",
    size: 438221,
    blocks: 51234,
    regions: 3,
    author: "",
    mcVersion: "1.20.6",
    createdAt: ago(2 * 60 + 17),
    url: "/api/projects/prj_redstone_cpu/file",
  },
  {
    id: "prj_beacon_farm",
    name: "满级信标农场.litematic",
    size: 92160,
    blocks: 8842,
    regions: 1,
    author: "",
    mcVersion: "1.21",
    createdAt: ago(26 * 60),
    url: "/api/projects/prj_beacon_farm/file",
  },
];

const STORAGE = { count: 3, bytes: 1817145, maxBytes: 536870912, maxCount: 200 };

const PACKS = [
  {
    id: "pack_ready",
    name: "我的材质包_1.21_低配版.zip",
    size: 2411724,
    status: "ready",
    progress: 1,
    message: "",
    assetsUrl: "/packs/pack_ready/assets/",
    stats: { blocks: 812, models: 640, quads: 3120, textures: 256, overrides: 27 },
    createdAt: ago(3 * 60),
  },
  {
    id: "pack_baking",
    name: "清新草地_测试包_带自定义天空.zip",
    size: 3774873,
    status: "baking",
    progress: 0.37,
    message: "正在烘焙：assets/minecraft/textures/block",
    assetsUrl: "",
    stats: { blocks: 0, models: 0, quads: 0, textures: 0, overrides: 0 },
    createdAt: ago(1),
  },
];

const CAPS = {
  version: 1,
  projects: true,
  packs: true,
  auth: false,
  maxUploadBytes: 33554432,
  limits: { projects: 200, packs: 5, totalBytes: 536870912 },
  packsSupported: true,
  python: "3.12.4",
};

// xss 场景：文件名里带 HTML，验证只按 textContent 渲染（安全审查要求）
const XSS_PROJECTS = [
  { ...PROJECTS[0], id: "prj_xss", name: '<img src=x onerror="window.__XSS__=1">末地要塞_主塔.litematic' },
];
const XSS_PACKS = [
  { ...PACKS[0], id: "pack_xss", name: '<img src=x onerror="window.__XSS__=2">我的材质包.zip' },
];

/* ------------------------------------------------------------------ 假 fetch / XHR */

function hasAuth(url, init) {
  const headers = (init && init.headers) || {};
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === "authorization" && String(headers[key]).startsWith("Bearer ")) return true;
  }
  return Boolean(url.searchParams.get("token"));
}

/* ------------------------------------------------------------------ 假 fetch / XHR */

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === null || body === undefined ? "" : JSON.stringify(body)),
  };
}

function installMockFetch() {
  window.fetch = async function (input, init) {
    const raw = typeof input === "string" ? input : (input && input.url) || "";
    const url = new URL(raw, "http://localhost");
    const path = url.pathname;
    const method = String((init && init.method) || "GET").toUpperCase();

    if (path === "/api/capabilities") {
      if (scenario === "offline") return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Not Found" } });
      const caps = scenario === "auth" ? { ...CAPS, auth: true } : CAPS;
      return jsonResponse(200, caps);
    }

    if (path === "/api/projects" && method === "GET") {
      if (scenario === "auth" && !hasAuth(url, init)) return jsonResponse(401, { error: { code: "UNAUTHORIZED", message: "服务器开启了令牌保护：请填写访问令牌后重试" } });
      if (scenario === "error") return jsonResponse(500, { error: { code: "INTERNAL", message: "服务器内部错误：data/projects 目录不可写" } });
      if (scenario === "empty") return jsonResponse(200, { items: [], storage: { count: 0, bytes: 0, maxBytes: 536870912, maxCount: 200 } });
      const items = scenario === "xss" ? XSS_PROJECTS : PROJECTS;
      return jsonResponse(200, { items, storage: STORAGE });
    }

    if (path === "/api/packs" && method === "GET") {
      if (scenario === "auth" && !hasAuth(url, init)) return jsonResponse(401, { error: { code: "UNAUTHORIZED", message: "服务器开启了令牌保护：请填写访问令牌后重试" } });
      if (scenario === "error") return jsonResponse(500, { error: { code: "INTERNAL", message: "服务器内部错误：烘焙队列不可用" } });
      if (scenario === "empty") return jsonResponse(200, { items: [], storage: { count: 0, bytes: 0, maxBytes: 536870912, maxCount: 5 } });
      const items = scenario === "xss" ? XSS_PACKS : PACKS;
      return jsonResponse(200, { items, storage: { count: items.length, bytes: 6186597, maxBytes: 536870912, maxCount: 5 } });
    }

    const deleteMatch = path.match(/^\/api\/(projects|packs)\/([^/]+)$/);
    if (deleteMatch && method === "DELETE") return jsonResponse(204, null);

    const fileMatch = path.match(/^\/api\/projects\/([^/]+)\/file$/);
    if (fileMatch) return jsonResponse(404, { error: { code: "NOT_FOUND", message: "mock harness 不提供文件下载" } });

    return jsonResponse(404, { error: { code: "NOT_FOUND", message: `mock 未实现：${method} ${path}` } });
  };
}

/** 只实现上传所需的 XMLHttpRequest 子集；upload45 场景在 45% 处卡住不返回 */
function installMockXHR() {
  class MockXHR {
    constructor() {
      this.upload = {};
      this.status = 0;
      this.responseText = "";
      this.timeout = 0;
      this._headers = {};
    }
    open(method, url) {
      this._method = method;
      this._url = url;
    }
    setRequestHeader(key, value) {
      this._headers[key] = value;
    }
    send(body) {
      const size = body && body.size ? body.size : 1024;
      const emit = (frac) => {
        if (this.upload && typeof this.upload.onprogress === "function") {
          this.upload.onprogress({ lengthComputable: true, loaded: Math.round(size * frac), total: size });
        }
      };
      let step = 0;
      const timer = setInterval(() => {
        step += 1;
        emit(Math.min(0.9, step * 0.15));
        if (scenario === "upload45") {
          // 卡在 45%：进度条停住，等截图
          if (step >= 3) clearInterval(timer);
          return;
        }
        if (step >= 7) {
          clearInterval(timer);
          this.status = 201;
          this.responseText = JSON.stringify({ item: PROJECTS[0] });
          emit(1);
          if (this.onload) this.onload();
        }
      }, 80);
    }
  }
  window.XMLHttpRequest = MockXHR;
}

/* ------------------------------------------------------------------ 左栏假数据（文件 / Region / 图例） */

const REGION_NAMES = [
  ["主塔主体", [128, 96, 144], 1769472],
  ["末地传送门", [24, 24, 24], 13824],
  ["信标基座", [16, 8, 16], 2048],
  ["楼梯与平台", [48, 32, 48], 73728],
  ["外墙装饰", [128, 40, 8], 40960],
  ["内部房间 A", [32, 16, 32], 16384],
  ["内部房间 B", [32, 16, 32], 16384],
  ["地下室", [40, 12, 40], 19200],
  ["塔顶尖刺", [24, 40, 24], 23040],
  ["生物笼", [12, 12, 12], 1728],
  ["红石线路", [64, 4, 64], 16384],
  ["仓库", [32, 20, 32], 20480],
  ["传送台", [16, 16, 16], 4096],
  ["边界墙", [1, 96, 144], 13824],
  ["装饰细节", [24, 24, 24], 13824],
];

const REGIONS = REGION_NAMES.map(([name, size, volume]) => ({
  name,
  size: { x: size[0], y: size[1], z: size[2] },
  volume,
  visible: true,
}));

const LEGEND = [
  ["minecraft:end_stone_bricks", "末地石砖", 48210, [219, 222, 158]],
  ["minecraft:purpur_block", "紫珀块", 31840, [169, 125, 169]],
  ["minecraft:stone_bricks", "石砖", 26412, [122, 122, 122]],
  ["minecraft:oak_planks", "橡木木板", 14480, [162, 130, 78]],
  ["minecraft:glass", "玻璃", 9620, [200, 226, 230]],
  ["minecraft:sea_lantern", "海晶灯", 4380, [200, 230, 220]],
  ["minecraft:redstone_block", "红石块", 2210, [175, 30, 20]],
  ["minecraft:beacon", "信标", 96, [120, 230, 210]],
].map(([id, name, count, color]) => ({ id, name, stateKey: `${id}[default]`, count, color }));

/* ------------------------------------------------------------------ 启动 */

function buildLeftColumn() {
  const root = document.getElementById("app");
  const refs = buildShell(root);

  // 隐藏画布空态，让左栏是唯一焦点（截图仍保留完整应用外框）
  if (refs.emptyState) refs.emptyState.hidden = true;

  renderFileCard(refs, {
    fileName: "末地要塞_主塔_最终版_v3.litematic",
    author: "Devon",
    size: { x: 128, y: 96, z: 144 },
    blocks: 182740,
    regions: REGIONS.length,
    mcVersion: "1.21.4",
    dataVersion: 4189,
    warnings: [],
  });
  renderRegions(refs, REGIONS, { onToggle() {}, onFocus() {}, onHover() {} });
  renderLegend(refs, LEGEND, { db: null, onSelect() {}, filter: "" });

  // 两张新卡片插在「文件」卡之后（app.js 接线时同理）
  const fileCard = refs.fileCardBody.closest(".card");
  const librarySection = h("section", { class: "card", id: "libraryCard" });
  const packSection = h("section", { class: "card", id: "packPanel" });
  fileCard.after(librarySection, packSection);

  return { refs, librarySection, packSection };
}

async function simulateUpload(librarySection) {
  const input = librarySection.querySelector('input[type="file"]');
  const dt = new DataTransfer();
  dt.items.add(
    new File([new Uint8Array(4096)], "末地要塞_主塔_2026改版_最终确定版.litematic", { type: "application/octet-stream" })
  );
  input.files = dt.files;
  input.dispatchEvent(new Event("change"));
}

async function main() {
  installMockFetch();
  installMockXHR();
  try {
    localStorage.removeItem("mcviewer.apiToken");
  } catch (err) {
    /* file:// 下 localStorage 可能不可用，忽略 */
  }

  const { refs, librarySection, packSection } = buildLeftColumn();

  const library = createLibrary(librarySection, {
    onOpen: async () => {},
    onError: () => {},
  });
  const packs = createPackPanel(packSection, {
    onApply: async (pack) => {
      // 模拟 app.js：应用后把该包标为当前材质
      packs.setActive(pack && pack.id ? pack.id : null);
    },
    onClear: async () => {
      packs.setActive(null);
    },
    onError: () => {},
  });

  window.__PANELS__ = { refs, library, packs, scenario, projects: PROJECTS, packsData: PACKS };

  const caps = await api.capabilities().catch((err) => {
    if (err && err.code === "UNAVAILABLE") return null;
    throw err;
  });

  if (caps && caps.projects) await library.refresh();
  else library.setEnabled(false);

  if (caps && caps.packs) await packs.refresh();
  else packs.setEnabled(false);

  if (caps && (scenario === "default" || scenario === "upload45" || scenario === "hover")) {
    packs.setActive("pack_ready");
  }

  if (scenario === "upload45") await simulateUpload(librarySection);

  hideBoot();
  window.__APP_READY__ = true;
}

main().catch((err) => {
  console.error("[panels-harness] 启动失败", err);
  document.body.dataset.harnessError = String((err && err.stack) || err);
});
