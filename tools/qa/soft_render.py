# -*- coding: utf-8 -*-
"""mcviewer QA 离线软件光栅器（正交、无光照贴图，仅原版式面明暗）。

不依赖 three.js / 浏览器，用来在跑浏览器截图之前快速校对模型的几何与 UV 朝向。
输入 quads 就是 assets/models.json 的 quad 格式：
    {"p": [x0,y0,z0, x1,y1,z1, x2,y2,z2, x3,y3,z3],   # 模型空间 0..16，顶点逆时针（从面外侧看）
     "uv": [u0,v0, u1,v1, u2,v2, u3,v3],             # 图集绝对像素，左上原点，v 向下
     "n": 0..5, "tint": -1, "tex": "..."}

用法示例：
    from soft_render import render_view, merge
    img = render_view(quads, atlas_img, view="iso", size=420)
"""
import math

import numpy as np
from PIL import Image, ImageDraw

# 原版式面明暗：下 0.5 / 上 1.0 / 南北 0.8 / 东西 0.6
FACE_SHADE = [0.5, 1.0, 0.8, 0.8, 0.6, 0.6]
FACE_AXIS = [(0, -1, 0), (0, 1, 0), (0, 0, -1), (0, 0, 1), (-1, 0, 0), (1, 0, 0)]


def _norm(v):
    n = math.sqrt(sum(c * c for c in v))
    return (v[0] / n, v[1] / n, v[2] / n) if n > 1e-12 else (0.0, 0.0, 0.0)


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


# 每个视图给出：cam（从场景指向相机的方向）、r（屏幕向右的世界向量）、u（屏幕向上的世界向量）
VIEWS = {
    # 从 (+x,+y,+z) 看：可见东、上、南三个面（箱子的正面朝 +Z，所以 iso 能看到锁扣）
    'iso': {'cam': _norm((1, 1, 1))},
    # 从 +Z 看：正对箱子正面（南面）
    'front': {'cam': (0, 0, 1)},
    # 从 -Z 看：正对北面
    'back': {'cam': (0, 0, -1)},
    # 从 +X 看：东面
    'side': {'cam': (1, 0, 0)},
    # 从 -X 看：西面
    'side2': {'cam': (-1, 0, 0)},
    # 顶视：屏幕上 = 北(-Z)，右 = 东(+X)
    'top': {'cam': (0, 1, 0), 'up': (0, 0, -1)},
    # 底视
    'bottom': {'cam': (0, -1, 0), 'up': (0, 0, 1)},
}


def _basis(view):
    v = VIEWS[view]
    cam = v['cam']
    if 'up' in v:
        up_hint = v['up']
    else:
        up_hint = (0, 1, 0)
    f = (-cam[0], -cam[1], -cam[2])          # 视线方向（相机->场景）
    r = _cross(f, up_hint)
    if _dot(r, r) < 1e-9:                     # 视线与 up 平行：换一个 hint
        r = _cross(f, (0, 0, -1))
    r = _norm(r)
    u = _norm(_cross(r, f))
    return tuple(cam), r, u


