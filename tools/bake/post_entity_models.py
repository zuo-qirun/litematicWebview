#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""mcviewer 资产后处理：把三个箱子换成真正的实体模型（ChestModel）几何。

问题：vanilla 的 block/chest、block/trapped_chest 是 `builtin/entity`（没有 elements），
bake.py 只能用 particle 纹理平铺出一个 1x1x1 占位方块 —— 于是投影里所有箱子都变成
一块橡木木板 / 一块黑曜石。block/trapped_chest 甚至连模型都没有（指向 block/chest）。

本脚本（独立、自包含、幂等，不修改 bake.py）：
  1. 用原版 ChestModel 的三个 part（bottom / lid / lock）生成真正的 18 个 quad；
  2. 把 textures/entity/chest/{normal,trapped,ender}.png（64x64）的 56x43 有效区
     贴进 atlas 的空闲区（带 1px 边缘复制，避免采样串色）；
  3. 重写 models.json 里这 3 个方块的模型（含 facing 旋转变体 #0,90 / #0,180 / #0,270）、
     blocks.json 的 variants、meta.json 的计数/notes/fallbackModels；
  4. 自检：几何法线与 n 一致、坐标/uv 越界检查、图集像素与源纹理逐像素比对。

跑法（必须在 bake.py 之后；重复执行结果一致）：
    python tools/bake/bake.py --jars _dl/client-1.21.1.jar,_dl/client-26.3.jar --out assets
    python tools/bake/post_entity_models.py
    node tools/audit_assets.mjs && node tools/audit_geometry.mjs

几何来源（原版 ChestModel，1.21.1，模型空间单位 1/16 方块）：
    bottom : addBox(1, 0, 1, 14, 10, 14).texOffs(0, 19)
    lid    : addBox(1, 0, 0, 14,  5, 14).texOffs(0, 0).offset(0, 9, 1)
    lock   : addBox(7, -1, 15, 2, 4, 1).texOffs(0, 0).offset(0, 8, 0)
  → 世界坐标（0..16）：bottom x1..15 y0..10 z1..15；lid x1..15 y9..14 z1..15；
    lock x7..9 y7..11 z15..16（正面朝 +Z，与 vanilla 一致）。
