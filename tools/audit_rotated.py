#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""独立复核「元素旋转」几何（不 import bake.py，纯 numpy 手算）

原理（与渲染约定无关）：
  元素的某个面 = 元素包围盒在该平面上的 4 个角点。把 4 个角点按声明的
  rotation(axis, angle, origin) 旋转后，得到 4 个点的**集合**。烘焙结果的
  quad 也应该正好是这 4 个点（顺序无关），因此可以直接做集合比对，
  不需要知道 vanilla 的顶点顺序/uv 约定。

比对三种情况：
  R+  ：角度按 +angle 旋转
  R-  ：角度按 -angle 旋转（vanilla 对某些轴取负）
  NONE：两者都不匹配 → 烘焙的几何与原始元素旋转不一致（镜子/顺序/公式错误）

用法：python tools/audit_rotated.py [--assets assets] [--jars _dl/client-1.21.1.jar]
"""
import argparse
import json
import math
import os
import sys
import zipfile

import numpy as np

FACE_PLANES = {
    "down": ("y", 0), "up": ("y", 1),
    "north": ("z", 0), "south": ("z", 1),
    "west": ("x", 0), "east": ("x", 1),
}
AXIS_IDX = {"x": 0, "y": 1, "z": 2}


def rot_matrix(axis, deg):
    t = math.radians(deg)
    c, s = math.cos(t), math.sin(t)
    m = np.eye(3)
    i = AXIS_IDX[axis]
    a, b = (i + 1) % 3, (i + 2) % 3
    m[a, a] = c
    m[a, b] = -s
    m[b, a] = s
    m[b, b] = c
    return m


def apply_rot(pts, axis, deg, origin):
    if deg == 0:
        return pts
    o = np.asarray(origin, dtype=float)
    return (pts - o) @ rot_matrix(axis, deg).T + o


def face_corners(fr, to, face):
    """元素某个面的 4 个角点（元素空间 0..16）"""
    ax, hi = FACE_PLANES[face]
    fixed = to if hi else fr
    ci = AXIS_IDX[ax]
    u, v = [i for i in range(3) if i != ci]
    out = []
    for a in (fr[u], to[u]):
        for b in (fr[v], to[v]):
            p = [0.0, 0.0, 0.0]
            p[ci] = fixed[ci]
            p[u] = a
            p[v] = b
            out.append(p)
    return np.array(out)


def load_jar_models(jar_path):
    models = {}
    with zipfile.ZipFile(jar_path) as z:
        for n in z.namelist():
            if n.startswith("assets/minecraft/models/block/") and n.endswith(".json"):
                key = n[len("assets/minecraft/models/"):-5]
                try:
                    models[key] = json.loads(z.read(n))
                except Exception:
                    pass
    return models


def resolve(models, key, seen=None):
    """解析 parent 链，返回 (elements, textures)"""
    seen = seen or set()
    if key in seen or key not in models:
        return None, {}
    seen.add(key)
    m = models[key]
    parent = m.get("parent")
    pe, pt = ([], {})
    if parent:
        pk = parent.split(":")[-1]
        pe, pt = resolve(models, pk, seen)
    tex = dict(pt)
    for k, v in (m.get("textures") or {}).items():
        tex[k] = v
    els = m.get("elements")
    return (els if els is not None else pe), tex


def key_of(pts):
    return tuple(tuple(round(float(x), 3) for x in p) for p in pts)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--assets", default="assets")
    ap.add_argument("--jars", default="_dl/client-1.21.1.jar")
    args = ap.parse_args()

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    assets = os.path.join(root, args.assets) if not os.path.isabs(args.assets) else args.assets
    jar = os.path.join(root, args.jars) if not os.path.isabs(args.jars) else args.jars

    jars = [j.strip() for j in jar.split(",") if j.strip() and os.path.exists(j.strip())]
    models = {}
    for j in jars:
        for k, v in load_jar_models(j).items():
            models.setdefault(k, v)
    baked = json.load(open(os.path.join(assets, "models.json"), encoding="utf-8"))["models"]

    checked_models = 0
    checked_quads = 0
    ok_plus = 0
    ok_minus = 0
    fail = 0
    samples = []

    for mid, m in sorted(models.items()):
        if mid not in baked:
            continue
        els, _ = resolve(models, mid)
        if not els:
            continue
        rot_els = [e for e in els if e.get("rotation") and e["rotation"].get("angle")]
        if not rot_els:
            continue
        checked_models += 1
        quads = baked[mid]["quads"]
        # 以「面 → 期望点集」建立期望池
        want = []  # (face, points, sign_needed)
        for e in els:
            fr = np.array(e["from"], dtype=float)
            to = np.array(e["to"], dtype=float)
            r = e.get("rotation")
            for face in (e.get("faces") or {}):
                pts = face_corners(fr, to, face)
                if r:
                    p_plus = apply_rot(pts, r["axis"], r["angle"], r.get("origin", [8, 8, 8]))
                    p_minus = apply_rot(pts, r["axis"], -r["angle"], r.get("origin", [8, 8, 8]))
                    want.append(("rot+", key_of(p_plus)))
                    want.append(("rot-", key_of(p_minus)))
                else:
                    want.append(("none", key_of(pts)))
        want_set = {}
        for tag, k in want:
            want_set.setdefault(k, tag)

        for q in quads:
            checked_quads += 1
            p = q["p"]
            pts = [(p[0], p[1], p[2]), (p[3], p[4], p[5]), (p[6], p[7], p[8]), (p[9], p[10], p[11])]
            k = key_of(pts)
            tag = want_set.get(k)
            if tag == "rot+":
                ok_plus += 1
            elif tag == "rot-":
                ok_minus += 1
            elif tag == "none":
                pass  # 未旋转元素的面，不在本审计范围
            else:
                fail += 1
                if len(samples) < 10:
                    samples.append((mid, q.get("n"), [tuple(round(x, 2) for x in v) for v in pts]))

    print(f"含元素旋转的模型：{checked_models}，其烘焙 quad：{checked_quads}")
    print(f"  与 +angle 旋转后的点集完全一致：{ok_plus}")
    print(f"  与 -angle 旋转后的点集完全一致：{ok_minus}")
    print(f"  与任一预期点集都不一致    ：{fail}")
    if samples:
        print("\n不一致样例（模型, n, 烘焙到的 4 个点）：")
        for mid, n, pts in samples:
            print(f"  {mid} n={n} {pts}")
    if fail:
        print("\n✗ 元素旋转几何审计失败")
        return 1
    print("\n✓ 元素旋转几何审计通过（所有旋转 quad 都能由原始元素+旋转得到）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
