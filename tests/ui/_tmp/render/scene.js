// src/render/scene.js
import * as THREE2 from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// src/render/geometry.js
import * as THREE from "three";
var FACE_SHADE = [0.5, 1, 0.8, 0.8, 0.6, 0.6];
var MAX_CACHED = 4e4;
var cache = /* @__PURE__ */ new Map();
var _geoCacheKey = (stateKey) => stateKey;
function buildStateGeometry(db, stateKey) {
  const hit = cache.get(_geoCacheKey(stateKey));
  if (hit) return hit;
  const modelIds = db.resolve(stateKey);
  if (!modelIds || modelIds.length === 0) return null;
  const tintMap = db.tintColors(stateKey) || null;
  const atlasSize = db.atlasSize || 256;
  let quadTotal = 0;
  for (const mid of modelIds) {
    const m = db.model(mid);
    if (m && m.quads) quadTotal += m.quads.length;
  }
  if (quadTotal === 0) return null;
  const pos = new Float32Array(quadTotal * 12);
  const uv = new Float32Array(quadTotal * 8);
  const col = new Float32Array(quadTotal * 12);
  const idx = new Uint32Array(quadTotal * 6);
  let q = 0;
  for (const mid of modelIds) {
    const m = db.model(mid);
    if (!m || !m.quads) continue;
    for (const quad of m.quads) {
      const p = quad.p;
      const u = quad.uv;
      const n = quad.n | 0;
      let shade = FACE_SHADE[n >= 0 && n < 6 ? n : 1];
      let tr = 1, tg = 1, tb = 1;
      const ti = quad.tint;
      if (ti >= 0 && tintMap) {
        const c = tintMap[String(ti)];
        if (c) {
          tr = c[0];
          tg = c[1];
          tb = c[2];
        }
      }
      const r = shade * tr, g = shade * tg, b = shade * tb;
      const vBase = q * 4;
      for (let i = 0; i < 4; i++) {
        pos[(vBase + i) * 3 + 0] = p[i * 3 + 0] / 16;
        pos[(vBase + i) * 3 + 1] = p[i * 3 + 1] / 16;
        pos[(vBase + i) * 3 + 2] = p[i * 3 + 2] / 16;
        uv[(vBase + i) * 2 + 0] = u[i * 2 + 0] / atlasSize;
        uv[(vBase + i) * 2 + 1] = u[i * 2 + 1] / atlasSize;
        col[(vBase + i) * 3 + 0] = r;
        col[(vBase + i) * 3 + 1] = g;
        col[(vBase + i) * 3 + 2] = b;
      }
      const ib = q * 6;
      idx[ib + 0] = vBase + 0;
      idx[ib + 1] = vBase + 1;
      idx[ib + 2] = vBase + 2;
      idx[ib + 3] = vBase + 0;
      idx[ib + 4] = vBase + 2;
      idx[ib + 5] = vBase + 3;
      q++;
    }
  }
  const geometry = new THREE.BufferGeometry();
  const nq = q;
  geometry.setAttribute("position", new THREE.BufferAttribute(pos.subarray(0, nq * 12), 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv.subarray(0, nq * 8), 2));
  geometry.setAttribute("color", new THREE.BufferAttribute(col.subarray(0, nq * 12), 3));
  geometry.setIndex(new THREE.BufferAttribute(idx.subarray(0, nq * 6), 1));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  geometry.name = `state:${stateKey}`;
  const result = { geometry, quadCount: nq, modelIds };
  if (cache.size > MAX_CACHED) {
    const it = cache.keys();
    for (let i = 0; i < 2e3; i++) {
      const k = it.next();
      if (k.done) break;
      const v = cache.get(k.value);
      if (v && v.geometry) v.geometry.dispose();
      cache.delete(k.value);
    }
  }
  cache.set(_geoCacheKey(stateKey), result);
  return result;
}
var missingGeo = null;
function missingGeometry() {
  if (!missingGeo) {
    missingGeo = new THREE.BoxGeometry(1, 1, 1);
    missingGeo.translate(0.5, 0.5, 0.5);
  }
  return missingGeo;
}

