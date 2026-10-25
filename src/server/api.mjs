// /api/** 路由：投影库 + 材质包 + 能力探测。所有响应都带安全头、禁止缓存。
import { createReadStream, promises as fsp } from "node:fs";
import { fileStream, fmtBytes, sanitizeFileName, sendEmpty, sendError, sendJson } from "./util.mjs";
import { contentDisposition, mimeOf } from "./paths.mjs";
import { BodyError, clientIp, fileNameFromHeader, readBody } from "./body.mjs";
import { ZipError, validatePackZip } from "./zipinfo.mjs";
import { InspectError, inspectLitematic } from "./inspect.mjs";
import { StoreError } from "./store.mjs";

const PROJECT_RE = /^\/api\/projects\/([0-9a-z]{6,24})$/;
const PROJECT_FILE_RE = /^\/api\/projects\/([0-9a-z]{6,24})\/file$/;
const PACK_RE = /^\/api\/packs\/([0-9a-z]{6,24})$/;

/**
 * @param {object} deps
 * @param {import('./store.mjs').Store} deps.store
 * @param {import('./packs.mjs').PackBaker} deps.baker
 * @param {{enabled:boolean, check:Function}} deps.auth
 * @param {{take:Function}} deps.rateLimit
 * @param {{maxUploadBytes:number}} deps.limits
 * @returns {(req:import('node:http').IncomingMessage, res:import('node:http').ServerResponse)=>Promise<boolean>}
 */
