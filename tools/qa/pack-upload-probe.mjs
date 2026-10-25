// QA：把一个 zip 走真实服务端流程上传 + 烘焙，打印状态和产物可访问性（不启浏览器）。
// 用法：node tools/qa/pack-upload-probe.mjs --pack tests/packs/eye-care-1.21.2.zip [--port 5188] [--keep]
import { spawn } from "node:child_process";
import { promises as fsp } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
};
const PACK = resolve(ROOT, flag("--pack", "tests/packs/eye-care-1.21.2.zip"));
const PORT = Number(flag("--port", "5188"));
const TOKEN = "probe-token-1234";
const KEEP = argv.includes("--keep");

const dataDir = await fsp.mkdtemp(join(os.tmpdir(), "mcviewer-probe-"));
const server = spawn(
  process.execPath,
  ["server.mjs", "--port", String(PORT), "--no-open", "--data", dataDir, "--token", TOKEN, "--max-upload-mb", "16"],
  { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
);
server.stderr.on("data", (d) => {
  const s = String(d).trim();
  if (s) console.log("  [server]", s.slice(0, 300));
});
const post = (p, body, headers = {}) =>
  fetch(`http://127.0.0.1:${PORT}${p}`, { method: "POST", body, headers });
const get = (p) => fetch(`http://127.0.0.1:${PORT}${p}`, { headers: { authorization: `Bearer ${TOKEN}` } });

try {
  const t0 = Date.now();
  let up = false;
  while (Date.now() - t0 < 20000) {
    try {
      if ((await get("/api/capabilities")).ok) {
        up = true;
        break;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  if (!up) throw new Error("server 未就绪");
  const caps = await (await get("/api/capabilities")).json();
  console.log("capabilities:", JSON.stringify(caps).slice(0, 500));

  const bytes = await fsp.readFile(PACK);
  const up2 = await fetch(`http://127.0.0.1:${PORT}/api/packs`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "x-file-name": encodeURIComponent(basename(PACK)),
      "content-type": "application/zip",
    },
    body: bytes,
  });
  const upBody = await up2.json().catch(() => ({}));
  console.log(`POST /api/packs -> ${up2.status}`, JSON.stringify(upBody).slice(0, 400));
  const id = upBody.item?.id || upBody.pack?.id || upBody.id;
  if (!id) throw new Error("没有拿到材质包 id");
  const tBake = Date.now();
  let item = null;
  while (Date.now() - tBake < 300000) {
    const r = await get(`/api/packs/${id}`);
    const b = await r.json();
    item = b.item || b.pack || b;
    if (item.status === "ready" || item.status === "error") break;
    await new Promise((r2) => setTimeout(r2, 700));
  }
  console.log(`status=${item && item.status} message=${item && item.message} assetsUrl=${item && item.assetsUrl} 用时 ${((Date.now() - tBake) / 1000).toFixed(1)}s`);
  if (item && item.assetsUrl) {
    for (const f of ["manifest.json", "meta.json", "atlas.png", "atlas.webp", "blocks.json", "models.json", "lang.json"]) {
      const r = await get(item.assetsUrl + f);
      console.log(`  ${f}: ${r.status} ${r.headers.get("content-type")} ${Number(r.headers.get("content-length") || 0)}B`);
    }
  }
  const list = await (await get("/api/packs")).json();
  console.log("packs:", JSON.stringify(list).slice(0, 800));
  if (KEEP) console.log("dataDir:", dataDir);
} finally {
  server.kill();
  if (!KEEP) await fsp.rm(dataDir, { recursive: true, force: true }).catch(() => {});
}
