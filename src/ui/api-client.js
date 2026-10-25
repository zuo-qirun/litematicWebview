// mcviewer —— 服务端 HTTP API 客户端（唯一契约来源：docs/API.md §1–§3）
//
// 设计要点：
// - 零依赖、纯 ESM；上传走 XMLHttpRequest，唯一原因是需要 upload.onprogress。
// - 服务器功能是「可选增强」：capabilities() 404 / 网络失败 / 返回非 JSON 时
//   api.available = false，此后所有方法统一抛 ApiError(code:"UNAVAILABLE")，
//   UI 只需灰态降级，不弹报错。
// - 令牌保存在 localStorage，setToken(null) 清除；请求头用 Bearer。
// - 所有错误统一成 ApiError，带 HTTP status 与服务端 code，方便 UI 区分
//   UNAUTHORIZED / QUOTA_EXCEEDED / INVALID_FILE 等场景。

const API_BASE = "/api";
const TOKEN_KEY = "mcviewer.apiToken";
const UNAVAILABLE_MESSAGE = "服务器未启用该功能";

export class ApiError extends Error {
  /** @param {string} message @param {{status?: number, code?: string}} [meta] */
  constructor(message, { status = 0, code = "" } = {}) {
    super(message || "请求失败");
    this.name = "ApiError";
    this.status = Number(status) || 0;
    this.code = code || "";
  }
}

/** 服务端错误码 → 中文兜底文案（服务端 message 优先） */
const CODE_TEXT = {
  UNAVAILABLE: UNAVAILABLE_MESSAGE,
  NETWORK: "无法连接服务器，请确认 viewer 服务仍在运行",
  UNAUTHORIZED: "未授权：服务器开启了令牌保护，请填写访问令牌",
  INVALID_FILE: "文件无效：不是可解析的 .litematic 投影",
  BAD_FILENAME: "文件名无效，请重命名后再上传",
  INVALID_PACK: "材质包无效：不是可烘焙的 Minecraft 资源包",
  PAYLOAD_TOO_LARGE: "文件超过服务器允许的大小",
  QUOTA_EXCEEDED: "服务器存储空间不足，请先删除旧文件",
  RATE_LIMITED: "请求过于频繁，请稍后再试",
  NOT_FOUND: "条目不存在（可能已被删除）",
  BAD_REQUEST: "请求参数有误",
  BAD_RESPONSE: "服务器返回了无法解析的响应",
};

const unavailable = (status = 0) => new ApiError(UNAVAILABLE_MESSAGE, { status, code: "UNAVAILABLE" });

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

/** 从响应体提取 { error:{code,message} } 或 { code, message } */
function serverError(status, data) {
  const err = (data && (data.error || data)) || {};
  const code = err.code ? String(err.code) : "";
  const message = err.message ? String(err.message) : CODE_TEXT[code] || `服务器返回 ${status}`;
  return new ApiError(message, { status, code });
}

function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch (e) {
    return "";
  }
}

function setToken(token) {
  const value = token === null || token === undefined ? "" : String(token).trim();
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch (e) {
    /* 隐私模式 / file:// 限制：忽略，内存里仍然可用本次会话 */
  }
  // 通知所有面板同步令牌状态（两张卡片只弹出一处提示，保存后一起刷新）
  try {
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new CustomEvent("mcviewer:token", { detail: { token: value } }));
    }
  } catch (e) {
    /* CustomEvent 不可用（极少见的宿主环境）时忽略 */
  }
  return value;
}

function authHeaders() {
  const token = getToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

/** 统一 JSON 请求（非上传） */
async function request(path, { method = "GET", body = null, headers = null } = {}) {
  if (!api.available) throw unavailable();
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      body,
      cache: "no-store",
      headers: { ...authHeaders(), ...(headers || {}) },
    });
  } catch (err) {
    throw new ApiError(CODE_TEXT.NETWORK, { status: 0, code: "NETWORK" });
  }
  if (res.status === 204) return null;
  const data = parseJson(await res.text().catch(() => ""));
  if (!res.ok) throw serverError(res.status, data);
  return data;
}