"""
import argparse
import json
import os
import sys
import zipfile

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))

# ---------------------------------------------------------------------------
# 面的约定（与 tools/audit_geometry.mjs / bake.py 一致）
#   n: 0=-Y 1=+Y 2=-Z 3=+Z 4=-X 5=+X
#   quad.p 顶点顺序恒为 [TL, BL, BR, TR]（从面外侧看、屏幕上=+Y），
#   quad.uv 与之一一对应：(umin,vmin),(umin,vmax),(umax,vmax),(umax,vmin)（图集绝对像素，v 向下）
# ---------------------------------------------------------------------------
FACE_NAMES = ('down', 'up', 'north', 'south', 'west', 'east')
FACE_AXIS = ((0, -1, 0), (0, 1, 0), (0, 0, -1), (0, 0, 1), (-1, 0, 0), (1, 0, 0))

# 盒的 8 个角（0/1 表示 x 取 x0/x1 …）
CORNERS = ((0, 0, 0), (1, 0, 0), (0, 1, 0), (1, 1, 0),
           (0, 0, 1), (1, 0, 1), (0, 1, 1), (1, 1, 1))
# 每个面 TL/BL/BR/TR 对应的盒角（已用 assets/models.json 里既有整方块 quad 反查确认）
FACE_CORNERS = {
    0: (4, 0, 1, 5),   # down : TL(x0,y0,z1) BL(x0,y0,z0) BR(x1,y0,z0) TR(x1,y0,z1)
    1: (2, 6, 7, 3),   # up   : TL(x0,y1,z0) BL(x0,y1,z1) BR(x1,y1,z1) TR(x1,y1,z0)
    2: (3, 1, 0, 2),   # north: TL(x1,y1,z0) BL(x1,y0,z0) BR(x0,y0,z0) TR(x0,y1,z0)
    3: (6, 4, 5, 7),   # south: TL(x0,y1,z1) BL(x0,y0,z1) BR(x1,y0,z1) TR(x1,y1,z1)
    4: (2, 0, 4, 6),   # west : TL(x0,y1,z0) BL(x0,y0,z0) BR(x0,y0,z1) TR(x0,y1,z1)
    5: (7, 5, 1, 3),   # east : TL(x1,y1,z1) BL(x1,y0,z1) BR(x1,y0,z0) TR(x1,y1,z0)
}

# ---------------------------------------------------------------------------
# ModelPart.Cube 的 box-UV 展开（纹理像素 1:1）
#   盒 (w,h,d) 占 texOffs (u0,v0) 起的 (2w+2d) x (d+h) 区域
#   顶条带（高 d）：[ down | up ]      各 w 宽，起点 u0+d
#   侧条带（高 h）：[ west(d) | north(w) | east(d) | south(w) ]，起点 v0+d
#   注：down/up 的先后顺序已用原版截图对照确认（顶面是浅木板带深边框、body 顶面是全黑内腔）
# ---------------------------------------------------------------------------
def tex_layout(u0, v0, w, h, d):
    return {
        0: (u0 + d, v0, u0 + d + w, v0 + d),                          # down
        1: (u0 + d + w, v0, u0 + d + 2 * w, v0 + d),                  # up
        4: (u0, v0 + d, u0 + d, v0 + d + h),                          # west
        2: (u0 + d, v0 + d, u0 + d + w, v0 + d + h),                  # north
        5: (u0 + d + w, v0 + d, u0 + 2 * d + w, v0 + d + h),          # east
        3: (u0 + 2 * d + w, v0 + d, u0 + 2 * d + 2 * w, v0 + d + h),  # south
    }


# 原版 ChestModel 的三个 part：(名字, (x0,y0,z0,x1,y1,z1), texOffs, (w,h,d))
# 这些是「原版坐标系」：锁扣朝 +Z，最后统一用 BASE_STATE_Y 转到朝北。
PARTS = (
    ('bottom', (1, 0, 1, 15, 10, 15), (0, 19), (14, 10, 14)),
    ('lid', (1, 9, 1, 15, 14, 15), (0, 0), (14, 5, 14)),
    ('lock', (7, 7, 15, 9, 11, 16), (0, 0), (2, 4, 1)),
)

# 双箱的两个半块（实测自 2246 个真实半箱：facing=north 时 type=left 在**西侧**块、
# type=right 在东侧块；其余朝向按 y 旋转同理）：
#   最终朝北时，大箱子横跨 x 1..31，西侧块（type=left）占本方块 x 1..16、东侧块
#   （type=right）占 x 0..15，两块在方块边界处严丝合缝。这里给的是**原版坐标系**
#   （锁扣朝 +Z），所以还要过一遍 BASE_STATE_Y=180 的预旋转（x → 16-x）：
#     西侧块 x 1..16  ← 预旋转前 x 0..15
#     东侧块 x 0..15  ← 预旋转前 x 1..16
#   180° 旋转会把东西面互换（uv 仍跟着原来的面走），因此：
#     西侧块（type=left）的接缝面最终朝东 → 用 normal_left 纹理（它把 west 面涂透明）
#     东侧块（type=right）的接缝面最终朝西 → 用 normal_right 纹理（它把 east 面涂透明）
#   锁扣只让西侧块画在接缝上（原版两半各画一半，视觉等价且避免重复几何）。
PARTS_WEST = (                                    # 最终占 x 1..16，接缝在东侧 → type=left
    ('bottom', (0, 0, 1, 15, 10, 15), (0, 19), (15, 10, 14)),
    ('lid', (0, 9, 1, 15, 14, 15), (0, 0), (15, 5, 14)),
    ('lock', (-1, 7, 15, 1, 11, 16), (0, 0), (2, 4, 1)),
)
PARTS_EAST = (                                    # 最终占 x 0..15，接缝在西侧 → type=right
    ('bottom', (1, 0, 1, 16, 10, 15), (0, 19), (15, 10, 14)),
    ('lid', (1, 9, 1, 16, 14, 15), (0, 0), (15, 5, 14)),
)
PARTS_BY_TYPE = {None: PARTS, 'left': PARTS_WEST, 'right': PARTS_EAST}

# 我方复刻的方块（顺序即 blocks.json 变体生成顺序）
BLOCKS = (
    ('minecraft:chest', 'entity/chest/normal', 'textures/entity/chest/normal.png', 'block/chest'),
    ('minecraft:trapped_chest', 'entity/chest/trapped', 'textures/entity/chest/trapped.png',
     'block/trapped_chest'),
    ('minecraft:ender_chest', 'entity/chest/ender', 'textures/entity/chest/ender.png',
     'block/ender_chest'),
)

# 渲染规格：每个「纹理 + 模型基名」一条——
#   (所属方块 id, 纹理 id, jar 内路径, 模型 id 基名, type 属性值 or None)
#
# 双箱（type=left/right）：原版 ChestBlockEntityRenderer 对左/右块用的是**同一套单箱几何**，
# 只是把朝向缝隙那一面在纹理里涂成透明（normal_left 把 west 面涂透明、normal_right 把 east
# 面涂透明），因此几何不用重新设计，只需各自的半块几何 + 对应纹理即可拼成 30px 宽的双箱。
# 实测（2246 个真实半箱，见 tools/lead_qa/probe_chest_pairs.py）：facing=north 时
#   type=left 块在西侧、type=right 块在东侧；其余朝向按 y 旋转同步。
# 结合 BASE_STATE_Y=180 预旋转后的透明面朝向：
#   西侧块（type=left，接缝朝东）→ normal_left
#   东侧块（type=right，接缝朝西）→ normal_right
# 末影箱没有 double 形态，只有单箱。
MODELS = (
    ('minecraft:chest', 'entity/chest/normal', 'textures/entity/chest/normal.png',
     'block/chest', None),
    ('minecraft:chest', 'entity/chest/normal_left', 'textures/entity/chest/normal_left.png',
     'block/chest_west', 'left'),
    ('minecraft:chest', 'entity/chest/normal_right', 'textures/entity/chest/normal_right.png',
     'block/chest_east', 'right'),
    ('minecraft:trapped_chest', 'entity/chest/trapped', 'textures/entity/chest/trapped.png',
     'block/trapped_chest', None),
    ('minecraft:trapped_chest', 'entity/chest/trapped_left',
     'textures/entity/chest/trapped_left.png', 'block/trapped_chest_west', 'left'),
    ('minecraft:trapped_chest', 'entity/chest/trapped_right',
     'textures/entity/chest/trapped_right.png', 'block/trapped_chest_east', 'right'),
    ('minecraft:ender_chest', 'entity/chest/ender', 'textures/entity/chest/ender.png',
     'block/ender_chest', None),
)

SOURCE_BOX = (0, 0, 58, 43)   # 64x64 纹理里真正被用到的区域：58 = 双箱（w=15）的 2w+2d，
                              # 43 = lid 顶带(d)+lid 侧带(h) + body 顶带(d) + body 侧带(h)
BORDER = 1                    # 边缘复制像素
TILE_W = SOURCE_BOX[2] + 2 * BORDER
TILE_H = SOURCE_BOX[3] + 2 * BORDER
HALO = 1                      # 与既有图集内容保持的净空

# 正面（锁扣）朝向：vanilla ChestModel 锁扣在 +Z。方块本体做成朝北（1.21.1 ChestBlock 默认 facing=north）
BASE_STATE_Y = 180
FACINGS = (('north', 0), ('east', 90), ('south', 180), ('west', 270))
MARKER_KEY = 'entityModels'


# ---------------------------------------------------------------------------
# 几何
# ---------------------------------------------------------------------------
def _box_quads(box, tex_off, dims, tex, uv_off):
    x0, y0, z0, x1, y1, z1 = box
    u0, v0 = tex_off
    w, h, d = dims
    reg = tex_layout(u0, v0, w, h, d)
    ox, oy = uv_off
    quads = []
    for n in range(6):
        umin, vmin, umax, vmax = reg[n]
        umin += ox
        umax += ox
        vmin += oy
        vmax += oy
        p = []
        for ci in FACE_CORNERS[n]:
            cx, cy, cz = CORNERS[ci]
            p.extend([x1 if cx else x0, y1 if cy else y0, z1 if cz else z0])
        quads.append({
            'p': p,
            'uv': [umin, vmin, umin, vmax, umax, vmax, umax, vmin],
            'n': n,
            'tint': -1,
            'tex': tex,
        })
    return quads


def chest_quads(tex, uv_off, parts=PARTS):
    """原版 ChestModel 的 quad（锁扣朝 +Z / 南）。单箱 18 个；双箱半块 12 / 6 个。"""
    out = []
    for _name, box, tex_off, dims in parts:
        out += _box_quads(box, tex_off, dims, tex, uv_off)
    return out


def _rotmat_y(deg):
    """与 bake.py 完全一致：_rotmat_y(90): (x,y,z) -> (z, y, -x)。"""
    d = deg % 360
    if d == 0:
        return ((1, 0, 0), (0, 1, 0), (0, 0, 1))
    if d == 90:
        return ((0, 0, 1), (0, 1, 0), (-1, 0, 0))
    if d == 180:
        return ((-1, 0, 0), (0, 1, 0), (0, 0, -1))
    if d == 270:
        return ((0, 0, -1), (0, 1, 0), (1, 0, 0))
    raise ValueError('bad deg %r' % (deg,))


def _mat_vec(m, v):
    return (m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
            m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
            m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2])


def rotate_quads(quads, state_y, center=8.0):
    """按原版 blockstate apply 的 y 旋转模型（R = Ry(-y)，与 bake.py state_rotmat(x=0,y) 一致）。

    绕方块中心旋转：刚体变换不改顶点绕向，uv 跟着顶点走（锁扣贴图随之转向）。
    """
    m = _rotmat_y(-state_y)
    out = []
    for q in quads:
        p = q['p']
        np_ = []
        for i in range(4):
            v = (p[3 * i] - center, p[3 * i + 1] - center, p[3 * i + 2] - center)
            r = _mat_vec(m, v)
            np_.extend([r[0] + center, r[1] + center, r[2] + center])
        axis = _mat_vec(m, FACE_AXIS[q['n']])
        try:
            n2 = FACE_AXIS.index(axis)
        except ValueError:
            raise SystemExit('旋转后法线不是轴对齐：%r -> %r' % (FACE_AXIS[q['n']], axis))
        out.append({'p': np_, 'uv': list(q['uv']), 'n': n2, 'tint': q['tint'], 'tex': q['tex']})
    return out


def _snap(quads):
    """旋转/平移后的浮点误差收干净（1/16 格是整数，容差内的都吸附）。"""
    for q in quads:
        q['p'] = [int(round(v)) if abs(v - round(v)) < 1e-6 else round(v, 6) for v in q['p']]
        q['uv'] = [int(round(v)) if abs(v - round(v)) < 1e-6 else round(v, 6) for v in q['uv']]
    return quads


# ---------------------------------------------------------------------------
# 自检（复用 assets/models.json 里已有的整方块 quad 反查 FACE_CORNERS 是否与工程约定一致）
# ---------------------------------------------------------------------------
def self_test(models):
    ref = models.get('block/oak_planks') or models.get('block/stone')
    if not ref or len(ref['quads']) != 6:
        print('  ! 自检跳过：找不到整方块参照模型')
        return
    mine = _box_quads((0, 0, 0, 16, 16, 16), (0, 0), (16, 16, 16), 'x', (0, 0))
    refq = {q['n']: q for q in ref['quads']}
    for q in mine:
        r = refq.get(q['n'])
        if r is None:
            raise SystemExit('自检失败：参照模型的 n 集合不含 %d' % q['n'])
        if [float(v) for v in r['p']] != [float(v) for v in q['p']]:
            raise SystemExit('自检失败：n=%d 顶点顺序与工程约定不一致\n  期望 %r\n  实际 %r'
                             % (q['n'], r['p'], q['p']))
    print('  自检 OK：18/6 面顶点顺序与 assets/models.json 既有整方块一致')


def check_quads(quads, atlas_size, where='', pad=0):
    """pad: 允许顶点超出 0..16 的幅度（双箱的锁扣会跨过方块边界 1px）。"""
    for i, q in enumerate(quads):
        p = q['p']
        if len(p) != 12:
            raise SystemExit('%s quad#%d p 长度 %d' % (where, i, len(p)))
        for v in p:
            if not (-pad <= float(v) <= 16 + pad):
                raise SystemExit('%s quad#%d 坐标越界：%r' % (where, i, p))
        for v in q['uv']:
            if not (0 <= float(v) <= atlas_size):
                raise SystemExit('%s quad#%d uv 越界：%r' % (where, i, q['uv']))
        e1 = [p[3] - p[0], p[4] - p[1], p[5] - p[2]]
        e3 = [p[9] - p[0], p[10] - p[1], p[11] - p[2]]
        nx = e1[1] * e3[2] - e1[2] * e3[1]
        ny = e1[2] * e3[0] - e1[0] * e3[2]
        nz = e1[0] * e3[1] - e1[1] * e3[0]
        ln = (nx * nx + ny * ny + nz * nz) ** 0.5
        if ln < 1e-9:
            raise SystemExit('%s quad#%d 退化（面积为 0）' % (where, i))
        ax = FACE_AXIS[q['n']]
        dot = (nx * ax[0] + ny * ax[1] + nz * ax[2]) / ln
        if dot < 0.999:
            raise SystemExit('%s quad#%d 法线与 n=%d 不一致（dot=%.4f）' % (where, i, q['n'], dot))


# ---------------------------------------------------------------------------
# 图集
# ---------------------------------------------------------------------------
def quad_rects(models, skip_ids):
    for mid, m in models.items():
        if mid in skip_ids:
            continue
        for q in m.get('quads') or ():
            uv = q['uv']
            yield (min(uv[0], uv[4]), min(uv[1], uv[5]), max(uv[2], uv[6]), max(uv[3], uv[7]))


def occupancy(models, skip_ids, size, dilate=1):
    occ = np.zeros((size, size), dtype=bool)
    for u0, v0, u1, v1 in quad_rects(models, skip_ids):
        x0 = max(0, int(np.floor(u0)))
        y0 = max(0, int(np.floor(v0)))
        x1 = min(size, int(np.ceil(u1)))
        y1 = min(size, int(np.ceil(v1)))
        if x1 > x0 and y1 > y0:
            occ[y0:y1, x0:x1] = True
    if dilate:
        for _ in range(dilate):
            o = occ.copy()
            o[1:, :] |= occ[:-1, :]
            o[:-1, :] |= occ[1:, :]
            o[:, 1:] |= occ[:, :-1]
            o[:, :-1] |= occ[:, 1:]
            occ = o
    return occ


def find_free(occ, w, h):
    """自上而下、自左而右找第一块 w x h 全空窗口。"""
    H, W = occ.shape
    if w > W or h > H:
        raise SystemExit('图集太小：需要 %dx%d' % (w, h))
    ii = np.zeros((H + 1, W + 1), dtype=np.int32)
    ii[1:, 1:] = np.cumsum(np.cumsum(occ.astype(np.int32), axis=0), axis=1)
    s = ii[h:, w:] - ii[:-h, w:] - ii[h:, :-w] + ii[:-h, :-w]
    ys, xs = np.nonzero(s == 0)
    if not len(ys):
        raise SystemExit('图集里没有 %dx%d 的空闲区' % (w, h))
    return int(xs[0]), int(ys[0])


def tile_from_texture(img):
    """取 (0,0)-(56,43) 有效区并复制 1px 边缘。"""
    x0, y0, x1, y1 = SOURCE_BOX
    crop = img.convert('RGBA').crop((x0, y0, x1, y1))
    arr = np.asarray(crop, dtype=np.uint8)
    return np.pad(arr, ((BORDER, BORDER), (BORDER, BORDER), (0, 0)), mode='edge')


# ---------------------------------------------------------------------------
# 纹理来源
# ---------------------------------------------------------------------------
def load_textures(jars, tex_dir):
    """优先从 client jar 读（权威），退回本地缓存目录。"""
    out = {}
    zips = []
    for j in jars:
        if os.path.exists(j):
            zips.append((os.path.basename(j), zipfile.ZipFile(j)))
    for _block, _tex, jpath, kind_model, _ty in MODELS:
        name = 'assets/minecraft/' + jpath
        img = None
        src = None
        for base, z in zips:
            try:
                with z.open(name) as fh:
                    img = Image.open(fh)
                    img.load()
                src = '%s:%s' % (base, name)
                break
            except KeyError:
                continue
        if img is None and tex_dir:
            p = os.path.join(tex_dir, os.path.basename(jpath))
            if os.path.exists(p):
                img = Image.open(p)
                src = p
        if img is None:
            raise SystemExit('找不到箱子纹理 %s（jar 与 --tex-dir 都没有）' % jpath)
        if img.size != (64, 64):
            raise SystemExit('纹理 %s 尺寸 %r，期望 64x64' % (src, img.size))
        out[kind_model] = (img, src)
    for _b, z in zips:
        z.close()
    return out


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------
def load_json(p):
    with open(p, 'r', encoding='utf-8') as f:
        return json.load(f)


def write_json(p, obj):
    data = json.dumps(obj, ensure_ascii=False, separators=(',', ':'), sort_keys=False)
    with open(p, 'w', encoding='utf-8', newline='\n') as f:
        f.write(data)
    return len(data.encode('utf-8'))


def model_file_name(model_id):
    """与 bake.py / 前端 encodeModelId 一致：/ → $， # → @， , → !"""
    return model_id.replace('/', '$').replace('#', '@').replace(',', '!')


