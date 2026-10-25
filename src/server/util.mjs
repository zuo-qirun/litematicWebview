// 服务端通用工具：JSON 响应、错误、ID、文件名消毒、原子写。
import { createReadStream, promises as fsp } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname } from "node:path";

export const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
export const ID_RE = /^[0-9a-z]{6,24}$/;

/** 生成 12 位 base36 随机 id */
export function newId(len = 12) {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return out;
}

export function nowIso() {
  return new Date().toISOString();
}

const CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
].join("; ");

const SECURITY_HEADERS = Object.freeze({
  "content-security-policy": CSP,
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "SAMEORIGIN",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
});

export function withSecurity(headers = {}) {
  return { ...SECURITY_HEADERS, ...headers };
}

/** 发送 JSON */
export function sendJson(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(
    status,
    withSecurity({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "content-length": Buffer.byteLength(body),
      ...headers,
    }),
  );
  res.end(res.req.method === "HEAD" ? undefined : body);
}

/** 统一错误结构 */
export function sendError(res, status, code, message, extra = {}) {
  sendJson(res, status, { error: { code, message, ...extra } });
}

export function sendEmpty(res, status, headers = {}) {
  res.writeHead(status, withSecurity({ "cache-control": "no-store", ...headers }));
  res.end();
}

/**
 * 文件名消毒：保留中文/字母数字/常见符号，去掉控制字符与路径分隔符，
 * 限制 120 字符（按码点，避免截断代理对），禁止以 . 开头，空名回落。
 */
export function sanitizeFileName(raw, fallback = "未命名.litematic") {
  let name = String(raw ?? "");
  // 去掉控制字符（含 \0\r\n\t）与各类斜杠
  name = name.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[\\/]+/g, "_");
  // 去掉 Windows 保留字符
  name = name.replace(/[<>:"|?*]/g, "_");
  name = name.trim().replace(/^\.+/, "").replace(/\.+$/, "");
  if (!name) name = fallback;
  const chars = Array.from(name);
  if (chars.length > 120) {
    const ext = /\.[a-z0-9]{1,8}$/i.exec(name)?.[0] ?? "";
    name = chars.slice(0, Math.max(8, 120 - ext.length)).join("") + ext;
  }
  return name || fallback;
}

/** 原子写 JSON：写 tmp → rename，避免半截文件 */
export async function writeJsonAtomic(path, value) {
  const tmp = `${path}.${newId(6)}.tmp`;
  await fsp.mkdir(dirname(path), { recursive: true });
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await fsp.rename(tmp, path);
}

export async function readJson(path, fallback) {
  try {
    const text = await fsp.readFile(path, "utf8");
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

/** 目录是否存在且是目录 */
export async function isDir(path) {
  try {
    const st = await fsp.stat(path);
    return st.isDirectory();
  } catch {
    return false;
  }
}

export function fileStream(path) {
  return createReadStream(path);
}

/** 人类可读的字节数（服务端日志用） */
export function fmtBytes(n) {
  if (!Number.isFinite(n)) return "?";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
