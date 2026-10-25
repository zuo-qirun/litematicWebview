// mcviewer —— 模型 quad → BufferGeometry
//
// 契约要点（§1.3）：
//   p   12 个 float，模型空间 0..16，逆时针（从正面看）
//   uv  8 个 float，图集内**绝对像素**坐标，左上原点、v 向下
//   n   面朝向 0=下 1=上 2=北 3=南 4=西 5=东 → 原版式明暗
//   tint>=0 表示该面受方块着色，取 BlockDef.tintColors[String(tint)]
//
// 所有明暗 / tint 都烘进顶点色，材质用 MeshBasicMaterial：不加任何光源，
// 这就是 MC 的经典观感（也是性能最优解）。

import * as THREE from "three";

/** 原版式面明暗：下 0.5 / 上 1.0 / 南北 0.8 / 东西 0.6 */
export const FACE_SHADE = [0.5, 1.0, 0.8, 0.8, 0.6, 0.6];

const MAX_CACHED = 40000;
const cache = new Map();

const _geoCacheKey = (stateKey) => stateKey;

/**
 * 建一个方块状态（可能由多个 multipart 模型组成）的几何。
 * @returns {{geometry: THREE.BufferGeometry, quadCount: number, modelIds: string[]} | null}
 */
export function buildStateGeometry(db, stateKey) {
  const hit = cache.get(_geoCacheKey(stateKey));
  if (hit) return hit;
  const modelIds = db.resolve(stateKey);
  if (!modelIds || modelIds.length === 0) return null;

  const tintMap = db.tintColors(stateKey) || null; // { "0": [r,g,b] }
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
        if (c) { tr = c[0]; tg = c[1]; tb = c[2]; }
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
  // InstancedMesh 的实例数量大，交给调用方设 frustumCulled = false

  const result = { geometry, quadCount: nq, modelIds };
  if (cache.size > MAX_CACHED) {
    const it = cache.keys();
    for (let i = 0; i < 2000; i++) {
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

/** 缺失模型的占位几何：洋红半透明方块（不缓存复用同一份） */
let missingGeo = null;
export function missingGeometry() {
  if (!missingGeo) {
    missingGeo = new THREE.BoxGeometry(1, 1, 1);
    // 挪到 [0,1] 而不是 [-.5,.5]，与模型空间一致
    missingGeo.translate(0.5, 0.5, 0.5);
  }
  return missingGeo;
}

export function disposeGeometryCache() {
  for (const v of cache.values()) {
    if (v && v.geometry) v.geometry.dispose();
  }
  cache.clear();
}

export function geometryCacheSize() {
  return cache.size;
}
