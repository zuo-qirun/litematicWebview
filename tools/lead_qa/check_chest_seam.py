"""判定 chest 半块几何里「透明的那个面」最终朝向。

对 type=right 与 type=left 两种几何：
  1. 用 post_entity_models 的函数生成 quads（先 BASE_STATE_Y=180，再 facing=north 即 0°）
  2. 取半块在最终坐标系里的 x 范围（判断它是西半 x1..16 还是东半 x0..15）
  3. 对每个 quad 取 uv 区域在纹理里的 alpha；找出 alpha 全 0 的面
  4. 打印：最终 x 范围 / 接缝应在哪一侧 / 透明面最终朝向
"""
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'bake'))
import post_entity_models as P  # noqa: E402

FACE = {0: 'down', 1: 'up', 2: 'north', 3: 'south', 4: 'west', 5: 'east'}


def analyze(tex_path, parts, label):
    img = np.asarray(Image.open(tex_path).convert('RGBA'), dtype=np.uint8)
    alpha = img[:, :, 3]
    quads = P.chest_quads('T', (0, 0), parts=parts)
    quads = P.rotate_quads(quads, P.BASE_STATE_Y)
    xs = [p for q in quads for p in q['p'][0::3]]
    xmin, xmax = min(xs), max(xs)
    transparent = []
    for q in quads:
        us, vs = q['uv'][0::2], q['uv'][1::2]
        u0, u1 = min(us), max(us)
        v0, v1 = min(vs), max(vs)
        a = alpha[int(v0):int(v1), int(u0):int(u1)]
        if a.size and (a == 0).mean() > 0.5:
            transparent.append((FACE[q['n']], q['uv']))
    print('%-14s x=%.2f..%.2f  seam=%s  transparent=%s'
          % (label, xmin, xmax, 'EAST' if xmax > 12 else 'WEST', transparent))


d = '_dl/chesttex'
analyze(os.path.join(d, 'normal_left.png'), P.PARTS_WEST, 'RIGHT/west-block')
analyze(os.path.join(d, 'normal_right.png'), P.PARTS_WEST, 'RIGHT/right-tex')
analyze(os.path.join(d, 'normal_left.png'), P.PARTS_EAST, 'LEFT/east-block')
analyze(os.path.join(d, 'normal_right.png'), P.PARTS_EAST, 'LEFT/left-tex')
