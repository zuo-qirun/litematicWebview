// mcviewer —— three.js 场景：相机 / 控制器 / InstancedMesh 构建 / 切片 / 高亮
//
// 渲染哲学（契约 §3）：不加载任何光源，原版式面明暗 + tint 全部烘进顶点色，
// 材质统一 MeshBasicMaterial({ map: atlas, vertexColors: true })。
//   不透明 → 普通 pass；cutout → alphaTest 0.5；半透明 → transparent + depthWrite:false，最后画。
//
// 一个方块状态一个 InstancedMesh（每个 region 一组，便于显隐），
// 另外维护一份"体素栅格"：拾取用 DDA 射线遍历（比逐实例矩阵检测快几个数量级），
// 切片计数也能 O(1) 得出。

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildStateGeometry, missingGeometry } from "./geometry.js";

export const ACCENT = 0x7ee787;
export const ACCENT_HEX = "#7ee787";
export const AMBER = 0xffb454;
export const BG = 0x0b0e14;

const ISO_DIR = new THREE.Vector3(1, 0.82, 1).normalize();
const AIR = new Set(["minecraft:air", "minecraft:cave_air", "minecraft:void_air", "air"]);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** 把 palette 条目规范化成状态字符串 */
export function paletteStateKey(entry) {
  if (!entry) return "minecraft:air";
  if (typeof entry === "string") return entry; // 契约 §2：palette 就是状态字符串数组
  if (entry.stateKey) return entry.stateKey;
  const id = entry.id || entry.Name || "minecraft:air";
  const props = entry.props || entry.Properties || entry.states || null;
  if (!props) return id;
  const keys = Object.keys(props).sort();
  if (!keys.length) return id;
  return `${id}[${keys.map((k) => `${k}=${props[k]}`).join(",")}]`;
}

