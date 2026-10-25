(() => {
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
  function icon(name, cls = "ico") {
    const s = icons[name];
    if (!s) return document.createTextNode("");
    const el = document.createElement("span");
    el.className = cls;
    el.innerHTML = s;
    return el;
  }

  // src/ui/app-shell.js
  var tpl = (s) => s.replace(/\s+/g, " ").trim();
  function buildShell(root) {
    root.innerHTML = tpl(`
    <header class="topbar" id="topbar">
      <div class="tb-left">
        <a class="brand" href="./" title="投影查看器">
          <span class="brand-mark">${icons.cubeSolid}</span>
          <span class="brand-text">投影查看器</span>
        </a>
        <div class="filechip" id="fileChip">
          <span class="filechip-name" id="fileChipName">未打开文件</span>
          <span class="filechip-meta" id="fileChipMeta"></span>
        </div>
      </div>

      <div class="tb-center">
        <div class="seg" role="group" aria-label="视角预设">
          <button class="seg-btn is-on" type="button" data-view="iso" title="等距视角 (1)" aria-label="等距视角">${icons.viewIso}<span>等距</span></button>
          <button class="seg-btn" type="button" data-view="top" title="俯视 (2)" aria-label="俯视">${icons.viewTop}<span>俯视</span></button>
          <button class="seg-btn" type="button" data-view="front" title="正前 (3)" aria-label="正前视角">${icons.viewFront}<span>正前</span></button>
          <button class="seg-btn" type="button" data-view="side" title="正侧 (4)" aria-label="正侧视角">${icons.viewSide}<span>正侧</span></button>
        </div>
        <span class="tb-sep" aria-hidden="true"></span>
        <button class="tbtn" type="button" data-act="slice" aria-pressed="false" title="按层切片 ( [ / ] )">${icons.slice}<span>切片</span></button>
        <button class="tbtn is-on" type="button" data-act="grid" aria-pressed="true" title="显示网格 (G)">${icons.grid}<span>网格</span></button>
        <button class="tbtn" type="button" data-act="wire" aria-pressed="false" title="线框模式 (X)">${icons.wire}<span>线框</span></button>
      </div>

      <div class="tb-right">
        <button class="btn btn-primary" type="button" data-act="open" title="打开 .litematic 文件 (O)">${icons.folder}<span>打开文件</span></button>
        <button class="iconbtn" type="button" data-act="shot" title="导出 PNG 截图" aria-label="导出截图">${icons.camera}</button>
        <button class="iconbtn" type="button" data-act="full" title="全屏 (F)" aria-label="全屏">${icons.fullscreen}</button>
        <button class="iconbtn" type="button" data-act="help" title="帮助与快捷键" aria-label="帮助">${icons.help}</button>
      </div>
    </header>

    <div class="layout" id="layout">
      <aside class="rail rail-left" id="leftRail" aria-label="文件与图例">
        <section class="card">
          <div class="card-head">
            <h2>文件</h2>
            <button class="linkbtn" type="button" id="resetViewBtn" title="框住整个投影并复位视角">${icons.reset}<span>复位视角</span></button>
          </div>
          <div class="filecard" id="fileCardBody">
            <div class="filecard-empty">
              <p>尚未打开文件</p>
              <p class="muted">拖入 .litematic，或点击「打开示例」</p>
            </div>
          </div>
        </section>

        <section class="card card-regions">
          <div class="card-head">
            <h2>Region</h2>
            <span class="pill-count" id="regionCount">0</span>
          </div>
          <div class="region-list" id="regionList">
            <div class="list-empty">打开文件后显示 Region 列表</div>
          </div>
        </section>

        <section class="card card-legend">
          <div class="card-head">
            <h2>方块图例</h2>
            <span class="pill-count" id="legendCount">0</span>
          </div>
          <label class="search">
            ${icons.search}
            <input id="legendSearch" type="search" placeholder="搜索方块名或 id" aria-label="搜索方块" autocomplete="off" spellcheck="false">
          </label>
          <div class="legend-list" id="legendList">
            <div class="list-empty">打开文件后按数量排序显示</div>
          </div>
        </section>
      </aside>

      <main class="stage" id="stage">
        <canvas id="glcanvas" class="glcanvas" tabindex="0" aria-label="3D 投影视图"></canvas>

        <div class="stage-empty" id="emptyState">
          <div class="empty-bg" aria-hidden="true"></div>
          <div class="empty-card">
            <div class="empty-art" aria-hidden="true">
              ${icons.cube}
              <span class="empty-art-drop">${icons.drop}</span>
            </div>
            <h1>把 .litematic 拖到这里</h1>
            <p class="empty-sub">或者从本地选择文件。解析和渲染全部在浏览器内完成，文件不会上传到任何服务器。</p>
            <div class="empty-actions">
              <button class="btn btn-primary btn-lg" type="button" data-act="open">${icons.folder}<span>选择文件</span></button>
              <button class="btn btn-ghost btn-lg" type="button" data-act="sample">${icons.bolt}<span>打开示例</span></button>
            </div>
            <div class="empty-foot">支持 Litematica 投影（.litematic）· 无需启动 Minecraft · 纯本地解析</div>
          </div>
        </div>

        <div class="stage-loading" id="loadingState" hidden>
          <div class="loading-card">
            <div class="loading-head">
              <span class="spinner" aria-hidden="true"></span>
              <span class="loading-title" id="loadingTitle">正在加载</span>
            </div>
            <div class="loading-phase" id="loadingPhase">准备中…</div>
            <div class="progress"><span class="progress-bar" id="loadingBar"></span></div>
            <div class="loading-foot"><span class="muted" id="loadingFile"></span><b id="loadingPct">0%</b></div>
          </div>
        </div>

        <div class="stage-error" id="errorState" hidden>
          <div class="error-card">
            <div class="error-ico">${icons.warning}</div>
            <h2 id="errorTitle">无法打开文件</h2>
            <p id="errorDetail"></p>
            <div class="empty-actions">
              <button class="btn" type="button" data-act="open">换一个文件</button>
              <button class="btn btn-ghost" type="button" data-act="sample">打开示例</button>
            </div>
          </div>
        </div>

        <div class="slice-hud" id="sliceHud" hidden>
          <span class="slice-label">${icons.slice}<span>层切片</span></span>
          <input class="slice-range" id="sliceRange" type="range" min="0" max="0" value="0" step="1" aria-label="切片层高">
          <span class="slice-value"><b id="sliceValue">0</b><span class="muted">/<span id="sliceMax">0</span></span></span>
          <button class="iconbtn sm" type="button" data-act="slice-off" title="关闭切片" aria-label="关闭切片">${icons.close}</button>
        </div>

        <div class="hint-bar" id="hintBar">
          <span class="hint"><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd> 视角</span>
          <span class="hint"><kbd>[</kbd><kbd>]</kbd> 切片</span>
          <span class="hint"><kbd>F</kbd> 全屏</span>
          <span class="hint"><kbd>O</kbd> 打开</span>
          <span class="hint hint-drag">拖入文件即可打开</span>
        </div>

        <button class="stat-badge" id="statBadge" type="button" title="点击切换性能显示：完整 / 精简 / 隐藏">
          <span class="stat" data-k="fps"><i>FPS</i><b id="statFps">60</b></span>
          <span class="stat" data-k="tri"><i>三角面</i><b id="statTri">0</b></span>
          <span class="stat" data-k="blocks"><i>方块</i><b id="statBlocks">0</b></span>
          <span class="stat" data-k="calls"><i>绘制</i><b id="statCalls">0</b></span>
        </button>

        <button class="inspector-pill" type="button" data-act="open-inspector" id="inspectorPill" title="展开方块检查器">
          ${icons.eye}<span>检查器</span>
        </button>

        <div class="drag-overlay" id="dragOverlay" hidden>
          <div class="drag-card">${icons.drop}<span>松开鼠标即可打开 .litematic</span></div>
        </div>
      </main>

      <aside class="rail rail-right" id="rightRail" aria-label="方块检查器">
        <div class="inspector-head">
          <h2>方块检查器</h2>
          <div class="inspector-head-actions">
            <button class="iconbtn sm ghost" type="button" id="inspectorPinBtn" title="固定当前方块" aria-label="固定当前方块">${icons.target}</button>
            <button class="iconbtn sm ghost" type="button" data-act="close-inspector" title="收起检查器 (Esc)" aria-label="收起检查器">${icons.chevronRight}</button>
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
          <h2 id="helpTitle">快捷键与说明</h2>
          <button class="iconbtn sm ghost" type="button" data-act="close-help" title="关闭 (Esc)" aria-label="关闭">${icons.close}</button>
        </div>
        <div class="modal-body">
          <div class="help-grid">
            <div class="help-sec">
              <h3>视角</h3>
              <dl>
                <dt><kbd>1</kbd></dt><dd>等距视角</dd>
                <dt><kbd>2</kbd></dt><dd>俯视</dd>
                <dt><kbd>3</kbd></dt><dd>正前</dd>
                <dt><kbd>4</kbd></dt><dd>正侧</dd>
                <dt><kbd>双击</kbd></dt><dd>聚焦到该方块</dd>
              </dl>
            </div>
            <div class="help-sec">
              <h3>切片与显示</h3>
              <dl>
                <dt><kbd>[</kbd> <kbd>]</kbd></dt><dd>逐层下降 / 上升切片</dd>
                <dt><kbd>G</kbd></dt><dd>开关网格地面</dd>
                <dt><kbd>X</kbd></dt><dd>开关线框模式</dd>
              </dl>
            </div>
            <div class="help-sec">
              <h3>操作</h3>
              <dl>
                <dt><kbd>左键拖拽</kbd></dt><dd>旋转</dd>
                <dt><kbd>右键拖拽</kbd></dt><dd>平移</dd>
                <dt><kbd>滚轮</kbd></dt><dd>缩放</dd>
                <dt><kbd>O</kbd></dt><dd>打开文件</dd>
                <dt><kbd>F</kbd></dt><dd>全屏</dd>
                <dt><kbd>Esc</kbd></dt><dd>关闭弹窗 / 取消选中</dd>
              </dl>
            </div>
          </div>
          <div class="help-about">
            <h3>关于</h3>
            <p>投影查看器把 Litematica 的 <code>.litematic</code> 投影文件直接解析成 3D 模型：不启动 Minecraft、不上传文件、不需要安装任何东西。所有方块贴图来自内置静态资产图集。</p>
            <p class="muted">渲染：three.js · 解析：自研 litematic 读取器 · 状态字符串按完整方块状态分组，一个状态一个 InstancedMesh。</p>
          </div>
        </div>
        <div class="modal-foot">
          <span class="muted" id="helpBuild"></span>
          <button class="btn" type="button" data-act="close-help">知道了</button>
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

  // src/ui/dom.js
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v === null || v === void 0 || v === false) continue;
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
      if (c === null || c === void 0 || c === false) continue;
      el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    }
    return el;
  }
  var fmtInt = (n) => typeof n === "number" && Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "—";
  function fmtBytes(n) {
    if (!Number.isFinite(n)) return "—";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  }
  function fmtSize(s) {
    if (!s) return "—";
    return `${s.x ?? s[0] ?? "?"} × ${s.y ?? s[1] ?? "?"} × ${s.z ?? s[2] ?? "?"}`;
  }
  function rgbCss(c) {
    if (!c) return "#3a4455";
    const arr = Array.isArray(c) ? c : [c.r, c.g, c.b];
    const norm = arr.map((v) => v > 1.0001 ? v / 255 : v);
    const [r, g, b] = norm.map((v) => Math.max(0, Math.min(255, Math.round(v * 255))));
    return `rgb(${r} ${g} ${b})`;
  }

  // src/ui/panels.js
  var kvRow = (k, v, opts = {}) => h(
    "div",
    { class: `kv-row${opts.strong ? " is-strong" : ""}${opts.mono ? " is-mono" : ""}` },
    h("dt", { text: k }),
    h("dd", { title: typeof v === "string" ? v.replace(/<[^>]+>/g, "") : "" }, v)
  );
  function renderFileCard(refs, info) {
    const {
      fileName = "未命名",
      author = "",
      description = "",
      size = null,
      blocks = 0,
      regions = 0,
      mcVersion = "",
      dataVersion = null,
      warnings = [],
      buildMs = 0,
      missing = 0,
      fallbackAssets = false,
      parseMs = 0
    } = info;
    refs.fileChipName.textContent = fileName;
    refs.fileChipMeta.textContent = `${fmtInt(blocks)} 方块 · ${fmtSize(size)}${mcVersion ? " · " + mcVersion : ""}`;
    refs.fileChip.classList.add("is-loaded");
    const rows = [];
    if (author) rows.push(kvRow("作者", author));
    rows.push(kvRow("尺寸", `${fmtSize(size)} 格`));
    rows.push(kvRow("方块数", fmtInt(blocks), { strong: true }));
    rows.push(kvRow("Region", `${fmtInt(regions)} 个`));
    if (mcVersion || dataVersion) {
      const label = "MC 版本";
      const value = mcVersion ? `${mcVersion}${dataVersion ? ` · 数据 ${dataVersion}` : ""}` : dataVersion ? `未知（数据 ${dataVersion}）` : "未知";
      rows.push(kvRow(label, value));
    }
    if (parseMs) rows.push(kvRow("解析 / 构建", `${Math.round(parseMs)} ms / ${Math.round(buildMs)} ms`, { mono: true }));
    const wrap2 = h("div", { class: "filecard-body" });
    wrap2.appendChild(h("div", { class: "fc-name", text: fileName, title: fileName }));
    if (description) wrap2.appendChild(h("p", { class: "fc-desc", text: description }));
    const dl = h("dl", { class: "kv" }, ...rows);
    wrap2.appendChild(dl);
    const badges = h("div", { class: "fc-badges" });
    if (missing > 0) {
      badges.appendChild(
        h(
          "span",
          { class: "fc-badge warn", title: "这些方块状态在资产图集里没有模型，已用洋红色占位：" + (info.missingSample || []).join(", ") },
          `${fmtInt(missing)} 个方块缺模型`
        )
      );
    }
    if (fallbackAssets) {
      badges.appendChild(h("span", { class: "fc-badge", title: "assets/ 未就绪，使用内置程序化贴图" }, "内置兜底贴图"));
    }
    if (warnings.length) {
      const btn = h(
        "button",
        { class: "fc-badge warn", type: "button", title: "点击展开全部警告" },
        `${warnings.length} 条警告`
      );
      const list = h(
        "ul",
        { class: "fc-warnlist", hidden: "" },
        ...warnings.slice(0, 12).map((w) => h("li", { text: String(w) }))
      );
      if (warnings.length > 12) list.appendChild(h("li", { class: "muted", text: `…另有 ${warnings.length - 12} 条` }));
      btn.addEventListener("click", () => {
        if (list.hasAttribute("hidden")) list.removeAttribute("hidden");
        else list.setAttribute("hidden", "");
      });
      badges.appendChild(btn);
      wrap2.appendChild(badges);
      wrap2.appendChild(list);
    } else if (badges.childElementCount) {
      wrap2.appendChild(badges);
    }
    refs.fileCardBody.replaceChildren(wrap2);
  }
  function renderRegions(refs, regions, handlers = {}) {
    refs.regionCount.textContent = String(regions.length);
    if (!regions.length) {
      refs.regionList.innerHTML = '<div class="list-empty">没有 Region</div>';
      return;
    }
    const frag = document.createDocumentFragment();
    regions.forEach((r, i) => {
      const cb = h("input", { type: "checkbox", class: "region-check", checked: r.visible !== false });
      cb.setAttribute("aria-label", `显示 / 隐藏 ${r.name}`);
      cb.addEventListener("change", () => handlers.onToggle && handlers.onToggle(r.name, cb.checked));
      const row = h(
        "div",
        { class: "region-row", role: "listitem", tabindex: "0", title: `点击聚焦：${r.name}` },
        cb,
        h("span", { class: "region-idx", text: String(i + 1).padStart(2, "0") }),
        h(
          "span",
          { class: "region-main" },
          h("span", { class: "region-name", text: r.name }),
          h("span", { class: "region-meta", text: `${fmtSize(r.size)} · ${fmtInt(r.volume || 0)} 格` })
        ),
        h("button", {
          class: "region-focus",
          type: "button",
          title: "聚焦到此 Region",
          "aria-label": `聚焦到 ${r.name}`,
          onclick: (e) => {
            e.stopPropagation();
            handlers.onFocus && handlers.onFocus(r.name);
          }
        }, "")
      );
      row.addEventListener("mouseenter", () => handlers.onHover && handlers.onHover(r.name));
      row.addEventListener("mouseleave", () => handlers.onHover && handlers.onHover(null));
      row.addEventListener("click", () => handlers.onFocus && handlers.onFocus(r.name));
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handlers.onFocus && handlers.onFocus(r.name);
        }
        if (e.key === " ") e.preventDefault();
      });
      if (r.hidden) row.classList.add("is-hidden");
      frag.appendChild(row);
    });
    refs.regionList.replaceChildren(frag);
  }
  function swatch(entry, db) {
    const color = entry.color || (db && db.color ? db.color(entry.stateKey) : null);
    const bg = rgbCss(color);
    return h("span", {
      class: "legend-swatch",
      style: { background: `linear-gradient(160deg, ${bg}, ${bg})`, borderColor: "rgba(0,0,0,.45)" },
      "aria-hidden": "true"
    });
  }
  function renderLegend(refs, entries, opts = {}) {
    const { db, onSelect, filter = "" } = opts;
    const groups = groupLegend(entries);
    const q = filter.trim().toLowerCase();
    const list = q ? groups.filter(
      (g) => g.name && g.name.toLowerCase().includes(q) || g.id.toLowerCase().includes(q) || g.states.some((s) => s.toLowerCase().includes(q))
    ) : groups;
    refs.legendCount.textContent = q ? `${list.length}/${groups.length}` : String(groups.length);
    if (!list.length) {
      refs.legendList.innerHTML = `<div class="list-empty">${groups.length ? "没有匹配的方块" : "没有可显示的方块"}</div>`;
      return;
    }
    const MAX = 300;
    const frag = document.createDocumentFragment();
    for (const e of list.slice(0, MAX)) {
      const tip = e.variants > 1 ? `${e.name}（合计 ${fmtInt(e.count)} 个，${e.variants} 种状态）
点击：高亮并聚焦数量最多的状态` : `${e.name}（${fmtInt(e.count)} 个）
点击：高亮并聚焦这些方块`;
      const row = h(
        "button",
        { class: "legend-row", type: "button", title: tip },
        swatch(e, db),
        h(
          "span",
          { class: "legend-text" },
          h("span", { class: "legend-name", text: e.name }),
          h(
            "span",
            { class: "legend-id" },
            h("span", { text: e.id.replace(/^minecraft:/, "") }),
            e.variants > 1 ? h("span", { class: "legend-var", text: `· ${e.variants} 态` }) : null
          )
        ),
        h("span", { class: "legend-count", text: fmtInt(e.count) })
      );
      row.addEventListener("click", () => onSelect && onSelect(e));
      frag.appendChild(row);
    }
    if (list.length > MAX) {
      frag.appendChild(h("div", { class: "list-empty", text: `还有 ${list.length - MAX} 种方块未列出，请用搜索缩小范围` }));
    }
    refs.legendList.replaceChildren(frag);
  }
  function groupLegend(entries) {
    const map = /* @__PURE__ */ new Map();
    for (const e of entries) {
      let g = map.get(e.id);
      if (!g) {
        g = { id: e.id, name: e.name, count: 0, variants: 0, states: [], best: -1, stateKey: e.stateKey, first: e.first };
        map.set(e.id, g);
      }
      g.count += e.count;
      g.variants++;
      g.states.push(e.stateKey);
      if (e.count > g.best) {
        g.best = e.count;
        g.stateKey = e.stateKey;
        g.first = e.first;
      }
    }
    const out = [...map.values()];
    for (const g of out) delete g.best;
    out.sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
    return out;
  }

  // src/ui/api-client.js
  var API_BASE = "/api";
  var TOKEN_KEY = "mcviewer.apiToken";
  var UNAVAILABLE_MESSAGE = "服务器未启用该功能";
  var ApiError = class extends Error {
    /** @param {string} message @param {{status?: number, code?: string}} [meta] */
    constructor(message, { status = 0, code = "" } = {}) {
      super(message || "请求失败");
      this.name = "ApiError";
      this.status = Number(status) || 0;
      this.code = code || "";
    }
  };
  var CODE_TEXT = {
    UNAVAILABLE: UNAVAILABLE_MESSAGE,
    NETWORK: "无法连接服务器，请确认 viewer 服务仍在运行",
    UNAUTHORIZED: "未授权：服务器开启了令牌保护，请填写访问令牌",
    INVALID_FILE: "文件无效：不是可解析的 .litematic 投影",
    BAD_FILENAME: "文件名无效，请重命名后再上传",
    INVALID_PACK: "材质包无效：不是可烘焙的 Minecraft 资源包",
    PAYLOAD_TOO_LARGE: "文件超过服务器允许的大小",
    QUOTA_EXCEEDED: "服务器存储空间不足，请先删除旧文件",
    RATE_LIMITED: "请求过于频繁，请稍后再试",
    NOT_FOUND: "条目不存在（可能已被删除）",
    BAD_REQUEST: "请求参数有误",
    BAD_RESPONSE: "服务器返回了无法解析的响应"
  };
  var unavailable = (status = 0) => new ApiError(UNAVAILABLE_MESSAGE, { status, code: "UNAVAILABLE" });
  function parseJson(text) {
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (e) {
      return null;
    }
  }
  function serverError(status, data) {
    const err = data && (data.error || data) || {};
    const code = err.code ? String(err.code) : "";
    const message = err.message ? String(err.message) : CODE_TEXT[code] || `服务器返回 ${status}`;
    return new ApiError(message, { status, code });
  }
  function getToken() {
    try {
      return localStorage.getItem(TOKEN_KEY) || "";
    } catch (e) {
      return "";
    }
  }
  function setToken(token) {
    const value = token === null || token === void 0 ? "" : String(token).trim();
    try {
      if (value) localStorage.setItem(TOKEN_KEY, value);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) {
    }
    try {
      if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
        window.dispatchEvent(new CustomEvent("mcviewer:token", { detail: { token: value } }));
      }
    } catch (e) {
    }
    return value;
  }
  function authHeaders() {
    const token = getToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  }
  async function request(path, { method = "GET", body = null, headers = null } = {}) {
    if (!api.available) throw unavailable();
    let res;
    try {
      res = await fetch(API_BASE + path, {
        method,
        body,
        cache: "no-store",
        headers: { ...authHeaders(), ...headers || {} }
      });
    } catch (err) {
      throw new ApiError(CODE_TEXT.NETWORK, { status: 0, code: "NETWORK" });
    }
    if (res.status === 204) return null;
    const data = parseJson(await res.text().catch(() => ""));
    if (!res.ok) throw serverError(res.status, data);
    return data;
  }
  function upload(path, file, onProgress) {
    if (!api.available) return Promise.reject(unavailable());
    return new Promise((resolve, reject) => {
      const name = file && file.name ? String(file.name) : "上传文件";
      let xhr;
      try {
        xhr = new XMLHttpRequest();
      } catch (e) {
        reject(new ApiError("当前浏览器不支持上传", { status: 0, code: "UPLOAD_UNSUPPORTED" }));
        return;
      }
      xhr.open("POST", API_BASE + path, true);
      xhr.timeout = 10 * 60 * 1e3;
      const headers = {
        ...authHeaders(),
        "content-type": "application/octet-stream",
        "x-file-name": encodeURIComponent(name)
      };
      for (const key of Object.keys(headers)) {
        try {
          xhr.setRequestHeader(key, headers[key]);
        } catch (e) {
        }
      }
      const emit = typeof onProgress === "function" ? onProgress : () => {
      };
      let lastFrac = -1;
      if (xhr.upload) {
        xhr.upload.onprogress = (ev) => {
          const total = ev && ev.lengthComputable && ev.total > 0 ? ev.total : file && file.size || 0;
          if (!(total > 0) || !ev) return;
          const frac = Math.max(0, Math.min(1, ev.loaded / total));
          if (frac >= 1 || lastFrac < 0 || frac - lastFrac >= 0.01) {
            lastFrac = frac;
            emit(frac);
          }
        };
      }
      xhr.onerror = () => reject(new ApiError("上传失败：无法连接服务器", { status: 0, code: "NETWORK" }));
      xhr.ontimeout = () => reject(new ApiError("上传超时，请检查网络或文件大小后重试", { status: 0, code: "TIMEOUT" }));
      xhr.onabort = () => reject(new ApiError("上传已取消", { status: 0, code: "ABORTED" }));
      xhr.onload = () => {
        const data = parseJson(xhr.responseText || "");
        if (xhr.status >= 200 && xhr.status < 300) {
          emit(1);
          if (data && data.item) resolve(data.item);
          else reject(new ApiError(CODE_TEXT.BAD_RESPONSE, { status: xhr.status, code: "BAD_RESPONSE" }));
        } else {
          reject(serverError(xhr.status, data));
        }
      };
      try {
        xhr.send(file);
      } catch (err) {
        reject(new ApiError(`上传失败：${err && err.message ? err.message : err}`, { status: 0, code: "NETWORK" }));
      }
    });
  }
  async function capabilities(force = false) {
    if (api.caps && !force) return api.caps;
    let res;
    try {
      res = await fetch(`${API_BASE}/capabilities`, { cache: "no-store", headers: authHeaders() });
    } catch (err) {
      api.available = false;
      throw unavailable(0);
    }
    const data = parseJson(await res.text().catch(() => ""));
    if (res.status === 404 || res.status >= 500 || !data || typeof data !== "object") {
      api.available = false;
      throw unavailable(res.status);
    }
    if (!res.ok) throw serverError(res.status, data);
    api.available = true;
    api.caps = data;
    if (data.auth === true) {
    }
    return data;
  }
  async function listProjects() {
    const data = await request("/projects");
    if (!data || !Array.isArray(data.items)) {
      throw new ApiError(CODE_TEXT.BAD_RESPONSE, { status: 200, code: "BAD_RESPONSE" });
    }
    return { items: data.items, storage: data.storage || null };
  }
  async function uploadProject(file, onProgress) {
    const data = await upload("/projects", file, onProgress);
    return data && data.item ? data.item : data;
  }
  async function deleteProject(id) {
    await request(`/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
    return true;
  }
  function projectFileUrl(id) {
    const base = `${API_BASE}/projects/${encodeURIComponent(id)}/file`;
    const token = getToken();
    return token ? `${base}?token=${encodeURIComponent(token)}` : base;
  }
  async function listPacks() {
    const data = await request("/packs");
    if (!data || !Array.isArray(data.items)) {
      throw new ApiError(CODE_TEXT.BAD_RESPONSE, { status: 200, code: "BAD_RESPONSE" });
    }
    return { items: data.items, storage: data.storage || null };
  }
  async function uploadPack(file, onProgress) {
    const data = await upload("/packs", file, onProgress);
    return data && data.item ? data.item : data;
  }
  async function getPack(id) {
    const data = await request(`/packs/${encodeURIComponent(id)}`);
    if (!data || !data.item) throw new ApiError(CODE_TEXT.BAD_RESPONSE, { status: 200, code: "BAD_RESPONSE" });
    return data.item;
  }
  async function deletePack(id) {
    await request(`/packs/${encodeURIComponent(id)}`, { method: "DELETE" });
    return true;
  }
  var api = {
    /** 服务器功能是否可用；capabilities() 失败后为 false（UI 据此灰态降级） */
    available: true,
    /** 最近一次 capabilities() 的结果（供 UI 读取 auth / packsSupported 等） */
    caps: null,
    capabilities,
    listProjects,
    uploadProject,
    deleteProject,
    projectFileUrl,
    listPacks,
    uploadPack,
    getPack,
    deletePack,
    setToken,
    getToken,
    /** 附加便利方法：需要自定义 fetch 时可直接取鉴权头 */
    authHeaders
  };

  // src/ui/library.js
  var UPLOAD_ACCEPT = ".litematic,.litematica";
  var pad2 = (n) => String(n).padStart(2, "0");
  function fmtRelTime(iso, now = Date.now()) {
    if (!iso) return "";
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return "";
    const sec = Math.max(0, (now - t) / 1e3);
    if (sec < 45) return "刚刚";
    if (sec < 3600) return `${Math.max(1, Math.round(sec / 60))} 分钟前`;
    if (sec < 86400) return `${Math.max(1, Math.round(sec / 3600))} 小时前`;
    if (sec < 86400 * 7) return `${Math.max(1, Math.round(sec / 86400))} 天前`;
    const d = new Date(t);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  function fmtAbsTime(iso) {
    if (!iso) return "";
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return "";
    const d = new Date(t);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  function fmtBytesCap(n) {
    if (!Number.isFinite(n)) return "—";
    const trim = (v) => Math.abs(v - Math.round(v)) < 0.049 ? String(Math.round(v)) : v.toFixed(1);
    if (n >= 1024 ** 3) return `${trim(n / 1024 ** 3)} GB`;
    if (n >= 1024 ** 2) return `${trim(n / 1024 ** 2)} MB`;
    if (n >= 1024) return `${trim(n / 1024)} KB`;
    return `${Math.round(n)} B`;
  }
  function createTokenPrompt(opts = {}) {
    const input = h("input", {
      class: "lib-token-input",
      type: "password",
      placeholder: "访问令牌",
      autocomplete: "off",
      spellcheck: "false",
      "aria-label": "服务器访问令牌"
    });
    const save = h("button", { class: "lib-token-save", type: "button", text: "保存" });
    const wrap2 = h(
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
        wrap2.classList.add("is-invalid");
        clearTimeout(invalidTimer);
        invalidTimer = setTimeout(() => wrap2.classList.remove("is-invalid"), 1e3);
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
    return wrap2;
  }
  function createLibrary(container, hooks = {}) {
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
      destroyed: false
    };
    let inFlight = null;
    let confirmTimer = 0;
    let tokenSig = "";
    const els = {};
    build();
    update();
    function onTokenChanged() {
      if (state.destroyed) return;
      state.tokenMissing = state.authRequired && !api.getToken();
      tokenSig = "";
      update();
      refresh({ force: true }).catch(() => {
      });
    }
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("mcviewer:token", onTokenChanged);
    }
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
        refresh({ force: true }).catch(() => {
        });
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
            refresh({ force: true }).catch(() => {
            });
          }
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
      const showError = Boolean(state.error) && !(state.error.code === "UNAUTHORIZED" && state.tokenMissing);
      if (showError && !state.items.length) {
        els.list.replaceChildren(alertBlock(state.error));
        return;
      }
      if (!state.items.length) {
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
      const main2 = h(
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
        main2,
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
        refresh({ force: true }).catch(() => {
        });
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
        )
      ];
      if (error.retry) {
        const retry = h("button", { class: "linkbtn lib-retry", type: "button", text: "重试" });
        retry.addEventListener("click", () => {
          refresh({ force: true }).catch(() => {
          });
        });
        nodes.push(retry);
      }
      return h("div", { class: "lib-alert", role: "alert" }, ...nodes);
    }
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
          detail: "请换一个更小的投影文件。"
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
        if (typeof hooks.onError === "function") hooks.onError(failure, void 0);
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
      }, 5e3);
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
          refresh({ silent: true }).catch(() => {
          });
        } else {
          state.error = describeError(err);
          if (typeof hooks.onError === "function") hooks.onError(err, project);
        }
      } finally {
        state.deletingId = "";
        update();
      }
    }
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
        storage: state.storage
      };
    }
    return { refresh, setEnabled, destroy, getState };
  }
  function describeError(err) {
    if (err instanceof ApiError) {
      const detail = err.code === "NETWORK" ? "请确认 viewer 服务仍在运行。" : err.code === "QUOTA_EXCEEDED" ? "可以先删除不再需要的条目。" : "";
      return { message: err.message || "请求失败", detail, code: err.code, status: err.status };
    }
    return { message: err && err.message ? String(err.message) : String(err || "未知错误"), detail: "" };
  }

  // src/ui/packs.js
  var PACK_ACCEPT = ".zip";
  var POLL_MS = 2e3;
  var STATUS = {
    queued: { text: "排队中", cls: "is-queued" },
    baking: { text: "烘焙中", cls: "is-baking" },
    ready: { text: "就绪", cls: "is-ready" },
    error: { text: "失败", cls: "is-error" }
  };
  var isBaking = (p) => p && (p.status === "queued" || p.status === "baking");
  function createPackPanel(container, hooks = {}) {
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
      sig: ""
    };
    let inFlight = null;
    let pollTimer = 0;
    let confirmTimer = 0;
    let tokenSig = "";
    const els = {};
    let lastSig = "";
    build();
    update();
    function onTokenChanged() {
      if (state.destroyed) return;
      state.tokenMissing = state.authRequired && !api.getToken();
      tokenSig = "";
      update();
      refresh({ force: true }).catch(() => {
      });
    }
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("mcviewer:token", onTokenChanged);
    }
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
        refresh({ force: true }).catch(() => {
        });
      });
      els.head = h(
        "div",
        { class: "card-head" },
        h("h2", { text: "材质包" }),
        h("div", { class: "pack-head-right" }, els.count, els.refresh)
      );
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
            refresh({ force: true }).catch(() => {
            });
          }
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
      const showError = Boolean(state.error) && !(state.error.code === "UNAUTHORIZED" && state.tokenMissing);
      if (showError && !state.items.length) {
        els.list.replaceChildren(alertBlock(state.error));
        return;
      }
      if (!state.items.length) {
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
      const main2 = h(
        "div",
        { class: "pack-row-main" },
        h("div", { class: "pack-name-line" }, h("div", { class: "pack-name", text: name, title: name }), badge),
        meta,
        isBaking(pack) ? h("div", { class: "pack-bar", title: `烘焙进度 ${pct}%` }, h("span", { style: { width: `${pct}%` } })) : null
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
          tabindex: "0"
        },
        main2,
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
        refresh({ force: true }).catch(() => {
        });
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
        )
      ];
      if (error.retry) {
        const retry = h("button", { class: "linkbtn pack-retry", type: "button", text: "重试" });
        retry.addEventListener("click", () => {
          refresh({ force: true }).catch(() => {
          });
        });
        nodes.push(retry);
      }
      return h("div", { class: "pack-alert", role: "alert" }, ...nodes);
    }
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
            state.error = describeError2(err);
          } else {
            state.error = { ...describeError2(err), retry: true };
          }
        } finally {
          state.initial = false;
          state.loading = false;
          inFlight = null;
          const sig = listSig();
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
      return state.items.map((p) => [p.id, p.name, p.status, p.progress, p.size, p.assetsUrl, p.stats && p.stats.overrides].join("|")).join(";");
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
          detail: "请精简资源包后再上传。"
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
        state.error = describeError2(failure);
        if (typeof hooks.onError === "function") hooks.onError(failure, void 0);
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
        await hooks.onApply({ ...pack, url: pack.assetsUrl });
        state.activeId = pack.id;
      } catch (err) {
        state.error = describeError2(err);
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
        state.error = describeError2(err);
        if (typeof hooks.onError === "function") hooks.onError(err, void 0);
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
      }, 5e3);
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
          refresh({ silent: true }).catch(() => {
          });
        } else {
          state.error = describeError2(err);
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
          refresh({ silent: true, fromPoll: true }).catch(() => {
          });
        }, POLL_MS);
      } else if (!should && pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = 0;
      }
    }
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
        storage: state.storage
      };
    }
    return { refresh, setEnabled, setActive, destroy, getState };
  }
  function describeError2(err) {
    if (err instanceof ApiError) {
      const detail = err.code === "NETWORK" ? "请确认 viewer 服务仍在运行。" : err.code === "INVALID_PACK" ? "资源包需要包含 pack.mcmeta 与 assets/ 目录。" : err.code === "QUOTA_EXCEEDED" ? "可以先删除不再需要的材质包或投影。" : "";
      return { message: err.message || "请求失败", detail, code: err.code, status: err.status };
    }
    return { message: err && err.message ? String(err.message) : String(err || "未知错误"), detail: "" };
  }

  // tests/ui/panels-entry.js
  var params = new URLSearchParams(location.search);
  var scenario = params.get("scenario") || "default";
  var NOW = Date.now();
  var ago = (minutes) => new Date(NOW - minutes * 60 * 1e3).toISOString();
  var PROJECTS = [
    {
      id: "prj_end_tower",
      name: "末地要塞_主塔_最终版_v3_带内饰完整存档.litematic",
      size: 1287364,
      blocks: 182740,
      regions: 6,
      author: "Devon",
      mcVersion: "1.21.4",
      createdAt: ago(3),
      url: "/api/projects/prj_end_tower/file"
    },
    {
      id: "prj_redstone_cpu",
      name: "红石计算器_8bit_优化版.litematic",
      size: 438221,
      blocks: 51234,
      regions: 3,
      author: "",
      mcVersion: "1.20.6",
      createdAt: ago(2 * 60 + 17),
      url: "/api/projects/prj_redstone_cpu/file"
    },
    {
      id: "prj_beacon_farm",
      name: "满级信标农场.litematic",
      size: 92160,
      blocks: 8842,
      regions: 1,
      author: "",
      mcVersion: "1.21",
      createdAt: ago(26 * 60),
      url: "/api/projects/prj_beacon_farm/file"
    }
  ];
  var STORAGE = { count: 3, bytes: 1817145, maxBytes: 536870912, maxCount: 200 };
  var PACKS = [
    {
      id: "pack_ready",
      name: "我的材质包_1.21_低配版.zip",
      size: 2411724,
      status: "ready",
      progress: 1,
      message: "",
      assetsUrl: "/packs/pack_ready/assets/",
      stats: { blocks: 812, models: 640, quads: 3120, textures: 256, overrides: 27 },
      createdAt: ago(3 * 60)
    },
    {
      id: "pack_baking",
      name: "清新草地_测试包_带自定义天空.zip",
      size: 3774873,
      status: "baking",
      progress: 0.37,
      message: "正在烘焙：assets/minecraft/textures/block",
      assetsUrl: "",
      stats: { blocks: 0, models: 0, quads: 0, textures: 0, overrides: 0 },
      createdAt: ago(1)
    }
  ];
  var CAPS = {
    version: 1,
    projects: true,
    packs: true,
    auth: false,
    maxUploadBytes: 33554432,
    limits: { projects: 200, packs: 5, totalBytes: 536870912 },
    packsSupported: true,
    python: "3.12.4"
  };
  var XSS_PROJECTS = [
    { ...PROJECTS[0], id: "prj_xss", name: '<img src=x onerror="window.__XSS__=1">末地要塞_主塔.litematic' }
  ];
  var XSS_PACKS = [
    { ...PACKS[0], id: "pack_xss", name: '<img src=x onerror="window.__XSS__=2">我的材质包.zip' }
  ];
  function hasAuth(url, init) {
    const headers = init && init.headers || {};
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === "authorization" && String(headers[key]).startsWith("Bearer ")) return true;
    }
    return Boolean(url.searchParams.get("token"));
  }
  function jsonResponse(status, body) {
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => body === null || body === void 0 ? "" : JSON.stringify(body)
    };
  }
  function installMockFetch() {
    window.fetch = async function(input, init) {
      const raw = typeof input === "string" ? input : input && input.url || "";
      const url = new URL(raw, "http://localhost");
      const path = url.pathname;
      const method = String(init && init.method || "GET").toUpperCase();
      if (path === "/api/capabilities") {
        if (scenario === "offline") return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Not Found" } });
        const caps = scenario === "auth" ? { ...CAPS, auth: true } : CAPS;
        return jsonResponse(200, caps);
      }
      if (path === "/api/projects" && method === "GET") {
        if (scenario === "auth" && !hasAuth(url, init)) return jsonResponse(401, { error: { code: "UNAUTHORIZED", message: "服务器开启了令牌保护：请填写访问令牌后重试" } });
        if (scenario === "error") return jsonResponse(500, { error: { code: "INTERNAL", message: "服务器内部错误：data/projects 目录不可写" } });
        if (scenario === "empty") return jsonResponse(200, { items: [], storage: { count: 0, bytes: 0, maxBytes: 536870912, maxCount: 200 } });
        const items = scenario === "xss" ? XSS_PROJECTS : PROJECTS;
        return jsonResponse(200, { items, storage: STORAGE });
      }
      if (path === "/api/packs" && method === "GET") {
        if (scenario === "auth" && !hasAuth(url, init)) return jsonResponse(401, { error: { code: "UNAUTHORIZED", message: "服务器开启了令牌保护：请填写访问令牌后重试" } });
        if (scenario === "error") return jsonResponse(500, { error: { code: "INTERNAL", message: "服务器内部错误：烘焙队列不可用" } });
        if (scenario === "empty") return jsonResponse(200, { items: [], storage: { count: 0, bytes: 0, maxBytes: 536870912, maxCount: 5 } });
        const items = scenario === "xss" ? XSS_PACKS : PACKS;
        return jsonResponse(200, { items, storage: { count: items.length, bytes: 6186597, maxBytes: 536870912, maxCount: 5 } });
      }
      const deleteMatch = path.match(/^\/api\/(projects|packs)\/([^/]+)$/);
      if (deleteMatch && method === "DELETE") return jsonResponse(204, null);
      const fileMatch = path.match(/^\/api\/projects\/([^/]+)\/file$/);
      if (fileMatch) return jsonResponse(404, { error: { code: "NOT_FOUND", message: "mock harness 不提供文件下载" } });
      return jsonResponse(404, { error: { code: "NOT_FOUND", message: `mock 未实现：${method} ${path}` } });
    };
  }
  function installMockXHR() {
    class MockXHR {
      constructor() {
        this.upload = {};
        this.status = 0;
        this.responseText = "";
        this.timeout = 0;
        this._headers = {};
      }
      open(method, url) {
        this._method = method;
        this._url = url;
      }
      setRequestHeader(key, value) {
        this._headers[key] = value;
      }
      send(body) {
        const size = body && body.size ? body.size : 1024;
        const emit = (frac) => {
          if (this.upload && typeof this.upload.onprogress === "function") {
            this.upload.onprogress({ lengthComputable: true, loaded: Math.round(size * frac), total: size });
          }
        };
        let step = 0;
        const timer = setInterval(() => {
          step += 1;
          emit(Math.min(0.9, step * 0.15));
          if (scenario === "upload45") {
            if (step >= 3) clearInterval(timer);
            return;
          }
          if (step >= 7) {
            clearInterval(timer);
            this.status = 201;
            this.responseText = JSON.stringify({ item: PROJECTS[0] });
            emit(1);
            if (this.onload) this.onload();
          }
        }, 80);
      }
    }
    window.XMLHttpRequest = MockXHR;
  }
  var REGION_NAMES = [
    ["主塔主体", [128, 96, 144], 1769472],
    ["末地传送门", [24, 24, 24], 13824],
    ["信标基座", [16, 8, 16], 2048],
    ["楼梯与平台", [48, 32, 48], 73728],
    ["外墙装饰", [128, 40, 8], 40960],
    ["内部房间 A", [32, 16, 32], 16384],
    ["内部房间 B", [32, 16, 32], 16384],
    ["地下室", [40, 12, 40], 19200],
    ["塔顶尖刺", [24, 40, 24], 23040],
    ["生物笼", [12, 12, 12], 1728],
    ["红石线路", [64, 4, 64], 16384],
    ["仓库", [32, 20, 32], 20480],
    ["传送台", [16, 16, 16], 4096],
    ["边界墙", [1, 96, 144], 13824],
    ["装饰细节", [24, 24, 24], 13824]
  ];
  var REGIONS = REGION_NAMES.map(([name, size, volume]) => ({
    name,
    size: { x: size[0], y: size[1], z: size[2] },
    volume,
    visible: true
  }));
  var LEGEND = [
    ["minecraft:end_stone_bricks", "末地石砖", 48210, [219, 222, 158]],
    ["minecraft:purpur_block", "紫珀块", 31840, [169, 125, 169]],
    ["minecraft:stone_bricks", "石砖", 26412, [122, 122, 122]],
    ["minecraft:oak_planks", "橡木木板", 14480, [162, 130, 78]],
    ["minecraft:glass", "玻璃", 9620, [200, 226, 230]],
    ["minecraft:sea_lantern", "海晶灯", 4380, [200, 230, 220]],
    ["minecraft:redstone_block", "红石块", 2210, [175, 30, 20]],
    ["minecraft:beacon", "信标", 96, [120, 230, 210]]
  ].map(([id, name, count, color]) => ({ id, name, stateKey: `${id}[default]`, count, color }));
  function buildLeftColumn() {
    const root = document.getElementById("app");
    const refs = buildShell(root);
    if (refs.emptyState) refs.emptyState.hidden = true;
    renderFileCard(refs, {
      fileName: "末地要塞_主塔_最终版_v3.litematic",
      author: "Devon",
      size: { x: 128, y: 96, z: 144 },
      blocks: 182740,
      regions: REGIONS.length,
      mcVersion: "1.21.4",
      dataVersion: 4189,
      warnings: []
    });
    renderRegions(refs, REGIONS, { onToggle() {
    }, onFocus() {
    }, onHover() {
    } });
    renderLegend(refs, LEGEND, { db: null, onSelect() {
    }, filter: "" });
    const fileCard = refs.fileCardBody.closest(".card");
    const librarySection = h("section", { class: "card", id: "libraryCard" });
    const packSection = h("section", { class: "card", id: "packPanel" });
    fileCard.after(librarySection, packSection);
    return { refs, librarySection, packSection };
  }
  async function simulateUpload(librarySection) {
    const input = librarySection.querySelector('input[type="file"]');
    const dt = new DataTransfer();
    dt.items.add(
      new File([new Uint8Array(4096)], "末地要塞_主塔_2026改版_最终确定版.litematic", { type: "application/octet-stream" })
    );
    input.files = dt.files;
    input.dispatchEvent(new Event("change"));
  }
  async function main() {
    installMockFetch();
    installMockXHR();
    try {
      localStorage.removeItem("mcviewer.apiToken");
    } catch (err) {
    }
    const { refs, librarySection, packSection } = buildLeftColumn();
    const library = createLibrary(librarySection, {
      onOpen: async () => {
      },
      onError: () => {
      }
    });
    const packs = createPackPanel(packSection, {
      onApply: async (pack) => {
        packs.setActive(pack && pack.id ? pack.id : null);
      },
      onClear: async () => {
        packs.setActive(null);
      },
      onError: () => {
      }
    });
    window.__PANELS__ = { refs, library, packs, scenario, projects: PROJECTS, packsData: PACKS };
    const caps = await api.capabilities().catch((err) => {
      if (err && err.code === "UNAVAILABLE") return null;
      throw err;
    });
    if (caps && caps.projects) await library.refresh();
    else library.setEnabled(false);
    if (caps && caps.packs) await packs.refresh();
    else packs.setEnabled(false);
    if (caps && (scenario === "default" || scenario === "upload45" || scenario === "hover")) {
      packs.setActive("pack_ready");
    }
    if (scenario === "upload45") await simulateUpload(librarySection);
    hideBoot();
    window.__APP_READY__ = true;
  }
  main().catch((err) => {
    console.error("[panels-harness] 启动失败", err);
    document.body.dataset.harnessError = String(err && err.stack || err);
  });
})();
