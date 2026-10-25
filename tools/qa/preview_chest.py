# -*- coding: utf-8 -*-
"""从原版 64x64 箱子纹理 + ModelPart.Cube 的 box-UV 展开反推真正的 ChestModel 贴图布局。

用途：在写正式后处理脚本之前，先用离线软件光栅器把几种「box UV 展开顺序」假设
都渲染出来对比，挑出和原版橡木箱一致的那种。

    python tools/qa/preview_chest.py            # 生成 _dl/qa/chest_calib_*.png

布局（ModelPart.Cube 经典展开，单位=纹理像素，纹理比例 1:1）：
    盒 (w,h,d) 在 texOffs (u0,v0) 占的包围盒 = (2w+2d) x (d+h)
    顶条带（高 d）：[ up | down ]  宽 w,w
    侧条带（高 h）：[ side0(d) | side1(w) | side2(d) | side3(w) ]
下面用 --swap-ud / --side 参数切换假设。
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from PIL import Image, ImageDraw

from soft_render import montage, render_view

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
TEX_DIR = os.path.join(ROOT, '_dl', 'chesttex')
OUT_DIR = os.path.join(ROOT, '_dl', 'qa')

# 面 -> (n, 每个面「屏幕左上角」对应的盒角下标)
# 盒角下标：x0y0z0=0 x1y0z0=1 x0y1z0=2 x1y1z0=3 x0y0z1=4 x1y0z1=5 x0y1z1=6 x1y1z1=7
# 顺序 TL, BL, BR, TR（从面外侧看，屏幕上=+Y）
FACE_CORNERS = {
    0: (4, 0, 1, 5),   # down : TL(x0,y0,z1) BL(x0,y0,z0) BR(x1,y0,z0) TR(x1,y0,z1)
    1: (2, 6, 7, 3),   # up   : TL(x0,y1,z0) BL(x0,y1,z1) BR(x1,y1,z1) TR(x1,y1,z0)
    2: (3, 1, 0, 2),   # north: TL(x1,y1,z0) BL(x1,y0,z0) BR(x0,y0,z0) TR(x0,y1,z0)
    3: (6, 4, 5, 7),   # south: TL(x0,y1,z1) BL(x0,y0,z1) BR(x1,y0,z1) TR(x1,y1,z1)
    4: (2, 0, 4, 6),   # west : TL(x0,y1,z0) BL(x0,y0,z0) BR(x0,y0,z1) TR(x0,y1,z1)
    5: (7, 5, 1, 3),   # east : TL(x1,y1,z1) BL(x1,y0,z1) BR(x1,y0,z0) TR(x1,y1,z0)
}
CORNERS = {
    0: (0, 0, 0), 1: (1, 0, 0), 2: (0, 1, 0), 3: (1, 1, 0),
    4: (0, 0, 1), 5: (1, 0, 1), 6: (0, 1, 1), 7: (1, 1, 1),
}


def regions(u0, v0, w, h, d, swap_ud=False, side_order=('west', 'north', 'east', 'south')):
    """返回 {n: (u_min, v_min, u_max, v_max)} 的 6 面纹理区域。"""
    up = [u0 + d, v0, u0 + d + w, v0 + d]
    down = [u0 + d + w, v0, u0 + d + 2 * w, v0 + d]
    if swap_ud:
        up, down = down, up
    slots = [
        [u0, v0 + d, u0 + d, v0 + d + h],
        [u0 + d, v0 + d, u0 + d + w, v0 + d + h],
        [u0 + d + w, v0 + d, u0 + d + 2 * d, v0 + d + h],
        [u0 + d + w + d, v0 + d, u0 + 2 * d + 2 * w, v0 + d + h],
    ]
    side = {name: slots[i] for i, name in enumerate(side_order)}
    return {0: tuple(down), 1: tuple(up), 2: tuple(side['north']), 3: tuple(side['south']),
            4: tuple(side['west']), 5: tuple(side['east'])}


def box_quads(x0, y0, z0, x1, y1, z1, reg, tex='entity/chest/normal'):
    """把一个轴对齐盒展开成 6 个 quad（uv 顺序 = TL,BL,BR,TR；p 逆时针）。"""
    lo = (x0, y0, z0)
    hi = (x1, y1, z1)
    quads = []
    for n in (0, 1, 2, 3, 4, 5):
        u_min, v_min, u_max, v_max = reg[n]
        ps = []
        for ci in FACE_CORNERS[n]:
            c = CORNERS[ci]
            ps.extend([x1 if c[0] else x0, y1 if c[1] else y0, z1 if c[2] else z0])
        quads.append({
            'p': ps,
            'uv': [u_min, v_min, u_min, v_max, u_max, v_max, u_max, v_min],
            'n': n, 'tint': -1, 'tex': tex,
        })
    return quads


def chest_quads(tex_kind='normal', swap_ud=False, side_order=('west', 'north', 'east', 'south')):
    """1.21.1 ChestModel 的三个 part。"""
    tex = 'entity/chest/%s' % tex_kind
    quads = []
    # bottom: addBox(1,0,1, 14,10,14).texOffs(0,19)
    quads += box_quads(1, 0, 1, 15, 10, 15, regions(0, 19, 14, 10, 14, swap_ud, side_order), tex)
    # lid: addBox(1,0,0, 14,5,14).texOffs(0,0).offset(0,9,1)
    quads += box_quads(1, 9, 1, 15, 14, 15, regions(0, 0, 14, 5, 14, swap_ud, side_order), tex)
    # lock: addBox(7,-1,15, 2,4,1).texOffs(0,0).offset(0,8,0)
    quads += box_quads(7, 7, 15, 9, 11, 16, regions(0, 0, 2, 4, 1, swap_ud, side_order), tex)
    return quads


def load_tex(kind):
    return Image.open(os.path.join(TEX_DIR, '%s.png' % kind)).convert('RGBA')


def render_variants(kind='normal', views=('iso', 'front', 'top'), size=300, scale=13.0):
    """渲染 4 种布局假设的对比图。"""
    tex = load_tex(kind)
    hypotheses = [
        ('A ud=up,down', dict(swap_ud=False)),
        ('B ud=down,up', dict(swap_ud=True)),
    ]
    ims, labels = [], []
    for name, kw in hypotheses:
        quads = chest_quads(kind, **kw)
        for view in views:
            ims.append(render_view(quads, tex, view=view, size=size, scale=scale, center=(8, 8, 8)))
            labels.append('%s | %s' % (name, view))
    return montage(ims, labels, cols=len(views))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tex', default='normal')
    ap.add_argument('--scale', type=float, default=13.0)
    ap.add_argument('--size', type=int, default=300)
    args = ap.parse_args()
    os.makedirs(OUT_DIR, exist_ok=True)
    img = render_variants(args.tex, size=args.size, scale=args.scale)
    out = os.path.join(OUT_DIR, 'chest_calib_%s.png' % args.tex)
    img.save(out)
    print(out, img.size)


if __name__ == '__main__':
    main()
