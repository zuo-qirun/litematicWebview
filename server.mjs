// mcviewer —— 查看器服务端：静态资源 + 投影库 / 材质包 API。
// 用法：node server.mjs [--port 5178] [--open] [--dir dist] [--data data]
//                       [--token 口令] [--no-api] [--no-open] [--max-upload-mb 32]
import { createServer } from "node:http";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import { Store } from "./src/server/store.mjs";
import { PackBaker } from "./src/server/packs.mjs";
import { createApi } from "./src/server/api.mjs";
import { createAuth, createRateLimiter } from "./src/server/guard.mjs";
import { safeJoin } from "./src/server/paths.mjs";
import { sendJson, withSecurity } from "./src/server/util.mjs";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));

// 可选：从 env 文件读取配置（宝塔/ systemd 部署时把访问令牌放在 /etc/litematic-viewer.env，
// 这样令牌不会出现在 `ps` 的命令行里）。已存在的环境变量优先，文件不覆盖它们。
function loadEnvFile() {
  const explicit = process.env.MCVIEWER_ENV_FILE || "";
  const candidates = explicit ? [explicit] : ["/etc/litematic-viewer.env"];
  for (const file of candidates) {
    if (!file) continue;
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!m || m[1] === "" || process.env[m[1]] !== undefined) continue;
      let value = m[2];
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[m[1]] = value;
    }
    return file;
  }
  return "";
}

const envArgIdx = process.argv.indexOf("--env-file");
if (envArgIdx > 0 && process.argv[envArgIdx + 1]) {
  process.env.MCVIEWER_ENV_FILE = process.argv[envArgIdx + 1];
}

const ENV_FILE = loadEnvFile();

function parseArgs(argv) {
  const out = {
    port: 5178,
    open: true,
    dir: "dist",
    host: "127.0.0.1",
    data: "data",
    api: true,
    token: process.env.MCVIEWER_TOKEN || "",
    maxUploadMb: 32,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port" || a === "-p") out.port = Number(argv[++i]);
    else if (a === "--dir" || a === "-d") out.dir = argv[++i];
    else if (a === "--host") out.host = argv[++i];
    else if (a === "--data") out.data = argv[++i];
    else if (a === "--token") out.token = String(argv[++i] || "");
    else if (a === "--max-upload-mb") out.maxUploadMb = Number(argv[++i]) || 32;
    else if (a === "--open" || a === "-o") out.open = true;
    else if (a === "--no-open") out.open = false;
    else if (a === "--no-api") out.api = false;
    else if (a === "--help" || a === "-h") {
      console.log(`用法: node server.mjs [选项]

  --port, -p <n>       端口（默认 5178）
  --host <addr>        监听地址（默认 127.0.0.1，部署到公网用 0.0.0.0）
  --dir, -d <path>     静态站点目录（默认 dist）
  --data <path>        投影库/材质包数据目录（默认 data）
  --token <str>        启用访问令牌（也可用环境变量 MCVIEWER_TOKEN）
  --env-file <path>    从文件读取环境变量（默认尝试 /etc/litematic-viewer.env）
  --max-upload-mb <n>  单个上传上限 MB（默认 32）
  --no-api             关闭上传/材质包接口（纯静态只读模式）
  --no-open            启动后不自动打开浏览器
  --open, -o           启动后自动打开浏览器（默认开启）`);
      process.exit(0);
    }
  }
  return out;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".gif": "image/gif",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".litematic": "application/octet-stream",
  ".mcmeta": "text/plain; charset=utf-8",
};

const GZIP_EXT = new Set([".js", ".mjs", ".css", ".json", ".html", ".svg", ".map", ".wasm", ".txt"]);
const SIZED_TYPES = new Set([".png", ".jpg", ".jpeg", ".webp", ".ico", ".gif", ".woff2"]);

const args = parseArgs(process.argv);
const DIST = resolve(ROOT, args.dir);
const DATA = resolve(ROOT, args.data);
const gzipCache = new Map();

const store = new Store({ dataDir: DATA });
const baker = new PackBaker({ store, repoRoot: ROOT });
const auth = createAuth(args.token);
const rateLimit = createRateLimiter({ windowMs: 60_000, max: 20 });
const handleApi = createApi({
  store,
  baker,
  auth,
  rateLimit,
  limits: {
    maxUploadBytes: Math.max(1, args.maxUploadMb) * 1024 * 1024,
    maxPackUncompressed: 256 * 1024 * 1024,
  },
});

