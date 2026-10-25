// mcviewer —— 舞台上的浮层：空状态 / 加载 / 错误 / 切片 HUD / 性能徽章 / 帮助弹窗

import { fmtInt } from "./dom.js";

export function setEmpty(refs, show) {
  refs.emptyState.hidden = !show;
}

export function setError(refs, title, detail) {
  refs.errorState.hidden = false;
  refs.errorTitle.textContent = title || "无法打开文件";
  refs.errorDetail.textContent = detail || "";
}
export function clearError(refs) {
  refs.errorState.hidden = true;
}

/* ------------------------------------------------------------------ 加载中 */

export function startLoading(refs, title, fileName) {
  refs.loadingState.hidden = false;
  refs.loadingTitle.textContent = title || "正在加载投影";
  refs.loadingFile.textContent = fileName || "";
  refs.loadingPhase.textContent = "准备中…";
  refs.loadingBar.style.width = "0%";
  refs.loadingPct.textContent = "0%";
  let pct = 0;
  const api = {
    set(p, phase) {
      if (typeof p === "number") {
        pct = Math.max(pct, Math.min(100, p));
        refs.loadingBar.style.width = `${pct.toFixed(1)}%`;
        refs.loadingPct.textContent = `${Math.round(pct)}%`;
      }
      if (phase) refs.loadingPhase.textContent = phase;
    },
    /** 在等待解析器时做"假进度"：缓慢爬升到 ceiling，阶段文案由调用方给 */
    creep(ceiling = 88, phase) {
      if (pct >= ceiling) return;
      pct = Math.min(ceiling, pct + (ceiling - pct) * 0.06 + 0.35);
      refs.loadingBar.style.width = `${pct.toFixed(1)}%`;
      refs.loadingPct.textContent = `${Math.round(pct)}%`;
      if (phase) refs.loadingPhase.textContent = phase;
    },
    hide() {
      refs.loadingState.hidden = true;
    },
    get visible() {
      return !refs.loadingState.hidden;
    },
  };
  return api;
}

/* ------------------------------------------------------------------ 切片 HUD */

export function setSliceHud(refs, on, level = 0, max = 0) {
  refs.sliceHud.hidden = !on;
  if (!on) return;
  refs.sliceRange.max = String(Math.max(0, max));
  refs.sliceRange.value = String(Math.max(0, Math.min(level, max)));
  refs.sliceRange.style.setProperty("--p", `${max > 0 ? (level / max) * 100 : 0}%`);
  refs.sliceValue.textContent = String(level);
  refs.sliceMax.textContent = String(max);
}

/* ------------------------------------------------------------------ 性能徽章 */

const STAT_MODES = ["full", "min", "off"];

export class StatsBadge {
  constructor(refs) {
    this.refs = refs;
    this.mode = "full";
    this._t = 0;
    this._last = 0;
    refs.statBadge.addEventListener("click", () => this.cycle());
    this.apply();
  }

  cycle() {
    const i = STAT_MODES.indexOf(this.mode);
    this.mode = STAT_MODES[(i + 1) % STAT_MODES.length];
    this.apply();
  }

  apply() {
    const b = this.refs.statBadge;
    b.classList.toggle("is-min", this.mode === "min");
    b.classList.toggle("is-off", this.mode === "off");
    b.title = { full: "性能信息：点击切换为精简", min: "性能信息：点击隐藏", off: "性能信息：点击显示全部" }[this.mode];
  }

  update({ fps = 0, triangles = 0, blocks = 0, drawCalls = 0 } = {}) {
    const now = performance.now();
    if (now - this._last < 220) return; // 4~5 次/秒，避免布局抖动
    this._last = now;
    this.refs.statFps.textContent = String(Math.round(fps));
    this.refs.statTri.textContent = fmtInt(triangles);
    this.refs.statBlocks.textContent = fmtInt(blocks);
    this.refs.statCalls.textContent = String(drawCalls);
    this.refs.statFps.classList.toggle("low", fps < 30 && fps > 0);
  }
}

/* ------------------------------------------------------------------ 帮助弹窗 */

export function openHelp(refs, buildText) {
  refs.helpModal.hidden = false;
  if (buildText) refs.helpBuild.textContent = buildText;
  requestAnimationFrame(() => refs.helpModal.classList.add("is-open"));
}
export function closeHelp(refs) {
  if (refs.helpModal.hidden) return;
  refs.helpModal.classList.remove("is-open");
  setTimeout(() => { refs.helpModal.hidden = true; }, 160);
}
export function isHelpOpen(refs) {
  return !refs.helpModal.hidden;
}

/* ------------------------------------------------------------------ 拖放 */

export function setDragOverlay(refs, on) {
  refs.dragOverlay.hidden = !on;
  refs.root.classList.toggle("is-drag", on);
}

/* ------------------------------------------------------------------ 按钮状态 */

export function setPressed(btn, on) {
  if (!btn) return;
  btn.classList.toggle("is-on", !!on);
  btn.setAttribute("aria-pressed", on ? "true" : "false");
}
