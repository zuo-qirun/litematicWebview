# -*- coding: utf-8 -*-
"""mcviewer 资产 QA 预览：把方块模型用 Pillow 画成等距/正交预览图。

用法：
    python tools\\bake\\preview.py                    # 默认：fixture 里最常用的 128 个方块状态，等距视图
    python tools\\bake\\preview.py --count 200        # 多画一些
    python tools\\bake\\preview.py --view top         # 正交顶视图（sheet_top.png）
    python tools\\bake\\preview.py --only oak_stairs,observer,hopper --only-all-states
    python tools\\bake\\preview.py --blocks oak_stairs#east#bottom

产物（都在 tools\\bake\\_preview\\ 下）：
    sheet.png        等距视图总览（默认）
    sheet_top.png    正交顶视图（--view top 时）
    sheet_qa.png     指定 --only 方块的特写
    report.txt       每个格子的状态串 / model id / quad 数（用于交叉核对）
"""
import argparse
import collections
import json
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
ASSETS = os.path.join(ROOT, 'assets')
FIXTURES = os.path.join(ROOT, 'tests', 'fixtures')
OUTDIR = os.path.join(HERE, '_preview')
sys.path.insert(0, HERE)

import verify  # noqa: E402  (复用 parse_state / resolve_models / read_fixture)

FACE_SHADE = [0.55, 1.0, 0.80, 0.80, 0.66, 0.66]     # 按 n（0..5）的原版式明暗
FACE_NORMAL = [(0, -1, 0), (0, 1, 0), (0, 0, -1), (0, 0, 1), (-1, 0, 0), (1, 0, 0)]

# 视图：把模型空间 (x,y,z) 投影到 2D；cam 是"从场景指向相机"的单位方向
VIEWS = {
    'iso': {
        'proj': lambda p: ((p[0] - p[2]) * 0.8660254, (p[0] + p[2]) * 0.5 - p[1]),
        'cam': (1.0, 1.0, 1.0),
        'scale': 2.75,
    },
    'top': {
        'proj': lambda p: (p[0], p[2]),
        'cam': (0.0, 1.0, 0.0),
        'scale': 4.6,
    },
    'front': {   # 看北面（原版 front 定义）
        'proj': lambda p: (p[0], -p[1]),
        'cam': (0.0, 0.0, -1.0),
        'scale': 4.6,
    },
    'side': {    # 看东面
        'proj': lambda p: (-p[2], -p[1]),
        'cam': (1.0, 0.0, 0.0),
        'scale': 4.6,
    },
}


def norm3(v):
    n = math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
    if n < 1e-9:
        return (0.0, 0.0, 0.0)
    return (v[0] / n, v[1] / n, v[2] / n)