def model_ids():
    """(base, state_y) -> 模型 id。本体模型正面向北（facing=north 用无后缀本体）。"""
    ids = {}
    for _b, _t, _p, base, _ty in MODELS:
        for _fac, y in FACINGS:
            ids[(base, y)] = base if y == 0 else '%s#0,%d' % (base, y)
    return ids


def build_models(uv_off, tex_by_model):
    """生成每个「纹理 × 朝向」的模型（7 个基名 × 4 朝向 = 28 个）。"""
    out = {}
    for _block, tex, _p, base, ty in MODELS:
        parts = PARTS_BY_TYPE[ty]
        quads_base = rotate_quads(chest_quads(tex, uv_off[base], parts), BASE_STATE_Y)
        for _fac, y in FACINGS:
            q = rotate_quads(quads_base, y) if y else [dict(x) for x in quads_base]
            for item in q:
                item['p'] = list(item['p'])
                item['uv'] = list(item['uv'])
            out['%s|%d' % (base, y)] = _snap(q)
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description='mcviewer 箱子实体模型后处理')
    ap.add_argument('--jars', default='_dl/client-1.21.1.jar,_dl/client-26.3.jar')
    ap.add_argument('--out', default='assets')
    ap.add_argument('--tex-dir', default='_dl/chesttex', help='jar 不可用时的本地纹理目录')
    ap.add_argument('--verbose', action='store_true')
    args = ap.parse_args(argv)

    out_dir = args.out if os.path.isabs(args.out) else os.path.join(ROOT, args.out)
    jarpaths = [j if os.path.isabs(j) else os.path.join(ROOT, j)
                for j in args.jars.split(',') if j.strip()]
    tex_dir = args.tex_dir if os.path.isabs(args.tex_dir) else os.path.join(ROOT, args.tex_dir)

    paths = {k: os.path.join(out_dir, k + '.json')
             for k in ('manifest', 'blocks', 'models', 'meta')}
    atlas_path = os.path.join(out_dir, 'atlas.png')
    for p in list(paths.values()) + [atlas_path]:
        if not os.path.exists(p):
            raise SystemExit('缺少 %s，先跑 tools/bake/bake.py' % p)

    manifest = load_json(paths['manifest'])
    blocks = load_json(paths['blocks'])
    models_doc = load_json(paths['models'])
    meta = load_json(paths['meta'])
    models = models_doc['models']
    atlas_img = Image.open(atlas_path)
    atlas_size = atlas_img.size[0]
    if atlas_size != atlas_img.size[1]:
        raise SystemExit('atlas 不是正方形：%r' % (atlas_img.size,))
    if atlas_size != int(manifest['atlas']['size']):
        raise SystemExit('atlas 实际 %d != manifest.atlas.size %r'
                         % (atlas_size, manifest['atlas']['size']))

    print('箱子实体模型后处理 → %s' % out_dir)
    print('  图集 %dx%d，模型 %d 个，方块 %d 个'
          % (atlas_size, atlas_size, len(models), len(blocks.get('blocks', {}))))

    # 0. 自检（顶点顺序约定）
    self_test(models)

    # 1. 纹理
    tex_by_model = load_textures(jarpaths, tex_dir)
    for base, (img, src) in tex_by_model.items():
        print('  纹理 %-22s ← %s' % (base, src))

    # 2. 图集定位（幂等：优先复用 meta 里记录的矩形）
    ids = model_ids()
    my_ids = set(ids.values())
    prev = (meta.get(MARKER_KEY) or {}).get('rects') or {}
    occ = occupancy(models, my_ids, atlas_size, dilate=HALO)

    rects = {}
    reuse = True
    for _b, _t, _p, base, _ty in MODELS:
        r = prev.get(base)
        if not (isinstance(r, list) and len(r) == 2):
            reuse = False
            break
        x, y = int(r[0]), int(r[1])
        if x < 0 or y < 0 or x + TILE_W > atlas_size or y + TILE_H > atlas_size:
            reuse = False
            break
        if occ[y:y + TILE_H, x:x + TILE_W].any():
            reuse = False
            break
    if reuse:
        rects = {base: (int(prev[base][0]), int(prev[base][1]))
                 for _b, _t, _p, base, _ty in MODELS}
        print('  复用上次的图集位置')
    else:
        for _b, _t, _p, base, _ty in MODELS:
            # 留 1px 净空：在 (TILE+2HALO) 的空窗里放到 +HALO 处
            x, y = find_free(occ, TILE_W + 2 * HALO, TILE_H + 2 * HALO)
            x += HALO
            y += HALO
            rects[base] = (x, y)
            occ[max(0, y - HALO):y + TILE_H + HALO, max(0, x - HALO):x + TILE_W + HALO] = True

    for _b, _t, _p, base, _ty in MODELS:
        x, y = rects[base]
        print('  atlas 位置 %-22s (%d, %d)  %dx%d' % (base, x, y, TILE_W, TILE_H))

    # 3. 贴图集
    had_alpha = atlas_img.mode in ('RGBA', 'LA') or 'transparency' in atlas_img.info
    arr = np.asarray(atlas_img.convert('RGBA'), dtype=np.uint8).copy()
    tiles = {}
    for _b, _t, _p, base, _ty in MODELS:
        img, _src = tex_by_model[base]
        tile = tile_from_texture(img)
        tiles[base] = tile
        x, y = rects[base]
        arr[y:y + TILE_H, x:x + TILE_W, :] = tile
    out_img = Image.fromarray(arr, 'RGBA')
    if not had_alpha:
        out_img = out_img.convert('RGB')
    out_img.save(atlas_path)

    # 图集改了，同步刷新无损 WebP（与 bake.py 的策略保持一致：写不出就算了）
    webp_path = os.path.join(out_dir, 'atlas.webp')
    try:
        rgb = out_img if out_img.mode == 'RGBA' else out_img.convert('RGBA')
        if rgb.getchannel('A').getextrema()[0] == 255:
            rgb = rgb.convert('RGB')
        rgb.save(webp_path, format='WEBP', lossless=True, quality=100, method=6)
        print('  atlas.webp %d B' % os.path.getsize(webp_path))
    except Exception as exc:
        print('  [warn] atlas.webp 更新失败（前端会回退 atlas.png）:', exc)

    # 4. 模型（uv 偏移要含边缘复制的 1px）
    uv_off = {base: (rects[base][0] + BORDER, rects[base][1] + BORDER)
              for _b, _t, _p, base, _ty in MODELS}
    new_models = build_models(uv_off, tex_by_model)

    # 双箱半块的纹理里，「锁扣」那块是空的（原版双箱只有一个锁扣，画在接缝处）。
    # 直接沿用会把锁扣渲染成透明黑洞 → 用户看到的「中间一条黑色竖线」。
    # 修法：西半块的锁扣 UV 改到单箱纹理里对应的锁扣位置。
    lock_src = {'block/chest_west': 'block/chest',
                'block/trapped_chest_west': 'block/trapped_chest'}
    for half, full in lock_src.items():
        du = uv_off[full][0] - uv_off[half][0]
        dv = uv_off[full][1] - uv_off[half][1]
        for _fac, y in FACINGS:
            for item in new_models['%s|%d' % (half, y)][-6:]:
                uv = item['uv']
                for i in (0, 2, 4, 6):
                    uv[i] += du
                for i in (1, 3, 5, 7):
                    uv[i] += dv

    for key, quads in new_models.items():
        check_quads(quads, atlas_size, where='模型 %s' % key, pad=1)
    for (base, y), mid in ids.items():
        quads = new_models['%s|%d' % (base, y)]
        models[mid] = {'quads': quads}

    # 5. blocks.json
    # 变体顺序很关键：db.resolve 取第一个 when 命中的变体，而 propsMatch 只校验 when
    # 里出现的键，所以「带 type 的」必须排在「只有 facing 的」前面，否则双箱状态会被
    # 单箱变体先吃掉。
    blk = blocks['blocks']
    for block_id, _tex, _p, _base in BLOCKS:
        specs = [m for m in MODELS if m[0] == block_id]
        plain = [s for s in specs if s[4] is None]
        typed = [s for s in specs if s[4] is not None]
        # 实体纹理里六个面的取样区全部不透明，但图集 tile 内「没被任何面取样」的
        # 间隙像素 alpha=0；设成 cutout 就不会把它们当黑色画出来（opaque 会）。
        variants = []
        for fac, y in FACINGS:
            for s in typed:
                variants.append({'when': {'facing': fac, 'type': s[4]},
                                 'models': [ids[(s[3], y)]]})
        for fac, y in FACINGS:
            for s in plain:
                variants.append({'when': {'facing': fac}, 'models': [ids[(s[3], y)]]})
        for s in plain:
            variants.append({'models': [ids[(s[3], 0)]]})   # 兜底（无 when）
        blk[block_id] = {'kind': 'variants', 'variants': variants, 'render': 'cutout'}

    # 6. meta.json
    my_bases = set(m[3] for m in MODELS)
    fb = [m for m in (meta.get('fallbackModels') or []) if m.split('#')[0] not in my_bases]
    meta['fallbackModels'] = fb
    stats = meta.get('stats') or {}
    if 'modelsNoGeometry' in stats:
        stats['modelsNoGeometry'] = sorted(fb)[:50]
    quad_total = sum(len(m.get('quads') or ()) for m in models.values())
    meta['modelCount'] = len(models)
    meta['quadCount'] = quad_total
    prev_marker = meta.get(MARKER_KEY) or {}
    if not prev_marker:
        meta['textureCount'] = int(meta.get('textureCount') or 0) + len(MODELS)
        at = meta.get('atlas') or {}
        used = int(at.get('usedPixels') or 0) + TILE_W * TILE_H * len(MODELS)
        if at:
            at['usedPixels'] = used
        meta['atlasUsage'] = round(used / float(atlas_size * atlas_size), 4)
    # notes 每次都用最新文本重写（旧版本自己写的那条会被替换掉），这样可以改说明
    note = ('箱子（chest/trapped_chest/ender_chest）已用原版 ChestModel 实体几何替换'
            '（tools/bake/post_entity_models.py）：bottom/lid/lock 三个盒共 18 quad，'
            '纹理 textures/entity/chest/{normal,trapped,ender}(_left/_right).png 的 56x43 '
            '有效区已贴入 atlas；facing 用 #0,90/#0,180/#0,270 三个旋转模型覆盖；render=cutout'
            '（实体纹理的六个取样面全不透明，但 tile 内未被取样的间隙像素 alpha=0）。'
            '双箱（type=left/right）用原版的 _left/_right 纹理复刻：几何与单箱相同，'
            '只是朝向缝隙那一面在纹理里透明，两块并排即拼成 30px 宽的双箱。')
    notes = [x for x in (meta.get('notes') or []) if 'post_entity_models' not in str(x)]
    meta['notes'] = list(notes) + [note]
    meta[MARKER_KEY] = {
        'tool': 'tools/bake/post_entity_models.py',
        'blocks': [b for b, _t, _p, _m in BLOCKS],
        'rects': {base: [rects[base][0], rects[base][1]]
                  for _b, _t, _p, base, _ty in MODELS},
        'tile': [TILE_W, TILE_H],
        'quadPerModel': 6 * len(PARTS),
        'models': [ids[(base, y)] for _b, _t, _p, base, _ty in MODELS
                   for _f, y in FACINGS],
    }

    # 7. 落盘
    sizes = {}
    sizes['models.json'] = write_json(paths['models'], models_doc)
    sizes['blocks.json'] = write_json(paths['blocks'], blocks)
    sizes['meta.json'] = write_json(paths['meta'], meta)

    # 7b. 同步单文件模型（运行时只下载用到的方块模型，与 bake.py 的 models/ 目录一致）
    models_dir = os.path.join(out_dir, 'models')
    if os.path.isdir(models_dir):
        touched = 0
        for mid in sorted(set(ids.values())):
            write_json(os.path.join(models_dir, model_file_name(mid) + '.json'),
                       models[mid].get('quads') or [])
            touched += 1
        # manifest.modelsCount 也要跟着更新（新增的箱子变体模型）
        man = load_json(paths['manifest'])
        if man.get('modelsMode') == 'files':
            man['modelsCount'] = len(models_doc.get('models') or {})
            write_json(paths['manifest'], man)
        print('  模型单文件：更新 %d 个（%s，共 %d 个模型）'
              % (touched, models_dir, len(models_doc.get('models') or {})))

    # 8. 复读自检：图集像素与源纹理逐像素比对
    back = np.asarray(Image.open(atlas_path).convert('RGBA'))
    for _b, _t, _p, base, _ty in MODELS:
        x, y = rects[base]
        got = back[y:y + TILE_H, x:x + TILE_W, :4]
        if not np.array_equal(got, tiles[base]):
            raise SystemExit('自检失败：图集 %s 区域内容与源纹理不一致' % base)
    for block_id, _tex, _p, base in BLOCKS:
        d = blk[block_id]
        for v in d['variants']:
            for mid in v['models']:
                if mid not in models or not models[mid]['quads']:
                    raise SystemExit('自检失败：%s 引用了不存在的模型 %s' % (block_id, mid))
    print('  自检 OK：图集像素、blocks.json 引用')

    print('  写入：' + '，'.join('%s %d B' % kv for kv in sizes.items()) + '，atlas.png %d B'
          % os.path.getsize(atlas_path))
    print('  模型：%d 个（每个 18 quad）→ %s' % (
        len(ids), ', '.join(sorted(set(ids.values())))))
    if args.verbose:
        for _b, _t, _p, base, _ty in MODELS:
            print('    %-22s atlas=%r  tile u%d..%d v%d..%d'
                  % (base, rects[base], rects[base][0], rects[base][0] + TILE_W,
                     rects[base][1], rects[base][1] + TILE_H))
        for base in (m for _b, _t, _p, m, _ty in MODELS):
            for fac, y in FACINGS:
                mid = ids[(base, y)]
                qs = models[mid]['quads']
                print('    %-24s %-6s quads=%d' % (mid, fac, len(qs)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
