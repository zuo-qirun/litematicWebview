// mcviewer —— 内联 SVG 图标集（不引入任何外部图标库）
// 统一 16×16 viewBox、stroke 1.4、无填充，靠 currentColor 继承颜色。

const wrap = (body, extra = "") =>
  `<svg class="ico" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;

export const icons = {
  cube: wrap('<path d="M8 1.7 13.4 4.6v6.8L8 14.3 2.6 11.4V4.6Z"/><path d="M2.6 4.6 8 7.5l5.4-2.9"/><path d="M8 7.5v6.8"/>'),
  cubeSolid: wrap('<path d="M8 1.7 13.4 4.6v6.8L8 14.3 2.6 11.4V4.6Z" fill="currentColor" fill-opacity=".16"/><path d="M2.6 4.6 8 7.5l5.4-2.9"/><path d="M8 7.5v6.8"/>'),
  layers: wrap('<path d="M8 2.2 2.6 5 8 7.8 13.4 5Z"/><path d="M2.6 8 8 10.8 13.4 8"/><path d="M2.6 11 8 13.8 13.4 11"/>'),
  slice: wrap('<path d="M8 2.2 2.6 5 8 7.8 13.4 5Z"/><path d="M2.6 8 8 10.8 13.4 8"/><path d="M2.6 12h10.8"/>'),
  grid: wrap('<path d="M2.4 2.4h11.2v11.2H2.4Z"/><path d="M6.1 2.4v11.2M9.9 2.4v11.2M2.4 6.1h11.2M2.4 9.9h11.2"/>'),
  wire: wrap('<path d="M8 1.7 13.4 4.6v6.8L8 14.3 2.6 11.4V4.6Z"/><path d="M2.6 4.6 8 7.5l5.4-2.9M2.6 11.4 8 8.4l5.4 3M8 7.5v6.8"/>'),
  viewIso: wrap('<path d="M8 2.6 13 5.3v5.4L8 13.4 3 10.7V5.3Z"/><path d="M3 5.3 8 8l5-2.7"/>'),
  viewTop: wrap('<path d="M3 4.2 8 2.4l5 1.8-5 1.8Z"/><path d="M3 9.4 8 7.6l5 1.8-5 1.8Z"/>'),
  viewFront: wrap('<path d="M3 3.2h10v9.6H3Z"/><path d="M3 8.8h10"/>'),
  viewSide: wrap('<path d="M4.6 3.2h6.8v9.6H4.6Z"/><path d="M8 3.2v9.6"/>'),
  camera: wrap('<path d="M2.4 5.6h2.9l1-1.7h3.4l1 1.7h2.9v7.2H2.4Z"/><circle cx="8" cy="9.1" r="2.2"/>'),
  fullscreen: wrap('<path d="M6.2 2.6H2.6v3.6M9.8 2.6h3.6v3.6M6.2 13.4H2.6V9.8M9.8 13.4h3.6V9.8"/>'),
  help: wrap('<circle cx="8" cy="8" r="5.7"/><path d="M6.3 6.2a1.75 1.75 0 1 1 2.3 1.66c-.4.15-.6.5-.6.93v.3"/><path d="M8 11.6h.01"/>'),
  folder: wrap('<path d="M2.4 4.2h4l1.2 1.6h6v7H2.4Z"/>'),
  file: wrap('<path d="M4.2 2.6h5l2.6 2.6v8.2H4.2Z"/><path d="M9.2 2.6v2.6h2.6"/>'),
  search: wrap('<circle cx="7.2" cy="7.2" r="3.9"/><path d="M10.1 10.1 13.4 13.4"/>'),
  close: wrap('<path d="M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8"/>'),
  chevronDown: wrap('<path d="M4.4 6.2 8 9.8l3.6-3.6"/>'),
  chevronRight: wrap('<path d="M6.2 4.4 9.8 8l-3.6 3.6"/>'),
  chevronLeft: wrap('<path d="M9.8 4.4 6.2 8l3.6 3.6"/>'),
  reset: wrap('<path d="M3.1 7.4a4.9 4.9 0 1 1 1.5 4"/><path d="M3 3.2v3.4h3.4"/>'),
  copy: wrap('<path d="M5.6 5.6h7.8v7.8H5.6Z"/><path d="M10.4 5.6V2.6H2.6v7.8h3"/>'),
  warning: wrap('<path d="M8 2.6 14 13H2Z"/><path d="M8 6.4v3.2"/><path d="M8 11.6h.01"/>'),
  check: wrap('<path d="M3.4 8.4 6.4 11.4 12.6 4.8"/>'),
  drop: wrap('<path d="M8 2.6v6.6"/><path d="M5.2 6.8 8 9.6l2.8-2.8"/><path d="M2.6 11.4v2h10.8v-2"/>'),
  target: wrap('<circle cx="8" cy="8" r="4.6"/><circle cx="8" cy="8" r="1.2"/><path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2"/>'),
  sun: wrap('<circle cx="8" cy="8" r="2.8"/><path d="M8 1.6v1.6M8 12.8v1.6M1.6 8h1.6M12.8 8h1.6M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1"/>'),
  info: wrap('<circle cx="8" cy="8" r="5.7"/><path d="M8 7.4v4"/><path d="M8 4.9h.01"/>'),
  bolt: wrap('<path d="M8.8 1.8 4.4 8.6h3.3l-1.1 5.6 4.6-7.1H8.1Z"/>'),
  eye: wrap('<path d="M1.8 8S4.2 4.2 8 4.2 14.2 8 14.2 8 11.8 11.8 8 11.8 1.8 8 1.8 8Z"/><circle cx="8" cy="8" r="1.7"/>'),
  eyeOff: wrap('<path d="M2.6 8s2.3-3.4 5.4-3.4c.9 0 1.7.2 2.4.6"/><path d="M13.4 8s-2.3 3.4-5.4 3.4c-.9 0-1.7-.2-2.4-.6"/><path d="M2.8 13.2 13.2 2.8"/>'),
};

/** 把 icon 名转成 DOM 节点 */
export function icon(name, cls = "ico") {
  const s = icons[name];
  if (!s) return document.createTextNode("");
  const el = document.createElement("span");
  el.className = cls;
  el.innerHTML = s;
  return el;
}
