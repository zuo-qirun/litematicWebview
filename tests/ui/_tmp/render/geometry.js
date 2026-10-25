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
function disposeGeometryCache() {
  for (const v of cache.values()) {
    if (v && v.geometry) v.geometry.dispose();
  }
  cache.clear();
}
function geometryCacheSize() {
  return cache.size;
}
export {
  FACE_SHADE,
  buildStateGeometry,
  disposeGeometryCache,
  geometryCacheSize,
  missingGeometry
};