// src/render/scene.js
var ACCENT = 8316807;
var ACCENT_HEX = "#7ee787";
var AMBER = 16757844;
var BG = 724500;
var ISO_DIR = new THREE2.Vector3(1, 0.82, 1).normalize();
var AIR = /* @__PURE__ */ new Set(["minecraft:air", "minecraft:cave_air", "minecraft:void_air", "air"]);
var nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
var clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
function paletteStateKey(entry) {
  if (!entry) return "minecraft:air";
  if (typeof entry === "string") return entry;
  if (entry.stateKey) return entry.stateKey;
  const id = entry.id || entry.Name || "minecraft:air";
  const props = entry.props || entry.Properties || entry.states || null;
  if (!props) return id;
  const keys = Object.keys(props).sort();
  if (!keys.length) return id;
  return `${id}[${keys.map((k) => `${k}=${props[k]}`).join(",")}]`;
}
var ViewerScene = class {
  constructor(canvas) {
    this.canvas = canvas;
    this.empty = true;
    this.meshes = [];
    this.regionGroups = /* @__PURE__ */ new Map();
    this.regionList = [];
    this.hiddenRegionNames = /* @__PURE__ */ new Set();
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
    this._frameCbs = /* @__PURE__ */ new Set();
    this._fps = 0;
    this._fpsAcc = 0;
    this._fpsFrames = 0;
    this._lastT = 0;
    this._needRender = true;
    this._disposed = false;
    this._hlMesh = null;
    const renderer = new THREE2.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
      alpha: false,
      powerPreference: "high-performance"
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE2.SRGBColorSpace;
    renderer.setClearColor(BG, 1);
    this.renderer = renderer;
    const scene = new THREE2.Scene();
    scene.background = this._gradientBackground();
    scene.fog = new THREE2.Fog(856345, 500, 2400);
    this.scene = scene;
    const camera = new THREE2.PerspectiveCamera(38, 1, 0.05, 3e4);
    camera.position.copy(ISO_DIR).multiplyScalar(48);
    this.camera = camera;
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.screenSpacePanning = true;
    controls.maxPolarAngle = Math.PI * 0.499;
    controls.minPolarAngle = 0.02;
    controls.minDistance = 1.5;
    controls.maxDistance = 6e3;
    controls.rotateSpeed = 0.85;
    controls.zoomSpeed = 0.95;
    controls.panSpeed = 0.9;
    controls.mouseButtons = { LEFT: THREE2.MOUSE.ROTATE, MIDDLE: THREE2.MOUSE.DOLLY, RIGHT: THREE2.MOUSE.PAN };
    controls.touches = { ONE: THREE2.TOUCH.ROTATE, TWO: THREE2.TOUCH.DOLLY_PAN };
    controls.addEventListener("change", () => {
      this._needRender = true;
    });
    this.controls = controls;
    this.group = new THREE2.Group();
    scene.add(this.group);
    this.gridGroup = new THREE2.Group();
    this.axisGroup = new THREE2.Group();
    scene.add(this.gridGroup, this.axisGroup);
    this.groundShadow = this._makeShadow();
    scene.add(this.groundShadow);
    this.regBoxGroup = new THREE2.Group();
    this.regBoxGroup.visible = false;
    scene.add(this.regBoxGroup);
    this.hoverBox = this._makeSelBox(16777215, 0.95, 1);
    this.selBox = this._makeSelBox(AMBER, 1, 1.006);
    scene.add(this.hoverBox, this.selBox);
    this.raycaster = new THREE2.Raycaster();
    this.pointer = new THREE2.Vector2();
    this._tmpM4 = new THREE2.Matrix4();
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
    const tex = new THREE2.CanvasTexture(c);
    tex.colorSpace = THREE2.SRGBColorSpace;
    tex.magFilter = THREE2.LinearFilter;
    tex.minFilter = THREE2.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }
  _makeSelBox(color, opacity, scale) {
    const geo = new THREE2.EdgesGeometry(new THREE2.BoxGeometry(1, 1, 1));
    const mat = new THREE2.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthTest: false,
      depthWrite: false,
      fog: false
    });
    const box = new THREE2.LineSegments(geo, mat);
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
    const tex = new THREE2.CanvasTexture(c);
    tex.colorSpace = THREE2.SRGBColorSpace;
    const mat = new THREE2.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
    const mesh = new THREE2.Mesh(new THREE2.PlaneGeometry(1, 1), mat);
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
    const half = Math.ceil((extent * 0.6 + major) / step) * step;
    const pos = [];
    const col = [];
    const cMinor = new THREE2.Color(8624312).multiplyScalar(0.13);
    const cMajor = new THREE2.Color(10335446).multiplyScalar(0.3);
    const y = -0.015;
    for (let v = -half; v <= half; v += step) {
      const isMajor = (v % major + major) % major === 0;
      if (!isMajor && Math.abs(v) > extent * 0.75) continue;
      const c = isMajor ? cMajor : cMinor;
      pos.push(-half, y, v, half, y, v);
      pos.push(v, y, -half, v, y, half);
      for (let i = 0; i < 4; i++) col.push(c.r, c.g, c.b);
    }
    const geo = new THREE2.BufferGeometry();
    geo.setAttribute("position", new THREE2.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE2.Float32BufferAttribute(col, 3));
    const mat = new THREE2.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      fog: false
    });
    const lines = new THREE2.LineSegments(geo, mat);
    lines.renderOrder = -1;
    lines.frustumCulled = false;
    this.gridGroup.clear();
    this.gridGroup.add(lines);
    this.axisGroup.clear();
    const ax = Math.min(28, Math.max(6, extent * 0.24));
    const ox = -this.bounds.sx / 2 - 2;
    const oz = -this.bounds.sz / 2 - 2;
    const axes = [
      { v: [ax, 0, 0], color: AMBER },
      { v: [0, ax, 0], color: ACCENT },
      { v: [0, 0, ax], color: 5809919 }
    ];
    for (const a of axes) {
      const g = new THREE2.BufferGeometry().setFromPoints([
        new THREE2.Vector3(ox, 0, oz),
        new THREE2.Vector3(ox + a.v[0], a.v[1], oz + a.v[2])
      ]);
      this.axisGroup.add(new THREE2.Line(g, new THREE2.LineBasicMaterial({
        color: a.color,
        transparent: true,
        opacity: 0.8,
        fog: false
      })));
    }
    this.gridGroup.visible = this.gridOn;
    this.axisGroup.visible = this.gridOn;
  }
  _materials(db) {
    if (this.materials) for (const m of Object.values(this.materials)) m.dispose();
    const base = { map: db.atlasTexture, vertexColors: true, fog: true, side: THREE2.FrontSide };
    this.materials = {
      opaque: new THREE2.MeshBasicMaterial({ ...base }),
      cutout: new THREE2.MeshBasicMaterial({ ...base, alphaTest: 0.5, side: THREE2.DoubleSide }),
      translucent: new THREE2.MeshBasicMaterial({
        ...base,
        transparent: true,
        depthWrite: false,
        alphaTest: 0,
        side: THREE2.DoubleSide
      }),
      missing: new THREE2.MeshBasicMaterial({
        color: 16727450,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        side: THREE2.DoubleSide,
        wireframe: true,
        fog: false
      })
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
    const regions = (schematic.regions || []).filter(Boolean).map((rg, i) => {
      const abs = rg.absSize || {
        x: Math.abs(rg.size?.x ?? 0),
        y: Math.abs(rg.size?.y ?? 0),
        z: Math.abs(rg.size?.z ?? 0)
      };
      let position = rg.min;
      if (!position || position.x === void 0) {
        const p = rg.position || { x: 0, y: 0, z: 0 };
        const s = rg.size || abs;
        position = {
          x: s.x >= 0 ? p.x : p.x + s.x + 1,
          y: s.y >= 0 ? p.y : p.y + s.y + 1,
          z: s.z >= 0 ? p.z : p.z + s.z + 1
        };
      }
      return {
        ...rg,
        name: rg.name || `region-${i}`,
        absSize: abs,
        position,
        volume: rg.volume ?? abs.x * abs.y * abs.z
      };
    });
    if (!regions.length) {
      this.stats = { ...this.stats, buildMs: 0 };
      return this.stats;
    }
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const rg of regions) {
      const p = rg.position || { x: 0, y: 0, z: 0 };
      const s = rg.absSize || rg.size || { x: 1, y: 1, z: 1 };
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      minZ = Math.min(minZ, p.z);
      maxX = Math.max(maxX, p.x + s.x);
      maxY = Math.max(maxY, p.y + s.y);
      maxZ = Math.max(maxZ, p.z + s.z);
    }
    if (!isFinite(minX)) {
      minX = minY = minZ = 0;
      maxX = maxY = maxZ = 1;
    }
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
      warnings: rg.warnings || []
    }));
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
          const my = py + (i / sxz | 0) - minY | 0;
          if (my >= 0 && my < cumY.length) cumY[my + 1]++;
          total++;
        }
      }
      for (let i = 1; i < cumY.length; i++) cumY[i] += cumY[i - 1];
      const counts = /* @__PURE__ */ new Map();
      for (let pi = 0; pi < palette.length; pi++) {
        if (!palCount[pi]) continue;
        const sk = palKeys[pi];
        counts.set(sk, (counts.get(sk) || 0) + palCount[pi]);
      }
      regStats.push({ ri, name: rs.name, sx, sy, sz, cumY, counts, palKeys, palCount, position: rs.position });
      this.regionGroups.set(rs.name, []);
      if (onProgress) onProgress((ri + 1) / regions.length * 0.4, `\u7EDF\u8BA1 Region ${rs.name}`);
      await nextFrame();
    }
    this._regStats = regStats;
    this._totalBlocks = total;
    for (let ki = 0; ki < regions.length; ki++) {
      const rg = regions[ki];
      const rs = regStats[ki];
      const abs = rg.absSize || rg.size || { x: 0, y: 0, z: 0 };
      const sx = rs.sx, sy = rs.sy, sz = rs.sz;
      void abs;
      void sy;
      const palette = rg.palette || [];
      const slotByState = /* @__PURE__ */ new Map();
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
        const slot = pi < palette.length ? palSlot[pi] : void 0;
        if (!slot) continue;
        const x = i % sx;
        const z = (i / sx | 0) % sz;
        const y = i / sxz | 0;
        const o = slot.n * 16;
        const d = slot.data;
        d[o] = 1;
        d[o + 5] = 1;
        d[o + 10] = 1;
        d[o + 15] = 1;
        d[o + 12] = px + x + ox;
        d[o + 13] = py + y + oy;
        d[o + 14] = pz + z + oz;
        slot.n++;
      }
      const group = this.regionGroups.get(rs.name);
      for (const [sk, slot] of slotByState) {
        if (!slot.n) continue;
        const built = buildStateGeometry(db, sk);
        const kind = built ? db.renderKind(sk) : "missing";
        const geo = built ? built.geometry : missingGeometry();
        const inst = new THREE2.InstancedMesh(geo, mats[kind], slot.n);
        inst.instanceMatrix = new THREE2.InstancedBufferAttribute(slot.data.subarray(0, slot.n * 16), 16);
        inst.instanceMatrix.needsUpdate = true;
        inst.frustumCulled = false;
        inst.computeBoundingSphere();
        inst.userData = {
          stateKey: sk,
          regionName: rs.name,
          regionIndex: ki,
          quadCount: built ? built.quadCount : 0
        };
        this.group.add(inst);
        this.meshes.push(inst);
        if (group) group.push(inst);
      }
      if (onProgress) onProgress(0.4 + (ki + 1) / regions.length * 0.45, `\u751F\u6210\u5B9E\u4F8B ${rs.name}`);
      await nextFrame();
    }
    const drawn = this.meshes.reduce((a, m) => a + m.count, 0);
    this._buildVoxels(regions, regStats);
    this._buildRegionBoxes();
    this._buildGrid();
    const radial = Math.max(8, Math.hypot(this.bounds.sx, this.bounds.sz) * 0.75);
    this.groundShadow.scale.set(radial * 1.5, radial * 1.5, 1);
    this.groundShadow.visible = this.shadowOn;
    this.empty = false;
    this.frameAll();
    if (onProgress) onProgress(1, "\u5B8C\u6210");
    this.stats = {
      buildMs: Math.round(performance.now() - t0),
      blocks: total,
      drawnInstances: drawn,
      states: this.meshes.length,
      regionStates: this.meshes.length,
      meshes: this.meshes.length,
      regions: regions.length,
      missing: db.missingCount
    };
    this._applySlice();
    this._needRender = true;
    return this.stats;
  }
  _buildVoxels(regions, regStats) {
    const b = this.bounds;
    const sx = Math.max(1, b.maxX - b.minX), sy = Math.max(1, b.maxY - b.minY), sz = Math.max(1, b.maxZ - b.minZ);
    const vol = sx * sy * sz;
    if (vol > 24e6) {
      this.voxels = null;
      return;
    }
    const cells = new Uint32Array(vol);
    const regionOf = new Uint16Array(vol);
    const stateIndex = /* @__PURE__ */ new Map();
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
        if (i === void 0) {
          i = stateKeys.length;
          stateIndex.set(sk, i);
          stateKeys.push(sk);
        }
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
        const z = (i / rsx | 0) % rsz;
        const y = i / rsxz | 0;
        const gx = px + x - b.minX, gy = py + y - b.minY, gz = pz + z - b.minZ;
        if (gx < 0 || gy < 0 || gz < 0 || gx >= sx || gy >= sy || gz >= sz) continue;
        const ci = gx + sx * gz + sx * sz * gy | 0;
        cells[ci] = si + 1;
        regionOf[ci] = ki + 1;
      }
    }
    this.voxels = {
      sx,
      sy,
      sz,
      minX: b.minX,
      minY: b.minY,
      minZ: b.minZ,
      cells,
      regionOf,
      stateKeys,
      regionVisible: new Uint8Array(regions.length + 1).fill(1),
      regionNames: this.regionList.map((r) => r.name)
    };
  }
  _buildRegionBoxes() {
    this.regBoxGroup.clear();
    this._regionBoxes = /* @__PURE__ */ new Map();
    for (const r of this.regionList) {
      const p = r.position;
      const s = r.size;
      const w = Math.max(1, s.x), h = Math.max(1, s.y), d = Math.max(1, s.z);
      const geo = new THREE2.EdgesGeometry(new THREE2.BoxGeometry(w, h, d));
      const mat = new THREE2.LineBasicMaterial({
        color: ACCENT,
        transparent: true,
        opacity: 0.45,
        depthTest: false,
        depthWrite: false,
        fog: false
      });
      const box = new THREE2.LineSegments(geo, mat);
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
  _loop(t) {
    if (this._disposed) return;
    const dt = this._lastT ? t - this._lastT : 16;
    this._lastT = t;
    this._fpsAcc += dt;
    this._fpsFrames++;
    if (this._fpsAcc > 350) {
      this._fps = Math.round(1e3 / (this._fpsAcc / this._fpsFrames));
      this._fpsAcc = 0;
      this._fpsFrames = 0;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this._needRender = false;
    const info = this.renderer.info;
    this.info = {
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      lines: info.render.lines,
      geometries: info.memory.geometries,
      textures: info.memory.textures
    };
    for (const cb of this._frameCbs) cb(this);
  }
  get fps() {
    return this._fps || 60;
  }
  onFrame(cb) {
    this._frameCbs.add(cb);
    return () => this._frameCbs.delete(cb);
  }
  // ------------------------------------------------------------ 视角
  worldOf(x, y, z) {
    return new THREE2.Vector3(x + this.offset.x, y + this.offset.y, z + this.offset.z);
  }
  _fitDistance(radius) {
    const fov = this.camera.fov * Math.PI / 180;
    return radius / Math.sin(fov / 2) * 1.06;
  }
  _lookAt(center, dir, radius) {
    const d = this._fitDistance(Math.max(1, radius));
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir.clone().normalize(), d);
    this.controls.minDistance = Math.max(0.8, Math.min(this.bounds.sy || 8, 8) * 0.3);
    this.controls.maxDistance = Math.max(60, d * 6);
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this._needRender = true;
  }
  frameAll() {
    const b = this.bounds;
    const radius = Math.max(2, Math.hypot(b.sx, b.sy, b.sz) / 2);
    this._lookAt(new THREE2.Vector3(0, b.sy / 2, 0), ISO_DIR.clone(), radius);
  }
  applyPreset(name) {
    const b = this.bounds;
    const radius = Math.max(2, Math.hypot(b.sx, b.sy, b.sz) / 2);
    const center = new THREE2.Vector3(0, b.sy / 2, 0);
    const dirs = {
      iso: new THREE2.Vector3(1, 0.82, 1),
      top: new THREE2.Vector3(1e-4, 1, 1e-4),
      front: new THREE2.Vector3(0, 0.06, 1),
      side: new THREE2.Vector3(1, 0.06, 0)
    };
    this._lookAt(center, dirs[name] || dirs.iso, radius);
    return name;
  }
  focusBlock(x, y, z) {
    const p = this.worldOf(x + 0.5, y + 0.5, z + 0.5);
    const dir = new THREE2.Vector3().subVectors(this.camera.position, this.controls.target).normalize();
    const cur = this.camera.position.distanceTo(this.controls.target);
    this._lookAt(p, dir, Math.max(3, Math.min(cur / 2.4, 24)));
  }
  focusRegion(name) {
    const r = this.regionList.find((v) => v.name === name);
    if (!r) return;
    const s = r.size, p = r.position;
    const c = this.worldOf(p.x + s.x / 2, p.y + s.y / 2, p.z + s.z / 2);
    this._lookAt(
      c,
      new THREE2.Vector3().subVectors(this.camera.position, this.controls.target).normalize(),
      Math.max(4, Math.hypot(s.x, s.y, s.z) / 2)
    );
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
      this.renderer.clippingPlanes = [new THREE2.Plane(new THREE2.Vector3(0, -1, 0), this.slice.level + 1)];
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
    if (!visible || x === null || x === void 0) {
      if (this.hoverBox.visible) {
        this.hoverBox.visible = false;
        this._needRender = true;
      }
      return;
    }
    this.hoverBox.position.set(x + 0.5 + this.offset.x, y + 0.5 + this.offset.y, z + 0.5 + this.offset.z);
    this.hoverBox.visible = true;
    this._needRender = true;
  }
  setSelected(x, y, z, visible = true) {
    if (!visible || x === null || x === void 0) {
      if (this.selBox.visible) {
        this.selBox.visible = false;
        this._needRender = true;
      }
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
    if (!stateKey || !this.db) {
      this._needRender = true;
      return 0;
    }
    const built = buildStateGeometry(this.db, stateKey);
    if (!built) return 0;
    const targets = this.meshes.filter((m) => m.userData.stateKey === stateKey && m.visible);
    let count = 0;
    for (const m of targets) count += m.count;
    if (!count) return 0;
    const mat = new THREE2.MeshBasicMaterial({
      color: ACCENT,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      side: THREE2.DoubleSide,
      fog: false
    });
    const inst = new THREE2.InstancedMesh(built.geometry, mat, count);
    const data = new Float32Array(count * 16);
    const tmp = this._tmpM4;
    const e = tmp.elements;
    let o = 0;
    for (const m of targets) {
      for (let i = 0; i < m.count; i++) {
        m.getMatrixAt(i, tmp);
        const b = o * 16;
        const s = 1.03;
        data[b] = e[0] * s;
        data[b + 5] = e[5] * s;
        data[b + 10] = e[10] * s;
        data[b + 15] = 1;
        data[b + 12] = e[12] - 0.015;
        data[b + 13] = e[13] - 0.015;
        data[b + 14] = e[14] - 0.015;
        o++;
      }
    }
    inst.instanceMatrix = new THREE2.InstancedBufferAttribute(data, 16);
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
    const nx = (clientX - rect.left) / rect.width * 2 - 1;
    const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    const ray = this._rayFromNdc(nx, ny);
    if (this.empty) return null;
    return this.voxels ? this._pickVoxel(ray) : this._pickInstances(ray);
  }
  _pickVoxel(ray) {
    const v = this.voxels;
    const origin = ray.origin, dir = ray.direction;
    const ox = origin.x - this.offset.x - v.minX;
    const oy = origin.y - this.offset.y - v.minY;
    const oz = origin.z - this.offset.z - v.minZ;
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
      if (t0 > t1) {
        const tt = t0;
        t0 = t1;
        t1 = tt;
      }
      if (t0 > tEnter) tEnter = t0;
      if (t1 < tExit) tExit = t1;
      if (tEnter > tExit) return null;
    }
    let px = ox + dir.x * tEnter;
    let py = oy + dir.y * tEnter;
    let pz = oz + dir.z * tEnter;
    const EPS = 1e-4;
    px += dir.x * EPS;
    py += dir.y * EPS;
    pz += dir.z * EPS;
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
    for (let s = 0; s < maxSteps && t <= tExit + 1e-4; s++) {
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
              distance: t
            };
          }
        }
      }
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        ix += stepX;
        t = tMaxX;
        tMaxX += tDeltaX;
        axis = 0;
      } else if (tMaxY < tMaxZ) {
        iy += stepY;
        t = tMaxY;
        tMaxY += tDeltaY;
        axis = 1;
      } else {
        iz += stepZ;
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        axis = 2;
      }
    }
    return null;
  }
  _pickInstances(ray) {
    const hits = this.raycaster.intersectObjects(this.meshes.filter((m) => m.visible), false);
    for (const h of hits) {
      const inst = h.object;
      if (inst.userData.kind === "highlight") continue;
      const local = new THREE2.Matrix4();
      inst.getMatrixAt(h.instanceId, local);
      const e = local.elements;
      const x = Math.round(e[12] - this.offset.x);
      const y = Math.round(e[13] - this.offset.y);
      const z = Math.round(e[14] - this.offset.z);
      if (this.slice.enabled && y - this.offset.y > this.slice.level) continue;
      return {
        x,
        y,
        z,
        stateKey: inst.userData.stateKey,
        regionName: inst.userData.regionName,
        regionIndex: inst.userData.regionIndex,
        normal: h.face ? h.face.normal.toArray() : [0, 1, 0],
        point: h.point,
        distance: h.distance
      };
    }
    return null;
  }
  onHover(cb) {
    this._hoverCb = cb;
  }
  onSelect(cb) {
    this._selectCb = cb;
  }
  emitHover(hit) {
    this._hoverCb && this._hoverCb(hit);
  }
  emitSelect(hit) {
    this._selectCb && this._selectCb(hit);
  }
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
        renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "unknown"
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
};
export {
  ACCENT,
  ACCENT_HEX,
  AMBER,
  BG,
  ViewerScene,
  paletteStateKey
};
