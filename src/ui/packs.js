// mcviewer —— 左栏「材质包」卡片（唯一契约：docs/API.md §4）
//
//   const packs = createPackPanel(container, { onApply(pack), onClear(), onError(err, pack?) });
//   await packs.refresh();        // 拉取 GET /api/packs（永不 throw）
//   packs.setActive(packId);      // 应用成功后回填当前启用的材质包 id（null = 内置默认）
//   packs.setEnabled(false);      // 服务器功能不可用 → 灰态
//   packs.destroy();              // 卸载（清轮询定时器 + 清空挂载点）
//
// 烘焙状态机（queued → baking → ready / error）由服务端驱动：只要有 queued/baking
// 的条目，就每 2s 静默刷新一次列表，直到全部结束，不打扰用户。
// 所有服务端字符串（材质包名等）只通过 textContent 上屏，禁止 innerHTML 插值。

import { h, fmtInt, fmtBytes } from "./dom.js";
import { icon } from "./icons.js";
import { api, ApiError } from "./api-client.js";
import { createTokenPrompt, fmtRelTime, fmtAbsTime, fmtBytesCap } from "./library.js";

const PACK_ACCEPT = ".zip";
const POLL_MS = 2000;

const STATUS = {
  queued: { text: "排队中", cls: "is-queued" },
  baking: { text: "烘焙中", cls: "is-baking" },
  ready: { text: "就绪", cls: "is-ready" },
  error: { text: "失败", cls: "is-error" },
};

const isBaking = (p) => p && (p.status === "queued" || p.status === "baking");

/**
 * @param {HTMLElement} container 左栏里的一个空 <section class="card">
 * @param {{onApply?: (pack: object) => Promise<void>, onClear?: () => Promise<void>, onError?: (err: Error, pack?: object) => void}} [hooks]
 * @returns {{refresh: (opts?: {force?: boolean, silent?: boolean}) => Promise<void>, setEnabled: (on: boolean) => void, setActive: (id: string|null) => void, destroy: () => void, getState: () => object}}
 */
