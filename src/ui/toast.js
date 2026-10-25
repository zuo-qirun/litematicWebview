// mcviewer —— 右下角 toast 通知

import { icon } from "./icons.js";

const KIND_ICON = {
  success: "check",
  error: "warning",
  warn: "warning",
  info: "info",
};

export class Toaster {
  constructor(container) {
    this.container = container;
    this.items = new Set();
  }

  show(kind, message, opts = {}) {
    const { detail = "", timeout } = opts;
    const el = document.createElement("div");
    el.className = `toast toast-${kind}`;
    el.setAttribute("role", kind === "error" ? "alert" : "status");
    const ic = icon(KIND_ICON[kind] || "info", "toast-ico");
    const body = document.createElement("div");
    body.className = "toast-body";
    const title = document.createElement("div");
    title.className = "toast-title";
    title.textContent = message;
    body.appendChild(title);
    if (detail) {
      const d = document.createElement("div");
      d.className = "toast-detail";
      d.textContent = detail;
      body.appendChild(d);
    }
    const close = document.createElement("button");
    close.className = "toast-close";
    close.type = "button";
    close.title = "关闭";
    close.setAttribute("aria-label", "关闭通知");
    close.innerHTML = "×";
    close.addEventListener("click", () => this.dismiss(el));
    el.append(ic, body, close);
    this.container.appendChild(el);
    this.items.add(el);
    requestAnimationFrame(() => el.classList.add("is-in"));
    const ms = timeout ?? (kind === "error" ? 6000 : kind === "warn" ? 4500 : 3000);
    if (ms > 0) setTimeout(() => this.dismiss(el), ms);
    // 最多同时 4 条
    while (this.items.size > 4) {
      const first = this.items.values().next().value;
      this.dismiss(first);
    }
    return el;
  }

  success(msg, detail) { return this.show("success", msg, { detail }); }
  error(msg, detail) { return this.show("error", msg, { detail }); }
  warn(msg, detail) { return this.show("warn", msg, { detail }); }
  info(msg, detail) { return this.show("info", msg, { detail }); }

  dismiss(el) {
    if (!el || !this.items.has(el)) return;
    this.items.delete(el);
    el.classList.remove("is-in");
    el.classList.add("is-out");
    setTimeout(() => el.remove(), 220);
  }
}
