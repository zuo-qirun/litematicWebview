// mcviewer —— 左栏「服务器投影」卡片（唯一契约：docs/API.md §4）
//
//   const library = createLibrary(container, { onOpen(project), onError(err, project?) });
//   await library.refresh();      // 拉取 POST /api/projects 列表（永不 throw，错误状态在卡片内展示）
//   library.setEnabled(false);    // 服务器功能不可用 → 卡片显示灰态说明
//   library.destroy();            // 卸载（清定时器 + 清空挂载点）
//
// 说明：
// - container 由 app-shell 提供，是一个空的 <section class="card">；本模块负责整张卡片的 DOM。
// - 服务器返回的文件名/作者等字符串一律走 textContent 上屏，禁止 innerHTML 插值（防 XSS）。
// - 这里还导出 createTokenPrompt / fmtRelTime / fmtAbsTime / fmtBytesCap，
//   供 packs.js 复用（同一套令牌提示与相对时间文案）。

import { h, fmtInt, fmtBytes } from "./dom.js";
import { icon } from "./icons.js";
import { api, ApiError } from "./api-client.js";

const UPLOAD_ACCEPT = ".litematic,.litematica";

/* ------------------------------------------------------------------ 格式化 */

const pad2 = (n) => String(n).padStart(2, "0");

/** ISO 时间 → 「刚刚 / 3 分钟前 / 2 小时前 / 3 天前 / 2026-10-20」 */
export function fmtRelTime(iso, now = Date.now()) {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const sec = Math.max(0, (now - t) / 1000);
  if (sec < 45) return "刚刚";
  if (sec < 3600) return `${Math.max(1, Math.round(sec / 60))} 分钟前`;
  if (sec < 86400) return `${Math.max(1, Math.round(sec / 3600))} 小时前`;
  if (sec < 86400 * 7) return `${Math.max(1, Math.round(sec / 86400))} 天前`;
  const d = new Date(t);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** ISO 时间 → 「2026-10-25 14:20」（tooltip 用） */
export function fmtAbsTime(iso) {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 容量：536870912 → 「512 MB」（比 fmtBytes 更适合展示上限） */
export function fmtBytesCap(n) {
  if (!Number.isFinite(n)) return "—";
  const trim = (v) => (Math.abs(v - Math.round(v)) < 0.049 ? String(Math.round(v)) : v.toFixed(1));
  if (n >= 1024 ** 3) return `${trim(n / 1024 ** 3)} GB`;
  if (n >= 1024 ** 2) return `${trim(n / 1024 ** 2)} MB`;
  if (n >= 1024) return `${trim(n / 1024)} KB`;
  return `${Math.round(n)} B`;
}

/* ------------------------------------------------------------------ 令牌提示（两卡片复用） */

/**
 * 服务器开启令牌保护且本地未填写时的内联提示条。
 * @param {{onSaved?: (token: string) => void}} [opts]
 */
export function createTokenPrompt(opts = {}) {
  const input = h("input", {
    class: "lib-token-input",
    type: "password",
    placeholder: "访问令牌",
    autocomplete: "off",
    spellcheck: "false",
    "aria-label": "服务器访问令牌",
  });
  const save = h("button", { class: "lib-token-save", type: "button", text: "保存" });
  const wrap = h(
    "div",
    { class: "lib-token" },
    icon("warning", "lib-token-ico"),
    h(
      "div",
      { class: "lib-token-body" },
      h("div", { class: "lib-token-title", text: "服务器需要访问令牌" }),
      h("div", { class: "lib-token-row" }, input, save)
    )
  );

  let invalidTimer = 0;
  const submit = () => {
    const value = input.value.trim();
    if (!value) {
      wrap.classList.add("is-invalid");
      clearTimeout(invalidTimer);
      invalidTimer = setTimeout(() => wrap.classList.remove("is-invalid"), 1000);
      input.focus();
      return;
    }
    api.setToken(value);
    input.value = "";
    save.disabled = true;
    save.textContent = "已保存";
    if (typeof opts.onSaved === "function") opts.onSaved(value);
  };
  save.addEventListener("click", submit);
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      submit();
    }
  });
  return wrap;
}

/* ------------------------------------------------------------------ 组件 */

/**
 * @param {HTMLElement} container 左栏里的一个空 <section class="card">
 * @param {{onOpen?: (project: object) => Promise<void>, onError?: (err: Error, project?: object) => void}} [hooks]
 * @returns {{refresh: (opts?: {force?: boolean, silent?: boolean}) => Promise<void>, setEnabled: (on: boolean) => void, destroy: () => void, getState: () => object}}
 */
