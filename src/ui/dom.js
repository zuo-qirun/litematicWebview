// mcviewer —— 极简 DOM 工具（不引入任何框架）

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "html") el.innerHTML = v;
      else if (k === "text") el.textContent = v;
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "dataset" && typeof v === "object") Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? "" : String(v));
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return el;
}

/** 只接受可信的静态 SVG 字符串 */
export function svg(markup, className) {
  const wrap = document.createElement("span");
  wrap.className = className || "svg-wrap";
  wrap.innerHTML = markup;
  return wrap.firstElementChild || wrap;
}

export const fmtInt = (n) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "—");

export function fmtBytes(n) {
  if (!Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function fmtSize(s) {
  if (!s) return "—";
  return `${s.x ?? s[0] ?? "?"} × ${s.y ?? s[1] ?? "?"} × ${s.z ?? s[2] ?? "?"}`;
}

/** [r,g,b]（0..1 或 0..255）→ css 颜色 */
export function rgbCss(c) {
  if (!c) return "#3a4455";
  const arr = Array.isArray(c) ? c : [c.r, c.g, c.b];
  const norm = arr.map((v) => (v > 1.0001 ? v / 255 : v));
  const [r, g, b] = norm.map((v) => Math.max(0, Math.min(255, Math.round(v * 255))));
  return `rgb(${r} ${g} ${b})`;
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function debounce(fn, ms) {
  let t = 0;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      return true;
    } catch (e2) {
      return false;
    }
  }
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
