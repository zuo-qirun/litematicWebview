// mcviewer —— 应用外壳（布局骨架 + 固定 UI），返回 DOM 引用集合
//
// 只构建静态结构；内容填充交给 panels.js / inspector.js，行为绑定交给 app.js。

import { icons } from "./icons.js";

const tpl = (s) => s.replace(/\s+/g, " ").trim();

export function buildShell(root) {
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
    helpBuild: q("#helpBuild"),
  };
  return refs;
}

/** 显示/隐藏 #boot 启动画面（index.html 里的静态节点） */
export function hideBoot() {
  const boot = document.getElementById("boot");
  if (!boot) return;
  boot.classList.add("boot-done");
  setTimeout(() => boot.setAttribute("hidden", ""), 360);
}
