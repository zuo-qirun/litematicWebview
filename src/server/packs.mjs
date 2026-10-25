// 材质包烘焙队列：调用 Python 烘焙脚本，串行执行，带超时与失败兜底。
import { spawn } from "node:child_process";
import { existsSync, promises as fsp } from "node:fs";
import { join } from "node:path";
import { readJson } from "./util.mjs";

const BAKE_TIMEOUT_MS = 5 * 60 * 1000;

export class PackBaker {
  constructor({ store, repoRoot, python = process.env.MCVIEWER_PYTHON || "python", maxQueue = 4 }) {
    this.store = store;
    this.repoRoot = repoRoot;
    this.python = python;
    // 部署环境常见只有 python3（Ubuntu 26.04 不再提供 python 命令），探测时按序回退
    this.pythonCandidates = [...new Set([python, "python3", "/usr/bin/python3"])].filter(Boolean);
    this.pythonBin = python;
    this.maxQueue = maxQueue;
    this.packScript = join(repoRoot, "tools", "bake", "pack.py");
    this.assetsBase = join(repoRoot, "assets");
    // 只有实际存在的 jar 才传给烘焙器（部署时可以只带主 jar）
    this.jars = [
      join(repoRoot, "_dl", "client-1.21.1.jar"),
      join(repoRoot, "_dl", "client-26.3.jar"),
    ].filter((p) => existsSync(p));
    this.queue = [];
    this.running = null;
    this.probeCache = null;
  }

  /** 探测 python 与烘焙脚本是否可用（结果缓存） */
  async probe() {
    if (this.probeCache) return this.probeCache;
    const result = { supported: false, python: null, reason: "" };
    try {
      await fsp.access(this.packScript);
    } catch {
      result.reason = "缺少 tools/bake/pack.py";
      this.probeCache = result;
      return result;
    }
    if (this.jars.length === 0) {
      result.reason = "缺少 _dl/client-1.21.1.jar（材质包烘焙需要原版资产）";
      this.probeCache = result;
      return result;
    }
    let version = null;
    for (const bin of this.pythonCandidates) {
      version = await runCapture(bin, ["--version"], 8000).catch(() => null);
      if (version && version.code === 0) {
        this.pythonBin = bin;
        break;
      }
      version = null;
    }
    if (!version) {
      result.reason = "找不到 python/python3，材质包烘焙不可用";
      this.probeCache = result;
      return result;
    }
    result.supported = true;
    result.python = String(version.stdout || version.stderr || "").trim();
    this.probeCache = result;
    return result;
  }

  /** 入队并异步开始烘焙（不等待完成） */
  async enqueue(id) {
    if (this.queue.length >= this.maxQueue) {
      await this.store.updatePack(id, { status: "error", message: "烘焙队列已满，请稍后重试" });
      return;
    }
    this.queue.push(id);
    await this.store.updatePack(id, { status: "queued", progress: 0, message: "" });
    this._pump();
  }

  _pump() {
    if (this.running || this.queue.length === 0) return;
    const id = this.queue.shift();
    this.running = this._bake(id)
      .catch(() => {})
      .finally(() => {
        this.running = null;
        this._pump();
      });
  }

  async _bake(id) {
    const store = this.store;
    const zipPath = store.packZip(id);
    const outDir = store.packAssetsDir(id);
    const reportPath = join(outDir, "report.json");
    const started = Date.now();
    await store.updatePack(id, { status: "baking", progress: 0.02, message: "正在解压资源包…" });
    // 清掉上次残留产物
    await fsp.rm(outDir, { recursive: true, force: true });

    // 粗粒度进度：按时间推进，真正的完成以进程退出为准
    const timer = setInterval(() => {
      const elapsed = Date.now() - started;
      const p = Math.min(0.92, 0.05 + (elapsed / 60000) * 0.85);
      const phase = p < 0.2 ? "正在解压资源包…" : p < 0.75 ? "正在烘焙方块模型与图集…" : "正在写入资产…";
      store.updatePack(id, { progress: Number(p.toFixed(3)), message: phase }).catch(() => {});
    }, 1500);
    timer.unref?.();

    let stderrTail = "";
    let stdoutTail = "";
    const args = [
      this.packScript,
      "--pack",
      zipPath,
      "--out",
      outDir,
      "--base",
      this.assetsBase,
      "--jars",
      this.jars.join(","),
    ];
    const res = await runCapture(this.pythonBin, args, BAKE_TIMEOUT_MS, {
      cwd: this.repoRoot,
      onStdout: (s) => {
        stdoutTail = (stdoutTail + s).slice(-4000);
      },
      onStderr: (s) => {
        stderrTail = (stderrTail + s).slice(-6000);
      },
    });
    clearInterval(timer);
    const elapsedMs = Date.now() - started;
    const report = await readJson(reportPath, null);

    if (res.code === 0 && report && report.ok !== false) {
      const stats = {
        entries: store.getPack(id)?.stats?.entries ?? 0,
        overrides: report.overrides || {},
        elapsedMs,
      };
      await store.updatePack(id, {
        status: "ready",
        progress: 1,
        message: "",
        assetsUrl: `/packs/${id}/assets/`,
        stats,
        bakedAt: new Date().toISOString(),
      });
      console.log(`[packs] ${id} 烘焙完成 ${elapsedMs} ms`);
      return;
    }

    const detail =
      (report && (report.error || report.message)) ||
      stderrTail.trim().split("\n").slice(-6).join("\n") ||
      stdoutTail.trim().split("\n").slice(-4).join("\n") ||
      `烘焙进程退出码 ${res.code}`;
    await fsp.rm(outDir, { recursive: true, force: true }).catch(() => {});
    await store.updatePack(id, {
      status: "error",
      progress: 0,
      message: `烘焙失败：${String(detail).slice(0, 400)}`,
    });
    console.log(`[packs] ${id} 烘焙失败：${String(detail).slice(0, 200)}`);
  }
}

/** 运行子进程并收集输出（带超时与 kill） */
export function runCapture(cmd, args, timeoutMs, opts = {}) {
  return new Promise((resolve) => {
    let out = "";
    let err = "";
    let settled = false;
    const child = spawn(cmd, args, {
      cwd: opts.cwd || process.cwd(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      resolve({ code: -1, stdout: out, stderr: `${err}\n[超时 ${timeoutMs}ms，已终止]`, timedOut: true });
    }, timeoutMs);
    timer.unref?.();
    child.stdout?.on("data", (d) => {
      const s = d.toString("utf8");
      out = (out + s).slice(-16000);
      opts.onStdout?.(s);
    });
    child.stderr?.on("data", (d) => {
      const s = d.toString("utf8");
      err = (err + s).slice(-16000);
      opts.onStderr?.(s);
    });
    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: -1, stdout: out, stderr: `${err}\n${e?.message || e}` });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout: out, stderr: err });
    });
  });
}