/** XHR 上传（拿到 upload.onprogress），成功返回响应 JSON */
function upload(path, file, onProgress) {
  if (!api.available) return Promise.reject(unavailable());
  return new Promise((resolve, reject) => {
    const name = file && file.name ? String(file.name) : "上传文件";
    let xhr;
    try {
      xhr = new XMLHttpRequest();
    } catch (e) {
      reject(new ApiError("当前浏览器不支持上传", { status: 0, code: "UPLOAD_UNSUPPORTED" }));
      return;
    }
    xhr.open("POST", API_BASE + path, true);
    xhr.timeout = 10 * 60 * 1000;
    const headers = {
      ...authHeaders(),
      "content-type": "application/octet-stream",
      "x-file-name": encodeURIComponent(name),
    };
    for (const key of Object.keys(headers)) {
      try {
        xhr.setRequestHeader(key, headers[key]);
      } catch (e) {
        /* 忽略非法头 */
      }
    }

    const emit = typeof onProgress === "function" ? onProgress : () => {};
    let lastFrac = -1;
    if (xhr.upload) {
      xhr.upload.onprogress = (ev) => {
        const total = ev && ev.lengthComputable && ev.total > 0 ? ev.total : (file && file.size) || 0;
        if (!(total > 0) || !ev) return;
        const frac = Math.max(0, Math.min(1, ev.loaded / total));
        if (frac >= 1 || lastFrac < 0 || frac - lastFrac >= 0.01) {
          lastFrac = frac;
          emit(frac);
        }
      };
    }
    xhr.onerror = () => reject(new ApiError("上传失败：无法连接服务器", { status: 0, code: "NETWORK" }));
    xhr.ontimeout = () => reject(new ApiError("上传超时，请检查网络或文件大小后重试", { status: 0, code: "TIMEOUT" }));
    xhr.onabort = () => reject(new ApiError("上传已取消", { status: 0, code: "ABORTED" }));
    xhr.onload = () => {
      const data = parseJson(xhr.responseText || "");
      if (xhr.status >= 200 && xhr.status < 300) {
        emit(1);
        if (data && data.item) resolve(data.item);
        else reject(new ApiError(CODE_TEXT.BAD_RESPONSE, { status: xhr.status, code: "BAD_RESPONSE" }));
      } else {
        reject(serverError(xhr.status, data));
      }
    };
    try {
      xhr.send(file);
    } catch (err) {
      reject(new ApiError(`上传失败：${err && err.message ? err.message : err}`, { status: 0, code: "NETWORK" }));
    }
  });
}

/* ------------------------------------------------------------------ 能力探测 */

/**
 * GET /api/capabilities（永远公开，可用来判断服务器功能是否可用）
 * 第一次成功后缓存；传 force=true 强制重新探测（UI 的「重新检测」会用到）。
 */
async function capabilities(force = false) {
  if (api.caps && !force) return api.caps;
  let res;
  try {
    res = await fetch(`${API_BASE}/capabilities`, { cache: "no-store", headers: authHeaders() });
  } catch (err) {
    api.available = false; // 网络错误 = 没有服务器功能
    throw unavailable(0);
  }
  const data = parseJson(await res.text().catch(() => ""));
  if (res.status === 404 || res.status >= 500 || !data || typeof data !== "object") {
    api.available = false;
    throw unavailable(res.status);
  }
  if (!res.ok) throw serverError(res.status, data);
  api.available = true;
  api.caps = data;
  if (data.auth === true) {
    // 服务端要求令牌但本地没有：不算「不可用」，UI 显示令牌输入提示即可
  }
  return data;
}

/* ------------------------------------------------------------------ 投影库 */

async function listProjects() {
  const data = await request("/projects");
  if (!data || !Array.isArray(data.items)) {
    throw new ApiError(CODE_TEXT.BAD_RESPONSE, { status: 200, code: "BAD_RESPONSE" });
  }
  return { items: data.items, storage: data.storage || null };
}

async function uploadProject(file, onProgress) {
  const data = await upload("/projects", file, onProgress);
  return data && data.item ? data.item : data;
}

async function deleteProject(id) {
  await request(`/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
  return true;
}

/** 投影文件的下载地址（不发起请求）；带令牌时用 ?token= 让 fetch 可直接取用 */
function projectFileUrl(id) {
  const base = `${API_BASE}/projects/${encodeURIComponent(id)}/file`;
  const token = getToken();
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

/* ------------------------------------------------------------------ 材质包 */

async function listPacks() {
  const data = await request("/packs");
  if (!data || !Array.isArray(data.items)) {
    throw new ApiError(CODE_TEXT.BAD_RESPONSE, { status: 200, code: "BAD_RESPONSE" });
  }
  return { items: data.items, storage: data.storage || null };
}

async function uploadPack(file, onProgress) {
  const data = await upload("/packs", file, onProgress);
  return data && data.item ? data.item : data;
}

async function getPack(id) {
  const data = await request(`/packs/${encodeURIComponent(id)}`);
  if (!data || !data.item) throw new ApiError(CODE_TEXT.BAD_RESPONSE, { status: 200, code: "BAD_RESPONSE" });
  return data.item;
}

async function deletePack(id) {
  await request(`/packs/${encodeURIComponent(id)}`, { method: "DELETE" });
  return true;
}

/* ------------------------------------------------------------------ 导出对象 */

export const api = {
  /** 服务器功能是否可用；capabilities() 失败后为 false（UI 据此灰态降级） */
  available: true,
  /** 最近一次 capabilities() 的结果（供 UI 读取 auth / packsSupported 等） */
  caps: null,
  capabilities,
  listProjects,
  uploadProject,
  deleteProject,
  projectFileUrl,
  listPacks,
  uploadPack,
  getPack,
  deletePack,
  setToken,
  getToken,
  /** 附加便利方法：需要自定义 fetch 时可直接取鉴权头 */
  authHeaders,
};
