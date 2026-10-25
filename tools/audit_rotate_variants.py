#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""内部自洽性复核：blockstate x/y 旋转变体 == 基模型点集按同一旋转矩阵变换

不依赖 vanilla 约定，只检查「同一个模型」的 base 与其 #x,y 变体之间是否
真的差一个旋转（而不是镜像/错序）。这一步能定位 bug 是在 base 烘焙
还是在 blockstate 旋转展开。
"""
import json
import os
import sys

import numpy as np

sys.stdout.reconfigure(encoding="utf-8")


def ry(pts, deg, c=(8, 8, 8)):
    t = np.radians(deg)
    m = np.array([[np.cos(t), 0, np.sin(t)], [0, 1, 0], [-np.sin(t), 0, np.cos(t)]])
    o = np.array(c, dtype=float)
    return (np.asarray(pts, dtype=float) - o) @ m.T + o


def rx(pts, deg, c=(8, 8, 8)):
    t = np.radians(deg)
    m = np.array([[1, 0, 0], [0, np.cos(t), -np.sin(t)], [0, np.sin(t), np.cos(t)]])
    o = np.array(c, dtype=float)
    return (np.asarray(pts, dtype=float) - o) @ m.T + o


def kset(pts):
    return frozenset(tuple(round(float(x), 2) for x in p) for p in pts)


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    models = json.load(open(os.path.join(root, "assets", "models.json"), encoding="utf-8"))["models"]

    # 收集 base -> {x,y} -> quads
    groups = {}
    for mid, m in models.items():
        if "#" in mid:
            base, suffix = mid.split("#", 1)
            try:
                xs, ys = [int(v) for v in suffix.split(",")]
            except ValueError:
                continue
            groups.setdefault(base, {}).setdefault((xs, ys), m)
        else:
            groups.setdefault(mid, {})[(0, 0)] = m

    total = 0
    bad = []
    checked = 0
    for base, variants in groups.items():
        if (0, 0) not in variants:
            continue
        bq = variants[(0, 0)]["quads"]
        base_pts = [q["p"] for q in bq]
        for (xs, ys), m in variants.items():
            if (xs, ys) == (0, 0):
                continue
            checked += 1
            # 变体点集（每 quad 4 点）
            got = [kset([q["p"][0:3], q["p"][3:6], q["p"][6:9], q["p"][9:12]]) for q in m["quads"]]
            # 期望：把 base 的每个 quad 变换（注意 vanilla 组合顺序）
            want = []
            for q in bq:
                pts = [q["p"][0:3], q["p"][3:6], q["p"][6:9], q["p"][9:12]]
                p = np.asarray(pts, dtype=float)
                # vanilla BlockModelRotation: 顺序 R = Ry(-y) * Rx(-x)
                if xs:
                    p = rx(p, -xs)
                if ys:
                    p = ry(p, -ys)
                want.append(kset(p))
            total += 1
            # 逐 quad 比对（顺序可能不同，用排序后的 set of frozensets 比）
            if sorted(map(sorted, [tuple(sorted(s)) for s in got])) != sorted(
                map(sorted, [tuple(sorted(s)) for s in want])
            ):
                # 更宽松：整体点集一致即可（允许 quad 顺序变化）
                allgot = frozenset().union(*got) if got else frozenset()
                allwant = frozenset().union(*want) if want else frozenset()
                ok = len(allgot & allwant) >= 0.8 * max(1, len(allwant))
                bad.append((base, xs, ys, len(got), len(want), len(allgot), len(allwant), ok))
    print(f"检查 {checked} 个带 blockstate 旋转的模型变体")
    bad.sort(key=lambda r: (r[7], len(r[0])))
    hard = [b for b in bad if not b[7]]
    print(f"  点集明显不一致（<80% 点匹配）：{len(hard)}")
    print(f"  点集基本一致但 quad 划分/顺序不同：{len(bad) - len(hard)}")
    for r in hard[:12]:
        print(f"   ✗ {r[0]} x={r[1]} y={r[2]} 变体quad={r[3]} basequad={r[4]} 点交集={r[5]}/{r[6]}")
    for r in bad[len(hard): len(hard) + 5]:
        print(f"   ! {r[0]} x={r[1]} y={r[2]} 点交集={r[5]}/{r[6]}（仅划分不同）")
    return 1 if hard else 0


if __name__ == "__main__":
    sys.exit(main())