def dot3(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def load_font(size):
    for name in ('consola.ttf', 'arial.ttf', 'segoeui.ttf', 'DejaVuSans.ttf'):
        for base in ('C:\\Windows\\Fonts\\', '/usr/share/fonts/truetype/dejavu/'):
            p = base + name
            if os.path.exists(p):
                try:
                    return ImageFont.truetype(p, size)
                except OSError:
                    pass
    try:
        return ImageFont.load_default(size)
    except TypeError:
        return ImageFont.load_default()


# ------------------------------------------------------------------ 投影/绘制
class Renderer:
    def __init__(self, atlas, view='iso', cw=126, ch=124, zoom=1.0):
        self.atlas = atlas.convert('RGBA')
        self.atlas_np = np.asarray(self.atlas)
        self.AH, self.AW = self.atlas_np.shape[:2]
        v = VIEWS[view]
        self.proj = v['proj']
        self.cam = norm3(v['cam'])
        self.scale = v['scale'] * zoom
        self.cw = cw
        self.ch = ch
        # 模型中心 (8,8,8) 投影到格子中心
        cx0, cy0 = self.proj((8.0, 8.0, 8.0))
        self.cx0, self.cy0 = cx0, cy0
        self.ox, self.oy = cw / 2.0, ch / 2.0

    def to_screen(self, p):
        sx, sy = self.proj(p)
        return (self.ox + (sx - self.cx0) * self.scale,
                self.oy - (sy - self.cy0) * self.scale)

    def render(self, quads, tint_colors):
        img = np.zeros((self.ch, self.cw, 4), dtype=np.float32)   # 直通 alpha 累积
        items = []
        for q in quads:
            p = q['p']
            P = [(p[0], p[1], p[2]), (p[3], p[4], p[5]),
                 (p[6], p[7], p[8]), (p[9], p[10], p[11])]
            # 几何法向（顶点逆时针 => 外法向）
            e1 = (P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2])
            e2 = (P[3][0] - P[0][0], P[3][1] - P[0][1], P[3][2] - P[0][2])
            n = norm3((e1[1] * e2[2] - e1[2] * e2[1],
                       e1[2] * e2[0] - e1[0] * e2[2],
                       e1[0] * e2[1] - e1[1] * e2[0]))
            if dot3(n, self.cam) <= 1e-6:      # 背面剔除
                continue
            cx = sum(v[0] for v in P) / 4.0
            cy = sum(v[1] for v in P) / 4.0
            cz = sum(v[2] for v in P) / 4.0
            depth = dot3((cx, cy, cz), self.cam)
            items.append((depth, P, q))
        items.sort(key=lambda it: it[0])        # 远的先画（painter）

        for _depth, P, q in items:
            self._draw_quad(img, P, q, tint_colors)
        out = np.zeros((self.ch, self.cw, 4), dtype=np.uint8)
        a = np.clip(img[..., 3], 0.0, 1.0)
        out[..., :3] = np.clip(img[..., :3] * 255.0 + 0.5, 0, 255).astype(np.uint8)
        out[..., 3] = (a * 255.0 + 0.5).astype(np.uint8)
        return Image.fromarray(out, 'RGBA')

    def _draw_quad(self, canvas, P, q, tint_colors):
        uv = q['uv']
        S = [self.to_screen(pt) for pt in P]
        T = [(uv[i * 2], uv[i * 2 + 1]) for i in range(4)]
        # 仿射 uv -> screen（最小二乘，4 点精确）
        A = np.array([[t[0], t[1], 1.0] for t in T], dtype=np.float64)
        Bx = np.array([s[0] for s in S], dtype=np.float64)
        By = np.array([s[1] for s in S], dtype=np.float64)
        try:
            solx, *_ = np.linalg.lstsq(A, Bx, rcond=None)
            soly, *_ = np.linalg.lstsq(A, By, rcond=None)
        except np.linalg.LinAlgError:
            return
        # screen = M * (u,v) + t
        M = np.array([[solx[0], solx[1]], [soly[0], soly[1]]], dtype=np.float64)
        t = np.array([solx[2], soly[2]], dtype=np.float64)
        det = M[0, 0] * M[1, 1] - M[0, 1] * M[1, 0]
        if abs(det) < 1e-9:
            return                      # 该面在屏幕上退化为线
        Minv = np.array([[M[1, 1], -M[0, 1]], [-M[1, 0], M[0, 0]]]) / det
        umin, umax = min(t[0] for t in T), max(t[0] for t in T)
        vmin, vmax = min(t[1] for t in T), max(t[1] for t in T)
        xs = [s[0] for s in S]
        ys = [s[1] for s in S]
        x0, x1 = int(math.floor(min(xs))), int(math.ceil(max(xs))) + 1
        y0, y1 = int(math.floor(min(ys))), int(math.ceil(max(ys))) + 1
        x0, x1 = max(0, x0), min(self.cw, x1)
        y0, y1 = max(0, y0), min(self.ch, y1)
        if x1 <= x0 or y1 <= y0:
            return
        gx = np.arange(x0, x1, dtype=np.float64) + 0.5
        gy = np.arange(y0, y1, dtype=np.float64) + 0.5
        SX = gx[None, :] - t[0]
        SY = gy[:, None] - t[1]
        U = Minv[0, 0] * SX + Minv[0, 1] * SY
        V = Minv[1, 0] * SX + Minv[1, 1] * SY
        inside = ((U >= umin - 0.5) & (U <= umax + 0.5)
                  & (V >= vmin - 0.5) & (V <= vmax + 0.5))
        if not inside.any():
            return
        iu = np.clip(np.floor(U).astype(np.int32), 0, self.AW - 1)
        iv = np.clip(np.floor(V).astype(np.int32), 0, self.AH - 1)
        tex = self.atlas_np[iv, iu].astype(np.float32)
        rgb = tex[..., :3] / 255.0
        alpha = tex[..., 3] / 255.0
        # 面明暗 + tint
        shade = FACE_SHADE[q.get('n', 1)]
        rgb = rgb * shade
        tc = None
        tint = q.get('tint', -1)
        if tint is not None and tint >= 0 and tint_colors:
            tc = tint_colors.get(str(tint)) or tint_colors.get(tint)
        if tc:
            rgb = rgb * np.array([tc[0], tc[1], tc[2]], dtype=np.float32)
        dst = canvas[y0:y1, x0:x1]
        m = inside[..., None] & (alpha[..., None] > 1.0 / 255.0)
        if not m.any():
            return
        a_src = np.where(m, alpha[..., None], 0.0)
        rgb_src = rgb * a_src
        dst_rgb = dst[..., :3] * (1.0 - a_src)
        dst[..., :3] = np.where(m, rgb_src + dst_rgb, dst[..., :3])
        dst[..., 3] = np.where(m[..., 0], a_src[..., 0] + dst[..., 3] * (1.0 - a_src[..., 0]),
                               dst[..., 3])


