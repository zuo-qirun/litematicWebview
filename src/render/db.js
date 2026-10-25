// mcviewer —— BlockDB（契约 §3）
//
// 负责：加载 assets/ 的四件套（manifest/blocks/models/lang[/textures]），
// 把"方块状态字符串"映射到已烘焙模型 id 列表，并提供材质分组、着色、本地化名。
// assets/ 缺失或损坏时退回内置程序化资产（fallback-assets.js），页面照常可玩。

import * as THREE from "three";
import {
  CELL,
  fallbackCell,
  fallbackColor,
  fallbackModelFor,
  fallbackZhName,
  createFallbackPack,
} from "./fallback-assets.js";

// ---------------------------------------------------------------- 内置 tint 表（契约 §1.6）
const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const GRASS = hex(0x91bd59);
const FOLIAGE = hex(0x48b518);

export const BUILTIN_TINTS = {
  grass_block: GRASS,
  short_grass: GRASS,
  tall_grass: GRASS,
  fern: GRASS,
  large_fern: GRASS,
  sugar_cane: GRASS,
  oak_leaves: FOLIAGE,
  jungle_leaves: FOLIAGE,
  acacia_leaves: FOLIAGE,
  dark_oak_leaves: FOLIAGE,
  mangrove_leaves: hex(0x8db127),
  birch_leaves: hex(0x80a755),
  spruce_leaves: hex(0x619961),
  vine: FOLIAGE,
  lily_pad: hex(0x208030),
  water: hex(0x3f76e4),
  bubble_column: hex(0x3f76e4),
  redstone_wire: hex(0xff0000),
};

// 关键词兜底（仅在 BlockDef 没有 render 字段时使用）
const RE_TRANSLUCENT = /(^|:)(water|flowing_water|lava|flowing_lava|nether_portal|slime_block|honey_block|tinted_glass|blue_ice|frosted_ice|ice|powder_snow|bubble_column)$/;
const RE_CUTOUT = /(glass|pane|leaves|sapling|flower|tulip|dandelion|poppy|orchid|allium|bluet|daisy|cornflower|fern|grass|vine|coral|lichen|torch|_rail|rail|ladder|chain|bars|hanging_roots|roots|kelp|seagrass|lily_pad|_bush|wheat|carrots|potatoes|beetroots|stem|scaffolding|_sign|banner|_pot|decorated_pot|azalea|moss|sugar_cane|cactus)$/;

function keywordRenderKind(id) {
  const p = id.replace(/^minecraft:/, "");
  if (RE_TRANSLUCENT.test(p)) return "translucent";
  // 玻璃：普通玻璃是 cutout，染色玻璃在原版是 translucent；这里统一 cutout 以免半透明排序问题
  if (/stained_glass|_glass$|^glass/.test(p)) return "cutout";
  if (RE_CUTOUT.test(p)) return "cutout";
  return "opaque";
}

/** 解析 `"id[props]"` → { id, props } */
export function parseStateKey(stateKey) {
  const i = stateKey.indexOf("[");
  if (i < 0) return { id: stateKey, props: EMPTY };
  const id = stateKey.slice(0, i);
  const body = stateKey.slice(i + 1, stateKey.lastIndexOf("]"));
  const props = {};
  let any = false;
  for (const part of body.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    props[part.slice(0, eq)] = part.slice(eq + 1);
    any = true;
  }
  return { id, props: any ? props : EMPTY };
}
const EMPTY = Object.freeze({});

function propsMatch(when, props) {
  for (const k in when) {
    const want = when[k];
    const got = props[k];
    if (Array.isArray(want)) {
      if (!want.includes(got)) return false;
    } else if (got !== want) {
      return false;
    }
  }
  return true;
}

const bufToU8 = (buf) => (buf instanceof Uint8Array ? buf : new Uint8Array(buf));

async function fetchJsonUrl(url, label) {
  const res = await fetch(url, { cache: "default" });
  if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
  const text = await res.text();
  // 大 JSON（blocks.json/models.json）直接用 JSON.parse，比 res.json() 更可控
  return JSON.parse(text);
}

function loadTexture(url) {
  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.load(url, resolve, undefined, reject);
  });
}