export class ViewerScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.empty = true;
    this.meshes = [];
    this.regionGroups = new Map(); // regionName → InstancedMesh[]
    this.regionList = [];
    this.hiddenRegionNames = new Set();
    this.wireframe = false;
    this.gridOn = true;
    this.shadowOn = true;
    this.showRegionBorders = false;
    this.slice = { enabled: false, level: 0 };
    this.db = null;
    this.schematic = null;
    this.offset = { x: 0, y: 0, z: 0 };
    this.bounds = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0, sx: 0, sy: 0, sz: 0 };
    this.voxels = null;
    this.stats = { buildMs: 0, blocks: 0, drawnInstances: 0, states: 0, meshes: 0, regions: 0 };
    this.info = { drawCalls: 0, triangles: 0 };
    this._hoverCb = null;
    this._selectCb = null;
    this._frameCbs = new Set();
    this._fps = 0;
    this._fpsAcc = 0;
    this._fpsFrames = 0;
    this._lastT = 0;
    this._needRender = true;
    this._disposed = false;
    this._hlMesh = null;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(BG, 1);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = this._gradientBackground();
    scene.fog = new THREE.Fog(0x0d1119, 500, 2400);
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 30000);
    camera.position.copy(ISO_DIR).multiplyScalar(48);
    this.camera = camera;

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.screenSpacePanning = true;
    controls.maxPolarAngle = Math.PI * 0.499;
    controls.minPolarAngle = 0.02;
    controls.minDistance = 1.5;
    controls.maxDistance = 6000;
    controls.rotateSpeed = 0.85;
    controls.zoomSpeed = 0.95;
    controls.panSpeed = 0.9;
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    // 缩放改成线性的：关掉 OrbitControls 自带的指数 dolly，滚轮/双指由下面自己处理
    controls.enableZoom = false;
    controls.addEventListener("change", () => { this._needRender = true; });
    this.controls = controls;

    this._zoomTarget = null; // 线性缩放的目标相机距离（缓动到它，避免一顿一顿）
    this._bindZoomInput(canvas);

    this.group = new THREE.Group();
    scene.add(this.group);

    this.gridGroup = new THREE.Group();
    this.axisGroup = new THREE.Group();
    scene.add(this.gridGroup, this.axisGroup);

    this.groundShadow = this._makeShadow();
    scene.add(this.groundShadow);

    this.regBoxGroup = new THREE.Group();
    this.regBoxGroup.visible = false;
    scene.add(this.regBoxGroup);

    this.hoverBox = this._makeSelBox(0xffffff, 0.95, 1.0);
    this.selBox = this._makeSelBox(AMBER, 1.0, 1.006);
    scene.add(this.hoverBox, this.selBox);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this._tmpM4 = new THREE.Matrix4();

    const parent = canvas.parentElement || canvas;
    this._io = new ResizeObserver(() => this.resize());
    this._io.observe(parent);
    this.resize();
    this._buildGrid();
    renderer.setAnimationLoop((t) => this._loop(t));
  }

  // ------------------------------------------------------------ 环境装饰
  _gradientBackground() {
    const c = document.createElement("canvas");
    c.width = 4;
    c.height = 256;
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, "#121826");
    grad.addColorStop(0.5, "#0d1119");
    grad.addColorStop(1, "#070a0f");
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }

  _makeSelBox(color, opacity, scale) {
    const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    const mat = new THREE.LineBasicMaterial({
      color, transparent: true, opacity, depthTest: false, depthWrite: false, fog: false,
    });
    const box = new THREE.LineSegments(geo, mat);
    box.renderOrder = 40;
    box.scale.setScalar(scale);
    box.visible = false;
    return box;
  }

  _makeShadow() {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 256;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(128, 128, 4, 128, 128, 126);
    grad.addColorStop(0, "rgba(0,0,0,0.6)");
    grad.addColorStop(0.5, "rgba(0,0,0,0.32)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -0.04;
    mesh.renderOrder = -2;
    mesh.visible = false;
    return mesh;
  }

  _buildGrid() {
    const extent = Math.max(this.bounds.sx || 0, this.bounds.sz || 0, 24);
    let step = 1;
    if (extent > 96) step = 2;
    if (extent > 192) step = 4;
    if (extent > 512) step = 8;
    if (extent > 1600) step = 16;
    const major = 16;
    const half = Math.ceil((extent * 0.5 + major) / step) * step;
    const pos = [];
    const col = [];
    const cMinor = new THREE.Color(0x8398b8).multiplyScalar(0.1);
    const cMajor = new THREE.Color(0x9db4d6).multiplyScalar(0.24);
    const y = -0.015;
    for (let v = -half; v <= half; v += step) {
      const isMajor = ((v % major) + major) % major === 0;
      if (!isMajor && Math.abs(v) > extent * 0.75) continue;
      const c = isMajor ? cMajor : cMinor;
      pos.push(-half, y, v, half, y, v);
      pos.push(v, y, -half, v, y, half);
      for (let i = 0; i < 4; i++) col.push(c.r, c.g, c.b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.62, depthWrite: false, fog: false,
    });
    const lines = new THREE.LineSegments(geo, mat);
    lines.renderOrder = -1;
    lines.frustumCulled = false;
    this.gridGroup.clear();
    this.gridGroup.add(lines);

    // 坐标轴 gizmo（模型左下角）
    this.axisGroup.clear();
    const ax = Math.min(28, Math.max(6, extent * 0.24));
    const ox = -this.bounds.sx / 2 - 2;
    const oz = -this.bounds.sz / 2 - 2;
    const axes = [
      { v: [ax, 0, 0], color: AMBER },
      { v: [0, ax, 0], color: ACCENT },
      { v: [0, 0, ax], color: 0x58a6ff },
    ];
    for (const a of axes) {
      const g = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(ox, 0, oz),
        new THREE.Vector3(ox + a.v[0], a.v[1], oz + a.v[2]),
      ]);
      this.axisGroup.add(new THREE.Line(g, new THREE.LineBasicMaterial({
        color: a.color, transparent: true, opacity: 0.8, fog: false,
      })));
    }
    this.gridGroup.visible = this.gridOn;
    // 空场景不画坐标轴：画面中央一条绿线容易让人以为渲染出错
    this.axisGroup.visible = this.gridOn && !this.empty;
  }

  _materials(db) {
    if (this.materials) for (const m of Object.values(this.materials)) m.dispose();
    const base = { map: db.atlasTexture, vertexColors: true, fog: true, side: THREE.FrontSide };
    this.materials = {
      opaque: new THREE.MeshBasicMaterial({ ...base }),
      cutout: new THREE.MeshBasicMaterial({ ...base, alphaTest: 0.5, side: THREE.DoubleSide }),
      translucent: new THREE.MeshBasicMaterial({
        ...base, transparent: true, depthWrite: false, alphaTest: 0, side: THREE.DoubleSide,
      }),
      missing: new THREE.MeshBasicMaterial({
        color: 0xff3d9a, transparent: true, opacity: 0.45, depthWrite: false,
        side: THREE.DoubleSide, wireframe: true, fog: false,
      }),
    };
    this.materials.opaque.renderOrder = 0;
    this.materials.cutout.renderOrder = 1;
    this.materials.translucent.renderOrder = 3;
    this.materials.missing.renderOrder = 4;
    return this.materials;
  }

  // ------------------------------------------------------------ 构建
  clear() {
    for (const m of this.meshes) {
      this.group.remove(m);
      m.dispose && m.dispose();
    }
    this.meshes.length = 0;
    this.regionGroups.clear();
    this.regionList = [];
    this.hiddenRegionNames.clear();
    this.regBoxGroup.clear();
    this._regionBoxes = null;
    this.hoverBox.visible = false;
    this.selBox.visible = false;
    this._hlMesh = null;
    this.voxels = null;
    this._regStats = null;
    this._totalBlocks = 0;
    this.empty = true;
    this.slice = { enabled: false, level: 0 };
    this.renderer.clippingPlanes = [];
    this.controls.target.set(0, 0, 0);
    this.camera.position.copy(ISO_DIR).multiplyScalar(48);
    this.bounds = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0, sx: 0, sy: 0, sz: 0 };
    this.groundShadow.visible = false;
    this._buildGrid();
    this.stats = { buildMs: 0, blocks: 0, drawnInstances: 0, states: 0, meshes: 0, regions: 0 };
    this._needRender = true;
  }

  /**
   * 构建整个 schematic（契约 §2 的解析结果）
   * @param {object} schematic
   * @param {import('./db.js').BlockDB} db
   */
  async build(schematic, db, { onProgress } = {}) {
    this.clear();
    this.db = db;
    this.schematic = schematic;
    const t0 = performance.now();
    const mats = this._materials(db);
    // 归一化 region 几何：position 统一为「最小角」，absSize 统一为非负，补齐 volume。
    // .litematic 的 Position 是起始角、Size 可为负，而容器索引始终从最小角出发（见 docs/FORMAT.md）。
    const regions = (schematic.regions || [])
      .filter(Boolean)
      .map((rg, i) => {
        const abs = rg.absSize || {
          x: Math.abs(rg.size?.x ?? 0),
          y: Math.abs(rg.size?.y ?? 0),
          z: Math.abs(rg.size?.z ?? 0),
        };
        let position = rg.min;
        if (!position || position.x === undefined) {
          const p = rg.position || { x: 0, y: 0, z: 0 };
          const s = rg.size || abs;
          position = {
            x: s.x >= 0 ? p.x : p.x + s.x + 1,
            y: s.y >= 0 ? p.y : p.y + s.y + 1,
            z: s.z >= 0 ? p.z : p.z + s.z + 1,
          };
        }
        return {
          ...rg,
          name: rg.name || `region-${i}`,
          absSize: abs,
          position,
          volume: rg.volume ?? abs.x * abs.y * abs.z,
        };
      });
    if (!regions.length) {
      this.stats = { ...this.stats, buildMs: 0 };
      return this.stats;
    }

    // ---- 1. 全局包围盒
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const rg of regions) {
      const p = rg.position || { x: 0, y: 0, z: 0 };
      const s = rg.absSize || rg.size || { x: 1, y: 1, z: 1 };
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); minZ = Math.min(minZ, p.z);
      maxX = Math.max(maxX, p.x + s.x); maxY = Math.max(maxY, p.y + s.y); maxZ = Math.max(maxZ, p.z + s.z);
    }
    if (!isFinite(minX)) { minX = minY = minZ = 0; maxX = maxY = maxZ = 1; }
    this.bounds = { minX, minY, minZ, maxX, maxY, maxZ, sx: maxX - minX, sy: maxY - minY, sz: maxZ - minZ };
    this.offset = { x: -(minX + maxX) / 2, y: -minY, z: -(minZ + maxZ) / 2 };
    const oy = this.offset.y;
    const height = Math.max(1, Math.ceil(this.bounds.sy));

    this.regionList = regions.map((rg, i) => ({
      index: i,
      name: rg.name || `region-${i}`,
      position: rg.position || { x: 0, y: 0, z: 0 },
      size: rg.absSize || rg.size || { x: 0, y: 0, z: 0 },
      volume: rg.volume,
      paletteSize: (rg.palette || []).length,
      warnings: rg.warnings || [],
    }));

    // ---- 2. 逐 region 统计（只做数字运算，不碰字符串）
    const regStats = [];
    let total = 0;
    for (let ri = 0; ri < regions.length; ri++) {
      const rg = regions[ri];
      const rs = this.regionList[ri];
      const abs = rg.absSize || rg.size || { x: 0, y: 0, z: 0 };
      const sx = Math.max(1, abs.x | 0), sy = Math.max(1, abs.y | 0), sz = Math.max(1, abs.z | 0);
      const palette = rg.palette || [];
      const indices = rg.indices;
      const cumY = new Uint32Array(height + 2);
      const palKeys = new Array(palette.length);
      const palVisible = new Uint8Array(palette.length);
      const palCount = new Uint32Array(palette.length);
      for (let pi = 0; pi < palette.length; pi++) {
        const sk = paletteStateKey(palette[pi]);
        palKeys[pi] = sk;
        if (AIR.has(sk.split("[")[0])) continue;
        if (db.isInvisible(sk)) continue;
        palVisible[pi] = 1;
      }
      const py = rs.position.y || 0;
      const volume = indices ? Math.min(sx * sy * sz, indices.length) : 0;
      const sxz = sx * sz;
      if (volume) {
        for (let i = 0; i < volume; i++) {
          const pi = indices[i];
          if (pi >= palette.length || !palVisible[pi]) continue;
          palCount[pi]++;
          const my = (py + ((i / sxz) | 0) - minY) | 0;
          if (my >= 0 && my < cumY.length) cumY[my + 1]++;
          total++;
        }
      }
      for (let i = 1; i < cumY.length; i++) cumY[i] += cumY[i - 1];
      // stateKey → 数量
      const counts = new Map();
      for (let pi = 0; pi < palette.length; pi++) {
        if (!palCount[pi]) continue;
        const sk = palKeys[pi];
        counts.set(sk, (counts.get(sk) || 0) + palCount[pi]);
      }
      regStats.push({ ri, name: rs.name, sx, sy, sz, cumY, counts, palKeys, palCount, position: rs.position });
      this.regionGroups.set(rs.name, []);
      if (onProgress) onProgress(((ri + 1) / regions.length) * 0.4, `统计 Region ${rs.name}`);
      await nextFrame();
    }
    this._regStats = regStats;
    this._totalBlocks = total;

    // ---- 2b. 按需下载本投影实际用到的方块模型（modelsMode=files 时）
    // 契约见 docs/CONTRACT.md §1：assets/models/<encodeModelId(id)>.json
    if (db && db._modelsMode === "files" && !db.fallback && typeof db.ensureModels === "function") {
      const wantIds = new Set();
      for (const rs of regStats) {
        for (const sk of rs.counts.keys()) {
          const res = db.resolve(sk);
          if (!res) continue;
          for (const mid of res) if (!mid.startsWith("fb:")) wantIds.add(mid);
        }
      }
      if (wantIds.size) {
        if (onProgress) onProgress(0.4, `下载方块模型（${wantIds.size} 个）`);
        await db.ensureModels(wantIds, (frac, msg) => {
          if (onProgress) onProgress(0.4 + frac * 0.1, msg);
        });
      }
    }

    // ---- 3. 分配并填充实例矩阵
    for (let ki = 0; ki < regions.length; ki++) {
      const rg = regions[ki];
      const rs = regStats[ki];
      const abs = rg.absSize || rg.size || { x: 0, y: 0, z: 0 };
      const sx = rs.sx, sy = rs.sy, sz = rs.sz;
      void abs; void sy;
      const palette = rg.palette || [];
      const slotByState = new Map();
      for (const [sk, n] of rs.counts) slotByState.set(sk, { data: new Float32Array(n * 16), n: 0 });
      const palSlot = new Array(palette.length);
      for (let pi = 0; pi < palette.length; pi++) {
        if (!rs.palCount[pi]) continue;
        palSlot[pi] = slotByState.get(rs.palKeys[pi]);
      }
      const indices = rg.indices;
      const volume = indices ? Math.min(sx * sy * sz, indices.length) : 0;
      const sxz = sx * sz;
      const px = rs.position.x || 0, py = rs.position.y || 0, pz = rs.position.z || 0;
      const ox = this.offset.x, oz = this.offset.z;
      for (let i = 0; i < volume; i++) {
        const pi = indices[i];
        const slot = pi < palette.length ? palSlot[pi] : undefined;
        if (!slot) continue;
        const x = i % sx;
        const z = ((i / sx) | 0) % sz;
        const y = (i / sxz) | 0;
        const o = slot.n * 16;
        const d = slot.data;
        d[o] = 1; d[o + 5] = 1; d[o + 10] = 1; d[o + 15] = 1;
        d[o + 12] = px + x + ox;
        d[o + 13] = py + y + oy;
        d[o + 14] = pz + z + oz;
        slot.n++;
      }
      // 建 InstancedMesh
      const group = this.regionGroups.get(rs.name);
      for (const [sk, slot] of slotByState) {
        if (!slot.n) continue;
        const built = buildStateGeometry(db, sk);
        const kind = built ? db.renderKind(sk) : "missing";
        const geo = built ? built.geometry : missingGeometry();
        const inst = new THREE.InstancedMesh(geo, mats[kind], slot.n);
        inst.instanceMatrix = new THREE.InstancedBufferAttribute(slot.data.subarray(0, slot.n * 16), 16);
        inst.instanceMatrix.needsUpdate = true;
        inst.frustumCulled = false;
        inst.computeBoundingSphere();
        inst.userData = {
          stateKey: sk,
          regionName: rs.name,
          regionIndex: ki,
          quadCount: built ? built.quadCount : 0,
        };
        this.group.add(inst);
        this.meshes.push(inst);
        if (group) group.push(inst);
      }
      if (onProgress) onProgress(0.5 + ((ki + 1) / regions.length) * 0.35, `生成实例 ${rs.name}`);
      await nextFrame();
    }
    const drawn = this.meshes.reduce((a, m) => a + m.count, 0);

    // ---- 4. 体素栅格
    this._buildVoxels(regions, regStats);

    // ---- 5. Region 边框 / 地面网格 / 阴影
    this.empty = false; // 先落位：_buildGrid 会据此决定是否显示坐标轴
    this._buildRegionBoxes();
    this._buildGrid();
    const radial = Math.max(8, Math.hypot(this.bounds.sx, this.bounds.sz) * 0.75);
    this.groundShadow.scale.set(radial * 1.5, radial * 1.5, 1);
    this.groundShadow.visible = this.shadowOn;

    // ---- 6. 初始视角
    this.frameAll();
    if (onProgress) onProgress(1, "完成");

    this.stats = {
      buildMs: Math.round(performance.now() - t0),
      blocks: total,
      drawnInstances: drawn,
      states: this.meshes.length,
      regionStates: this.meshes.length,
      meshes: this.meshes.length,
      regions: regions.length,
      missing: db.missingCount,
    };
    this._applySlice();
    this._needRender = true;
    return this.stats;
  }

  _buildVoxels(regions, regStats) {
    const b = this.bounds;
    const sx = Math.max(1, b.maxX - b.minX), sy = Math.max(1, b.maxY - b.minY), sz = Math.max(1, b.maxZ - b.minZ);
    const vol = sx * sy * sz;
    if (vol > 24_000_000) { this.voxels = null; return; }
    const cells = new Uint32Array(vol);
    const regionOf = new Uint16Array(vol);
    const stateIndex = new Map();
    const stateKeys = [];
    for (let ki = 0; ki < regions.length; ki++) {
      const rg = regions[ki];
      const rs = regStats[ki];
      const palette = rg.palette || [];
      const indices = rg.indices;
      if (!indices) continue;
      const palStateIdx = new Int32Array(palette.length).fill(-1);
      for (let pi = 0; pi < palette.length; pi++) {
        const sk = rs.palKeys[pi];
        if (AIR.has(sk.split("[")[0])) continue;
        if (this.db.isInvisible(sk)) continue;
        let i = stateIndex.get(sk);
        if (i === undefined) { i = stateKeys.length; stateIndex.set(sk, i); stateKeys.push(sk); }
        palStateIdx[pi] = i;
      }
      const px = rs.position.x || 0, py = rs.position.y || 0, pz = rs.position.z || 0;
      const volume = Math.min(rs.sx * rs.sy * rs.sz, indices.length);
      const rsx = rs.sx, rsz = rs.sz, rsxz = rsx * rsz;
      for (let i = 0; i < volume; i++) {
        const pi = indices[i];
        if (pi >= palette.length) continue;
        const si = palStateIdx[pi];
        if (si < 0) continue;
        const x = i % rsx;
        const z = ((i / rsx) | 0) % rsz;
        const y = (i / rsxz) | 0;
        const gx = px + x - b.minX, gy = py + y - b.minY, gz = pz + z - b.minZ;
        if (gx < 0 || gy < 0 || gz < 0 || gx >= sx || gy >= sy || gz >= sz) continue;
        const ci = (gx + sx * gz + sx * sz * gy) | 0;
        cells[ci] = si + 1;
        regionOf[ci] = ki + 1;
      }
    }
    this.voxels = {
      sx, sy, sz,
      minX: b.minX, minY: b.minY, minZ: b.minZ,
      cells, regionOf, stateKeys,
      regionVisible: new Uint8Array(regions.length + 1).fill(1),
      regionNames: this.regionList.map((r) => r.name),
    };
  }

  _buildRegionBoxes() {
    this.regBoxGroup.clear();
    this._regionBoxes = new Map();
    for (const r of this.regionList) {
      const p = r.position;
      const s = r.size;
      const w = Math.max(1, s.x), h = Math.max(1, s.y), d = Math.max(1, s.z);
      const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d));
      const mat = new THREE.LineBasicMaterial({
        color: ACCENT, transparent: true, opacity: 0.45, depthTest: false, depthWrite: false, fog: false,
      });
      const box = new THREE.LineSegments(geo, mat);
      box.position.set(
        p.x + w / 2 + this.offset.x,
        p.y + h / 2 + this.offset.y,
        p.z + d / 2 + this.offset.z
      );
      box.renderOrder = 30;
      this.regBoxGroup.add(box);
      this._regionBoxes.set(r.name, box);
    }
    this.regBoxGroup.visible = this.showRegionBorders;
  }

  // ------------------------------------------------------------ 渲染循环
  resize() {
    const parent = this.canvas.parentElement || this.canvas;
    const w = Math.max(1, Math.round(parent.clientWidth || 1));
    const h = Math.max(1, Math.round(parent.clientHeight || 1));
    if (w === this._w && h === this._h) return;
    this._w = w;
    this._h = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._needRender = true;
  }

  // ------------------------------------------------------------ 线性缩放
  /** 每格滚轮走过的世界距离：随模型规模定标，同一次缩放内是常数（这才是"线性"） */
  _zoomStepSize() {
    const b = this.bounds || {};
    const diag = Math.hypot(b.sx || 16, b.sy || 16, b.sz || 16);
    return Math.max(0.12, Math.min(2.5, diag / 60));
  }

  /** 以目标点为中心沿视线前后移动 steps 格（正数=拉远） */
  _zoomBy(steps) {
    const tgt = this.controls && this.controls.target;
    if (!tgt || !steps) return;
    const cur = this.camera.position.distanceTo(tgt);
    const base = this._zoomTarget == null ? cur : this._zoomTarget;
    const want = base + steps * this._zoomStepSize();
    this._zoomTarget = Math.max(this.controls.minDistance, Math.min(this.controls.maxDistance, want));
    this._needRender = true;
  }

  _bindZoomInput(canvas) {
    canvas.addEventListener(
      "wheel",
      (e) => {
        if (this._disposed) return;
        e.preventDefault();
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 240 : 1; // 行 / 页 → 像素
        const px = e.deltaY * unit;
        if (!px) return;
        // 一"格"（100px）算一次；触控板/ctrl+滚轮（捏合）减半，避免过于灵敏
        const notch = Math.max(-3, Math.min(3, px / 100)) * (e.ctrlKey ? 0.5 : 1);
        this._zoomBy(notch); // 上滚（deltaY<0）→ 拉近，和多数 3D 查看器一致
      },
      { passive: false }
    );

    // 触屏双指捏合：按两指距离变化线性缩放（每 40px ≈ 一格滚轮）
    const span = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    let prev = 0;
    canvas.addEventListener("touchstart", (e) => {
      prev = e.touches.length === 2 ? span(e.touches) : 0;
    }, { passive: true });
    canvas.addEventListener("touchmove", (e) => {
      if (e.touches.length !== 2) { prev = 0; return; }
      const d = span(e.touches);
      if (!prev) { prev = d; return; }
      this._zoomBy(-(d - prev) / 40); // 张开 → 拉近
      prev = d;
    }, { passive: true });
    canvas.addEventListener("touchend", () => { prev = 0; }, { passive: true });
  }

  /** 每帧把相机距离缓动到 _zoomTarget */
  _applyZoomEase(dt) {
    if (this._zoomTarget == null) return;
    const tgt = this.controls.target;
    const dir = new THREE.Vector3().subVectors(this.camera.position, tgt);
    const cur = dir.length();
    if (cur < 1e-6) { this._zoomTarget = null; return; }
    const diff = this._zoomTarget - cur;
    const eps = Math.max(0.0015, this._zoomTarget * 0.0012);
    if (Math.abs(diff) <= eps) {
      this.camera.position.copy(tgt).add(dir.setLength(this._zoomTarget));
      this._zoomTarget = null;
      this._needRender = true;
      return;
    }
    this.camera.position.copy(tgt).add(dir.setLength(cur + diff * Math.min(1, dt / 90)));
    this._needRender = true;
  }

  _loop(t) {
    if (this._disposed) return;
    const dt = this._lastT ? t - this._lastT : 16;
    this._lastT = t;
    this._fpsAcc += dt;
    this._fpsFrames++;
    if (this._fpsAcc > 350) {
      this._fps = Math.round(1000 / (this._fpsAcc / this._fpsFrames));
      this._fpsAcc = 0;
      this._fpsFrames = 0;
    }
    this._applyZoomEase(dt);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this._needRender = false;
    const info = this.renderer.info;
    this.info = {
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      lines: info.render.lines,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
    };
    for (const cb of this._frameCbs) cb(this);
  }

  get fps() { return this._fps || 60; }

  onFrame(cb) {
    this._frameCbs.add(cb);
    return () => this._frameCbs.delete(cb);
  }

  // ------------------------------------------------------------ 视角
  worldOf(x, y, z) {
    return new THREE.Vector3(x + this.offset.x, y + this.offset.y, z + this.offset.z);
  }

  _fitDistance(radius) {
    const fov = (this.camera.fov * Math.PI) / 180;
    return (radius / Math.sin(fov / 2)) * 1.06;
  }

  _lookAt(center, dir, radius) {
    const d = this._fitDistance(Math.max(1, radius));
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir.clone().normalize(), d);
    this.controls.minDistance = Math.max(0.8, Math.min(this.bounds.sy || 8, 8) * 0.3);
    this.controls.maxDistance = Math.max(60, d * 6);
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this._zoomTarget = null; // 视角切换后线性缩放从当前距离重新起算
    this._needRender = true;
  }

  frameAll() {
    const b = this.bounds;
    const radius = Math.max(2, Math.hypot(b.sx, b.sy, b.sz) / 2);
    this._lookAt(new THREE.Vector3(0, b.sy / 2, 0), ISO_DIR.clone(), radius);
  }

  applyPreset(name) {
    const b = this.bounds;
    const radius = Math.max(2, Math.hypot(b.sx, b.sy, b.sz) / 2);
    const center = new THREE.Vector3(0, b.sy / 2, 0);
    const dirs = {
      iso: new THREE.Vector3(1, 0.82, 1),
      top: new THREE.Vector3(0.0001, 1, 0.0001),
      front: new THREE.Vector3(0, 0.06, 1),
      side: new THREE.Vector3(1, 0.06, 0),
    };
    this._lookAt(center, dirs[name] || dirs.iso, radius);
    return name;
  }

  focusBlock(x, y, z) {
    const p = this.worldOf(x + 0.5, y + 0.5, z + 0.5);
    const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target).normalize();
    const cur = this.camera.position.distanceTo(this.controls.target);
    this._lookAt(p, dir, Math.max(3, Math.min(cur / 2.4, 24)));
  }

  focusRegion(name) {
    const r = this.regionList.find((v) => v.name === name);
    if (!r) return;
    const s = r.size, p = r.position;
    const c = this.worldOf(p.x + s.x / 2, p.y + s.y / 2, p.z + s.z / 2);
    this._lookAt(c, new THREE.Vector3().subVectors(this.camera.position, this.controls.target).normalize(),
      Math.max(4, Math.hypot(s.x, s.y, s.z) / 2));
  }

  // ------------------------------------------------------------ 显示开关
  setWireframe(on) {
    this.wireframe = on;
    for (const k of ["opaque", "cutout", "translucent"]) {
      if (this.materials && this.materials[k]) this.materials[k].wireframe = on;
    }
    this._needRender = true;
  }

  setGridVisible(on) {
    this.gridOn = on;
    this.gridGroup.visible = on;
    this.axisGroup.visible = on;
    this._needRender = true;
  }

  setShadowVisible(on) {
    this.shadowOn = on;
    this.groundShadow.visible = on && !this.empty;
    this._needRender = true;
  }

  setRegionBorders(on) {
    this.showRegionBorders = on;
    this.regBoxGroup.visible = on;
    this._needRender = true;
  }

  highlightRegion(name, on) {
    if (!this._regionBoxes) return;
    const box = this._regionBoxes.get(name);
    if (!box) return;
    box.material.opacity = on ? 1 : 0.45;
    box.material.color.set(on ? AMBER : ACCENT);
    if (on) this.regBoxGroup.visible = true;
    this._needRender = true;
  }

  setRegionVisible(name, visible) {
    const group = this.regionGroups.get(name);
    if (!group) return;
    for (const m of group) m.visible = visible;
    if (visible) this.hiddenRegionNames.delete(name);
    else this.hiddenRegionNames.add(name);
    const ri = this.regionList.findIndex((r) => r.name === name);
    if (this.voxels && ri >= 0) this.voxels.regionVisible[ri + 1] = visible ? 1 : 0;
    const rb = this._regionBoxes && this._regionBoxes.get(name);
    if (rb) rb.visible = visible || this.showRegionBorders;
    this._needRender = true;
  }

  setAllRegionsVisible(visible) {
    for (const r of this.regionList) this.setRegionVisible(r.name, visible);
  }

  // ------------------------------------------------------------ 切片
  setSlice(enabled, level = this.slice.level) {
    this.slice.enabled = enabled;
    this.slice.level = clamp(Math.round(level), 0, Math.max(0, Math.ceil(this.bounds.sy) - 1));
    this._applySlice();
    return this.slice.level;
  }

  stepSlice(delta) {
    const max = Math.max(0, Math.ceil(this.bounds.sy) - 1);
    this.slice.level = clamp(this.slice.level + delta, 0, max);
    this.slice.enabled = true;
    this._applySlice();
    return this.slice.level;
  }

  _applySlice() {
    if (!this.slice.enabled || this.empty) {
      this.renderer.clippingPlanes = [];
    } else {
      // 模型底面贴 y = 0，保留 y <= level + 1
      this.renderer.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), this.slice.level + 1)];
      this.setHover(null, null, null, false);
    }
    this._needRender = true;
  }

  /** 当前实际参与绘制的实例数（受 region 显隐 + 切片影响） */
  drawnInstances() {
    if (!this._regStats) return 0;
    let n = 0;
    const maxLevel = Math.max(0, Math.ceil(this.bounds.sy) - 1);
    for (const rs of this._regStats) {
      if (this.hiddenRegionNames.has(rs.name)) continue;
      if (!this.slice.enabled) {
        let t = 0;
        for (const c of rs.counts.values()) t += c;
        n += t;
      } else {
        const idx = clamp(this.slice.level + 1, 0, rs.cumY.length - 1);
        n += rs.cumY[idx];
      }
    }
    void maxLevel;
    return n;
  }

  // ------------------------------------------------------------ 高亮
  setHover(x, y, z, visible = true) {
    if (!visible || x === null || x === undefined) {
      if (this.hoverBox.visible) { this.hoverBox.visible = false; this._needRender = true; }
      return;
    }
    this.hoverBox.position.set(x + 0.5 + this.offset.x, y + 0.5 + this.offset.y, z + 0.5 + this.offset.z);
    this.hoverBox.visible = true;
    this._needRender = true;
  }

  setSelected(x, y, z, visible = true) {
    if (!visible || x === null || x === undefined) {
      if (this.selBox.visible) { this.selBox.visible = false; this._needRender = true; }
      return;
    }
    this.selBox.position.set(x + 0.5 + this.offset.x, y + 0.5 + this.offset.y, z + 0.5 + this.offset.z);
    this.selBox.visible = true;
    this._needRender = true;
  }

  /** 强调某方块状态的全部实例（图例点击） */
  highlightState(stateKey) {
    if (this._hlMesh) {
      this.group.remove(this._hlMesh);
      this._hlMesh.material.dispose();
      this._hlMesh = null;
    }
    if (!stateKey || !this.db) { this._needRender = true; return 0; }
    const built = buildStateGeometry(this.db, stateKey);
    if (!built) return 0;
    const targets = this.meshes.filter((m) => m.userData.stateKey === stateKey && m.visible);
    let count = 0;
    for (const m of targets) count += m.count;
    if (!count) return 0;
    const mat = new THREE.MeshBasicMaterial({
      color: ACCENT, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    const inst = new THREE.InstancedMesh(built.geometry, mat, count);
    const data = new Float32Array(count * 16);
    const tmp = this._tmpM4;
    const e = tmp.elements;
    let o = 0;
    for (const m of targets) {
      for (let i = 0; i < m.count; i++) {
        m.getMatrixAt(i, tmp);
        const b = o * 16;
        const s = 1.03;
        data[b] = e[0] * s; data[b + 5] = e[5] * s; data[b + 10] = e[10] * s; data[b + 15] = 1;
        data[b + 12] = e[12] - 0.015;
        data[b + 13] = e[13] - 0.015;
        data[b + 14] = e[14] - 0.015;
        o++;
      }
    }
    inst.instanceMatrix = new THREE.InstancedBufferAttribute(data, 16);
    inst.instanceMatrix.needsUpdate = true;
    inst.frustumCulled = false;
    inst.renderOrder = 5;
    inst.userData = { stateKey, kind: "highlight" };
    this.group.add(inst);
    this._hlMesh = inst;
    this._needRender = true;
    return count;
  }

  // ------------------------------------------------------------ 拾取
  _rayFromNdc(nx, ny) {
    this.pointer.set(nx, ny);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.ray;
  }

  pickAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    const ray = this._rayFromNdc(nx, ny);
    if (this.empty) return null;
    return this.voxels ? this._pickVoxel(ray) : this._pickInstances(ray);
  }

  _pickVoxel(ray) {
    const v = this.voxels;
    const origin = ray.origin, dir = ray.direction;
    // 世界 → 栅格局部（格子 [0,1)）
    const ox = origin.x - this.offset.x - v.minX;
    const oy = origin.y - this.offset.y - v.minY;
    const oz = origin.z - this.offset.z - v.minZ;
    // 先用 slab 法把射线裁到栅格包围盒内
    let tEnter = 0, tExit = Infinity;
    const inv = [1 / dir.x, 1 / dir.y, 1 / dir.z];
    const o = [ox, oy, oz];
    const sz = [v.sx, v.sy, v.sz];
    for (let a = 0; a < 3; a++) {
      const iv = inv[a];
      if (!isFinite(iv)) {
        if (o[a] < 0 || o[a] > sz[a]) return null;
        continue;
      }
      let t0 = (0 - o[a]) * iv;
      let t1 = (sz[a] - o[a]) * iv;
      if (t0 > t1) { const tt = t0; t0 = t1; t1 = tt; }
      if (t0 > tEnter) tEnter = t0;
      if (t1 < tExit) tExit = t1;
      if (tEnter > tExit) return null;
    }
    let px = ox + dir.x * tEnter;
    let py = oy + dir.y * tEnter;
    let pz = oz + dir.z * tEnter;
    // 推进一点点，避免正好落在格子边界上
    const EPS = 1e-4;
    px += dir.x * EPS; py += dir.y * EPS; pz += dir.z * EPS;
    let t = tEnter + EPS;
    let ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
    const stepX = dir.x > 0 ? 1 : dir.x < 0 ? -1 : 0;
    const stepY = dir.y > 0 ? 1 : dir.y < 0 ? -1 : 0;
    const stepZ = dir.z > 0 ? 1 : dir.z < 0 ? -1 : 0;
    const INF = Infinity;
    const tDeltaX = stepX ? Math.abs(1 / dir.x) : INF;
    const tDeltaY = stepY ? Math.abs(1 / dir.y) : INF;
    const tDeltaZ = stepZ ? Math.abs(1 / dir.z) : INF;
    let tMaxX = stepX ? (stepX > 0 ? ix + 1 - px : px - ix) * tDeltaX : INF;
    let tMaxY = stepY ? (stepY > 0 ? iy + 1 - py : py - iy) * tDeltaY : INF;
    let tMaxZ = stepZ ? (stepZ > 0 ? iz + 1 - pz : pz - iz) * tDeltaZ : INF;
    let axis = -1;
    const maxSteps = 8192;
    const sliceOn = this.slice.enabled;
    const sliceLevel = this.slice.level;
    for (let s = 0; s < maxSteps && t <= tExit + 0.0001; s++) {
      if (ix >= 0 && iy >= 0 && iz >= 0 && ix < v.sx && iy < v.sy && iz < v.sz) {
        const ci = ix + v.sx * iz + v.sx * v.sz * iy;
        const sv = v.cells[ci];
        if (sv && v.regionVisible[v.regionOf[ci]] !== 0) {
          if (!sliceOn || iy <= sliceLevel) {
            const stateKey = v.stateKeys[sv - 1];
            const regionIdx = v.regionOf[ci] - 1;
            return {
              x: ix + v.minX,
              y: iy + v.minY,
              z: iz + v.minZ,
              stateKey,
              regionName: v.regionNames[regionIdx],
              regionIndex: regionIdx,
              normal: axis === 0 ? [-stepX, 0, 0] : axis === 1 ? [0, -stepY, 0] : axis === 2 ? [0, 0, -stepZ] : [0, 1, 0],
              point: { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t },
              distance: t,
            };
          }
        }
      }
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        ix += stepX; t = tMaxX; tMaxX += tDeltaX; axis = 0;
      } else if (tMaxY < tMaxZ) {
        iy += stepY; t = tMaxY; tMaxY += tDeltaY; axis = 1;
      } else {
        iz += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; axis = 2;
      }
    }
    return null;
  }

  _pickInstances(ray) {
    const hits = this.raycaster.intersectObjects(this.meshes.filter((m) => m.visible), false);
    for (const h of hits) {
      const inst = h.object;
      if (inst.userData.kind === "highlight") continue;
      const local = new THREE.Matrix4();
      inst.getMatrixAt(h.instanceId, local);
      const e = local.elements;
      // 世界 → 原始坐标
      const x = Math.round(e[12] - this.offset.x);
      const y = Math.round(e[13] - this.offset.y);
      const z = Math.round(e[14] - this.offset.z);
      if (this.slice.enabled && y - this.offset.y > this.slice.level) continue;
      return {
        x, y, z,
        stateKey: inst.userData.stateKey,
        regionName: inst.userData.regionName,
        regionIndex: inst.userData.regionIndex,
        normal: h.face ? h.face.normal.toArray() : [0, 1, 0],
        point: h.point,
        distance: h.distance,
      };
    }
    return null;
  }

  onHover(cb) { this._hoverCb = cb; }
  onSelect(cb) { this._selectCb = cb; }
  emitHover(hit) { this._hoverCb && this._hoverCb(hit); }
  emitSelect(hit) { this._selectCb && this._selectCb(hit); }

  // ------------------------------------------------------------ 截图
  screenshot() {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL("image/png");
  }

  get webglInfo() {
    try {
      const gl = this.renderer.getContext();
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      return {
        version: gl.getParameter(gl.VERSION),
        renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "unknown",
      };
    } catch (e) {
      return { version: "unknown", renderer: "unknown" };
    }
  }

  dispose() {
    this._disposed = true;
    this.renderer.setAnimationLoop(null);
    this.clear();
    this._io && this._io.disconnect();
    for (const m of Object.values(this.materials || {})) m.dispose();
    if (this._hlMesh) this._hlMesh.material.dispose();
    this.renderer.dispose();
  }
}
