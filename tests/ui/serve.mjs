#!/usr/bin/env node
// mcviewer —— 极简静态服务器（仅用于 UI 视觉自检，不参与产物）
// 以项目根为根目录，支持 importmap 直接加载 src/ 源码，免构建热迭代。
// 用法：node tests/ui/serve.mjs [--port 5179] [--root .]

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, "../..");

const argv = process.argv.slice(2);
const getArg = (name, def) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};
const PORT = Number(getArg("port", 5179));
const ROOT = path.resolve(PROJECT, getArg("root", "."));
const HOST = getArg("host", "127.0.0.1");

const MIME = {
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
  ".litematic": "application/octet-stream",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
  } catch (e) {
    res.writeHead(400).end("bad url");
    return;
  }
  let file = path.join(ROOT, pathname);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      console.log(`404 ${req.method} ${pathname}`);
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("404 " + pathname);
      return;
    }
    const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, {
      "content-type": type,
      "content-length": st.size,
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    });
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`UI harness: http://${HOST}:${PORT}/tests/ui/harness.html`);
  console.log(`static root: ${ROOT}`);
});