export class BlockDB {
  constructor(pack) {
    this.manifest = pack.manifest || {};
    this.meta = pack.meta || {};
    this.blocks = pack.blocks || {}; // id → BlockDef
    this.models = pack.models || {}; // modelId → { quads }
    this.lang = pack.lang || {};
    this.textures = pack.textures || {}; // texPath → [x,y,w,h]
    this.atlasTexture = pack.atlasTexture;
    this.atlasSize = pack.atlasSize || 256;
    this.atlasData = pack.atlasData || null; // fallback 时的原始像素（做图例色块用）
    this.atlasImage = pack.atlasImage || null;
    this.fallback = !!pack.fallback;
    this.sourceUrl = pack.sourceUrl || null;
    this.dataVersion = this.manifest.dataVersion ?? null;
    this._resolveCache = new Map();
    this._nameCache = new Map();
    this._swatchCache = new Map();
    this._dynModels = new Map();
    this.missingStates = new Set();
    this.missingBlocksReported = new Set();
    this._invisibleStates = new Map();
    // 分段加载状态：fallback 包与"一次性 load()"都算已就绪
    this._full = !!(pack.fallback || (pack.blocks && Object.keys(pack.blocks).length > 0));
    this._base = pack.sourceUrl || "./assets/";
    this._version = "";
    this._loadPromise = null;
    // 模型按需加载：manifest.modelsMode === "files" 时 assets/models/ 下每个模型一个 JSON，
    // 打开投影时只下载它实际用到的那些（再靠 ?v= 版本号吃长期缓存）。
    const man = pack.manifest || {};
    this._modelsMode = man.modelsMode === "files" ? "files" : "full";
    this._modelsDir = man.modelsDir || "models";
    this._modelMissing = new Set();
    this._modelsFallbackTried = false;
    this._modelsPromise = null;
  }

  // ------------------------------------------------------------ 加载
  /**
   * 一次加载完所有资产（保留给测试与需要"就绪即完整"的场景）。
   * @param {string} baseUrl 资产根，默认 ./assets/
   * @returns {Promise<BlockDB>}
   */
  static async load(baseUrl = "./assets/") {
    const db = await BlockDB.loadStaged(baseUrl);
    await db.ensureLoaded();
    return db;
  }

  /**
   * 分两段加载：先只拿 manifest/meta（几 KB，够渲染空态 UI 与面板），
   * 真正要画方块时再 ensureLoaded() 拉 blocks/models/lang/atlas。
   * 这样首页不用为了看一眼界面去下 9MB 的 models.json。
   */
  static async loadStaged(baseUrl = "./assets/") {
    const base = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";
    const pack = { sourceUrl: base };
    pack.manifest = await fetchJsonUrl(base + "manifest.json", "manifest.json");
    pack.meta = await fetchJsonUrl(base + "meta.json", "meta.json").catch(() => ({}));
    const db = new BlockDB(pack);
    db._base = base;
    db._version = pack.manifest && pack.manifest.version ? String(pack.manifest.version) : "";
    db._full = false;
    db._loadPromise = null;
    return db;
  }

  get isReady() {
    return this._full !== false;
  }

  /** 资源 URL：带构建版本号，命中服务端 immutable 缓存 */
  _url(name) {
    return this._base + name + (this._version ? "?v=" + encodeURIComponent(this._version) : "");
  }

