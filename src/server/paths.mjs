// 路径安全：把 URL 路径限制在某个根目录内，防止目录穿越、NUL 注入、UNC 逃逸。
import { resolve, sep, extname, normalize } from "node:path";

export const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".litematic": "application/octet-stream",
  ".zip": "application/zip",
};

/** 可以在浏览器里安全渲染的类型（用于静态服务白名单，避免把 .litematic/.zip 当页面） */
export const STATIC_EXT = new Set(Object.keys(MIME));

/**
 * 解析静态资源路径。
 * @param {string} root 绝对根目录
 * @param {string} urlPath 原始 URL 路径（含查询串会被剥离）
 * @returns {string|null} 绝对路径；越界/非法返回 null
 */
export function safeJoin(root, urlPath) {
  const rootAbs = resolve(root);
  let p;
  try {
    p = decodeURIComponent(String(urlPath || "/").split("?")[0].split("#")[0]);
  } catch {
    return null; // 非法百分号编码
  }
  if (p.includes("\0")) return null;
  if (p === "" || p === "/") p = "/index.html";
  if (p.endsWith("/")) p += "index.html";
  // 反斜杠在 Windows 上也是分隔符，统一成 /
  p = p.replace(/\\/g, "/");
  // 拒绝任何 . 或 .. 段（normalize 之后再判断一次，防御编码变体）
  const abs = resolve(rootAbs, "." + normalize(p));
  if (abs !== rootAbs && !abs.startsWith(rootAbs + sep)) return null;
  return abs;
}

export function mimeOf(path) {
  return MIME[extname(String(path)).toLowerCase()] || "application/octet-stream";
}

/** Content-Disposition 的 RFC 5987 编码（支持中文文件名） */
export function contentDisposition(name) {
  const safe = String(name).replace(/[\r\n"]/g, "_");
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}