class Scene:
    """一次渲染的上下文（图集、视图、缩放、映射）。"""

    def __init__(self, atlas, view='iso', size=420, center=(8.0, 8.0, 8.0),
                 scale=22.0, bg=(30, 30, 34, 255), shade=True):
        self.atlas = np.asarray(atlas.convert('RGBA'))
        self.AH, self.AW = self.atlas.shape[:2]
        self.cam, self.r, self.u = _basis(view)
        self.W = self.H = size
        self.center = center
        self.scale = scale
        self.shade = shade
        self.canvas = np.zeros((self.H, self.W, 4), dtype=np.float32)
        self.canvas[..., :3] = np.array(bg[:3], dtype=np.float32) / 255.0
        self.canvas[..., 3] = bg[3] / 255.0

    def project(self, p):
        d = (p[0] - self.center[0], p[1] - self.center[1], p[2] - self.center[2])
        sx = _dot(d, self.r) * self.scale + self.W * 0.5
        sy = self.H * 0.5 - _dot(d, self.u) * self.scale
        return sx, sy

    def depth(self, p):
        return _dot((p[0] - self.center[0], p[1] - self.center[1], p[2] - self.center[2]), self.cam)

    # ------------------------------------------------------------------ 绘制
    def draw(self, quads, offset=(0.0, 0.0, 0.0)):
        items = []
        offset = np.array(offset, dtype=np.float64)
        for q in quads:
            p = np.asarray(q['p'], dtype=np.float64).reshape(4, 3) + offset
            e1 = p[1] - p[0]
            e3 = p[3] - p[0]
            nrm = _norm(tuple(_cross(tuple(e1), tuple(e3))))
            if _dot(nrm, self.cam) <= 1e-6:       # 背面剔除
                continue
            uv = np.asarray(q['uv'], dtype=np.float64).reshape(4, 2)
            S = np.array([self.project(tuple(v)) for v in p])
            depth = self.depth(tuple(p.mean(axis=0)))
            items.append((depth, p, S, uv, q))
        items.sort(key=lambda it: it[0])          # depth 小=远，远的先画
        for _d, p, S, uv, q in items:
            self._blit(S, uv, q)

    def _blit(self, S, uv, q):
        # 仿射解 screen -> (u,v)：solve [u,v,1] @ A = screen
        A = np.hstack([uv, np.ones((4, 1))])
        try:
            solx = np.linalg.lstsq(A, S[:, 0], rcond=None)[0]
            soly = np.linalg.lstsq(A, S[:, 1], rcond=None)[0]
        except np.linalg.LinAlgError:
            return
        M = np.array([[solx[0], solx[1]], [soly[0], soly[1]]])
        t = np.array([solx[2], soly[2]])
        det = M[0, 0] * M[1, 1] - M[0, 1] * M[1, 0]
        if abs(det) < 1e-9:
            return
        Mi = np.array([[M[1, 1], -M[0, 1]], [-M[1, 0], M[0, 0]]]) / det
        umin, umax = uv[:, 0].min(), uv[:, 0].max()
        vmin, vmax = uv[:, 1].min(), uv[:, 1].max()
        x0 = max(0, int(math.floor(S[:, 0].min())))
        x1 = min(self.W, int(math.ceil(S[:, 0].max())) + 1)
        y0 = max(0, int(math.floor(S[:, 1].min())))
        y1 = min(self.H, int(math.ceil(S[:, 1].max())) + 1)
        if x1 <= x0 or y1 <= y0:
            return
        gx = np.arange(x0, x1, dtype=np.float64) + 0.5 - t[0]
        gy = np.arange(y0, y1, dtype=np.float64) + 0.5 - t[1]
        U = Mi[0, 0] * gx[None, :] + Mi[0, 1] * gy[:, None]
        V = Mi[1, 0] * gx[None, :] + Mi[1, 1] * gy[:, None]
        # uv 是角点坐标：连续范围就是 [umin,umax]x[vmin,vmax]。只留极小容差避免 FP 裂缝，
        # 采样下标再 clamp 到区域内（否则大缩放下会把面边缘切掉一条，出现黑色斜缝）。
        tol = 1e-3
        inside = (U >= umin - tol) & (U <= umax + tol) & (V >= vmin - tol) & (V <= vmax + tol)
        if not inside.any():
            return
        iu = np.clip(np.floor(U).astype(np.int32), int(math.floor(umin)),
                     max(int(math.floor(umin)), int(math.ceil(umax)) - 1))
        iv = np.clip(np.floor(V).astype(np.int32), int(math.floor(vmin)),
                     max(int(math.floor(vmin)), int(math.ceil(vmax)) - 1))
        tex = self.atlas[iv, iu].astype(np.float32)
        rgb = tex[..., :3] / 255.0
        alpha = tex[..., 3] / 255.0
        if self.shade:
            rgb = rgb * FACE_SHADE[int(q.get('n', 1))]
        tint = q.get('tint', -1)
        if tint is not None and tint >= 0:
            pass  # 箱子不涉及 tint；需要时由调用方预乘
        dst = self.canvas[y0:y1, x0:x1]
        m = inside & (alpha > 1.0 / 255.0)
        if not m.any():
            return
        a = np.where(m, alpha, 0.0)[..., None]
        dst[..., :3] = np.where(m[..., None], rgb * a + dst[..., :3] * (1.0 - a), dst[..., :3])
        dst[..., 3] = np.where(m, a[..., 0] + dst[..., 3] * (1.0 - a[..., 0]), dst[..., 3])

    def image(self):
        out = np.zeros((self.H, self.W, 4), dtype=np.uint8)
        out[..., :3] = np.clip(self.canvas[..., :3] * 255.0 + 0.5, 0, 255).astype(np.uint8)
        out[..., 3] = np.clip(self.canvas[..., 3] * 255.0 + 0.5, 0, 255).astype(np.uint8)
        return Image.fromarray(out, 'RGBA')


def render_view(quads, atlas, view='iso', size=420, scale=22.0, center=(8.0, 8.0, 8.0),
                offsets=None, bg=(30, 30, 34, 255), shade=True):
    """渲染一组 quads；offsets 可给每个方块一个平移（做多方块并排图）。"""
    sc = Scene(atlas, view=view, size=size, center=center, scale=scale, bg=bg, shade=shade)
    if offsets:
        for off in offsets:
            sc.draw(quads, off)
    else:
        sc.draw(quads)
    return sc.image()


def montage(images, labels=None, cols=4, pad=6, bg=(24, 24, 28)):
    w, h = images[0].size
    rows = (len(images) + cols - 1) // cols
    out = Image.new('RGB', (cols * (w + pad) + pad, rows * (h + pad + 16) + pad), bg)
    dr = ImageDraw.Draw(out)
    from PIL import ImageFont
    try:
        f = ImageFont.truetype('C:\\Windows\\Fonts\\consola.ttf', 12)
    except OSError:
        f = ImageFont.load_default()
    for i, im in enumerate(images):
        r, c = divmod(i, cols)
        x = pad + c * (w + pad)
        y = pad + r * (h + pad + 16)
        out.paste(im, (x, y), im)
        dr.rectangle([x, y, x + w - 1, y + h - 1], outline=(70, 70, 80))
        if labels:
            dr.text((x + 2, y + h + 2), labels[i], fill=(240, 220, 150), font=f)
    return out