export function createPackPanel(container, hooks = {}) {
  if (!container) throw new Error("createPackPanel(container, hooks)：container 不能为空");

  const state = {
    enabled: true,
    unavailable: false,
    initial: true,
    loading: false,
    items: [],
    storage: null,
    activeId: "",
    error: null,
    upload: null,
    applyingId: "",
    clearing: false,
    confirmId: "",
    deletingId: "",
    authRequired: false,
    tokenMissing: false,
    destroyed: false,
    sig: "",
  };

  let inFlight = null;
  let pollTimer = 0;
  let confirmTimer = 0;
  let tokenSig = "";
  const els = {};
  let lastSig = "";

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
    container.classList.add("pack-card");
    container.replaceChildren();

    els.count = h("span", { class: "pill-count", text: "0" });
    els.refresh = h(
      "button",
      { class: "iconbtn sm pack-refresh", type: "button", title: "刷新材质包列表", "aria-label": "刷新材质包列表" },
      icon("reset")
    );
    els.refresh.addEventListener("click", () => {
      refresh({ force: true }).catch(() => {});
    });

    els.head = h(
      "div",
      { class: "card-head" },
      h("h2", { text: "材质包" }),
      h("div", { class: "pack-head-right" }, els.count, els.refresh)
    );

    // 「当前材质」摘要行
    els.currentName = h("b", { class: "pack-current-name", text: "内置默认" });
    els.currentClear = h("button", { class: "linkbtn pack-clear", type: "button", title: "恢复内置默认材质", text: "取消使用" });
    els.currentClear.addEventListener("click", clearActive);
    els.current = h(
      "div",
      { class: "pack-current" },
      icon("layers", "pack-current-ico"),
      h("span", { class: "pack-current-text" }, h("span", { class: "pack-current-label", text: "当前材质" }), els.currentName),
      els.currentClear
    );

    els.note = h("div", { class: "pack-note", hidden: true }, icon("warning", "pack-note-ico"), h("span", { text: "服务端缺少 Python 烘焙环境，暂时无法上传新材质包。" }));

    els.token = h("div", { class: "pack-token-slot" });

    els.input = h("input", { type: "file", accept: PACK_ACCEPT, hidden: true, "aria-hidden": "true", tabindex: "-1" });
    els.input.addEventListener("change", () => {
      const file = els.input.files && els.input.files[0];
      els.input.value = "";
      if (file) startUpload(file);
    });

    els.drop = h(
      "button",
      { class: "pack-drop", type: "button", title: "上传 .zip 资源包（服务端烘焙后生效）" },
      icon("drop"),
      h("span", { class: "pack-drop-text", text: "上传材质包" }),
      h("span", { class: "pack-drop-sub", text: ".zip" })
    );
    els.drop.addEventListener("click", () => {
      if (!els.drop.disabled) els.input.click();
    });
    for (const type of ["dragenter", "dragover"]) {
      els.drop.addEventListener(type, (ev) => {
        ev.preventDefault();
        if (!els.drop.disabled) els.drop.classList.add("is-over");
      });
    }
    for (const type of ["dragleave", "dragend"]) {
      els.drop.addEventListener(type, (ev) => {
        ev.preventDefault();
        els.drop.classList.remove("is-over");
      });
    }
    els.drop.addEventListener("drop", (ev) => {
      ev.preventDefault();
      els.drop.classList.remove("is-over");
      const file = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (file && !els.drop.disabled) startUpload(file);
    });

    els.progress = h("div", { class: "pack-progress-slot" });
    els.list = h("div", { class: "pack-list-slot" });
    els.foot = h("div", { class: "pack-foot" });

    els.body = h("div", { class: "pack-body" }, els.current, els.note, els.token, els.drop, els.input, els.progress, els.list, els.foot);
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

    const caps = api.caps || {};
    const supported = caps.packsSupported !== false;
    els.count.hidden = off;
    els.count.textContent = String(state.items.length || 0);
    els.refresh.disabled = off || state.loading;
    els.refresh.classList.toggle("is-spinning", state.loading);
    els.drop.disabled = off || state.loading || !supported || Boolean(state.upload);
    els.drop.hidden = off;
    els.note.hidden = off || supported;
    els.current.hidden = off;
    els.currentClear.hidden = !state.activeId || typeof hooks.onClear !== "function";

    renderToken(off);
    renderProgress();
    renderCurrent();
    renderList(off);
    renderFoot(off);
    syncPoll();
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
        { class: "pack-progress-head" },
        h("span", { class: "pack-progress-name", text: up.name, title: up.name }),
        h("b", { class: "pack-progress-pct", text: `${pct}%` })
      ),
      h("div", { class: "progress pack-progress-bar" }, h("span", { class: "progress-bar", style: { width: `${pct}%` } }))
    );
  }

  function renderCurrent() {
    const active = state.items.find((p) => p && p.id === state.activeId) || null;
    els.currentName.textContent = active ? active.name || "未命名材质包" : "内置默认";
    els.currentName.title = active ? active.name || "" : "使用 viewer 内置的默认材质";
    els.current.classList.toggle("is-builtin", !active);
    els.current.classList.toggle("is-baking", Boolean(active && isBaking(active)));
  }

  function renderList(off) {
    if (off) {
      els.list.replaceChildren(offlineBlock());
      return;
    }
    if (state.initial) {
      els.list.replaceChildren(
        h("div", { class: "pack-empty" }, h("span", { class: "spinner", "aria-hidden": "true" }), h("p", { class: "pack-empty-sub", text: "正在读取材质包…" }))
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
    const list = h("div", { class: "pack-list", role: "list", "aria-label": "材质包列表" });
    for (const pack of state.items) list.appendChild(row(pack));
    els.list.replaceChildren(showError ? alertBlock(state.error) : document.createDocumentFragment(), list);
  }

  function renderFoot(off) {
    const st = state.storage;
    if (off || !state.items.length) {
      els.foot.hidden = true;
      return;
    }
    els.foot.hidden = false;
    const parts = [`${state.items.length} 个`];
    if (st && Number.isFinite(st.bytes)) {
      const cap = Number.isFinite(st.maxBytes) ? ` / ${fmtBytesCap(st.maxBytes)}` : "";
      parts.push(`已用 ${fmtBytes(st.bytes)}${cap}`);
    } else {
      const maxCount = Number(api.caps && api.caps.limits && api.caps.limits.packs);
      if (Number.isFinite(maxCount)) parts.push(`上限 ${maxCount}`);
    }
    els.foot.textContent = parts.join(" · ");
  }

  /* ---------------- 列表行 ---------------- */

  function row(pack) {
    const active = pack.id === state.activeId;
    const applying = state.applyingId === pack.id;
    const confirming = state.confirmId === pack.id;
    const deleting = state.deletingId === pack.id;
    const name = pack.name || "未命名材质包";
    const overrides = Number(pack.stats && pack.stats.overrides);
    const metaParts = [];
    metaParts.push(Number.isFinite(overrides) && overrides >= 0 ? `${fmtInt(overrides)} 覆盖` : "覆盖数未知");
    metaParts.push(fmtBytes(pack.size));
    metaParts.push(fmtRelTime(pack.createdAt));
    const meta = h("div", { class: "pack-meta" });
    metaParts.forEach((part, i) => {
      if (i) meta.appendChild(h("i", { class: "pack-sep" }, "·"));
      meta.appendChild(h("span", { text: part }));
    });

    const status = STATUS[pack.status] || { text: String(pack.status || "未知"), cls: "" };
    const pct = Math.round(Math.max(0, Math.min(1, Number(pack.progress))) * 100);
    const badge = h(
      "span",
      { class: `pack-badge ${status.cls}` },
      h("span", { text: pack.status === "baking" ? `${status.text} ${pct}%` : status.text })
    );

    const main = h(
      "div",
      { class: "pack-row-main" },
      h("div", { class: "pack-name-line" }, h("div", { class: "pack-name", text: name, title: name }), badge),
      meta,
      isBaking(pack)
        ? h("div", { class: "pack-bar", title: `烘焙进度 ${pct}%` }, h("span", { style: { width: `${pct}%` } }))
        : null
    );

    const acts = h("div", { class: "pack-row-acts" });
    if (confirming) {
      const yes = h("button", { class: "pack-act is-danger", type: "button", title: "确认从服务器删除", text: "确认删除" });
      yes.addEventListener("click", (ev) => {
        ev.stopPropagation();
        remove(pack);
      });
      const no = h("button", { class: "pack-act", type: "button", title: "取消删除", text: "取消" });
      no.addEventListener("click", (ev) => {
        ev.stopPropagation();
        cancelConfirm();
      });
      acts.append(yes, no);
    } else {
      if (typeof hooks.onApply === "function") {
        const use = h(
          "button",
          { class: "pack-act", type: "button", title: active ? "已在使用（点击可重新应用）" : pack.status !== "ready" ? "烘焙完成后才可启用" : "启用这个材质包" },
          h("span", { text: applying ? "应用中" : active ? "已启用" : "使用" })
        );
        use.disabled = applying || pack.status !== "ready";
        use.classList.toggle("is-on", active);
        use.addEventListener("click", (ev) => {
          ev.stopPropagation();
          applyPack(pack);
        });
        acts.appendChild(use);
      }
      if (active && typeof hooks.onClear === "function") {
        const off = h("button", { class: "pack-act", type: "button", title: "恢复内置默认材质", text: state.clearing ? "还原中" : "取消使用" });
        off.disabled = state.clearing;
        off.addEventListener("click", (ev) => {
          ev.stopPropagation();
          clearActive();
        });
        acts.appendChild(off);
      }
      const del = h("button", { class: "pack-act is-danger", type: "button", title: "从服务器删除" }, h("span", { class: "pack-act-ico" }, icon("close")), h("span", { text: deleting ? "删除中" : "删除" }));
      del.disabled = deleting;
      del.addEventListener("click", (ev) => {
        ev.stopPropagation();
        askDelete(pack.id);
      });
      acts.appendChild(del);
    }

    const rowEl = h(
      "div",
      {
        class: `pack-row${active ? " is-active" : ""}${confirming ? " is-confirming" : ""}${isBaking(pack) ? " is-baking" : ""}${pack.status === "error" ? " is-error" : ""}`,
        role: "listitem",
        tabindex: "0",
      },
      main,
      acts
    );
    const details = [];
    if (pack.stats) {
      if (Number.isFinite(Number(pack.stats.blocks))) details.push(`${fmtInt(Number(pack.stats.blocks))} 方块`);
      if (Number.isFinite(Number(pack.stats.models))) details.push(`${fmtInt(Number(pack.stats.models))} 模型`);
      if (Number.isFinite(Number(pack.stats.textures))) details.push(`${fmtInt(Number(pack.stats.textures))} 贴图`);
      if (Number.isFinite(overrides)) details.push(`${fmtInt(overrides)} 覆盖`);
    }
    if (pack.message) details.push(String(pack.message));
    details.push(`上传于 ${fmtAbsTime(pack.createdAt)}`);
    rowEl.title = details.join(" · ");
    return rowEl;
  }

  function emptyBlock() {
    return h(
      "div",
      { class: "pack-empty" },
      icon("layers", "pack-empty-ico"),
      h("p", { class: "pack-empty-title", text: "还没有材质包" }),
      h("p", { class: "pack-empty-sub", text: "上传 .zip 资源包，服务端会把它叠加到内置资产上烘焙，完成后点「使用」即可生效。" })
    );
  }

  function offlineBlock() {
    const retry = h("button", { class: "linkbtn pack-retry", type: "button" }, icon("reset"), h("span", { text: "重新检测" }));
    retry.addEventListener("click", () => {
      refresh({ force: true }).catch(() => {});
    });
    return h(
      "div",
      { class: "pack-empty pack-offline" },
      icon("info", "pack-empty-ico"),
      h("p", { class: "pack-empty-title", text: "服务器未连接" }),
      h("p", { class: "pack-empty-sub", text: "材质包需要服务端烘焙环境。启动带服务器功能的 viewer 后即可上传并启用自定义材质。" }),
      retry
    );
  }

  function alertBlock(error) {
    const nodes = [
      icon("warning", "pack-alert-ico"),
      h(
        "div",
        { class: "pack-alert-body" },
        h("p", { class: "pack-alert-msg", text: error.message }),
        error.detail ? h("p", { class: "pack-alert-detail", text: error.detail }) : null
      ),
    ];
    if (error.retry) {
      const retry = h("button", { class: "linkbtn pack-retry", type: "button", text: "重试" });
      retry.addEventListener("click", () => {
        refresh({ force: true }).catch(() => {});
      });
      nodes.push(retry);
    }
    return h("div", { class: "pack-alert", role: "alert" }, ...nodes);
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
    const fromPoll = opts.fromPoll === true;
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
        const data = await api.listPacks();
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
        const sig = listSig();
        // 轮询命中「内容没变」时跳过整表重绘，避免 hover 状态每 2s 被重置
        if (fromPoll && sig === lastSig && !state.error) {
          syncPoll();
        } else {
          lastSig = sig;
          update();
        }
      }
    })();
    return inFlight;
  }

  function listSig() {
    return state.items
      .map((p) => [p.id, p.name, p.status, p.progress, p.size, p.assetsUrl, p.stats && p.stats.overrides].join("|"))
      .join(";");
  }

  async function startUpload(file) {
    if (typeof file.name === "string" && !/\.zip$/i.test(file.name)) {
      state.error = { message: `「${file.name}」不是 .zip 资源包`, detail: "材质包必须是 Minecraft Java 版资源包 zip。" };
      update();
      return;
    }
    const maxBytes = Number(api.caps && api.caps.maxUploadBytes);
    if (Number.isFinite(maxBytes) && maxBytes > 0 && file.size > maxBytes) {
      state.error = {
        message: `「${file.name}」有 ${fmtBytes(file.size)}，超过服务器上限 ${fmtBytes(maxBytes)}`,
        detail: "请精简资源包后再上传。",
      };
      update();
      return;
    }
    state.error = null;
    state.upload = { name: file.name || "未命名材质包.zip", uploaded: 0 };
    update();
    let failure = null;
    try {
      await api.uploadPack(file, (frac) => {
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

  async function applyPack(pack) {
    if (typeof hooks.onApply !== "function" || state.applyingId) return;
    if (pack.status !== "ready") return;
    state.applyingId = pack.id;
    state.error = null;
    update();
    try {
      // 克隆并补一个 url 字段，和 docs/API.md §5 的 applyPack(pack) 用法保持一致
      await hooks.onApply({ ...pack, url: pack.assetsUrl });
      state.activeId = pack.id;
    } catch (err) {
      state.error = describeError(err);
      if (typeof hooks.onError === "function") hooks.onError(err, pack);
    } finally {
      state.applyingId = "";
      update();
    }
  }

  async function clearActive() {
    if (typeof hooks.onClear !== "function" || state.clearing) return;
    state.clearing = true;
    update();
    try {
      await hooks.onClear();
      state.activeId = "";
    } catch (err) {
      state.error = describeError(err);
      if (typeof hooks.onError === "function") hooks.onError(err, undefined);
    } finally {
      state.clearing = false;
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

  async function remove(pack) {
    clearTimeout(confirmTimer);
    confirmTimer = 0;
    state.confirmId = "";
    state.deletingId = pack.id;
    update();
    try {
      await api.deletePack(pack.id);
      state.items = state.items.filter((it) => it && it.id !== pack.id);
      if (state.activeId === pack.id) {
        state.activeId = "";
        if (typeof hooks.onClear === "function") {
          try {
            await hooks.onClear();
          } catch (err) {
            if (typeof hooks.onError === "function") hooks.onError(err, pack);
          }
        }
      }
      state.error = null;
      update();
      await refresh({ silent: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        state.items = state.items.filter((it) => it && it.id !== pack.id);
        if (state.activeId === pack.id) state.activeId = "";
        update();
        refresh({ silent: true }).catch(() => {});
      } else {
        state.error = describeError(err);
        if (typeof hooks.onError === "function") hooks.onError(err, pack);
      }
    } finally {
      state.deletingId = "";
      update();
    }
  }

  function syncPoll() {
    if (state.destroyed) return;
    const should = state.enabled && !state.unavailable && !state.upload && state.items.some(isBaking);
    if (should && !pollTimer) {
      pollTimer = setTimeout(() => {
        pollTimer = 0;
        refresh({ silent: true, fromPoll: true }).catch(() => {});
      }, POLL_MS);
    } else if (!should && pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = 0;
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

  function setActive(packId) {
    state.activeId = packId ? String(packId) : "";
    update();
  }

  function destroy() {
    state.destroyed = true;
    clearTimeout(pollTimer);
    clearTimeout(confirmTimer);
    pollTimer = 0;
    confirmTimer = 0;
    inFlight = null;
    if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
      window.removeEventListener("mcviewer:token", onTokenChanged);
    }
    container.classList.remove("pack-card", "is-off", "is-busy", "is-uploading");
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
      applyingId: state.applyingId,
      clearing: state.clearing,
      activeId: state.activeId,
      authRequired: state.authRequired,
      tokenMissing: state.tokenMissing,
      items: state.items.slice(),
      storage: state.storage,
    };
  }

  return { refresh, setEnabled, setActive, destroy, getState };
}

/* ------------------------------------------------------------------ 错误文案 */

function describeError(err) {
  if (err instanceof ApiError) {
    const detail =
      err.code === "NETWORK"
        ? "请确认 viewer 服务仍在运行。"
        : err.code === "INVALID_PACK"
          ? "资源包需要包含 pack.mcmeta 与 assets/ 目录。"
          : err.code === "QUOTA_EXCEEDED"
            ? "可以先删除不再需要的材质包或投影。"
            : "";
    return { message: err.message || "请求失败", detail, code: err.code, status: err.status };
  }
  return { message: err && err.message ? String(err.message) : String(err || "未知错误"), detail: "" };
}
