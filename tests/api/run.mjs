// 服务端 API 自检：安全与功能用例（不需要浏览器）。
// 用法：node tests/api/run.mjs [--keep] [--verbose]
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fsp } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const FIXTURES = join(ROOT, "tests", "fixtures");
const FIXTURE = "海草机打包收集-by小鱼.litematic";
const TOKEN = "test-token-9f3a";
const MAX_UPLOAD_MB = 2;

let verbose = process.argv.includes("--verbose");
const keep = process.argv.includes("--keep");

let pass = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) {
    pass++;
    if (verbose) console.log(`  ✓ ${name}`);
  } else {
    failures.push({ name, detail });
    console.log(`  ✗ ${name}${detail ? "  → " + detail : ""}`);
  }
}
function eq(name, actual, expected) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}

/* ------------------------------------------------------------ 服务器进程 */

let port = 0;
let child = null;
let dataDir = "";

function freePort() {
  return new Promise((res, rej) => {
    const srv = http.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const p = srv.address().port;
      srv.close(() => res(p));
    });
    srv.on("error", rej);
  });
}

async function startServer() {
  port = await freePort();
  child = spawn(process.execPath, [
    "server.mjs",
    "--port",
    String(port),
    "--no-open",
    "--data",
    dataDir,
    "--token",
    TOKEN,
    "--max-upload-mb",
    String(MAX_UPLOAD_MB),
  ], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (d) => (log += d.toString()));
  child.stderr.on("data", (d) => (log += d.toString()));
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/capabilities`);
      if (r.ok) return log;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`服务端启动超时：\n${log}`);
}

async function stopServer() {
  if (!child) return;
  const dead = new Promise((res) => child.once("exit", res));
  child.kill();
  await Promise.race([dead, new Promise((r) => setTimeout(r, 3000))]);
  child = null;
}

/* ------------------------------------------------------------ 请求助手 */

const base = () => `http://127.0.0.1:${port}`;

async function api(path, { method = "GET", token = TOKEN, headers = {}, body } = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  const res = await fetch(base() + path, { method, headers: h, body, redirect: "manual" });
  const ct = res.headers.get("content-type") || "";
  let json = null;
  let buf = null;
  if (ct.includes("application/json")) {
    json = await res.json().catch(() => null);
  } else {
    buf = Buffer.from(await res.arrayBuffer());
  }
  return { status: res.status, headers: res.headers, json, buf };
}

/** 原样发送 path（不被 URL 规范化），用于路径穿越测试 */
function rawGet(path, extraHeaders = {}) {
  return new Promise((resolveP, rejectP) => {
    const req = http.request(
      { host: "127.0.0.1", port, method: "GET", path, headers: extraHeaders },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolveP({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("error", rejectP);
    req.end();
  });
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const fixtureBytes = await fsp.readFile(join(FIXTURES, FIXTURE));
const encodedName = encodeURIComponent(FIXTURE);

/* ------------------------------------------------------------ 用例 */

console.log("mcviewer API 自检");
dataDir = await fsp.mkdtemp(join(tmpdir(), "mcviewer-api-"));

try {
  const bootLog = await startServer();
  ok("服务端启动成功", true);
  ok("启动日志打印令牌已启用", /访问令牌 已启用/.test(bootLog), bootLog.slice(0, 200));

  // --- 能力探测（公开）
  const caps = await api("/api/capabilities", { token: null });
  eq("capabilities HTTP 200", caps.status, 200);
  eq("capabilities.version", caps.json?.version, 1);
  eq("capabilities.auth", caps.json?.auth, true);
  eq("capabilities.maxUploadBytes", caps.json?.maxUploadBytes, MAX_UPLOAD_MB * 1024 * 1024);
  ok("capabilities 有 packsSupported 字段", typeof caps.json?.packsSupported === "boolean");

  // --- 鉴权
  eq("未带令牌读取投影列表 → 401", (await api("/api/projects", { token: null })).status, 401);
  eq("错误令牌 → 401", (await api("/api/projects", { token: "wrong-token-123" })).status, 401);
  eq("?token= 查询参数鉴权可用", (await api(`/api/projects?token=${encodeURIComponent(TOKEN)}`, { token: null })).status, 200);
  const emptyList = await api("/api/projects");
  eq("初始投影列表为空", emptyList.json?.items?.length, 0);

  // --- 上传
  const up = await api("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/octet-stream", "x-file-name": encodedName },
    body: fixtureBytes,
  });
  eq("上传投影 → 201", up.status, 201);
  eq("上传后返回解析方块数", up.json?.item?.blocks, 966);
  eq("文件名按 UTF-8 正确还原", up.json?.item?.name, FIXTURE);
  ok("上传返回 id", /^[0-9a-z]{6,24}$/.test(up.json?.item?.id || ""));
  const id = up.json?.item?.id;

  const list = await api("/api/projects");
  eq("列表包含 1 个投影", list.json?.items?.length, 1);
  eq("列表统计容量", list.json?.storage?.count, 1);

  // --- 下载
  const dl = await api(`/api/projects/${id}/file`);
  eq("下载投影 → 200", dl.status, 200);
  ok("下载内容与原文件一致", dl.buf && sha256(dl.buf) === sha256(fixtureBytes));
  ok("下载带 UTF-8 文件名", /filename\*=UTF-8''/.test(dl.headers.get("content-disposition") || ""));
  const etag = dl.headers.get("etag");
  ok("下载响应带 ETag", Boolean(etag));
  const notModified = await fetch(base() + `/api/projects/${id}/file`, {
    headers: { authorization: `Bearer ${TOKEN}`, "if-none-match": etag },
  });
  eq("ETag 命中 → 304", notModified.status, 304);

  // --- 校验：非 gzip / 超大
  const bad = await api("/api/projects", {
    method: "POST",
    headers: { "x-file-name": "bad.litematic" },
    body: Buffer.from("这不是 litematic 文件".repeat(10)),
  });
  eq("非 gzip 文件 → 400", bad.status, 400);
  eq("非 gzip 文件错误码", bad.json?.error?.code, "INVALID_FILE");

  const tooBig = await api("/api/projects", {
    method: "POST",
    headers: { "x-file-name": "big.litematic" },
    body: Buffer.alloc(MAX_UPLOAD_MB * 1024 * 1024 + 1024, 7),
  });
  ok("超过上限 → 413 或 400", tooBig.status === 413 || tooBig.status === 400, `实际 ${tooBig.status}`);

  // --- 路径穿越 / 未知接口 / 方法
  for (const p of ["/api/../server.mjs", "/%2e%2e/package.json", "/api/projects/../../package.json", "/packs/abc/index.html"]) {
    const r = await rawGet(p, { authorization: `Bearer ${TOKEN}` });
    ok(`路径穿越被拒：${p}`, r.status === 404 || r.status === 403, `实际 ${r.status}`);
    ok(`路径穿越不泄露源码：${p}`, !/createServer|"name": "mcviewer"/.test(r.body || ""));
  }
  const unknown = await api("/api/nope");
  eq("未知 API → 404 JSON", unknown.status, 404);
  eq("未知 API 错误结构", unknown.json?.error?.code, "NOT_FOUND");
  const put = await api("/api/projects", { method: "PUT" });
  ok("不支持的方法 → 405", put.status === 405, `实际 ${put.status}`);

  // --- 删除
  eq("删除投影 → 204", (await api(`/api/projects/${id}`, { method: "DELETE" })).status, 204);
  eq("删除后列表为空", (await api("/api/projects")).json?.items?.length, 0);
  eq("删除不存在的投影 → 404", (await api(`/api/projects/${id}`, { method: "DELETE" })).status, 404);

  // --- 材质包（未安装烘焙脚本时应当 503）
  if (!caps.json?.packsSupported) {
    const packRes = await api("/api/packs", {
      method: "POST",
      headers: { "x-file-name": "test.zip" },
      body: Buffer.from("PK\x03\x04fake"),
    });
    eq("材质包烘焙不可用 → 503", packRes.status, 503);
    eq("材质包不可用错误码", packRes.json?.error?.code, "PACK_BAKE_UNAVAILABLE");
  }

  // --- 静态资源安全头
  const home = await fetch(base() + "/");
  eq("首页 200", home.status, 200);
  const csp = home.headers.get("content-security-policy") || "";
  ok("首页带 CSP", /default-src 'self'/.test(csp), csp);
  ok("CSP 禁止 object", /object-src 'none'/.test(csp));
  ok("首页 nosniff", home.headers.get("x-content-type-options") === "nosniff");
  ok("首页 no-referrer", home.headers.get("referrer-policy") === "no-referrer");
  ok("首页 frame-options", (home.headers.get("x-frame-options") || "").toUpperCase() === "SAMEORIGIN");

  // --- 限速（20 次/分钟）：连续 24 次写请求应出现 429
  let limited = 0;
  let retryAfter = null;
  for (let i = 0; i < 24; i++) {
    const r = await api("/api/projects", {
      method: "POST",
      headers: { "x-file-name": "x.litematic" },
      body: Buffer.from("x"),
    });
    if (r.status === 429) {
      limited++;
      retryAfter = retryAfter || r.headers.get("retry-after");
    }
  }
  ok("写入限速触发 429", limited > 0, `429 次数 ${limited}`);
  ok("429 带 Retry-After", Boolean(retryAfter), String(retryAfter));

  // --- 持久化：重启后投影仍在
  await new Promise((r) => setTimeout(r, 100));
  await stopServer();
  await startServer();
  const up2 = await api("/api/projects", {
    method: "POST",
    headers: { "x-file-name": encodeURIComponent("重启后.litematic") },
    body: fixtureBytes,
  });
  ok("重启后可继续上传", up2.status === 201 || up2.status === 429, `实际 ${up2.status}`);
  await stopServer();
  await startServer();
  const list2 = await api("/api/projects");
  eq("重启后投影仍在（持久化）", list2.json?.items?.length, 1);
  eq("重启后名称保持", list2.json?.items?.[0]?.name, "重启后.litematic");
} catch (err) {
  failures.push({ name: "未捕获异常", detail: err?.stack || String(err) });
  console.error(err);
} finally {
  await stopServer();
  if (!keep) {
    await fsp.rm(dataDir, { recursive: true, force: true }).catch(() => {});
  } else {
    console.log(`保留测试数据目录：${dataDir}`);
  }
}

console.log("");
if (failures.length) {
  console.log(`✗ API 自检失败：${failures.length} 项未通过 / 共 ${pass + failures.length} 项`);
  for (const f of failures) console.log(`  · ${f.name}${f.detail ? "  → " + f.detail : ""}`);
  process.exit(1);
}
console.log(`✓ API 自检通过：${pass} 项全部通过`);