export function createApi({ store, baker, auth, rateLimit, limits }) {
  const send = (res, status, body, headers) => sendJson(res, status, body, headers);

  return async function handleApi(req, res) {
    const url = new URL(req.url || "/", "http://localhost");
    const path = url.pathname;
    if (!path.startsWith("/api/")) return false;

    const method = req.method || "GET";
    const needAuth = path !== "/api/capabilities";
    if (needAuth && !auth.check(req)) {
      send(res, 401, { error: { code: "UNAUTHORIZED", message: "需要访问令牌（在页面右上角填入，或用 ?token= 传入）" } });
      return true;
    }

    const write = method === "POST" || method === "DELETE";
    if (write) {
      const r = rateLimit.take(clientIp(req));
      if (!r.ok) {
        send(res, 429, { error: { code: "RATE_LIMITED", message: "操作太频繁，请稍后再试", retryAfter: r.retryAfter } }, { "retry-after": String(r.retryAfter) });
        return true;
      }
    }

    try {
      // ---------- 能力探测 ----------
      if (path === "/api/capabilities") {
        if (method !== "GET" && method !== "HEAD") return methodNotAllowed(res, "GET, HEAD");
        const probe = await baker.probe();
        send(res, 200, {
          version: 1,
          projects: true,
          packs: probe.supported,
          auth: auth.enabled,
          maxUploadBytes: limits.maxUploadBytes,
          limits: {
            projects: store.limits.projects,
            packs: store.limits.packs,
            totalBytes: store.limits.projectBytes,
          },
          packsSupported: probe.supported,
          python: probe.python || "",
          packsUnavailableReason: probe.supported ? "" : probe.reason,
        });
        return true;
      }

      // ---------- 投影库 ----------
      if (path === "/api/projects") {
        if (method === "GET" || method === "HEAD") {
          const { items, storage } = store.listProjects();
          send(res, 200, { items, storage });
          return true;
        }
        if (method === "POST") {
          const buf = await readBody(req, { limit: limits.maxUploadBytes });
          const rawName = fileNameFromHeader(req, "未命名.litematic");
          let name = sanitizeFileName(rawName, "未命名.litematic");
          if (!/\.litematic$/i.test(name)) name += ".litematic";
          const info = inspectLitematic(buf);
          const item = await store.addProject({ name, buffer: buf, info });
          console.log(`[api] 上传投影 ${item.name}（${fmtBytes(item.size)}，${item.blocks} 方块）`);
          send(res, 201, { item });
          return true;
        }
        return methodNotAllowed(res, "GET, HEAD, POST");
      }

      let m = PROJECT_FILE_RE.exec(path);
      if (m) {
        if (method !== "GET" && method !== "HEAD") return methodNotAllowed(res, "GET, HEAD");
        const item = store.getProject(m[1]);
        if (!item) return notFound(res, "投影不存在");
        const file = store.projectFile(item.id);
        let st;
        try {
          st = await fsp.stat(file);
        } catch {
          return notFound(res, "投影文件已丢失");
        }
        const etag = `W/"${st.size}-${Math.round(st.mtimeMs)}"`;
        if (req.headers["if-none-match"] === etag) {
          sendEmpty(res, 304, { etag });
          return true;
        }
        res.writeHead(200, {
          "content-type": "application/octet-stream",
          "content-length": st.size,
          "content-disposition": contentDisposition(item.name),
          "cache-control": "private, max-age=0, must-revalidate",
          "x-content-type-options": "nosniff",
          etag,
        });
        if (method === "HEAD") return res.end(), true;
        fileStream(file).pipe(res);
        return true;
      }

      m = PROJECT_RE.exec(path);
      if (m) {
        if (method !== "DELETE") return methodNotAllowed(res, "DELETE");
        const ok = await store.removeProject(m[1]);
        if (!ok) return notFound(res, "投影不存在");
        console.log(`[api] 删除投影 ${m[1]}`);
        sendEmpty(res, 204);
        return true;
      }

      // ---------- 材质包 ----------
      if (path === "/api/packs") {
        if (method === "GET" || method === "HEAD") {
          const { items, storage } = store.listPacks();
          send(res, 200, { items, storage });
          return true;
        }
        if (method === "POST") {
          const probe = await baker.probe();
          if (!probe.supported) {
            send(res, 503, {
              error: { code: "PACK_BAKE_UNAVAILABLE", message: `材质包烘焙不可用：${probe.reason || "服务端缺少依赖"}` },
            });
            return true;
          }
          const buf = await readBody(req, { limit: limits.maxUploadBytes });
          const name = sanitizeFileName(fileNameFromHeader(req, "材质包.zip"), "材质包.zip");
          const info = validatePackZip(buf, { maxUncompressed: limits.maxPackUncompressed });
          const item = await store.addPack({ name, buffer: buf, zipInfo: info });
          console.log(`[api] 上传材质包 ${item.name}（${fmtBytes(item.size)}，${info.counts.json} json / ${info.counts.png} png）`);
          await baker.enqueue(item.id);
          const latest = store.getPack(item.id) || item;
          send(res, 202, { item: latest });
          return true;
        }
        return methodNotAllowed(res, "GET, HEAD, POST");
      }

      m = PACK_RE.exec(path);
      if (m) {
        if (method === "GET" || method === "HEAD") {
          const item = store.getPack(m[1]);
          if (!item) return notFound(res, "材质包不存在");
          send(res, 200, { item });
          return true;
        }
        if (method === "DELETE") {
          const ok = await store.removePack(m[1]);
          if (!ok) return notFound(res, "材质包不存在");
          console.log(`[api] 删除材质包 ${m[1]}`);
          sendEmpty(res, 204);
          return true;
        }
        return methodNotAllowed(res, "GET, HEAD, DELETE");
      }

      // 未匹配的 /api/** 一律 404 JSON，避免落到静态服务
      notFound(res, "接口不存在");
      return true;
    } catch (err) {
      return handleError(res, err);
    }
  };
}

function handleError(res, err) {
  const status = Number(err?.status) || 500;
  const code = String(err?.code || (status === 500 ? "INTERNAL" : "BAD_REQUEST"));
  const message =
    status === 500 ? "服务器内部错误" : String(err?.message || "请求失败");
  if (status >= 500) console.error("[api]", err);
  try {
    sendError(res, status, code, message);
  } catch {
    try {
      res.destroy();
    } catch {
      /* ignore */
    }
  }
  return true;
}

function methodNotAllowed(res, allow) {
  sendError(res, 405, "METHOD_NOT_ALLOWED", "不支持的请求方法", { allow });
  return true;
}

function notFound(res, message) {
  sendError(res, 404, "NOT_FOUND", message);
  return true;
}

// 让未使用的导入不被 tree-shake 掉（createReadStream/mimeOf 供后续扩展使用）
void createReadStream;
void mimeOf;
