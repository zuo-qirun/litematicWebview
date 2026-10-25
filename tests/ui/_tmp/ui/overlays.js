// src/ui/dom.js
var fmtInt = (n) => typeof n === "number" && Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "\u2014";

// src/ui/overlays.js
function setEmpty(refs, show) {
  refs.emptyState.hidden = !show;
}
function setError(refs, title, detail) {
  refs.errorState.hidden = false;
  refs.errorTitle.textContent = title || "\u65E0\u6CD5\u6253\u5F00\u6587\u4EF6";
  refs.errorDetail.textContent = detail || "";
}
function clearError(refs) {
  refs.errorState.hidden = true;
}
function startLoading(refs, title, fileName) {
  refs.loadingState.hidden = false;
  refs.loadingTitle.textContent = title || "\u6B63\u5728\u52A0\u8F7D\u6295\u5F71";
  refs.loadingFile.textContent = fileName || "";
  refs.loadingPhase.textContent = "\u51C6\u5907\u4E2D\u2026";
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
    }
  };
  return api;
}
function setSliceHud(refs, on, level = 0, max = 0) {
  refs.sliceHud.hidden = !on;
  if (!on) return;
  refs.sliceRange.max = String(Math.max(0, max));
  refs.sliceRange.value = String(Math.max(0, Math.min(level, max)));
  refs.sliceRange.style.setProperty("--p", `${max > 0 ? level / max * 100 : 0}%`);
  refs.sliceValue.textContent = String(level);
  refs.sliceMax.textContent = String(max);
}
var STAT_MODES = ["full", "min", "off"];
var StatsBadge = class {
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
    b.title = { full: "\u6027\u80FD\u4FE1\u606F\uFF1A\u70B9\u51FB\u5207\u6362\u4E3A\u7CBE\u7B80", min: "\u6027\u80FD\u4FE1\u606F\uFF1A\u70B9\u51FB\u9690\u85CF", off: "\u6027\u80FD\u4FE1\u606F\uFF1A\u70B9\u51FB\u663E\u793A\u5168\u90E8" }[this.mode];
  }
  update({ fps = 0, triangles = 0, blocks = 0, drawCalls = 0 } = {}) {
    const now = performance.now();
    if (now - this._last < 220) return;
    this._last = now;
    this.refs.statFps.textContent = String(Math.round(fps));
    this.refs.statTri.textContent = fmtInt(triangles);
    this.refs.statBlocks.textContent = fmtInt(blocks);
    this.refs.statCalls.textContent = String(drawCalls);
    this.refs.statFps.classList.toggle("low", fps < 30 && fps > 0);
  }
};
function openHelp(refs, buildText) {
  refs.helpModal.hidden = false;
  if (buildText) refs.helpBuild.textContent = buildText;
  requestAnimationFrame(() => refs.helpModal.classList.add("is-open"));
}
function closeHelp(refs) {
  if (refs.helpModal.hidden) return;
  refs.helpModal.classList.remove("is-open");
  setTimeout(() => {
    refs.helpModal.hidden = true;
  }, 160);
}
function isHelpOpen(refs) {
  return !refs.helpModal.hidden;
}
function setDragOverlay(refs, on) {
  refs.dragOverlay.hidden = !on;
  refs.root.classList.toggle("is-drag", on);
}
function setPressed(btn, on) {
  if (!btn) return;
  btn.classList.toggle("is-on", !!on);
  btn.setAttribute("aria-pressed", on ? "true" : "false");
}
export {
  StatsBadge,
  clearError,
  closeHelp,
  isHelpOpen,
  openHelp,
  setDragOverlay,
  setEmpty,
  setError,
  setPressed,
  setSliceHud,
  startLoading
};