# ------------------------------------------------------------------ 选状态
def fixture_usage(fixtures):
    """{状态串: 实例数}，跨文件累加。"""
    usage = collections.Counter()
    for path in fixtures:
        try:
            stats, _nr, _tb = verify.read_fixture(path)
        except Exception as e:
            print('  读取 fixture 失败 %s: %s' % (os.path.basename(path), e))
            continue
        for reg in stats:
            for st, cnt in reg['states']:
                if st.startswith('minecraft:air'):
                    continue
                usage[st] += cnt
    return usage


def pick_states(usage, blocks, count):
    """按实例数排序取前 count 个状态；同方块只保留最常用的 1~2 个状态以覆盖更多方块。"""
    ranked = sorted(usage.items(), key=lambda kv: (-kv[1], kv[0]))
    out = []
    seen = collections.Counter()
    for st, cnt in ranked:
        name, props = verify.parse_state(st)
        defn = blocks.get(name)
        if defn is None:
            continue
        if defn.get('kind') == 'invisible':
            continue
        key = name
        if seen[key] >= 2:      # 每个方块最多 2 个状态
            continue
        seen[key] += 1
        out.append((st, cnt))
        if len(out) >= count:
            break
    return out


def tiles_for_state(state, blocks, models):
    """返回 (model_ids, quads, 说明)。"""
    name, props = verify.parse_state(state)
    defn = blocks.get(name) or {}
    ids, how = verify.resolve_models(defn, props)
    quads = []
    used = []
    for mid in ids:
        m = models.get(mid)
        if not m:
            continue
        used.append(mid)
        quads.extend(m.get('quads') or [])
    return used, quads, how, defn


