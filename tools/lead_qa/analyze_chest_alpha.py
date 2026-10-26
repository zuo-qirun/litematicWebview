"""判定 chest 的 normal / normal_left / normal_right 各自把哪个面涂透明。

face n: 0=down 1=up 2=north 3=south 4=west 5=east
盒 UV 布局（post_entity_models.tex_layout）：
  顶条带 v0..d：[ down(u0+d..u0+d+w) | up(u0+d+w..u0+2w+d) ]
  侧条带 v0+d..v0+d+h：[ west(d) | north(w) | east(d) | south(w) ]
"""
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'bake'))
from post_entity_models import tex_layout  # noqa: E402

NAMES = {0: 'down', 1: 'up', 2: 'north', 3: 'south', 4: 'west', 5: 'east'}
PARTS = (('lid', (0, 0), (14, 5, 14)), ('body', (0, 19), (14, 10, 14)))
PARTS_HALF = (('lid', (0, 0), (15, 5, 14)), ('body', (0, 19), (15, 10, 14)))


def alpha_by_face(img, parts):
    a = np.asarray(img.convert('RGBA'), dtype=np.uint8)[:, :, 3]
    out = {}
    for name, (u0, v0), (w, h, d) in parts:
        reg = tex_layout(u0, v0, w, h, d)
        for n, (umin, vmin, umax, vmax) in reg.items():
            box = a[vmin:vmax, umin:umax]
            if box.size:
                out.setdefault(NAMES[n], []).append(float((box == 0).mean()))
    return {k: round(max(v), 3) for k, v in out.items()}


def main():
    d = '_dl/chesttex'
    for f in ('normal.png', 'normal_left.png', 'normal_right.png',
              'trapped.png', 'trapped_left.png', 'trapped_right.png'):
        p = os.path.join(d, f)
        img = Image.open(p)
        half = '_left' in f or '_right' in f
        print('%-18s %s  %s' % (f, img.size, alpha_by_face(img, PARTS_HALF if half else PARTS)))


main()
