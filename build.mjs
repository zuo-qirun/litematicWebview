// mcviewer —— 打包脚本。用法：node build.mjs [--dev] [--watch] [--out dist]
// 产物：dist/{index.html,styles.css,app.js,assets/*,samples/*}
// 额外做三件事（为了首屏加载快）：
//   1) 给 app.js / styles.css / assets/* 打上内容版本号（?v=xxxx），配合服务端 immutable 缓存；
//   2) 预压缩：给文本资源生成 .br / .gz 兄弟文件，服务端直接发送，不再实时压缩；
//   3) 在 assets/manifest.json 里写入 version，前端据此给资源 URL 加版本号。
import * as esbuild from "esbuild";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { brotliCompressSync, gzipSync, constants as zc } from "node:zlib";


const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));
const argv = process.argv.slice(2);
const DEV = argv.includes("--dev");
const WATCH = argv.includes("--watch");
const outIdx = argv.findIndex((a) => a === "--out" || a === "-o");
const OUT = resolve(ROOT, outIdx >= 0 ? argv[outIdx + 1] : "dist");

const ENTRY = join(ROOT, "src", "app.js");
const STATIC_FILES = ["index.html", "styles.css"];
const STATIC_DIRS = ["assets", "samples", "fonts"];

function fmt(bytes) {
  if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + " MB";
  if (bytes > 1024) return (bytes / 1024).toFixed(1) + " KB";
  return bytes + " B";
}

function dirSize(dir) {
  let total = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    total += st.isDirectory() ? dirSize(p) : st.size;
  }
  return total;
}

function copyStatic() {
  mkdirSync(OUT, { recursive: true });
  const copied = [];
  for (const f of STATIC_FILES) {
    const src = join(ROOT, f);
    if (existsSync(src)) {
      copyFileSync(src, join(OUT, f));
      copied.push(f);
    }
  }
  for (const d of STATIC_DIRS) {
    const src = join(ROOT, d);
    if (!existsSync(src)) continue;
    const dst = join(OUT, d);
    rmSync(dst, { recursive: true, force: true });
    cpSync(src, dst, { recursive: true });
    copied.push(d + "/");
  }
  // 示例文件：让首页可以直接"打开示例"，不需要用户先找文件
  const fixtures = join(ROOT, "tests", "fixtures");
  if (existsSync(fixtures)) {
    const samplesDir = join(OUT, "samples");
    mkdirSync(samplesDir, { recursive: true });
    for (const f of readdirSync(fixtures)) {
      if (!f.endsWith(".litematic")) continue;
      const st = statSync(join(fixtures, f));
      if (st.size > 400 * 1024) continue;
      copyFileSync(join(fixtures, f), join(samplesDir, f));
    }
    copied.push("samples/*.litematic");
  }
  return copied;
}

function hashOf(buf) {
  return createHash("sha256").update(buf).digest("hex").slice(0, 10);
}

function stampVersions() {
  const appPath = join(OUT, "app.js");
  const cssPath = join(OUT, "styles.css");
  const appV = existsSync(appPath) ? hashOf(readFileSync(appPath)) : "0";
  const cssV = existsSync(cssPath) ? hashOf(readFileSync(cssPath)) : "0";
  const versions = { app: appV, css: cssV, assets: "" };

  // assets 版本 = 数据文件内容的联合哈希（图集也算进去，换图集也要失效缓存）
  const assetsDir = join(OUT, "assets");
  if (existsSync(assetsDir)) {
    const h = createHash("sha256");
    for (const name of readdirSync(assetsDir).sort()) {
      if (name.endsWith(".br") || name.endsWith(".gz")) continue;
      if (name === "manifest.json") continue;
      if (!/\.(json|png|webp)$/.test(name)) continue;
      h.update(name);
      h.update(readFileSync(join(assetsDir, name)));
    }
    versions.assets = h.digest("hex").slice(0, 10);
  }

  // index.html 里给 app.js / styles.css 带上版本号
  const idxPath = join(OUT, "index.html");
  if (existsSync(idxPath)) {
    let html = readFileSync(idxPath, "utf8");
    html = html
      .replace(/(\.\/app\.js)(\?v=[\w]+)?/g, `$1?v=${versions.app}`)
      .replace(/(\.\/styles\.css)(\?v=[\w]+)?/g, `$1?v=${versions.css}`)
      .replace(/(\.\/assets\/manifest\.json)(\?v=[\w]+)?/g, `$1?v=${versions.assets}`);
    writeFileSync(idxPath, html);
  }

  // manifest 里写入 version，前端据此给 blocks/models/lang/meta/atlas 加版本号
  const manPath = join(assetsDir, "manifest.json");
  if (existsSync(manPath)) {
    try {
      const man = JSON.parse(readFileSync(manPath, "utf8"));
      man.version = versions.assets;
      writeFileSync(manPath, JSON.stringify(man));
    } catch {
      /* manifest 坏了就让运行时自己兜底 */
    }
  }
  return versions;
}