# ------------------------------------------------------------------ 拼图
def make_sheet(items, blocks, models, atlas, view, cw, ch, cap_h, cols, font, title,
               zoom=1.0):
    rend = Renderer(atlas, view, cw, ch, zoom)
    rows = max(1, (len(items) + cols - 1) // cols)
    cell_w = cw + 4
    cell_h = ch + cap_h + 4
    W = cols * cell_w
    H = rows * cell_h + 26
    sheet = Image.new('RGB', (W, H), (28, 28, 32))
    dr = ImageDraw.Draw(sheet)
    dr.text((8, 7), title, fill=(235, 235, 240), font=font.big)
    report = []
    for i, (state, cnt) in enumerate(items):
        r, c = divmod(i, cols)
        x = c * cell_w + 2
        y = r * cell_h + 26 + 2
        name, props = verify.parse_state(state)
        defn = blocks.get(name) or {}
        used, quads, how, _d = tiles_for_state(state, blocks, models)
        tc = defn.get('tintColors') or {}
        img = rend.render(quads, tc)
        # 格子底：棋盘（便于看透明）
        bg = Image.new('RGB', (cw, ch), (44, 44, 50))
        bdr = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
        bdd = ImageDraw.Draw(bdr)
        bdd.rectangle([0, 0, cw - 1, ch - 1], outline=(70, 70, 80, 255))
        bg.paste(img, (0, 0), img)
        sheet.paste(bg, (x, y))
        sheet.paste(bdr.convert('RGB'), (x, y), bdr)
        # 标题：序号 + 方块名 +（属性用更小字号，最多 2 行）
        label = name.replace('minecraft:', '')
        dr.text((x + 2, y + ch + 2), '%d %s' % (i + 1, label),
                fill=(255, 235, 160), font=font.small)
        propstr = ','.join('%s=%s' % (k, props[k]) for k in sorted(props))
        per = max(8, int((cw - 6) / 6.0))
        lines = []
        while len(propstr) > per:
            lines.append(propstr[:per])
            propstr = propstr[per:]
            if len(lines) >= 2:
                propstr = propstr[:per]
                break
        if propstr:
            lines.append(propstr)
        for j, ln in enumerate(lines[:2]):
            dr.text((x + 2, y + ch + 14 + j * 10), ln, fill=(180, 190, 205),
                    font=font.tiny)
        report.append({'n': i + 1, 'state': state, 'instances': cnt,
                       'models': used, 'quads': len(quads), 'how': how})
    return sheet, report


class Fonts:
    def __init__(self):
        self.big = load_font(13)
        self.small = load_font(10)
        self.tiny = load_font(9)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--count', type=int, default=128)
    ap.add_argument('--view', default='iso', choices=sorted(VIEWS))
    ap.add_argument('--only', default='')
    ap.add_argument('--only-all-states', action='store_true')
    ap.add_argument('--per-block', type=int, default=0,
                    help='--only 时每个方块最多画几个状态（0=不限）')
    ap.add_argument('--cols', type=int, default=8)
    ap.add_argument('--zoom', type=float, default=1.0)
    ap.add_argument('--tile', type=int, default=0, help='格子边长（0=自动 126）')
    ap.add_argument('--out', default='')
    ap.add_argument('--assets', default=ASSETS)
    args = ap.parse_args()

    os.makedirs(OUTDIR, exist_ok=True)
    blocks = verify.load_json(os.path.join(args.assets, 'blocks.json'))['blocks']
    models = verify.load_json(os.path.join(args.assets, 'models.json'))['models']
    atlas = Image.open(os.path.join(args.assets, 'atlas.png'))
    fixtures = sorted(glob_fixtures())
    usage = fixture_usage(fixtures)
    print('fixture 状态数 %d（5 文件合计实例 %d）' % (len(usage), sum(usage.values())))

    cw = args.tile or 126
    cap_h = 44
    fonts = Fonts()
    if args.only:
        want = [w.strip().replace('minecraft:', '') for w in args.only.split(',') if w.strip()]
        items = []
        for name in want:
            states = [st for st in usage if verify.parse_state(st)[0] == 'minecraft:' + name]
            if not states:
                # 用 blocks.json 里的第一个变体当代表
                defn = blocks.get('minecraft:' + name)
                if defn and defn.get('variants'):
                    items.append(('minecraft:' + name + _props_suffix(defn['variants'][0].get('when')), 0))
                continue
            states.sort(key=lambda s: -usage[s])
            lim = args.per_block or (None if args.only_all_states else 1)
            sel = states if lim is None else states[:lim]
            items.extend((st, usage[st]) for st in sel)
        sheet, report = make_sheet(items, blocks, models, atlas, args.view,
                                   cw, cw, cap_h, args.cols, fonts,
                                   'mcviewer QA closeup  view=%s' % args.view,
                                   args.zoom)
        out = os.path.join(OUTDIR, args.out or 'sheet_qa.png')
    else:
        items = pick_states(usage, blocks, args.count)
        title = ('mcviewer asset preview  view=%s  top %d block states by fixture usage'
                 % (args.view, len(items)))
        sheet, report = make_sheet(items, blocks, models, atlas, args.view,
                                   cw, cw, cap_h, args.cols, fonts, title, args.zoom)
        out = os.path.join(OUTDIR, args.out or ('sheet.png' if args.view == 'iso'
                                                else 'sheet_%s.png' % args.view))
    sheet.save(out)
    rep = os.path.join(OUTDIR, 'report.txt')
    with open(rep, 'w', encoding='utf-8') as fh:
        fh.write('# view=%s  sheet=%s\n' % (args.view, os.path.basename(out)))
        for r in report:
            fh.write('%3d  %-58s x%-6d quads=%-3d %s\n     models=%s\n'
                     % (r['n'], r['state'], r['instances'], r['quads'],
                        r['how'], ', '.join(r['models'])))
    print('已生成 %s (%dx%d, %d 个格子)；清单 %s'
          % (out, sheet.width, sheet.height, len(items), rep))


def _props_suffix(when):
    if not when:
        return ''
    return '[' + ','.join('%s=%s' % (k, when[k]) for k in sorted(when)) + ']'


def glob_fixtures():
    if not os.path.isdir(FIXTURES):
        return []
    return [os.path.join(FIXTURES, f) for f in os.listdir(FIXTURES)
            if f.lower().endswith('.litematic')]


if __name__ == '__main__':
    main()