  /** 模型 id → 单文件模型名（必须与 tools/bake 的 model_file_name 一致） */
  static encodeModelId(id) {
    return String(id).replace(/\//g, "$").replace(/#/g, "@").replace(/,/g, "!");
  }

  /** 单个模型的 URL（带版本号） */
  modelFileUrl(modelId) {
    const name = BlockDB.encodeModelId(modelId);
    return this._base + this._modelsDir + "/" + name + ".json" + (this._version ? "?v=" + encodeURIComponent(this._version) : "");
  }

  /**
   * 按需下载模型（仅 modelsMode=files 时有效）。
   * 已下载/已知缺失的会跳过；并发 8；某个文件 404 时整体回退到 models.json（兼容旧产物）。
   * @param {Iterable<string>} ids 模型 id
   * @param {(frac:number,msg:string)=>void} [onProgress]
   */
  async ensureModels(ids, onProgress) {
    if (this._modelsMode !== "files" || this.fallback || !ids) return 0;
    if (!this.models) this.models = Object.create(null);
    const need = [];
    const seen = new Set();
    for (const id of ids) {
      if (!id || seen.has(id) || id.startsWith("fb:")) continue;
      seen.add(id);
      if (this.models[id] || this._modelMissing.has(id)) continue;
      need.push(id);
    }
    if (need.length === 0) return 0;
    if (this._modelsPromise) {
      // 同一时刻只跑一批：等前一批结束后再看还缺哪些
      await this._modelsPromise.catch(() => {});
      return this.ensureModels(seen, onProgress);
    }

    const total = need.length;
    let done = 0;
    const report = () => {
      try {
        onProgress && onProgress(done / total, `下载方块模型 ${done}/${total}`);
      } catch {
        /* 进度回调不影响加载 */
      }
    };
    const queue = need.slice();
    const worker = async () => {
      while (queue.length) {
        const id = queue.shift();
        if (this.models[id]) {
          done++;
          continue;
        }
        try {
          const res = await fetch(this.modelFileUrl(id), { cache: "default" });
          if (!res.ok) throw new Error("HTTP " + res.status);
          const data = await res.json();
          this.models[id] = Array.isArray(data) ? { quads: data } : data;
        } catch {
          this._modelMissing.add(id);
          if (!this._modelsFallbackTried) {
            this._modelsFallbackTried = true;
            await this._loadFullModels().catch(() => {});
            return;
          }
        }
        done++;
        report();
      }
    };

    this._modelsPromise = (async () => {
      const workers = [];
      const n = Math.min(8, queue.length);
      for (let i = 0; i < n; i++) workers.push(worker());
      await Promise.all(workers);
    })();
    try {
      await this._modelsPromise;
    } finally {
      this._modelsPromise = null;
    }
    return done;
  }

  /** 回退：一次性拉全量 models.json，并把 resolve 缓存作废 */
  async _loadFullModels() {
    const raw = await fetchJsonUrl(this._url("models.json"), "models.json");
    const all = raw && raw.models ? raw.models : raw || {};
    const merged = Object.assign(Object.create(null), all, this.models || {});
    this.models = merged;
    this._modelsMode = "full";
    this._resolveCache = new Map();
  }

  /** 拉取重资产（幂等、并发安全） */
  ensureLoaded(onProgress) {
    if (this._full) return Promise.resolve(this);
    if (this._loadPromise) return this._loadPromise;
    this._loadPromise = this._loadHeavy(onProgress).then(
      () => {
        this._full = true;
        this._loadPromise = null;
        return this;
      },
      (err) => {
        this._loadPromise = null;
        throw err;
      }
    );
    return this._loadPromise;
  }

  async _loadHeavy(onProgress) {
    const step = (p, msg) => {
      try {
        onProgress && onProgress(p, msg);
      } catch {
        /* 进度回调不影响加载 */
      }
    };

    step(0.05, "加载方块定义");
    const blocks = await fetchJsonUrl(this._url("blocks.json"), "blocks.json");
    this.blocks = blocks && blocks.blocks ? blocks.blocks : blocks || {};

    step(0.35, "加载方块模型");
    if (this._modelsMode === "files") {
      // 按需模式下这里不拉 models.json：等 scene.build 收集到实际用到的模型再逐个下载
      this.models = Object.create(null);
    } else {
      const modelsRaw = await fetchJsonUrl(this._url("models.json"), "models.json");
      this.models = modelsRaw && modelsRaw.models ? modelsRaw.models : modelsRaw || {};
    }

    step(0.8, "加载名称表");
    const lang = await fetchJsonUrl(this._url("lang.json"), "lang.json").catch(() => ({}));
    this.lang = lang && lang.lang ? lang.lang : lang || {};

    // textures.json 可选：新版烘焙把图集 uv 直接烘进 models.json；只有 manifest 声明了才请求，
    // 否则会白拿一个 404（控制台噪声 + e2e 误判）。manifest.files 既可能是数组也可能是对象。
    const files = this.manifest.files;
    const wantTex = !files
      ? true
      : Array.isArray(files)
        ? files.includes("textures")
        : Object.prototype.hasOwnProperty.call(files, "textures");
    const tex = wantTex ? await fetchJsonUrl(this._url("textures.json"), "textures.json").catch(() => ({})) : {};
    this.textures = tex && tex.textures ? tex.textures : tex || {};

    step(0.9, "加载纹理图集");
    const atlas = this.manifest.atlas || {};
    this.atlasSize = atlas.size || 1024;
    const pngName = atlas.file || "atlas.png";
    let texture = null;
    if (atlas.webp) {
      try {
        texture = await loadTexture(this._base + atlas.webp + (this._version ? "?v=" + encodeURIComponent(this._version) : ""));
      } catch {
        texture = null; // 没加载到就退回 PNG
      }
    }
    if (!texture) texture = await loadTexture(this._url(pngName));
    const t = texture;
    t.flipY = false; // uv 直接是"图集像素 / 尺寸"，v 向下
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter; // 不用 mipmap：彻底避免相邻方块渗色
    t.generateMipmaps = false;
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = 1;
    t.needsUpdate = true;
    this.atlasTexture = t;
    this.atlasImage = t.image;
    step(1, "资源就绪");
  }

  /** assets/ 不可用时的内置资产 */
  static fallback(reason = "") {
    const pack = createFallbackPack();
    pack.fallbackReason = reason;
    return new BlockDB(pack);
  }

  get isFallback() {
    return this.fallback;
  }

  // ------------------------------------------------------------ 解析状态
  _resolveModels(stateKey, props, id) {
    const def = this.blocks[id];
    if (!def) return null;
    if (def.kind === "variants") {
      const variants = def.variants || [];
      let chosen = null;
      for (const v of variants) {
        if (!v.when) { chosen = v; break; }
        if (propsMatch(v.when, props)) { chosen = v; break; }
      }
      if (!chosen && def.default) return [].concat(def.default);
      if (!chosen) return null;
      return (chosen.models || []).slice();
    }
    if (def.kind === "multipart") {
      const out = [];
      for (const part of def.parts || []) {
        if (!part.when) {
          const m = part.models || [];
          if (m.length) out.push(m[0]);
          continue;
        }
        if (propsMatch(part.when, props)) {
          const m = part.models || [];
          if (m.length) out.push(m[0]);
        }
      }
      return out.length ? out : [];
    }
    // invisible / missing
    return [];
  }

  /** 状态字符串 → 模型 id 列表；找不到返回 null */
  resolve(stateKey) {
    let hit = this._resolveCache.get(stateKey);
    if (hit !== undefined) return hit;
    let result;
    if (!this.blocks || Object.keys(this.blocks).length === 0) {
      // 内置资产：没有 blocks 表，按 id 现算模型
      result = this._fallbackResolve(stateKey);
    } else {
      const { id, props } = parseStateKey(stateKey);
      result = this._resolveModels(stateKey, props, id);
      if (!result || result.length === 0) {
        if (this.fallback) result = this._fallbackResolve(stateKey);
        else if (result && result.length === 0) {
          // 明确 invisible（bubble_column / structure_void 等）
          result = [];
        } else {
          result = null;
        }
      }
      if (result && result.length && this._modelsMode !== "files") {
        // 一次性模式：校验模型存在；不存在则视作缺失
        // （按需模式下模型还没下载，不能在这里判缺失）
        const ok = result.filter((m) => this.models[m] && this.models[m].quads && this.models[m].quads.length);
        if (ok.length === 0) result = null;
        else result = ok;
      }
    }
    if (result === null) this.missingStates.add(stateKey);
    this._resolveCache.set(stateKey, result);
    return result;
  }

  /** 走内置程序化模型 */
  _fallbackResolve(stateKey) {
    const { id, props } = parseStateKey(stateKey);
    const cell = fallbackCell(stateKey);
    const key = `${id}|${JSON.stringify(props)}|${cell}`;
    if (this._dynModels.has(key)) return this._dynModels.get(key);
    const mid = `fb:${key}`;
    const quads = fallbackModelFor(id, props, cell);
    const quadsWithTint = this._applyFallbackTint(quads, id);
    this.models[mid] = { quads: quadsWithTint };
    const r = [mid];
    this._dynModels.set(key, r);
    return r;
  }

  _applyFallbackTint(quads, id) {
    const p = id.replace(/^minecraft:/, "");
    const tintColor = BUILTIN_TINTS[p] || null;
    // 草方块：顶面与侧面（simple cube 的 up/north/south/east/west）着色
    const leafy = /(_leaves|^vine$|^lily_pad$|^water$|^bubble_column$|short_grass|tall_grass|^fern$|sugar_cane)/.test(p);
    return quads.map((q) => {
      let tint = -1;
      if (tintColor) {
        if (p === "grass_block") {
          if (q.n === 1 || q.n === 2 || q.n === 3 || q.n === 4 || q.n === 5) tint = 0;
        } else if (leafy) {
          tint = 0;
        } else if (p === "redstone_wire") {
          tint = 0;
        }
      }
      return tint === -1 ? q : { ...q, tint };
    });
  }

  /** 状态字符串 → 是否不渲染 */
  isInvisible(stateKey) {
    let v = this._invisibleStates.get(stateKey);
    if (v !== undefined) return v;
    const { id } = parseStateKey(stateKey);
    const def = this.blocks[id];
    if (def && (def.kind === "invisible" || def.kind === "missing")) v = true;
    else {
      const models = this.resolve(stateKey);
      v = !models || models.length === 0;
    }
    this._invisibleStates.set(stateKey, v);
    return v;
  }

  /** 状态字符串 → tintindex 0 的着色（UI 用） */
  tint(stateKey) {
    const t = this.tintColors(stateKey);
    if (t && t["0"]) return t["0"];
    const { id } = parseStateKey(stateKey);
    const p = id.replace(/^minecraft:/, "");
    if (this.fallback) return BUILTIN_TINTS[p] ? BUILTIN_TINTS[p].slice() : null;
    // 真实资产里没写 tintColors 但内置表有的（例如烘焙器漏了），仍给 UI 一个颜色
    return BUILTIN_TINTS[p] ? BUILTIN_TINTS[p].slice() : null;
  }

  /** 状态字符串 → { "<tintindex>": [r,g,b] } | null */
  tintColors(stateKey) {
    const { id } = parseStateKey(stateKey);
    const def = this.blocks[id];
    if (def && def.tintColors) return def.tintColors;
    return null;
  }

  renderKind(stateKey) {
    const { id } = parseStateKey(stateKey);
    // 染色玻璃 / 遮光玻璃：atlas 里这些纹理的 alpha 只有 0.4~0.6（实测 white_stained_glass 的
    // 16×16 像素中 191 个 α≈0.4、65 个 α≈0.6），若按 cutout(alphaTest 0.5) 渲染会裁掉 75% 的
    // 像素，白色玻璃墙面变成"雪花点"。原版是 alpha 混合，这里强制归为 translucent。
    if (/(stained_glass|stained_glass_pane|tinted_glass)$/.test(id)) return "translucent";
    const def = this.blocks[id];
    if (def && def.render) return def.render;
    return keywordRenderKind(id);
  }

  displayName(blockId, lang = "zh_cn") {
    const key = blockId + "|" + lang;
    let v = this._nameCache.get(key);
    if (v !== undefined) return v;
    const path = blockId.replace(/^[a-z_]+:/, "");
    const lk = "block." + path;
    let name = null;
    const L = this.lang || {};
    if (L[lang] && L[lang][lk]) name = L[lang][lk];
    if (!name && lang !== "en_us" && L.en_us && L.en_us[lk]) name = L.en_us[lk];
    if (!name && L.zh_cn && L.zh_cn[lk]) name = L.zh_cn[lk];
    if (!name) name = this.fallback ? fallbackZhName(blockId) : path;
    this._nameCache.set(key, name);
    return name;
  }

  /** 图例色块颜色（无 tint 时用兜底颜色表） */
  color(stateKey) {
    const t = this.tint(stateKey);
    if (t) return t;
    const { id } = parseStateKey(stateKey);
    return fallbackColor(id);
  }

  /** 取模型几何（带缓存；内置资产时是现算的） */
  model(modelId) {
    const m = this.models[modelId];
    if (!m) return null;
    if (!m.quads && m.quads !== undefined) return null;
    return m;
  }

  /** 某方块状态在图集上的"顶面贴图矩形"，用于图例缩略图；没有则返回 null */
  topTextureRect(stateKey) {
    const models = this.resolve(stateKey);
    if (!models || !models.length) return null;
    for (const mid of models) {
      const m = this.model(mid);
      if (!m || !m.quads) continue;
      let best = null;
      for (const quad of m.quads) {
        if (quad.n === 1) { best = quad; break; }
      }
      if (!best) best = m.quads.slice().sort((a, b) => area(b) - area(a))[0];
      if (!best) continue;
      const rect = this.textures[best.tex] || null;
      if (rect) return { rect, quad: best, atlasSize: this.atlasSize };
    }
    return null;
  }

  /** 缺模型统计（UI 告警用） */
  get missingCount() {
    return this.missingStates.size;
  }

  /** 举例若干缺失状态，便于排查 */
  missingSample(limit = 5) {
    return [...this.missingStates].slice(0, limit);
  }
}

function area(q) {
  const p = q.p;
  const ax = p[9] - p[0], ay = p[10] - p[1], az = p[11] - p[2];
  const bx = p[3] - p[0], by = p[4] - p[1], bz = p[5] - p[2];
  const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
  return Math.hypot(cx, cy, cz);
}

export { bufToU8, CELL };