/* ------------------------------------------------------------------ 静态文件 */

function cachePolicy(pathname, ext, search) {
  const versioned = /[?&]v=/.test(search || "");
  // 材质包资源在 /packs/<id>/assets/ 下，id 每次上传都会变，内容基本不会改写
  if (pathname.startsWith("/packs/")) return "public, max-age=3600";
  // 带内容版本号的静态资源可以长缓存（build.mjs 会给 app.js/styles.css/assets 打 ?v=xxxx）
  if (versioned) return "public, max-age=31536000, immutable";
  if (SIZED_TYPES.has(ext)) return "public, max-age=3600";
  if (ext === ".litematic") return "public, max-age=3600";
  return "no-cache";
}

/** 找一个可用的预压缩兄弟文件：优先 br，其次 gz */
function pickPrecompressed(absPath, acceptEncoding) {
  const enc = String(acceptEncoding || "").toLowerCase();
  const tryOne = (file, name) => {
    try {
      const st = statSync(file);
      return st.isFile() && st.size > 0 ? { file, name, size: st.size } : null;
    } catch {
      return null;
    }
  };
  if (/(^|,)\s*br\b/.test(enc) || /br;/.test(enc)) {
    const hit = tryOne(absPath + ".br", "br");
    if (hit) return hit;
  }
  if (enc.includes("gzip") || enc.includes("*")) {
    const hit = tryOne(absPath + ".gz", "gzip");
    if (hit) return hit;
  }
  return null;
}

function serveFile(req, res, absPath, pathname, search) {
  let st;
  try {
    st = statSync(absPath);
    if (st.isDirectory()) return false;
  } catch {
    return false;
  }
  const ext = extname(absPath).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  const policy = cachePolicy(pathname, ext, search);

  // 1) 预压缩文件（构建立即生成的 .br/.gz）——直接流式发送，省 CPU
  const pre = pickPrecompressed(absPath, req.headers["accept-encoding"]);
  if (pre) {
    const etag = `W/"${pre.size}-${Math.round(st.mtimeMs)}-${pre.name}"`;
    const headers = withSecurity({
      "content-type": type,
      etag,
      "cache-control": policy,
      "content-encoding": pre.name,
      "content-length": pre.size,
      vary: "accept-encoding",
    });
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, headers);
      res.end();
      return true;
    }
    res.writeHead(200, headers);
    if (req.method === "HEAD") {
      res.end();
      return true;
    }
    const ps = createReadStream(pre.file);
    ps.on("error", () => {
      try {
        res.destroy();
      } catch {
        /* ignore */
      }
    });
    ps.pipe(res);
    return true;
  }

  // 2) 没有预压缩兄弟文件：文本类型现场 gzip（材质包生成的文件、开发模式走这里）
  const etag = `W/"${st.size}-${Math.round(st.mtimeMs)}"`;
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, withSecurity({ etag, "cache-control": policy }));
    res.end();
    return true;
  }
  const headers = withSecurity({
    "content-type": type,
    etag,
    "cache-control": policy,
  });

  const acceptGzip = String(req.headers["accept-encoding"] || "").includes("gzip");
  if (acceptGzip && GZIP_EXT.has(ext) && st.size > 1024) {
    const key = `${absPath}:${st.mtimeMs}`;
    let buf = gzipCache.get(key);
    if (!buf) {
      try {
        buf = gzipSync(readFileSync(absPath), { level: 6 });
      } catch {
        buf = null;
      }
      if (gzipCache.size > 64) gzipCache.clear();
      if (buf) gzipCache.set(key, buf);
    }
    if (buf) {
      headers["content-encoding"] = "gzip";
      headers["content-length"] = buf.length;
      headers["vary"] = "accept-encoding";
      res.writeHead(200, headers);
      if (req.method === "HEAD") res.end();
      else res.end(buf);
      return true;
    }
  }

  headers["content-length"] = st.size;
  res.writeHead(200, headers);
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  const stream = createReadStream(absPath);
  stream.on("error", () => {
    try {
      res.destroy();
    } catch {
      /* ignore */
    }
  });
  stream.pipe(res);
  return true;
}