const PRECOMPRESS_EXT = new Set([".js", ".mjs", ".css", ".html", ".json", ".svg", ".txt"]);
const PRECOMPRESS_MIN = 1024;

function precompress() {
  const stats = { files: 0, raw: 0, br: 0, gz: 0 };
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) {
        walk(p);
        continue;
      }
      const dot = name.lastIndexOf(".");
      const ext = dot >= 0 ? name.slice(dot) : "";
      if (!PRECOMPRESS_EXT.has(ext) || st.size < PRECOMPRESS_MIN) continue;
      const buf = readFileSync(p);
      // 小文件（按模型拆出来的模型 JSON 都是 KB 级）用 q9，大文件才用 q11：
      // 压缩率差别很小，但几千个文件时 q11 会把构建拖到分钟级。
      const br = brotliCompressSync(buf, {
        params: {
          [zc.BROTLI_PARAM_QUALITY]: buf.length > 16384 ? 11 : 9,
          [zc.BROTLI_PARAM_SIZE_HINT]: buf.length,
        },
      });
      const gz = gzipSync(buf, { level: 9 });
      writeFileSync(p + ".br", br);
      writeFileSync(p + ".gz", gz);
      stats.files += 1;
      stats.raw += buf.length;
      stats.br += br.length;
      stats.gz += gz.length;
    }
  };
  if (existsSync(OUT)) walk(OUT);
  return stats;
}

function report(pc, versions) {
  const app = join(OUT, "app.js");
  const appSize = existsSync(app) ? statSync(app).size : 0;
  let assets = 0;
  try {
    assets = dirSize(join(OUT, "assets"));
  } catch {
    /* no assets yet */
  }
  console.log(`build: ${OUT}`);
  console.log(`  app.js  ${fmt(appSize)}${DEV ? " (dev, unminified)" : " (minified)"}`);
  if (existsSync(join(OUT, "assets"))) console.log(`  assets  ${fmt(assets)}`);
  else console.log("  assets  缺失（渲染器需要 assets/，见 docs/CONTRACT.md §1）");
  if (pc && pc.files) {
    console.log(
      `  预压缩  ${pc.files} 个文件：原始 ${fmt(pc.raw)} → br ${fmt(pc.br)}（省 ${(100 - (pc.br / pc.raw) * 100).toFixed(1)}%）/ gz ${fmt(pc.gz)}`
    );
  }
  if (versions) console.log(`  版本号  app=${versions.app} css=${versions.css} assets=${versions.assets}`);
}

if (!existsSync(ENTRY)) {
  console.error(`缺少入口 ${ENTRY}。等 src/app.js 写好后重试。`);
  process.exit(1);
}

const options = {
  entryPoints: [ENTRY],
  outfile: join(OUT, "app.js"),
  bundle: true,
  format: "esm",
  target: ["chrome110", "edge110", "firefox115", "safari16"],
  platform: "browser",
  minify: !DEV,
  sourcemap: DEV ? "inline" : false,
  legalComments: "none",
  logLevel: "warning",
  loader: { ".glsl": "text", ".vert": "text", ".frag": "text" },
  define: { "process.env.NODE_ENV": JSON.stringify(DEV ? "development" : "production") },
  plugins: [
    {
      name: "mcviewer-static",
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length) return;
          const copied = copyStatic();
          const versions = stampVersions();
          const pc = precompress();
          report(pc, versions);
          if (copied.length) console.log("  copied  " + copied.join(", "));
        });
      },
    },
  ],
};

if (WATCH) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("watch: 监听 src/ 变化（Ctrl+C 退出）");
} else {
  await esbuild.build(options);
}