export function createLibrary(container, hooks = {}) {
  if (!container) throw new Error("createLibrary(container, hooks)：container 不能为空");

  const state = {
    enabled: true,
    unavailable: false,
    initial: true,
    loading: false,
    items: [],
    storage: null,
    error: null,
    upload: null,
    busyId: "",
    loadedId: "",
    confirmId: "",
    deletingId: "",
    authRequired: false,
    tokenMissing: false,
    destroyed: false,
  };

  let inFlight = null;
  let confirmTimer = 0;
  let tokenSig = "";
  const els = {};

  build();
  update();

  // 令牌在任一面板保存后，另一张卡片同步解锁并刷新
  function onTokenChanged() {
    if (state.destroyed) return;
    state.tokenMissing = state.authRequired && !api.getToken();
    tokenSig = "";
    update();
    refresh({ force: true }).catch(() => {});
  }
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("mcviewer:token", onTokenChanged);
  }

  /* ---------------- 基础 DOM ---------------- */

  function build() {
    container.classList.add("lib-card");
    container.replaceChildren();

    els.count = h("span", { class: "pill-count", text: "0" });
    els.refresh = h(
      "button",
      { class: "iconbtn sm lib-refresh", type: "button", title: "刷新服务器投影", "aria-label": "刷新服务器投影列表" },
      icon("reset")
    );
    els.refresh.addEventListener("click", () => {
      refresh({ force: true }).catch(() => {});
    });

    els.head = h(
      "div",
      { class: "card-head" },
      h("h2", { text: "服务器投影" }),
      h("div", { class: "lib-head-right" }, els.count, els.refresh)
    );

    els.token = h("div", { class: "lib-token-slot" });

    els.input = h("input", { type: "file", accept: UPLOAD_ACCEPT, hidden: true, "aria-hidden": "true", tabindex: "-1" });
    els.input.addEventListener("change", () => {
      const file = els.input.files && els.input.files[0];
      els.input.value = "";
      if (file) startUpload(file);
    });

    els.upload = h(
      "button",
      { class: "lib-drop", type: "button", title: "上传 .litematic 并保存到服务器" },
      icon("drop"),
      h("span", { class: "lib-drop-text", text: "上传投影" }),
      h("span", { class: "lib-drop-sub", text: ".litematic" })
    );
    els.upload.addEventListener("click", () => {
      if (!els.upload.disabled) els.input.click();
    });

    els.progress = h("div", { class: "lib-progress-slot" });
    els.list = h("div", { class: "lib-list-slot" });
    els.foot = h("div", { class: "lib-foot" });

    els.body = h("div", { class: "lib-body" }, els.token, els.upload, els.input, els.progress, els.list, els.foot);
    container.append(els.head, els.body);
    container.hidden = false;
  }

  /* ---------------- 状态渲染 ---------------- */

  function update() {
    if (state.destroyed) return;
    const off = !state.enabled || state.unavailable;
    container.classList.toggle("is-off", off);
    container.classList.toggle("is-busy", state.loading);
    container.classList.toggle("is-uploading", Boolean(state.upload));

    els.count.hidden = off;
    els.count.textContent = String(state.items.length || 0);
    els.refresh.disabled = off || state.loading;
    els.refresh.classList.toggle("is-spinning", state.loading);
    els.upload.disabled = off || state.loading || Boolean(state.upload);
    els.upload.hidden = off;

    renderToken(off);
    renderProgress();
    renderList(off);
    renderFoot(off);
  }

  function renderToken(off) {
    const show = !off && state.authRequired && state.tokenMissing;
    const sig = show ? "on" : "off";
    if (sig === tokenSig) return;
    tokenSig = sig;
    if (!show) {
      els.token.replaceChildren();
      return;
    }
    els.token.replaceChildren(
      createTokenPrompt({
        onSaved: () => {
          state.tokenMissing = false;
          tokenSig = "";
          update();
          refresh({ force: true }).catch(() => {});
        },
      })
    );
  }

  function renderProgress() {
    const up = state.upload;
    els.progress.hidden = !up;
    if (!up) {
      els.progress.replaceChildren();
      return;
    }
    const pct = Math.max(0, Math.min(100, Math.round((up.uploaded || 0) * 100)));
    els.progress.replaceChildren(
      h(
        "div",
        { class: "lib-progress-head" },
        h("span", { class: "lib-progress-name", text: up.name, title: up.name }),
        h("b", { class: "lib-progress-pct", text: `${pct}%` })
      ),
      h("div", { class: "progress lib-progress-bar" }, h("span", { class: "progress-bar", style: { width: `${pct}%` } }))
    );
  }

  function renderList(off) {
    if (off) {
      els.list.replaceChildren(offlineBlock());
      return;
    }
    if (state.initial) {
      els.list.replaceChildren(
        h("div", { class: "lib-empty" }, h("span", { class: "spinner", "aria-hidden": "true" }), h("p", { class: "lib-empty-sub", text: "正在读取服务器…" }))
      );
      return;
    }
    // 令牌缺失时由内联提示条说明，不再重复弹错误条
    const showError = Boolean(state.error) && !(state.error.code === "UNAUTHORIZED" && state.tokenMissing);
    if (showError && !state.items.length) {
      els.list.replaceChildren(alertBlock(state.error));
      return;
    }
    if (!state.items.length) {
      // 令牌缺失时只保留内联提示条，不重复空态文案
      if (state.authRequired && state.tokenMissing) {
        els.list.replaceChildren();
        return;
      }
      els.list.replaceChildren(emptyBlock());
      return;
    }
    const list = h("div", { class: "lib-list", role: "list", "aria-label": "服务器投影列表" });
    for (const project of state.items) list.appendChild(row(project));
    els.list.replaceChildren(showError ? alertBlock(state.error) : document.createDocumentFragment(), list);
  }

  function renderFoot(off) {
    const st = state.storage;
    if (off || !state.items.length || !st) {
      els.foot.hidden = true;
      return;
    }
    els.foot.hidden = false;
    const parts = [`${state.items.length} 项`];
    if (Number.isFinite(st.bytes)) {
      const cap = Number.isFinite(st.maxBytes) ? ` / ${fmtBytesCap(st.maxBytes)}` : "";
      parts.push(`已用 ${fmtBytes(st.bytes)}${cap}`);
    } else if (Number.isFinite(st.maxCount)) {
      parts.push(`上限 ${st.maxCount}`);
    }
    els.foot.textContent = parts.join(" · ");
  }

  /* ---------------- 列表行 ---------------- */

  function row(project) {
    const busy = state.busyId === project.id;
    const active = state.loadedId === project.id;
    const confirming = state.confirmId === project.id;
    const deleting = state.deletingId === project.id;
    const name = project.name || "未命名投影";
    const blocks = Number(project.blocks);
    const blocksText = Number.isFinite(blocks) && blocks >= 0 ? `${fmtInt(blocks)} 方块` : "方块数未解析";
    const regions = Number(project.regions);
    const meta = h(
      "div",
      { class: "lib-meta" },
      h("span", { text: blocksText }),
      h("i", { class: "lib-sep" }, "·"),
      h("span", { text: fmtBytes(project.size) }),
      h("i", { class: "lib-sep" }, "·"),
      h("span", { text: fmtRelTime(project.createdAt) })
    );
    const main = h(
      "div",
      { class: "lib-row-main" },
      h("div", { class: "lib-name", text: name, title: name }),
      meta
    );

    const acts = h("div", { class: "lib-row-acts" });
    if (confirming) {
      const yes = h("button", { class: "lib-act is-danger", type: "button", title: "确认从服务器删除", text: "确认删除" });
      yes.addEventListener("click", (ev) => {
        ev.stopPropagation();
        remove(project);
      });
      const no = h("button", { class: "lib-act", type: "button", title: "取消删除", text: "取消" });
      no.addEventListener("click", (ev) => {
        ev.stopPropagation();
        cancelConfirm();
      });
      acts.append(yes, no);
    } else {
      if (typeof hooks.onOpen === "function") {
        const openBtn = h(
          "button",
          { class: "lib-act", type: "button", title: busy ? "正在加载…" : active ? "重新加载到视图" : "加载到视图" },
          busy ? h("span", { class: "spinner lib-act-spin", "aria-hidden": "true" }) : null,
          h("span", { text: busy ? "加载中" : active ? "重新加载" : "加载" })
        );
        openBtn.disabled = busy;
        openBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          openProject(project);
        });
        acts.appendChild(openBtn);
      }
      const del = h("button", { class: "lib-act is-danger", type: "button", title: "从服务器删除" }, h("span", { text: deleting ? "删除中" : "删除" }));
      del.disabled = deleting;
      del.addEventListener("click", (ev) => {
        ev.stopPropagation();
        askDelete(project.id);
      });
      acts.appendChild(del);
    }

    const rowEl = h(
      "div",
      { class: `lib-row${active ? " is-active" : ""}${confirming ? " is-confirming" : ""}`, role: "listitem", tabindex: "0" },
      main,
      acts
    );
    const details = [blocksText];
    if (Number.isFinite(regions) && regions >= 0) details.push(`${fmtInt(regions)} Region`);
    if (project.author) details.push(`作者 ${project.author}`);
    details.push(`上传于 ${fmtAbsTime(project.createdAt)}`);
    rowEl.title = details.join(" · ");
    if (typeof hooks.onOpen === "function") {
      rowEl.addEventListener("dblclick", () => openProject(project));
      rowEl.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          openProject(project);
        }
      });
    }
    return rowEl;
  }

  function emptyBlock() {
    if (typeof hooks.onOpen !== "function") {
      return h(
        "div",
        { class: "lib-empty lib-offline" },
        icon("info", "lib-empty-ico"),
        h("p", { class: "lib-empty-title", text: "服务器未启用" }),
        h("p", { class: "lib-empty-sub", text: "当前页面没有提供打开服务器投影的入口，投影只在本机解析。" })
      );
    }
    return h(
      "div",
      { class: "lib-empty" },
      icon("layers", "lib-empty-ico"),
      h("p", { class: "lib-empty-title", text: "还没有服务器投影" }),
      h("p", { class: "lib-empty-sub", text: "上传 .litematic 后保存在服务器，换台设备也能直接打开。" })
    );
  }

  function offlineBlock() {
    const retry = h("button", { class: "linkbtn lib-retry", type: "button" }, icon("reset"), h("span", { text: "重新检测" }));
    retry.addEventListener("click", () => {
      refresh({ force: true }).catch(() => {});
    });
    return h(
      "div",
      { class: "lib-empty lib-offline" },
      icon("info", "lib-empty-ico"),
      h("p", { class: "lib-empty-title", text: "服务器未连接" }),
      h("p", { class: "lib-empty-sub", text: "当前为纯本地模式，投影只在本机解析、不会上传。启动带服务器功能的 viewer 后即可在这里保存与打开投影。" }),
      retry
    );
  }

  function alertBlock(error) {
    const nodes = [
      icon("warning", "lib-alert-ico"),
      h(
        "div",
        { class: "lib-alert-body" },
        h("p", { class: "lib-alert-msg", text: error.message }),
        error.detail ? h("p", { class: "lib-alert-detail", text: error.detail }) : null
      ),
    ];
    if (error.retry) {
      const retry = h("button", { class: "linkbtn lib-retry", type: "button", text: "重试" });
      retry.addEventListener("click", () => {
        refresh({ force: true }).catch(() => {});
      });
      nodes.push(retry);
    }
    return h("div", { class: "lib-alert", role: "alert" }, ...nodes);
  }

  /* ---------------- 数据 ---------------- */

  function applyCaps() {
    const caps = api.caps || {};
    state.authRequired = caps.auth === true;
    state.tokenMissing = state.authRequired && !api.getToken();
  }

  async function ensureCaps(force = false) {
    if (api.caps && !force) {
      applyCaps();
      return;
    }
    try {
      await api.capabilities(force);
    } catch (err) {
      state.unavailable = true;
      throw err;
    }
    applyCaps();
  }

  async function refresh(opts = {}) {
    const force = opts.force === true;
    const silent = opts.silent === true;
    if (state.destroyed) return;
    if (!state.enabled && !force) return;
    if (inFlight) return inFlight;
    if (force) state.enabled = true;
    if (!silent) {
      state.loading = true;
      state.error = null;
    }
    update();

    inFlight = (async () => {
      try {
        await ensureCaps(force);
        const data = await api.listProjects();
        state.items = data.items;
        state.storage = data.storage;
        state.unavailable = false;
        state.error = null;
      } catch (err) {
        if (err instanceof ApiError && err.code === "UNAVAILABLE") {
          state.unavailable = true;
          state.error = null;
        } else if (err instanceof ApiError && err.code === "UNAUTHORIZED") {
          state.authRequired = true;
          state.tokenMissing = !api.getToken();
          state.error = describeError(err);
        } else {
          state.error = { ...describeError(err), retry: true };
        }
      } finally {
        state.initial = false;
        state.loading = false;
        inFlight = null;
        update();
      }
    })();
    return inFlight;
  }

  async function startUpload(file) {
    const maxBytes = Number(api.caps && api.caps.maxUploadBytes);
    if (Number.isFinite(maxBytes) && maxBytes > 0 && file.size > maxBytes) {
      state.error = {
        message: `「${file.name}」有 ${fmtBytes(file.size)}，超过服务器上限 ${fmtBytes(maxBytes)}`,
        detail: "请换一个更小的投影文件。",
      };
      update();
      return;
    }
    state.error = null;
    state.upload = { name: file.name || "未命名.litematic", uploaded: 0 };
    update();
    let failure = null;
    try {
      await api.uploadProject(file, (frac) => {
        if (!state.upload) return;
        state.upload.uploaded = frac;
        renderProgress();
      });
    } catch (err) {
      failure = err;
    }
    state.upload = null;
    if (failure) {
      state.error = describeError(failure);
      if (typeof hooks.onError === "function") hooks.onError(failure, undefined);
      update();
      return;
    }
    await refresh({ silent: true });
  }

  async function openProject(project) {
    if (typeof hooks.onOpen !== "function" || state.busyId) return;
    state.busyId = project.id;
    state.error = null;
    update();
    try {
      // 带上令牌的文件地址：app.js 里 fetch(project.url) 即可直接取到字节流
      await hooks.onOpen({ ...project, url: api.projectFileUrl(project.id) });
      state.loadedId = project.id;
    } catch (err) {
      state.error = describeError(err);
      if (typeof hooks.onError === "function") hooks.onError(err, project);
    } finally {
      state.busyId = "";
      update();
    }
  }

  function askDelete(id) {
    state.confirmId = id;
    clearTimeout(confirmTimer);
    confirmTimer = setTimeout(() => {
      if (state.destroyed) return;
      if (state.confirmId === id) {
        state.confirmId = "";
        update();
      }
    }, 5000);
    update();
  }

  function cancelConfirm() {
    clearTimeout(confirmTimer);
    confirmTimer = 0;
    if (state.confirmId) {
      state.confirmId = "";
      update();
    }
  }

  async function remove(project) {
    clearTimeout(confirmTimer);
    confirmTimer = 0;
    state.confirmId = "";
    state.deletingId = project.id;
    update();
    try {
      await api.deleteProject(project.id);
      if (state.loadedId === project.id) state.loadedId = "";
      state.items = state.items.filter((it) => it && it.id !== project.id);
      state.error = null;
      update();
      await refresh({ silent: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        state.items = state.items.filter((it) => it && it.id !== project.id);
        update();
        refresh({ silent: true }).catch(() => {});
      } else {
        state.error = describeError(err);
        if (typeof hooks.onError === "function") hooks.onError(err, project);
      }
    } finally {
      state.deletingId = "";
      update();
    }
  }

  /* ---------------- 对外 ---------------- */

  function setEnabled(on) {
    state.enabled = Boolean(on);
    if (state.enabled) {
      state.unavailable = false;
      state.error = null;
    }
    tokenSig = "";
    container.hidden = false;
    update();
  }

  function destroy() {
    state.destroyed = true;
    clearTimeout(confirmTimer);
    confirmTimer = 0;
    inFlight = null;
    if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
      window.removeEventListener("mcviewer:token", onTokenChanged);
    }
    container.classList.remove("lib-card", "is-off", "is-busy", "is-uploading");
    container.replaceChildren();
  }

  function getState() {
    return {
      enabled: state.enabled,
      unavailable: state.unavailable,
      loading: state.loading,
      initial: state.initial,
      error: state.error,
      upload: state.upload ? { ...state.upload } : null,
      loadedId: state.loadedId,
      authRequired: state.authRequired,
      tokenMissing: state.tokenMissing,
      items: state.items.slice(),
      storage: state.storage,
    };
  }

  return { refresh, setEnabled, destroy, getState };
}

/* ------------------------------------------------------------------ 错误文案 */

function describeError(err) {
  if (err instanceof ApiError) {
    const detail =
      err.code === "NETWORK"
        ? "请确认 viewer 服务仍在运行。"
        : err.code === "QUOTA_EXCEEDED"
          ? "可以先删除不再需要的条目。"
          : "";
    return { message: err.message || "请求失败", detail, code: err.code, status: err.status };
  }
  return { message: err && err.message ? String(err.message) : String(err || "未知错误"), detail: "" };
}