const PACK_ASSET_RE = /^\/packs\/([0-9a-z]{6,24})\/assets\/(.+)$/;

function serveStatic(req, res, pathname, search) {
  let rel = pathname;
  if (rel.endsWith("/")) rel += "index.html";

  // 材质包烘焙产物：/packs/<id>/assets/**
  const pm = PACK_ASSET_RE.exec(rel);
  if (pm) {
    const pack = store.getPack(pm[1]);
    if (!pack || pack.status !== "ready") return false;
    const abs = safeJoin(store.packAssetsDir(pack.id), "/" + pm[2]);
    return abs ? serveFile(req, res, abs, pathname, search) : false;
  }

  // 站点静态资源
  const abs = safeJoin(DIST, rel);
  if (!abs) return false;
  return serveFile(req, res, abs, pathname, search);
}

/* ------------------------------------------------------------------ 服务器 */

const server = createServer(async (req, res) => {
  // 统一安全头（含 CSP），任何响应都先带上
  for (const [k, v] of Object.entries(withSecurity({}))) res.setHeader(k, v);

  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  try {
    if (pathname.startsWith("/api/")) {
      if (!args.api) {
        sendJson(res, 404, { error: { code: "API_DISABLED", message: "本服务器以只读模式运行，已关闭上传接口" } });
        return;
      }
      const handled = await handleApi(req, res);
      if (!handled) sendJson(res, 404, { error: { code: "NOT_FOUND", message: "接口不存在" } });
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "仅支持 GET / HEAD" } }, { allow: "GET, HEAD" });
      return;
    }

    if (serveStatic(req, res, pathname, url.search)) return;

    // 单页应用回退：非资源路径交给 index.html（例如直接访问 / 子路径）
    const looksLikeAsset = extname(pathname) !== "";
    if (!looksLikeAsset && serveStatic(req, res, "/index.html", url.search)) return;

    sendJson(res, 404, { error: { code: "NOT_FOUND", message: `找不到 ${pathname}` } });
  } catch (err) {
    console.error("[server]", err);
    if (!res.headersSent) {
      try {
        sendJson(res, 500, { error: { code: "INTERNAL", message: "服务器内部错误" } });
      } catch {
        res.destroy();
      }
    } else {
      try {
        res.destroy();
      } catch {
        /* ignore */
      }
    }
  }
});

server.requestTimeout = 180_000; // 大文件上传
server.headersTimeout = 30_000;
server.keepAliveTimeout = 10_000;
server.maxHeadersCount = 100;

async function main() {
  await store.init();
  server.listen(args.port, args.host, async () => {
    const shown = args.host === "0.0.0.0" ? "127.0.0.1" : args.host;
    const url = `http://${shown}:${args.port}/`;
    console.log(`mcviewer: 静态目录 ${DIST}`);
    if (ENV_FILE) console.log(`mcviewer: 已读取环境文件 ${ENV_FILE}`);
    if (args.api) {
      console.log(`mcviewer: 数据目录 ${DATA}`);
      console.log(`mcviewer: 上传接口已启用（单文件上限 ${args.maxUploadMb} MB，写入限速 20 次/分钟/IP）`);
      console.log(`mcviewer: 访问令牌 ${auth.enabled ? "已启用（需在页面右上角填写）" : "未启用（仅适合本机/内网）"}`);
      const probe = await baker.probe();
      console.log(`mcviewer: 材质包烘焙 ${probe.supported ? "可用" : "不可用（" + probe.reason + "）"}`);
    } else {
      console.log("mcviewer: 只读模式（--no-api），上传与材质包接口已关闭");
    }
    console.log(`mcviewer: ${url}`);
    if (args.open) openBrowser(url);
  });
}

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`端口 ${args.port} 已被占用。换一个端口：node server.mjs --port 5179`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log("\nmcviewer: 正在退出…");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}

process.on("unhandledRejection", (err) => console.error("[unhandledRejection]", err));

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

function openBrowser(url) {
  try {
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    /* ignore */
  }
}

// 让 join/sep 等辅助导入保持可用
void join;
void sep;
