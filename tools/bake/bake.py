#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""mcviewer 资产烘焙器。

用法:
    python tools/bake/bake.py --jars _dl/client-1.21.1.jar,_dl/client-26.3.jar --out assets

产出 assets/{manifest,blocks,models,lang,meta}.json + atlas.png
可重复执行、确定性输出（无时间戳以外的随机/时间因素；时间戳见 meta.json）。
"""
import argparse
import collections
import json
import os
import re
import shutil
import sys
import time
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))

# ---------------------------------------------------------------------------
# 面表
# ---------------------------------------------------------------------------
# 索引与契约 models.json 的 `n` 一致: 0=下 1=上 2=北 3=南 4=西 5=东
FACE_NAMES = ['down', 'up', 'north', 'south', 'west', 'east']
FACE_NORMALS = [(0, -1, 0), (0, 1, 0), (0, 0, -1), (0, 0, 1), (-1, 0, 0), (1, 0, 0)]
# 每个面的纹理坐标基（原版 BlockFaceUV 缺省 uv 公式反推，均为模型 0..16 空间下的线性函数）：
#   u = u_off + dot(p, au) ,  v = v_off + dot(p, av) ; au/av 为单位轴向量，sign 已含在向量里
FACE_UV_BASIS = {
    # name: (u_off, au, v_off, av)
    'down': (0.0, (1, 0, 0), 16.0, (0, 0, -1)),
    'up': (0.0, (1, 0, 0), 0.0, (0, 0, 1)),
    'north': (16.0, (-1, 0, 0), 16.0, (0, -1, 0)),
    'south': (0.0, (1, 0, 0), 16.0, (0, -1, 0)),
    'west': (0.0, (0, 0, 1), 16.0, (0, -1, 0)),
    'east': (16.0, (0, 0, -1), 16.0, (0, -1, 0)),
}
# 每个面在几何上"固定"的坐标轴（该面上该坐标恒定）
FACE_PLANE_AXIS = {'down': 1, 'up': 1, 'north': 2, 'south': 2, 'west': 0, 'east': 0}
# 原版式面明暗系数（仅 preview / 统计用，渲染器自己算）
FACE_SHADE = [0.5, 1.0, 0.8, 0.8, 0.6, 0.6]


def face_u(name, p):
    off, au, _, _ = FACE_UV_BASIS[name]
    return off + p[0] * au[0] + p[1] * au[1] + p[2] * au[2]


def face_v(name, p):
    _, _, off, av = FACE_UV_BASIS[name]
    return off + p[0] * av[0] + p[1] * av[1] + p[2] * av[2]


def _uv_quad_order(us, vs):
    """给定 4 个角在 (u,v) 空间的位置，返回按 TL,BL,BR,TR 排列的索引列表。

    TL=(umin,vmin) BL=(umin,vmax) BR=(umax,vmax) TR=(umax,vmin)，
    该顺序从面外侧看是逆时针（与原版一致）。退化（面积为 0）时返回 None。
    """
    umin, vmin = min(us), min(vs)
    slots = {}
    for i in range(4):
        key = (us[i] > umin, vs[i] > vmin)
        if key in slots:
            return None            # uv 空间退化（面积 0），无法排序
        slots[key] = i
    if len(slots) != 4:
        return None
    return [slots[(False, False)], slots[(False, True)],
            slots[(True, True)], slots[(True, False)]]


# ---------------------------------------------------------------------------
# 方块状态旋转: R = Ry(-y) * Rx(-x)   （原版 BlockModelRotation 语义：
#   x=90 => 顶面朝北、北面朝下 ; y=90 => 北面朝东）
# ---------------------------------------------------------------------------
def _rotmat_x(deg):
    d = deg % 360
    if d == 0:
        return ((1, 0, 0), (0, 1, 0), (0, 0, 1))
    if d == 90:      # (x,y,z) -> (x,-z, y)
        return ((1, 0, 0), (0, 0, -1), (0, 1, 0))
    if d == 180:
        return ((1, 0, 0), (0, -1, 0), (0, 0, -1))
    if d == 270:
        return ((1, 0, 0), (0, 0, 1), (0, -1, 0))
    raise ValueError('bad x %r' % (deg,))


def _rotmat_y(deg):
    d = deg % 360
    if d == 0:
        return ((1, 0, 0), (0, 1, 0), (0, 0, 1))
    if d == 90:      # (x,y,z) -> (z, y, -x)
        return ((0, 0, 1), (0, 1, 0), (-1, 0, 0))
    if d == 180:
        return ((-1, 0, 0), (0, 1, 0), (0, 0, -1))
    if d == 270:     # (x,y,z) -> (-z, y, x)
        return ((0, 0, -1), (0, 1, 0), (1, 0, 0))
    raise ValueError('bad y %r' % (deg,))


def mat_mul(a, b):
    return tuple(tuple(sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3))
                 for i in range(3))


def mat_vec(m, v):
    return (m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
            m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
            m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2])


IDENT = ((1, 0, 0), (0, 1, 0), (0, 0, 1))


def state_rotmat(x, y):
    """原版 blockstate variants/apply 的 x/y 旋转矩阵（先 x 后 y）。"""
    return mat_mul(_rotmat_y(-y), _rotmat_x(-x))


def rot_normal(m, n):
    v = mat_vec(m, n)
    for i, fn in enumerate(FACE_NORMALS):
        if v == fn:
            return i
    # 非轴对齐（元素旋转后可能出现浮点误差）→ 取最大分量
    ax = max(range(3), key=lambda i: abs(v[i]))
    s = 1 if v[ax] > 0 else -1
    t = [0, 0, 0]
    t[ax] = s
    return FACE_NORMALS.index(tuple(t))


# ---------------------------------------------------------------------------
# 元素旋转（22.5/45 度等任意角度，绕 origin、绕轴）
# ---------------------------------------------------------------------------
def _axis_rot(axis, deg, origin):
    import math
    t = math.radians(deg)
    c, s = math.cos(t), math.sin(t)
    ox, oy, oz = origin
    if axis == 'x':
        def f(p):
            y = p[1] - oy
            z = p[2] - oz
            return (p[0], oy + y * c - z * s, oz + y * s + z * c)
    elif axis == 'y':
        def f(p):
            x = p[0] - ox
            z = p[2] - oz
            return (ox + x * c + z * s, p[1], oz - x * s + z * c)
    else:
        def f(p):
            x = p[0] - ox
            y = p[1] - oy
            return (ox + x * c - y * s, oy + x * s + y * c, p[2])
    return f


# ---------------------------------------------------------------------------
# jar 读取
# ---------------------------------------------------------------------------
class AssetSource(object):
    """多个 jar 按优先级合并（前面的优先）。"""

    def __init__(self, jars):
        self.zips = []
        self.names = []          # 每个 zip 的 namelist
        self.sets = []
        for j in jars:
            z = zipfile.ZipFile(j)
            self.zips.append(z)
            nl = z.namelist()
            self.names.append(nl)
            self.sets.append(set(nl))
        self.merged = set()
        for s in self.sets:
            self.merged |= s
        self._cache = {}

    def has(self, path):
        return path in self.merged

    def read(self, path, default=None):
        for z, s in zip(self.zips, self.sets):
            if path in s:
                return z.read(path)
        return default

    def json(self, path, default=None):
        raw = self.read(path)
        if raw is None:
            return default
        return json.loads(raw.decode('utf-8'))

    def list(self, prefix, suffix=''):
        out = []
        for s in self.sets:
            for p in s:
                if p.startswith(prefix) and p.endswith(suffix):
                    out.append(p)
        return sorted(set(out))

    def close(self):
        for z in self.zips:
            z.close()


# ---------------------------------------------------------------------------
# 模型解析（parent 链）
# ---------------------------------------------------------------------------
class ModelResolver(object):
    def __init__(self, src):
        self.src = src
        self.cache = {}
        self.missing = set()
        self.cycles = 0

    @staticmethod
    def normalize(ref):
        """'minecraft:block/oak_stairs' -> 'block/oak_stairs'"""
        if ref is None:
            return None
        r = ref.strip()
        if r.startswith('minecraft:'):
            r = r[len('minecraft:'):]
        return r

    def _raw(self, path):
        return self.src.json('assets/minecraft/models/%s.json' % path, None)

    def resolve(self, ref):
        path = self.normalize(ref)
        if path in self.cache:
            return self.cache[path]
        chain = []
        seen = set()
        cur = path
        base = {'textures': {}}
        while cur is not None:
            if cur in seen:
                self.cycles += 1
                break
            seen.add(cur)
            data = self._raw(cur)
            if data is None:
                self.missing.add(cur)
                break
            chain.append((cur, data))
            p = data.get('parent')
            cur = self.normalize(p) if p else None
            if cur is not None and cur.startswith('builtin/'):
                # builtin/entity, builtin/generated, ... 没有可烘焙几何
                break
        # 自底向上合并：textures 父->子覆盖；elements 取"最近"（最派生）的一个定义
        textures = {}
        elements = None
        for cur, data in reversed(chain):      # 根 -> 子：父纹理先铺，子覆盖
            if 'textures' in data:
                textures.update(data['textures'])
        for cur, data in chain:                # 子 -> 根：第一个 elements 即最派生定义
            if 'elements' in data:
                elements = data['elements']
                break
        res = {'textures': textures, 'elements': elements or [],
               'chain': [c for c, _ in chain]}
        self.cache[path] = res
        return res

    def resolve_texture(self, name, textures):
        """#var 递归解析为 'block/xxx'（或 None）。

        原版 quirk：faces.texture 允许写裸变量名（如 block/heavy_core 的 "all"），
        等价于 "#all"。所以裸名若命中 textures 的 key 就当变量处理。
        """
        if name is None:
            return None
        seen = set()
        cur = name
        while True:
            if not isinstance(cur, str):
                return None
            if cur.startswith('#'):
                key = cur[1:]
            elif '/' not in cur and ':' not in cur and cur in textures:
                key = cur
            else:
                return self.normalize(cur)
            if key in seen:
                return None
            seen.add(key)
            if key not in textures:
                return None
            cur = textures[key]
            if cur is None:
                return None


# ---------------------------------------------------------------------------
# 图集
# ---------------------------------------------------------------------------
def load_texture(src, texpath):
    """返回 (PIL.Image RGBA, 是否动画截帧)。缺失返回 None。"""
    from io import BytesIO
    from PIL import Image
    p = 'assets/minecraft/textures/%s.png' % texpath
    raw = src.read(p)
    if raw is None:
        return None, False
    try:
        im = Image.open(BytesIO(raw))
        im.load()
    except Exception:
        return None, False
    cut = False
    if im.size[1] > im.size[0]:
        w = im.size[0]
        im = im.crop((0, 0, w, w))
        cut = True
    if im.mode != 'RGBA':
        im = im.convert('RGBA')
    return im, cut


def magenta_checker():
    from PIL import Image
    im = Image.new('RGBA', (16, 16), (255, 0, 255, 255))
    px = im.load()
    for y in range(16):
        for x in range(16):
            if (x // 4 + y // 4) % 2 == 0:
                px[x, y] = (0, 0, 0, 255)
    return im


def pack_atlas(entries, padding, min_size, max_size):
    """entries: list of (texpath, PIL.Image)。返回 (atlas Image, placement dict, size, usage)"""
    from PIL import Image
    items = []
    for tex, im in entries:
        items.append((im.size[0], im.size[1], tex, im))
    items.sort(key=lambda t: (-t[1], -t[0], t[2]))

    def try_size(size):
        rows = []          # [y, height, x_cursor]
        place = {}
        for w, h, tex, im in items:
            cw, ch = w + 2 * padding, h + 2 * padding
            best = None
            for r in rows:
                if r[2] + cw <= size and r[1] >= ch:
                    best = r
                    break
            if best is None:
                y = rows[-1][0] + rows[-1][1] if rows else 0
                if y + ch > size:
                    return None
                best = [y, ch, 0]
                rows.append(best)
            x = best[2]
            best[2] += cw
            place[tex] = (x + padding, best[0] + padding, w, h)
        return place, rows

    size = min_size
    while size <= max_size:
        r = try_size(size)
        if r is not None:
            place, rows = r
            break
        size *= 2
    else:
        raise SystemExit('atlas too small / too many textures')

    atlas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    used = 0
    for tex, im in entries:
        x, y, w, h = place[tex]
        atlas.paste(im, (x, y))
        used += (w + 2 * padding) * (h + 2 * padding)
        # padding：边缘像素复制
        if padding:
            left = im.crop((0, 0, 1, h)).resize((padding, h), Image.NEAREST)
            right = im.crop((w - 1, 0, w, h)).resize((padding, h), Image.NEAREST)
            atlas.paste(left, (x - padding, y))
            atlas.paste(right, (x + w, y))
            top = atlas.crop((x - padding, y, x + w + padding, y + 1)).resize(
                (w + 2 * padding, padding), Image.NEAREST)
            bot = atlas.crop((x - padding, y + h - 1, x + w + padding, y + h)).resize(
                (w + 2 * padding, padding), Image.NEAREST)
            atlas.paste(top, (x - padding, y - padding))
            atlas.paste(bot, (x - padding, y + h))
    return atlas, place, size, used / float(size * size)


# ---------------------------------------------------------------------------
# 数值 / JSON 输出
# ---------------------------------------------------------------------------
def num(v):
    """能取整就取整，否则保留 4 位小数（去掉浮点噪声）。"""
    r = round(float(v), 4)
    i = int(r)
    if r == i:
        return i
    return r


def compact_json(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(',', ':'), sort_keys=False)


def write_json(path, obj):
    data = compact_json(obj)
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(data)
    return len(data.encode('utf-8'))


def model_file_name(model_id):
    """模型 id → 单文件模型名（无扩展名）。

    必须与前端 src/render/db.js 的 encodeModelId() 完全一致：
    把三个在 Windows / URL 里麻烦的字符换成安全字符。
    模型 id 只由 [A-Za-z0-9_/] 与可选的 '#x,yu' 后缀组成，替换后仍是纯 ASCII。
    """
    return model_id.replace('/', '$').replace('#', '@').replace(',', '!')


# ---------------------------------------------------------------------------
# 分类表
# ---------------------------------------------------------------------------
# kind=invisible：无可见几何
INVISIBLE_BLOCKS = {
    'air', 'cave_air', 'void_air', 'barrier', 'light', 'structure_void',
    'bubble_column', 'moving_piston',
}
# 原版 translucent 渲染层（纹理本身多半看不出来，需硬编码）
TRANSLUCENT_EXACT = {
    'water', 'bubble_column', 'ice', 'frosted_ice', 'packed_ice', 'blue_ice',
    'slime_block', 'honey_block', 'water_cauldron', 'nether_portal',
    'tinted_glass', 'beacon',
}
# 原版 cutout（alphaTest）渲染层，纹理 alpha 检测兜底，这里只是保险
CUTOUT_SUFFIX = ('_leaves', '_leaves_flowering')
CUTOUT_EXACT = {
    'glass', 'tinted_glass', 'iron_bars', 'torch', 'wall_torch', 'soul_torch',
    'soul_wall_torch', 'redstone_torch', 'redstone_wall_torch', 'ladder',
    'rail', 'powered_rail', 'detector_rail', 'activator_rail',
    'cobweb', 'tripwire', 'tripwire_hook', 'vine', 'lily_pad', 'flower_pot',
    'chain', 'lantern', 'soul_lantern', 'sea_pickle', 'scaffolding',
    'end_rod', 'lightning_rod', 'bamboo', 'pointed_dripstone', 'candle',
    'white_candle', 'gray_candle', 'black_candle', 'brown_candle',
    'red_candle', 'orange_candle', 'yellow_candle', 'lime_candle',
    'green_candle', 'cyan_candle', 'blue_candle', 'purple_candle',
    'magenta_candle', 'pink_candle',
}

# §1.6 tint 颜色表：block -> {tintindex: (r,g,b) 0..1}
def _hex(h):
    return (round(int(h[1:3], 16) / 255.0, 4),
            round(int(h[3:5], 16) / 255.0, 4),
            round(int(h[5:7], 16) / 255.0, 4))


GRASS = _hex('#91BD59')
FOLIAGE = _hex('#48B518')
TINT_TABLE = {}
for _b in ('grass_block', 'short_grass', 'tall_grass', 'fern', 'large_fern',
           'sugar_cane'):
    TINT_TABLE[_b] = {0: GRASS}
for _b in ('oak_leaves', 'jungle_leaves', 'acacia_leaves', 'dark_oak_leaves',
           'vine'):
    TINT_TABLE[_b] = {0: FOLIAGE}
TINT_TABLE['mangrove_leaves'] = {0: _hex('#8DB127')}
TINT_TABLE['birch_leaves'] = {0: _hex('#80A755')}
TINT_TABLE['spruce_leaves'] = {0: _hex('#619961')}
TINT_TABLE['lily_pad'] = {0: _hex('#208030')}
for _b in ('water', 'bubble_column'):
    TINT_TABLE[_b] = {0: _hex('#3F76E4')}
TINT_TABLE['redstone_wire'] = {0: _hex('#FF0000')}

# 无几何模型不要生成占位方块的（不可见/纯逻辑）
NO_FALLBACK_BASES = {
    'block/air', 'block/barrier', 'block/light', 'block/structure_void',
    'block/moving_piston', 'block/void_air', 'block/cave_air',
    'block/end_portal', 'block/end_gateway',
}

MISSING_TEX = '__missing__'


# ---------------------------------------------------------------------------
# 烘焙单模型实例
# ---------------------------------------------------------------------------
class Baker(object):
    def __init__(self, src, atlas_place):
        self.src = src
        self.res = ModelResolver(src)
        self.place = atlas_place
        self.cache = {}
        self.missing_textures = set()
        self.model_textures = {}     # model id -> set(texpath)
        self.no_geom_models = set()

    # --- 模型 id ---
    @staticmethod
    def mid(base, x, y, uvlock):
        if x == 0 and y == 0:
            return base
        return '%s#%d,%d%s' % (base, x, y, 'u' if uvlock else '')

    def collect(self, base):
        """解析模型（不依赖图集），返回 (elements, textures)；并记录纹理引用。"""
        res = self.res.resolve(base)
        texs = []
        for el in res['elements']:
            for fname in FACE_NAMES:
                fd = (el.get('faces') or {}).get(fname)
                if not fd:
                    continue
                t = self.res.resolve_texture(fd.get('texture'), res['textures'])
                if t is None:
                    self.missing_textures.add(
                        '%s:%s' % (base, fd.get('texture')))
                    t = MISSING_TEX
                texs.append(t)
        return res, texs

    def bake(self, base, x, y, uvlock):
        key = self.mid(base, x, y, uvlock)
        if key in self.cache:
            return key
        res = self.res.resolve(base)
        R = state_rotmat(x, y) if (x or y) else IDENT
        quads = []
        texs = set()
        for el in res['elements']:
            fro = el.get('from')
            to = el.get('to')
            if not fro or not to:
                continue
            lo = [min(float(fro[i]), float(to[i])) for i in range(3)]
            hi = [max(float(fro[i]), float(to[i])) for i in range(3)]
            rotf = None
            elrot = el.get('rotation')
            if elrot:
                ang = float(elrot.get('angle', 0) or 0)
                if ang:
                    org = elrot.get('origin') or [8, 8, 8]
                    rotf = _axis_rot(elrot.get('axis', 'y'), ang,
                                     tuple(float(v) for v in org))
            faces = el.get('faces') or {}
            for fname in FACE_NAMES:
                fd = faces.get(fname)
                if not fd:
                    continue
                texpath = self.res.resolve_texture(fd.get('texture'),
                                                   res['textures'])
                if texpath is None:
                    self.missing_textures.add('%s:%s' % (base, fd.get('texture')))
                    texpath = MISSING_TEX
                texs.add(texpath)

                plane = FACE_PLANE_AXIS[fname]
                nrm = FACE_NORMALS[FACE_NAMES.index(fname)]
                pval = hi[plane] if nrm[plane] > 0 else lo[plane]
                oth = [i for i in range(3) if i != plane]
                corners = []
                for i1 in (0, 1):
                    for i2 in (0, 1):
                        p = [0.0, 0.0, 0.0]
                        p[plane] = pval
                        p[oth[0]] = hi[oth[0]] if i1 else lo[oth[0]]
                        p[oth[1]] = hi[oth[1]] if i2 else lo[oth[1]]
                        corners.append(tuple(p))
                us = [face_u(fname, p) for p in corners]
                vs = [face_v(fname, p) for p in corners]
                umin, umax = min(us), max(us)
                vmin, vmax = min(vs), max(vs)
                uv = fd.get('uv')
                if uv is None:
                    u1, v1, u2, v2 = umin, vmin, umax, vmax
                else:
                    u1, v1, u2, v2 = (float(uv[0]), float(uv[1]),
                                      float(uv[2]), float(uv[3]))
                # 4 个 uv 角：0=TL 1=TR 2=BR 3=BL
                cc = [(u1, v1), (u2, v1), (u2, v2), (u1, v2)]
                k = int(fd.get('rotation') or 0) // 90
                k %= 4
                # 位置顺序按 uv 空间排成 TL,BL,BR,TR（从外侧看逆时针），
                # 再配 uv 角索引 [0,3,2,1]（TL,BL,BR,TR 在 cc 里的序号）
                base_idx = [0, 3, 2, 1]
                order = _uv_quad_order(us, vs)
                if order is None:
                    # uv 空间退化 = 该面几何面积为 0（薄片元素的侧边），不可见，跳过
                    continue
                pos = [corners[i] for i in order]
                uvs = [cc[(base_idx[j] - k) % 4] for j in range(4)]
                # 元素旋转（只动位置）
                if rotf is not None:
                    pos = [rotf(p) for p in pos]
                # blockstate 旋转
                if R is not IDENT:
                    pos = [tuple(mat_vec(R, (p[0] - 8.0, p[1] - 8.0, p[2] - 8.0))[i] + 8.0
                                 for i in range(3)) for p in pos]
                nidx = rot_normal(R, nrm) if R is not IDENT else FACE_NAMES.index(fname)
                if uvlock and R is not IDENT:
                    # uv 不随方块旋转：按**旋转后**该面朝向的标准 (u,v) 基重新排角
                    nfname = FACE_NAMES[nidx]
                    us2 = [face_u(nfname, p) for p in pos]
                    vs2 = [face_v(nfname, p) for p in pos]
                    order2 = _uv_quad_order(us2, vs2)
                    if order2 is not None:
                        pos = [pos[i] for i in order2]
                        uvs = [cc[(base_idx[bi] - k) % 4] for bi in range(4)]
                # 图集映射
                place = self.place.get(texpath)
                if place is None:
                    place = self.place[MISSING_TEX]
                px, py, pw, ph = place
                uvpx = []
                for (u, v) in uvs:
                    uvpx.append(num(px + u / 16.0 * pw))
                    uvpx.append(num(py + v / 16.0 * ph))
                pflat = []
                for p in pos:
                    pflat.extend((num(p[0]), num(p[1]), num(p[2])))
                tint = fd.get('tintindex', -1)
                tint = int(tint) if tint is not None else -1
                if tint < 0:
                    tint = -1
                quads.append({'p': pflat, 'uv': uvpx, 'n': int(nidx),
                              'tint': tint, 'tex': texpath})
        self.cache[key] = quads
        self.model_textures[key] = texs
        if not quads:
            self.no_geom_models.add(key)
        return key


# ---------------------------------------------------------------------------
# blockstate -> BlockDef
# ---------------------------------------------------------------------------
def dnf_expand(cond, _depth=0):
    """把 when（可含 OR / AND / 'a|b'）展开成若干"单值属性表"。None -> [None]"""
    if cond is None:
        return [None]
    if _depth > 8:
        return [None]
    out = []
    if isinstance(cond, list):
        for c in cond:
            out.extend(dnf_expand(c, _depth + 1))
        return out
    if not isinstance(cond, dict):
        return [None]
    if 'OR' in cond and len(cond) == 1:
        for c in cond['OR']:
            out.extend(dnf_expand(c, _depth + 1))
        return out
    if 'AND' in cond and len(cond) == 1:
        acc = [{}]
        for c in cond['AND']:
            subs = dnf_expand(c, _depth + 1)
            subs = [s for s in subs if s is not None] or [{}]
            acc = [dict(a, **b) for a in acc for b in subs]
        return acc or [{}]
    # 混合：属性 + AND/OR
    parts = [{}]
    for k, v in cond.items():
        if k in ('OR', 'AND'):
            subs = dnf_expand(cond, _depth + 1)
            return subs
        vals = v.split('|') if isinstance(v, str) else list(v)
        parts = [dict(p, **{k: val}) for p in parts for val in vals]
    return parts


def parse_variant_key(key):
    when = {}
    for piece in key.split(','):
        piece = piece.strip()
        if not piece:
            continue
        if '=' not in piece:
            continue
        a, b = piece.split('=', 1)
        when[a.strip()] = b.strip()
    return when


APPLY_KEYS = ('model', 'x', 'y', 'uvlock', 'weight')


def normalize_apply(ap):
    """apply -> list of (model_ref, x, y, uvlock)"""
    if ap is None:
        return []
    items = ap if isinstance(ap, list) else [ap]
    out = []
    for it in items:
        if not isinstance(it, dict):
            continue
        m = it.get('model')
        if not m:
            continue
        x = int(it.get('x', 0) or 0) % 360
        y = int(it.get('y', 0) or 0) % 360
        uvlock = bool(it.get('uvlock', False))
        out.append((m, x, y, uvlock))
    return out


# ---------------------------------------------------------------------------
# lang
# ---------------------------------------------------------------------------
LANG_DIR = os.path.join(HERE, '_work', 'lang')
SOURCES_JSON = os.path.join(HERE, '_work', 'sources.json')


def _curl(url, dst):
    import subprocess
    try:
        subprocess.run(['curl.exe', '-sSL', '--max-time', '90', '-o', dst, url],
                       check=True)
        return os.path.isfile(dst) and os.path.getsize(dst) > 1000
    except Exception as e:
        print('  curl 失败 %s: %s' % (url, e))
        return False


def fetch_zh_cn(version_json_url, reuse=True):
    """下载 1.21.1 官方 zh_cn 语言文件到 _work/lang。失败返回 None。"""
    os.makedirs(LANG_DIR, exist_ok=True)
    dst = os.path.join(LANG_DIR, 'zh_cn-1.21.1.json')
    if reuse and os.path.isfile(dst) and os.path.getsize(dst) > 1000:
        print('  [lang] 复用已有 %s' % os.path.relpath(dst, ROOT))
        return dst
    import subprocess
    vj = os.path.join(LANG_DIR, '_version.json')
    idx = os.path.join(LANG_DIR, '_assetindex.json')
    print('  [lang] 下载 version json ...')
    if not _curl(version_json_url, vj):
        return None
    try:
        with open(vj, 'r', encoding='utf-8') as f:
            v = json.load(f)
        asset_url = v['assetIndex']['url']
        asset_id = v.get('assetIndex', {}).get('id', '?')
    except Exception as e:
        print('  [lang] version json 解析失败: %s' % e)
        return None
    print('  [lang] 下载 asset index id=%s ...' % asset_id)
    if not _curl(asset_url, idx):
        return None
    try:
        with open(idx, 'r', encoding='utf-8') as f:
            ai = json.load(f)
        obj = ai['objects']['minecraft/lang/zh_cn.json']
        h = obj['hash']
    except Exception as e:
        print('  [lang] asset index 解析失败: %s' % e)
        return None
    urls = [
        'https://resources.download.minecraft.net/%s/%s' % (h[:2], h),
        'https://bmclapi2.bangbang93.com/assets/%s/%s' % (h[:2], h),
        'https://download.mcbbs.net/assets/%s/%s' % (h[:2], h),
    ]
    for u in urls:
        print('  [lang] 下载 zh_cn.json (%s) ...' % u.split('/')[2])
        if _curl(u, dst):
            try:
                with open(dst, 'r', encoding='utf-8') as f:
                    d = json.load(f)
                if not isinstance(d, dict) or len(d) < 500:
                    raise ValueError('内容不像语言文件')
            except Exception as e:
                print('  [lang] 校验失败: %s' % e)
                continue
            rec = {}
            if os.path.isfile(SOURCES_JSON):
                try:
                    with open(SOURCES_JSON, 'r', encoding='utf-8') as f:
                        rec = json.load(f)
                except Exception:
                    rec = {}
            rec['zh_cn-1.21.1.json'] = {
                'url': u, 'sha1': h,
                'fetched': time.strftime('%Y-%m-%dT%H:%M:%S%z'),
                'bytes': os.path.getsize(dst)}
            with open(SOURCES_JSON, 'w', encoding='utf-8', newline='\n') as f:
                f.write(json.dumps(rec, ensure_ascii=False, indent=1))
            return dst
    return None


def load_lang(src, zh_path):
    en = src.json('assets/minecraft/lang/en_us.json', {}) or {}
    en_block = {k: v for k, v in en.items() if k.startswith('block.minecraft.')}
    zh = {}
    if zh_path and os.path.isfile(zh_path):
        with open(zh_path, 'r', encoding='utf-8') as f:
            raw = json.load(f)
        for k, v in raw.items():
            if k.startswith('block.minecraft.') and k in en_block:
                zh[k] = v
    return en_block, zh


# ---------------------------------------------------------------------------
# 渲染层分类
# ---------------------------------------------------------------------------
class TexInfo(object):
    def __init__(self):
        self.images = {}
        self.alpha = {}
        self.animated = set()

    def get(self, src, texpath):
        if texpath == MISSING_TEX:
            return None
        if texpath in self.images:
            return self.images[texpath]
        im, cut = load_texture(src, texpath)
        self.images[texpath] = im
        if cut:
            self.animated.add(texpath)
        if im is None:
            self.alpha[texpath] = (0, 0)
        else:
            h = im.getchannel('A').histogram()
            zero = h[0]
            partial = sum(h[1:255])
            self.alpha[texpath] = (zero, partial)
        return im


def classify_render(name, textures, texinfo, src):
    if name in TRANSLUCENT_EXACT:
        return 'translucent'
    if name in CUTOUT_EXACT or name.endswith(CUTOUT_SUFFIX):
        return 'cutout'
    if name in ('glass_pane',) or name.endswith('_stained_glass') or \
            name.endswith('_stained_glass_pane') or name.endswith('_leaves') or \
            name.endswith('_leaves_flowering') or name.endswith('_glass') or \
            name.endswith('_glass_pane'):
        return 'cutout'
    zero = 0
    partial = 0
    total_px = 0
    for t in textures:
        if t == MISSING_TEX:
            continue
        texinfo.get(src, t)
        a = texinfo.alpha.get(t)
        im = texinfo.images.get(t)
        if a is None or im is None:
            continue
        zero += a[0]
        partial += a[1]
        total_px += im.size[0] * im.size[1]
    if total_px and partial / float(total_px) >= 0.02:
        return 'translucent'
    if zero > 0:
        return 'cutout'
    return 'opaque'


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------
def build(jars, out, atlas_min=1024, reuse_lang=True, lang_file=None,
          fetch_lang=True, fixtures_dir=None, verbose=True,
          src=None, lang_pair=None, atlas_fn=None, write_atlas_index=True):
    """烘焙主流程。

    可选扩展点（默认 None/True 时行为与历史版本完全一致，供 tools/bake/pack.py 复用）：
      src              自定义资产源（需实现 has/read/json/list/close），默认由 jars 构造
      lang_pair        (en_block, zh_block) 语言字典，给定时跳过下载/读取，直接使用
      atlas_fn         callable(entries, padding, min_size, max_size) -> (atlas, place, size, usage)
                       默认是 pack_atlas；pack.py 用它实现「图集布局冻结 + 覆盖/追加」
      write_atlas_index 是否写 tools/bake/_work/atlas_index.json（pack.py 传 False，避免污染基准布局）
    """
    t0 = time.time()
    jarpaths = [j if os.path.isabs(j) else os.path.join(ROOT, j) for j in jars]
    if src is None:
        src = AssetSource(jarpaths)
    if verbose:
        print('jars: %s' % ', '.join(os.path.basename(j) for j in jarpaths))

    baker = Baker(src, None)

    # ---- 1. blockstates ----
    bs_paths = src.list('assets/minecraft/blockstates/', '.json')
    blocks = collections.OrderedDict()
    order = []
    parse_fail = []
    parse_empty = []
    for p in bs_paths:
        name = p.rsplit('/', 1)[-1][:-5]
        try:
            data = src.json(p)
        except Exception as e:
            parse_fail.append('%s (%s)' % (name, e))
            continue
        if not isinstance(data, dict):
            parse_fail.append('%s (not object)' % name)
            continue
        entries = []      # [{when, models, nprops}]
        kind = None
        try:
            if 'variants' in data and isinstance(data['variants'], dict):
                kind = 'variants'
                for key, val in data['variants'].items():
                    if isinstance(val, dict) and 'model' not in val and \
                            all(isinstance(v, dict) for v in val.values()):
                        # 旧的"属性->模型"内联写法（少数 mod / 老格式）
                        for k2, v2 in val.items():
                            when = dict(parse_variant_key(key))
                            when.update(parse_variant_key(k2))
                            mids = [baker.mid(ModelResolver.normalize(m), x, y, u)
                                    for (m, x, y, u) in normalize_apply(v2)]
                            if mids:
                                entries.append({'when': when, 'models': mids,
                                                'nprops': len(when)})
                        continue
                    when = parse_variant_key(key)
                    mids = []
                    for (m, x, y, u) in normalize_apply(val):
                        mids.append(baker.mid(ModelResolver.normalize(m), x, y, u))
                    if mids:
                        entries.append({'when': when, 'models': mids,
                                        'nprops': len(when)})
            elif 'multipart' in data and isinstance(data['multipart'], list):
                kind = 'multipart'
                for part in data['multipart']:
                    if not isinstance(part, dict):
                        continue
                    staff = normalize_apply(part.get('apply'))
                    if not staff:
                        continue
                    mids = [baker.mid(ModelResolver.normalize(m), x, y, u)
                            for (m, x, y, u) in staff]
                    conds = dnf_expand(part.get('when'))
                    for c in conds:
                        entries.append({'when': c or None, 'models': mids,
                                        'nprops': len(c) if c else 0})
            else:
                parse_empty.append(name)
                continue
        except Exception as e:
            parse_fail.append('%s (%s)' % (name, e))
            continue
        if not entries:
            parse_empty.append(name)
            continue
        if kind == 'variants':
            entries.sort(key=lambda e: (-e['nprops'], compact_json(e['when'])))
        blocks[name] = {'kind': kind, 'entries': entries}
        order.append(name)

    if verbose:
        print('blockstates: %d 个（解析失败 %d，无几何 %d）'
              % (len(order), len(parse_fail), len(parse_empty)))

    # ---- 2. 收集模型实例与纹理引用 ----
    instances = collections.OrderedDict()   # mid -> (base, x, y, uvlock)
    block_mids = {}
    block_texs = {}
    for name in order:
        b = blocks[name]
        mids = []
        for e in b['entries']:
            for mid in e['models']:
                if mid in mids:
                    continue
                mids.append(mid)
                if mid not in instances:
                    base = mid.split('#')[0]
                    if '#' in mid:
                        tail = mid.split('#')[1]
                        uv = tail.endswith('u')
                        xs, ys = tail.rstrip('u').split(',')
                        instances[mid] = (base, int(xs), int(ys), uv)
                    else:
                        instances[mid] = (base, 0, 0, False)
        block_mids[name] = mids
        texs = set()
        for mid in mids:
            base = instances[mid][0]
            try:
                baker.collect(base)
            except Exception:
                pass
            texs |= set(baker.model_textures.get(mid, ()))
            if mid in baker.model_textures:
                texs |= baker.model_textures[mid]
        block_texs[name] = texs

    # 模型纹理表（collect 阶段已按 base 缓存，这里按 mid 重算旋转无关的纹理集合）
    for mid, info in instances.items():
        base = info[0]
        try:
            _res, texs = baker.collect(base)
        except Exception as e:
            print('  collect 失败 %s: %s' % (mid, e))
            texs = []
        baker.model_textures[mid] = set(texs)
    for name in order:
        texs = set()
        for mid in block_mids[name]:
            texs |= baker.model_textures.get(mid, set())
        block_texs[name] = texs

    # ---- 3. 图集 ----
    texinfo = TexInfo()
    needed = set()
    for name in order:
        needed |= block_texs[name]
    needed.discard(MISSING_TEX)
    needed = sorted(needed)
    entries = []
    missing_tex = []
    for t in needed:
        im = texinfo.get(src, t)
        if im is None:
            missing_tex.append(t)
            continue
        entries.append((t, im))
    entries.append((MISSING_TEX, magenta_checker()))
    do_pack = atlas_fn or pack_atlas
    atlas, place, atlas_size, usage = do_pack(entries, 2, atlas_min, 4096)
    baker.place = place
    if verbose:
        print('textures: %d 张（缺 %d），atlas %dx%d 占用 %.1f%%'
              % (len(entries) - 1, len(texinfo.images) - len(entries) + 1,
                 atlas_size, atlas_size, usage * 100.0))

    # ---- 4. 烘焙 quads ----
    models = {}
    fallback_models = []
    for mid, info in instances.items():
        base, x, y, uvl = info
        try:
            baker.bake(base, x, y, uvl)
        except Exception as e:
            if verbose:
                print('  bake 失败 %s: %s' % (mid, e))
            baker.cache[mid] = []
            baker.model_textures.setdefault(mid, set())
        quads = baker.cache.get(mid, [])
        if not quads:
            quads = fallback_cube(baker, base, place)
            if quads:
                fallback_models.append(mid)
        models[mid] = {'quads': quads}

    # ---- 5. 方块表 ----
    out_blocks = collections.OrderedDict()
    missing_blocks = []
    tex_gaps = set()
    tint_blocks = 0
    tint_names = []
    render_count = collections.Counter()
    for name in sorted(order):
        b = blocks[name]
        full = 'minecraft:' + name
        texs = block_texs[name]
        tex_gaps |= set(t for t in texs if t == MISSING_TEX)
        render = classify_render(name, texs, texinfo, src)
        bd = collections.OrderedDict()
        if name in INVISIBLE_BLOCKS:
            bd['kind'] = 'invisible'
        else:
            bd['kind'] = b['kind']
            if b['kind'] == 'variants':
                vs = []
                has_default = False
                for e in b['entries']:
                    w = e['when'] or {}
                    if not w:
                        has_default = True
                    vs.append(collections.OrderedDict(
                        (('when', w), ('models', e['models']))))
                bd['variants'] = vs
                if not has_default and vs:
                    bd['default'] = list(vs[0]['models'])
            else:
                ps = []
                for e in b['entries']:
                    w = e['when']
                    ps.append(collections.OrderedDict(
                        (('when', w if w else None), ('models', e['models']))))
                bd['parts'] = ps
        bd['render'] = render
        render_count[render] += 1
        tt = TINT_TABLE.get(name)
        if tt:
            bd['tintColors'] = collections.OrderedDict(
                (str(k), list(v)) for k, v in sorted(tt.items()))
            tint_blocks += 1
            tint_names.append(full)
        out_blocks[full] = bd

    if 'minecraft:air' not in out_blocks:
        out_blocks['minecraft:air'] = collections.OrderedDict(
            (('kind', 'invisible'), ('render', 'opaque')))

    # ---- 6. lang ----
    if lang_pair is not None:
        en_block, zh_block = lang_pair
    else:
        zh_path = None
        if lang_file is not None:
            zh_path = lang_file
        elif fetch_lang:
            zh_path = fetch_zh_cn(
                'https://piston-meta.mojang.com/v1/packages/'
                '1757c8b1fbfc6b638504e1f6cceb05893f7389d5/1.21.1.json',
                reuse=reuse_lang)
        if zh_path is None:
            cand = os.path.join(LANG_DIR, 'zh_cn-1.21.1.json')
            if os.path.isfile(cand):
                zh_path = cand
        en_block, zh_block = load_lang(src, zh_path)
    # 只保留真正存在的方块 key
    en_out = collections.OrderedDict()
    zh_out = collections.OrderedDict()
    for name in sorted(out_blocks):
        path = name.split(':')[1]
        key = 'block.minecraft.' + path
        short = 'block.' + path
        ev = en_block.get(key)
        zv = zh_block.get(key)
        if ev is None:
            ev = path.replace('_', ' ')
        en_out[key] = ev
        en_out[short] = ev
        if zv is not None:
            zh_out[key] = zv
            zh_out[short] = zv
    # 补上 jar 里其余 block.minecraft.*（可能对应无 blockstate 的方块）
    for k, v in en_block.items():
        if k in en_out:
            continue
        en_out[k] = v
        short = 'block.' + k[len('block.minecraft.'):]
        en_out[short] = v
        if k in zh_block:
            zh_out[k] = zh_block[k]
            zh_out[short] = zh_block[k]
    lang_obj = collections.OrderedDict((('zh_cn', zh_out), ('en_us', en_out)))

    # ---- 7. 输出 ----
    os.makedirs(out, exist_ok=True)
    atlas.save(os.path.join(out, 'atlas.png'))

    # 图集同时出一份无损 WebP：像素艺术无损压缩通常比 PNG 小一半左右，
    # 前端优先用它（失败自动退回 atlas.png）。写不出来不影响交付。
    atlas_webp = False
    try:
        atlas.save(os.path.join(out, 'atlas.webp'), format='WEBP', lossless=True, quality=100, method=6)
        atlas_webp = True
    except Exception as exc:
        print('  [warn] atlas.webp 生成失败（继续用 png）:', exc)

    # QA 辅助产物（可删）：图集布局索引，供 verify.py / preview.py 校验与绘制
    if write_atlas_index:
        try:
            work = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_work')
            os.makedirs(work, exist_ok=True)
            with open(os.path.join(work, 'atlas_index.json'), 'w', encoding='utf-8') as fh:
                json.dump({'size': atlas_size, 'padding': 2,
                           'index': dict((k, list(v)) for k, v in place.items())},
                          fh, ensure_ascii=False, separators=(',', ':'))
        except Exception as exc:      # 纯辅助产物，失败不影响交付
            print('  [warn] atlas_index 写入失败:', exc)

    atlas_meta = collections.OrderedDict([
        ('file', 'atlas.png'), ('size', atlas_size), ('padding', 2)])
    if atlas_webp:
        atlas_meta['webp'] = 'atlas.webp'
    manifest = collections.OrderedDict([
        ('format', 1),
        ('mcVersions', ['1.21.1', '26.3']),
        ('dataVersion', 3955),
        ('atlas', atlas_meta),
        ('textureScale', 16),
        ('files', collections.OrderedDict([
            ('blocks', 'blocks.json'), ('models', 'models.json'),
            ('lang', 'lang.json'), ('meta', 'meta.json')])),
    ])

    quad_count = sum(len(m['quads']) for m in models.values())
    models_sorted = collections.OrderedDict((k, models[k]) for k in sorted(models))
    sizes = {}
    write_json(os.path.join(out, 'blocks.json'), {'blocks': out_blocks})
    write_json(os.path.join(out, 'models.json'), {'models': models_sorted})

    # ---- 7b. 按模型拆分成小文件（运行时只下载该投影用到的方块模型） ----
    # 契约：assets/models/<编码后的模型 id>.json，内容是 quad 数组。
    # 编码必须与前端 src/render/db.js 的 encodeModelId 完全一致：
    #   '/' → '$'   '#' → '@'   ',' → '!'（这三个字符在文件名里跨平台不安全）
    models_dir = os.path.join(out, 'models')
    if os.path.isdir(models_dir):
        shutil.rmtree(models_dir)
    os.makedirs(models_dir, exist_ok=True)
    written_names = {}
    for mid, model in models_sorted.items():
        fname = model_file_name(mid)
        prev = written_names.get(fname)
        if prev is not None and prev != mid:
            raise RuntimeError('模型文件名冲突：%s 与 %s 都编码为 %s' % (prev, mid, fname))
        written_names[fname] = mid
        write_json(os.path.join(models_dir, fname + '.json'), model.get('quads') or [])
    manifest['modelsMode'] = 'files'
    manifest['modelsDir'] = 'models'
    manifest['modelsCount'] = len(written_names)
    print('  模型拆分：%d 个文件 -> %s' % (len(written_names), models_dir))

    write_json(os.path.join(out, 'lang.json'), lang_obj)
    write_json(os.path.join(out, 'manifest.json'), manifest)

    import gzip
    for fn in ('blocks.json', 'models.json', 'lang.json', 'atlas.png'):
        p = os.path.join(out, fn)
        raw = os.path.getsize(p)
        if fn.endswith('.json'):
            with open(p, 'rb') as f:
                gz = len(gzip.compress(f.read(), 6))
        else:
            gz = raw
        sizes[fn] = {'bytes': raw, 'gzipBytes': gz}

    # ---- 8. meta ----
    notes = []
    notes.append('坐标为 0..16 模型空间、Y 向上、右手系；quad 顶点逆时针（从外侧看）。')
    notes.append('uv 为图集绝对像素坐标、左上原点、v 向下；渲染器做 v/atlasSize 后翻转。')
    notes.append('blockstate 的 x/y 旋转与 uvlock 已在烘焙期应用并生成独立 model id'
                 '（形如 block/oak_stairs#90,0u），运行时无需再旋转。')
    notes.append('x 旋转按原版 BlockModelRotation 语义（x=90 顶面朝北），组合顺序 R=Ry(-y)*Rx(-x)。')
    notes.append('multipart 的 when 数组(OR) 已展开为多个 part 条目；值中的 a|b 已展开。')
    notes.append('weighted 随机的 apply 数组全部保留，渲染器取第 0 个。')
    notes.append('faces.rotation 在烘焙期作用于 uv 角；元素 rotation(22.5/45 度等) 只作用于顶点，'
                 'uv 不随之变化（原版如此）。')
    notes.append('quad 的 tint 输出原始 tintindex；未在 tintColors 中列出的方块/索引按契约渲染为白色。')
    notes.append('动画纹理只取首帧（高度>宽度，帧高=宽度，取最上一帧）。')
    notes.append('缺失纹理用洋红/黑棋盘格占位。')
    if baker.res.cycles:
        notes.append('模型 parent 链存在 %d 处环，已截断。' % baker.res.cycles)
    if baker.res.missing:
        notes.append('引用了不存在的模型文件：%s' % ', '.join(
            sorted(baker.res.missing)[:40]))
    if texinfo.animated:
        notes.append('动画纹理 %d 张（取首帧）：%s' % (
            len(texinfo.animated), ', '.join(sorted(texinfo.animated)[:12])))
    fb = sorted(set(fallback_models))
    if fb:
        notes.append('%d 个模型无几何元素（block entity / 流体等），已用 particle 纹理生成整方块'
                     '占位，清单见 meta.fallbackModels。' % len(fb))
        notes.append('流体（water/water_cavern 等）占位为整方块，不体现 level 的水面高度；'
                     '占位方块沿用方块 tintColors 的 0 号颜色（水=蓝）。')
    notes.append('render 层级由硬编码原版材质名单 + 纹理 alpha 统计推断；'
                 '1.21.1 与 26.3 的材质映射若不同可能有个别偏差。')

    meta = collections.OrderedDict([
        ('generated', time.strftime('%Y-%m-%dT%H:%M:%S+08:00')),
        ('blockCount', len(out_blocks)),
        ('modelCount', len(models)),
        ('quadCount', quad_count),
        ('textureCount', len(entries) - 1),
        ('atlasUsage', round(usage, 4)),
        ('missingBlocks', missing_blocks),
        ('missingTextures', sorted(missing_tex)),
        ('tintsApplied', sorted(tint_names)),
        ('fallbackModels', fb),
        ('notes', notes),
        ('atlas', collections.OrderedDict([
            ('size', atlas_size), ('padding', 2),
            ('usedPixels', int(round(usage * atlas_size * atlas_size)))])),
        ('sizes', sizes),
        ('stats', collections.OrderedDict([
            ('blockstates', len(order)),
            ('blockstatesParseFail', parse_fail),
            ('blockstatesNoGeometry', parse_empty),
            ('blocksWithTint', tint_blocks),
            ('renderCounts', collections.OrderedDict(sorted(render_count.items()))),
            ('texturesAnimated', len(texinfo.animated)),
            ('modelsNoGeometry', sorted(fb)[:50]),
            ('unresolvedTextureRefs', sorted(baker.missing_textures)[:60]),
            ('jars', [os.path.basename(j) for j in jarpaths]),
        ])),
    ])
    write_json(os.path.join(out, 'meta.json'), meta)
    src.close()

    if verbose:
        print('blocks=%d models=%d quads=%d textures=%d atlas=%d usage=%.1f%%'
              % (len(out_blocks), len(models), quad_count, len(entries) - 1,
                 atlas_size, usage * 100.0))
        for fn, s in sizes.items():
            print('  %-12s %9d B  (gzip %9d B)' % (fn, s['bytes'], s['gzipBytes']))
        print('耗时 %.1fs -> %s' % (time.time() - t0, os.path.abspath(out)))
    return {'blocks': out_blocks, 'models': models, 'meta': meta,
            'atlas': {'size': atlas_size, 'padding': 2,
                      'place': dict(place), 'usage': usage}}


def fallback_cube(baker, base, place):
    """无几何的模型（block entity）用 particle 纹理生成一个整方块占位。"""
    if base in NO_FALLBACK_BASES:
        return []
    res = baker.res.resolve(base)
    tex = baker.res.resolve_texture('#particle', res['textures'])
    if tex is None:
        tex = baker.res.resolve_texture('block/oak_planks', res['textures'])
    if tex is None:
        return []
    p = place.get(tex)
    if p is None:
        p = place.get(MISSING_TEX)
        tex = MISSING_TEX
    px, py, pw, ph = p
    u0, v0 = num(px), num(py)
    u1, v1 = num(px + pw), num(py + ph)
    # 占位方块也吃 tint（水/水柱等流体模型本来没有 elements，也就没有 tintindex）
    tkeys = TINT_TABLE.get(base.split('/')[-1])
    tint = sorted(tkeys)[0] if tkeys else -1
    quads = []
    for fi, fname in enumerate(FACE_NAMES):
        plane = FACE_PLANE_AXIS[fname]
        nrm = FACE_NORMALS[fi]
        pval = 16.0 if nrm[plane] > 0 else 0.0
        oth = [i for i in range(3) if i != plane]
        corners = []
        for i1 in (0, 1):
            for i2 in (0, 1):
                q = [0.0, 0.0, 0.0]
                q[plane] = pval
                q[oth[0]] = 16.0 if i1 else 0.0
                q[oth[1]] = 16.0 if i2 else 0.0
                corners.append(tuple(q))
        us = [face_u(fname, q) for q in corners]
        vs = [face_v(fname, q) for q in corners]
        by = {}
        for i in range(4):
            by[(us[i] <= 8.0, vs[i] <= 8.0)] = i
        pos = []
        for key in ((True, True), (True, False), (False, False), (False, True)):
            pos.append(corners[by[key]])
        pf = []
        for q in pos:
            pf.extend((num(q[0]), num(q[1]), num(q[2])))
        quads.append({'p': pf, 'uv': [u0, v0, u0, v1, u1, v1, u1, v0],
                      'n': fi, 'tint': tint, 'tex': tex})
    return quads


def main(argv=None):
    ap = argparse.ArgumentParser(description='mcviewer 资产烘焙')
    ap.add_argument('--jars',
                    default='_dl/client-1.21.1.jar,_dl/client-26.3.jar')
    ap.add_argument('--out', default='assets')
    ap.add_argument('--atlas', type=int, default=1024)
    ap.add_argument('--reuse-lang', action='store_true', default=True)
    ap.add_argument('--no-fetch-lang', action='store_true')
    ap.add_argument('--lang-file', default=None)
    ap.add_argument('--fixtures', default=None)
    args = ap.parse_args(argv)
    jars = [x for x in args.jars.split(',') if x.strip()]
    out = args.out if os.path.isabs(args.out) else os.path.join(ROOT, args.out)
    build(jars, out, atlas_min=args.atlas, reuse_lang=args.reuse_lang,
          lang_file=args.lang_file, fetch_lang=not args.no_fetch_lang,
          fixtures_dir=args.fixtures)


if __name__ == '__main__':
    main()
