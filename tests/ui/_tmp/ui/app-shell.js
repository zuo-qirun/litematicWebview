// src/ui/icons.js
var wrap = (body, extra = "") => `<svg class="ico" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;
var icons = {
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
  eyeOff: wrap('<path d="M2.6 8s2.3-3.4 5.4-3.4c.9 0 1.7.2 2.4.6"/><path d="M13.4 8s-2.3 3.4-5.4 3.4c-.9 0-1.7-.2-2.4-.6"/><path d="M2.8 13.2 13.2 2.8"/>')
};

// src/ui/app-shell.js
var tpl = (s) => s.replace(/\s+/g, " ").trim();
function buildShell(root) {
  root.innerHTML = tpl(`
    <header class="topbar" id="topbar">
      <div class="tb-left">
        <a class="brand" href="./" title="\u6295\u5F71\u67E5\u770B\u5668">
          <span class="brand-mark">${icons.cubeSolid}</span>
          <span class="brand-text">\u6295\u5F71\u67E5\u770B\u5668</span>
        </a>
        <div class="filechip" id="fileChip">
          <span class="filechip-name" id="fileChipName">\u672A\u6253\u5F00\u6587\u4EF6</span>
          <span class="filechip-meta" id="fileChipMeta"></span>
        </div>
      </div>

      <div class="tb-center">
        <div class="seg" role="group" aria-label="\u89C6\u89D2\u9884\u8BBE">
          <button class="seg-btn is-on" type="button" data-view="iso" title="\u7B49\u8DDD\u89C6\u89D2 (1)" aria-label="\u7B49\u8DDD\u89C6\u89D2">${icons.viewIso}<span>\u7B49\u8DDD</span></button>
          <button class="seg-btn" type="button" data-view="top" title="\u4FEF\u89C6 (2)" aria-label="\u4FEF\u89C6">${icons.viewTop}<span>\u4FEF\u89C6</span></button>
          <button class="seg-btn" type="button" data-view="front" title="\u6B63\u524D (3)" aria-label="\u6B63\u524D\u89C6\u89D2">${icons.viewFront}<span>\u6B63\u524D</span></button>
          <button class="seg-btn" type="button" data-view="side" title="\u6B63\u4FA7 (4)" aria-label="\u6B63\u4FA7\u89C6\u89D2">${icons.viewSide}<span>\u6B63\u4FA7</span></button>
        </div>
        <span class="tb-sep" aria-hidden="true"></span>
        <button class="tbtn" type="button" data-act="slice" aria-pressed="false" title="\u6309\u5C42\u5207\u7247 ( [ / ] )">${icons.slice}<span>\u5207\u7247</span></button>
        <button class="tbtn is-on" type="button" data-act="grid" aria-pressed="true" title="\u663E\u793A\u7F51\u683C (G)">${icons.grid}<span>\u7F51\u683C</span></button>
        <button class="tbtn" type="button" data-act="wire" aria-pressed="false" title="\u7EBF\u6846\u6A21\u5F0F (X)">${icons.wire}<span>\u7EBF\u6846</span></button>
      </div>

      <div class="tb-right">
        <button class="btn btn-primary" type="button" data-act="open" title="\u6253\u5F00 .litematic \u6587\u4EF6 (O)">${icons.folder}<span>\u6253\u5F00\u6587\u4EF6</span></button>
        <button class="iconbtn" type="button" data-act="shot" title="\u5BFC\u51FA PNG \u622A\u56FE" aria-label="\u5BFC\u51FA\u622A\u56FE">${icons.camera}</button>
        <button class="iconbtn" type="button" data-act="full" title="\u5168\u5C4F (F)" aria-label="\u5168\u5C4F">${icons.fullscreen}</button>
        <button class="iconbtn" type="button" data-act="help" title="\u5E2E\u52A9\u4E0E\u5FEB\u6377\u952E" aria-label="\u5E2E\u52A9">${icons.help}</button>
      </div>
    </header>

    <div class="layout" id="layout">
      <aside class="rail rail-left" id="leftRail" aria-label="\u6587\u4EF6\u4E0E\u56FE\u4F8B">
        <section class="card">
          <div class="card-head">
            <h2>\u6587\u4EF6</h2>
            <button class="linkbtn" type="button" id="resetViewBtn" title="\u6846\u4F4F\u6574\u4E2A\u6295\u5F71\u5E76\u590D\u4F4D\u89C6\u89D2">${icons.reset}<span>\u590D\u4F4D\u89C6\u89D2</span></button>
          </div>
          <div class="filecard" id="fileCardBody">
            <div class="filecard-empty">
              <p>\u5C1A\u672A\u6253\u5F00\u6587\u4EF6</p>
              <p class="muted">\u62D6\u5165 .litematic\uFF0C\u6216\u70B9\u51FB\u300C\u6253\u5F00\u793A\u4F8B\u300D</p>
            </div>
          </div>
        </section>

        <section class="card card-regions">
          <div class="card-head">
            <h2>Region</h2>
            <span class="pill-count" id="regionCount">0</span>
          </div>
          <div class="region-list" id="regionList">
            <div class="list-empty">\u6253\u5F00\u6587\u4EF6\u540E\u663E\u793A Region \u5217\u8868</div>
          </div>
        </section>

        <section class="card card-legend">
          <div class="card-head">
            <h2>\u65B9\u5757\u56FE\u4F8B</h2>
            <span class="pill-count" id="legendCount">0</span>
          </div>
          <label class="search">
            ${icons.search}
            <input id="legendSearch" type="search" placeholder="\u641C\u7D22\u65B9\u5757\u540D\u6216 id" aria-label="\u641C\u7D22\u65B9\u5757" autocomplete="off" spellcheck="false">
          </label>
          <div class="legend-list" id="legendList">
            <div class="list-empty">\u6253\u5F00\u6587\u4EF6\u540E\u6309\u6570\u91CF\u6392\u5E8F\u663E\u793A</div>
          </div>
        </section>
      </aside>

      <main class="stage" id="stage">
        <canvas id="glcanvas" class="glcanvas" tabindex="0" aria-label="3D \u6295\u5F71\u89C6\u56FE"></canvas>

        <div class="stage-empty" id="emptyState">
          <div class="empty-bg" aria-hidden="true"></div>
          <div class="empty-card">
            <div class="empty-art" aria-hidden="true">
              ${icons.cube}
              <span class="empty-art-drop">${icons.drop}</span>
            </div>
            <h1>\u628A .litematic \u62D6\u5230\u8FD9\u91CC</h1>
            <p class="empty-sub">\u6216\u8005\u4ECE\u672C\u5730\u9009\u62E9\u6587\u4EF6\u3002\u89E3\u6790\u548C\u6E32\u67D3\u5168\u90E8\u5728\u6D4F\u89C8\u5668\u5185\u5B8C\u6210\uFF0C\u6587\u4EF6\u4E0D\u4F1A\u4E0A\u4F20\u5230\u4EFB\u4F55\u670D\u52A1\u5668\u3002</p>
            <div class="empty-actions">
              <button class="btn btn-primary btn-lg" type="button" data-act="open">${icons.folder}<span>\u9009\u62E9\u6587\u4EF6</span></button>
              <button class="btn btn-ghost btn-lg" type="button" data-act="sample">${icons.bolt}<span>\u6253\u5F00\u793A\u4F8B</span></button>
            </div>
            <div class="empty-foot">\u652F\u6301 Litematica \u6295\u5F71\uFF08.litematic\uFF09\xB7 \u65E0\u9700\u542F\u52A8 Minecraft \xB7 \u7EAF\u672C\u5730\u89E3\u6790</div>
          </div>
        </div>

        <div class="stage-loading" id="loadingState" hidden>
          <div class="loading-card">
            <div class="loading-head">
              <span class="spinner" aria-hidden="true"></span>
              <span class="loading-title" id="loadingTitle">\u6B63\u5728\u52A0\u8F7D</span>
            </div>
            <div class="loading-phase" id="loadingPhase">\u51C6\u5907\u4E2D\u2026</div>
            <div class="progress"><span class="progress-bar" id="loadingBar"></span></div>
            <div class="loading-foot"><span class="muted" id="loadingFile"></span><b id="loadingPct">0%</b></div>
          </div>
        </div>

        <div class="stage-error" id="errorState" hidden>
          <div class="error-card">
            <div class="error-ico">${icons.warning}</div>
            <h2 id="errorTitle">\u65E0\u6CD5\u6253\u5F00\u6587\u4EF6</h2>
            <p id="errorDetail"></p>
            <div class="empty-actions">
              <button class="btn" type="button" data-act="open">\u6362\u4E00\u4E2A\u6587\u4EF6</button>
              <button class="btn btn-ghost" type="button" data-act="sample">\u6253\u5F00\u793A\u4F8B</button>
            </div>
          </div>
        </div>

        <div class="slice-hud" id="sliceHud" hidden>
          <span class="slice-label">${icons.slice}<span>\u5C42\u5207\u7247</span></span>
          <input class="slice-range" id="sliceRange" type="range" min="0" max="0" value="0" step="1" aria-label="\u5207\u7247\u5C42\u9AD8">
          <span class="slice-value"><b id="sliceValue">0</b><span class="muted">/<span id="sliceMax">0</span></span></span>
          <button class="iconbtn sm" type="button" data-act="slice-off" title="\u5173\u95ED\u5207\u7247" aria-label="\u5173\u95ED\u5207\u7247">${icons.close}</button>
        </div>

        <div class="hint-bar" id="hintBar">
          <span class="hint"><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd> \u89C6\u89D2</span>
          <span class="hint"><kbd>[</kbd><kbd>]</kbd> \u5207\u7247</span>
          <span class="hint"><kbd>F</kbd> \u5168\u5C4F</span>
          <span class="hint"><kbd>O</kbd> \u6253\u5F00</span>
          <span class="hint hint-drag">\u62D6\u5165\u6587\u4EF6\u5373\u53EF\u6253\u5F00</span>
        </div>

        <button class="stat-badge" id="statBadge" type="button" title="\u70B9\u51FB\u5207\u6362\u6027\u80FD\u663E\u793A\uFF1A\u5B8C\u6574 / \u7CBE\u7B80 / \u9690\u85CF">
          <span class="stat" data-k="fps"><i>FPS</i><b id="statFps">60</b></span>
          <span class="stat" data-k="tri"><i>\u4E09\u89D2\u9762</i><b id="statTri">0</b></span>
          <span class="stat" data-k="blocks"><i>\u65B9\u5757</i><b id="statBlocks">0</b></span>
          <span class="stat" data-k="calls"><i>\u7ED8\u5236</i><b id="statCalls">0</b></span>
        </button>

        <button class="inspector-pill" type="button" data-act="open-inspector" id="inspectorPill" title="\u5C55\u5F00\u65B9\u5757\u68C0\u67E5\u5668">
          ${icons.eye}<span>\u68C0\u67E5\u5668</span>
        </button>

        <div class="drag-overlay" id="dragOverlay" hidden>
          <div class="drag-card">${icons.drop}<span>\u677E\u5F00\u9F20\u6807\u5373\u53EF\u6253\u5F00 .litematic</span></div>
        </div>
      </main>

      <aside class="rail rail-right" id="rightRail" aria-label="\u65B9\u5757\u68C0\u67E5\u5668">
        <div class="inspector-head">
          <h2>\u65B9\u5757\u68C0\u67E5\u5668</h2>
          <div class="inspector-head-actions">
            <button class="iconbtn sm ghost" type="button" id="inspectorPinBtn" title="\u56FA\u5B9A\u5F53\u524D\u65B9\u5757" aria-label="\u56FA\u5B9A\u5F53\u524D\u65B9\u5757">${icons.target}</button>
            <button class="iconbtn sm ghost" type="button" data-act="close-inspector" title="\u6536\u8D77\u68C0\u67E5\u5668 (Esc)" aria-label="\u6536\u8D77\u68C0\u67E5\u5668">${icons.chevronRight}</button>
          </div>
        </div>
        <div class="inspector-body" id="inspectorBody"></div>
        <div class="inspector-foot" id="inspectorFoot"></div>
      </aside>
    </div>

    <div class="toasts" id="toasts" aria-live="polite" aria-atomic="false"></div>

    <div class="modal" id="helpModal" hidden>
      <div class="modal-mask" data-act="close-help"></div>
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="helpTitle">
        <div class="modal-head">
          <h2 id="helpTitle">\u5FEB\u6377\u952E\u4E0E\u8BF4\u660E</h2>
          <button class="iconbtn sm ghost" type="button" data-act="close-help" title="\u5173\u95ED (Esc)" aria-label="\u5173\u95ED">${icons.close}</button>
        </div>
        <div class="modal-body">
          <div class="help-grid">
            <div class="help-sec">
              <h3>\u89C6\u89D2</h3>
              <dl>
                <dt><kbd>1</kbd></dt><dd>\u7B49\u8DDD\u89C6\u89D2</dd>
                <dt><kbd>2</kbd></dt><dd>\u4FEF\u89C6</dd>
                <dt><kbd>3</kbd></dt><dd>\u6B63\u524D</dd>
                <dt><kbd>4</kbd></dt><dd>\u6B63\u4FA7</dd>
                <dt><kbd>\u53CC\u51FB</kbd></dt><dd>\u805A\u7126\u5230\u8BE5\u65B9\u5757</dd>
              </dl>
            </div>
            <div class="help-sec">
              <h3>\u5207\u7247\u4E0E\u663E\u793A</h3>
              <dl>
                <dt><kbd>[</kbd> <kbd>]</kbd></dt><dd>\u9010\u5C42\u4E0B\u964D / \u4E0A\u5347\u5207\u7247</dd>
                <dt><kbd>G</kbd></dt><dd>\u5F00\u5173\u7F51\u683C\u5730\u9762</dd>
                <dt><kbd>X</kbd></dt><dd>\u5F00\u5173\u7EBF\u6846\u6A21\u5F0F</dd>
              </dl>
            </div>
            <div class="help-sec">
              <h3>\u64CD\u4F5C</h3>
              <dl>
                <dt><kbd>\u5DE6\u952E\u62D6\u62FD</kbd></dt><dd>\u65CB\u8F6C</dd>
                <dt><kbd>\u53F3\u952E\u62D6\u62FD</kbd></dt><dd>\u5E73\u79FB</dd>
                <dt><kbd>\u6EDA\u8F6E</kbd></dt><dd>\u7F29\u653E</dd>
                <dt><kbd>O</kbd></dt><dd>\u6253\u5F00\u6587\u4EF6</dd>
                <dt><kbd>F</kbd></dt><dd>\u5168\u5C4F</dd>
                <dt><kbd>Esc</kbd></dt><dd>\u5173\u95ED\u5F39\u7A97 / \u53D6\u6D88\u9009\u4E2D</dd>
              </dl>
            </div>
          </div>
          <div class="help-about">
            <h3>\u5173\u4E8E</h3>
            <p>\u6295\u5F71\u67E5\u770B\u5668\u628A Litematica \u7684 <code>.litematic</code> \u6295\u5F71\u6587\u4EF6\u76F4\u63A5\u89E3\u6790\u6210 3D \u6A21\u578B\uFF1A\u4E0D\u542F\u52A8 Minecraft\u3001\u4E0D\u4E0A\u4F20\u6587\u4EF6\u3001\u4E0D\u9700\u8981\u5B89\u88C5\u4EFB\u4F55\u4E1C\u897F\u3002\u6240\u6709\u65B9\u5757\u8D34\u56FE\u6765\u81EA\u5185\u7F6E\u9759\u6001\u8D44\u4EA7\u56FE\u96C6\u3002</p>
            <p class="muted">\u6E32\u67D3\uFF1Athree.js \xB7 \u89E3\u6790\uFF1A\u81EA\u7814 litematic \u8BFB\u53D6\u5668 \xB7 \u72B6\u6001\u5B57\u7B26\u4E32\u6309\u5B8C\u6574\u65B9\u5757\u72B6\u6001\u5206\u7EC4\uFF0C\u4E00\u4E2A\u72B6\u6001\u4E00\u4E2A InstancedMesh\u3002</p>
          </div>
        </div>
        <div class="modal-foot">
          <span class="muted" id="helpBuild"></span>
          <button class="btn" type="button" data-act="close-help">\u77E5\u9053\u4E86</button>
        </div>
      </div>
    </div>
  `);
  const input = document.createElement("input");
  input.type = "file";
  input.id = "fileInput";
  input.accept = ".litematic,.litematica,application/octet-stream";
  input.hidden = true;
  root.appendChild(input);
  const q = (sel) => root.querySelector(sel);
  const qa = (sel) => [...root.querySelectorAll(sel)];
  const refs = {
    root,
    topbar: q("#topbar"),
    layout: q("#layout"),
    leftRail: q("#leftRail"),
    rightRail: q("#rightRail"),
    stage: q("#stage"),
    canvas: q("#glcanvas"),
    fileInput: input,
    fileChip: q("#fileChip"),
    fileChipName: q("#fileChipName"),
    fileChipMeta: q("#fileChipMeta"),
    fileCardBody: q("#fileCardBody"),
    resetViewBtn: q("#resetViewBtn"),
    regionCount: q("#regionCount"),
    regionList: q("#regionList"),
    legendCount: q("#legendCount"),
    legendSearch: q("#legendSearch"),
    legendList: q("#legendList"),
    viewButtons: qa("[data-view]"),
    actButtons: qa("[data-act]"),
    emptyState: q("#emptyState"),
    loadingState: q("#loadingState"),
    loadingTitle: q("#loadingTitle"),
    loadingPhase: q("#loadingPhase"),
    loadingBar: q("#loadingBar"),
    loadingPct: q("#loadingPct"),
    loadingFile: q("#loadingFile"),
    errorState: q("#errorState"),
    errorTitle: q("#errorTitle"),
    errorDetail: q("#errorDetail"),
    sliceHud: q("#sliceHud"),
    sliceRange: q("#sliceRange"),
    sliceValue: q("#sliceValue"),
    sliceMax: q("#sliceMax"),
    hintBar: q("#hintBar"),
    statBadge: q("#statBadge"),
    statFps: q("#statFps"),
    statTri: q("#statTri"),
    statBlocks: q("#statBlocks"),
    statCalls: q("#statCalls"),
    inspectorBody: q("#inspectorBody"),
    inspectorFoot: q("#inspectorFoot"),
    inspectorPinBtn: q("#inspectorPinBtn"),
    inspectorPill: q("#inspectorPill"),
    dragOverlay: q("#dragOverlay"),
    toasts: q("#toasts"),
    helpModal: q("#helpModal"),
    helpBuild: q("#helpBuild")
  };
  return refs;
}
function hideBoot() {
  const boot = document.getElementById("boot");
  if (!boot) return;
  boot.classList.add("boot-done");
  setTimeout(() => boot.setAttribute("hidden", ""), 360);
}
export {
  buildShell,
  hideBoot
};
