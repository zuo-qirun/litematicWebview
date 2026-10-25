# -*- coding: utf-8 -*-
"""箱子实体模型后处理的自检脚本（独立于 post_entity_models.py 的 verify 逻辑）。

    python tools/qa/check_entity_assets.py [--assets assets] [--jars _dl/client-1.21.1.jar]

检查：
 1. 12 个模型（3 方块 x 4 朝向）都存在、每个 18 quad、p 在 0..16、uv 落在该纹理的图集矩形内；
 2. 图集像素 == jar 里源纹理对应像素（逐像素，含偏移 BORDER 的换算）；
 3. 我的图集矩形不和任何其它模型的 uv 矩形重叠（不破坏既有资产）；
 4. blocks.json 的 facing 选型解析后，锁扣（最凸出的那个面）朝向正确；
 5. 其余模型的 uv 仍然在图集范围内。
"""
import argparse
import json
import os
import sys
import zipfile

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
FACE_AXIS = ((0, -1, 0), (0, 1, 0), (0, 0, -1), (0, 0, 1), (-1, 0, 0), (1, 0, 0))
FACE_NAME = ('down', 'up', 'north', 'south', 'west', 'east')
DIR_OF_FACING = {'north': (0, 0, -1), 'south': (0, 0, 1), 'east': (1, 0, 0), 'west': (-1, 0, 0)}

BLOCKS = (('minecraft:chest', 'block/chest', 'textures/entity/chest/normal.png'),
          ('minecraft:trapped_chest', 'block/trapped_chest', 'textures/entity/chest/trapped.png'),
          ('minecraft:ender_chest', 'block/ender_chest', 'textures/entity/chest/ender.png'))
BOXSIZE = 58, 45
BORDER = 1
SOURCE_BOX = (0, 0, 56, 43)

problems = []


def bad(msg):
    problems.append(msg)
    print('  \u2717 %s' % msg)


def ok(msg):
    print('  \u2713 %s' % msg)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--assets', default='assets')
    ap.add_argument('--jars', default='_dl/client-1.21.1.jar')
    args = ap.parse_args()
    assets = args.assets if os.path.isabs(args.assets) else os.path.join(ROOT, args.assets)
    models_doc = json.load(open(os.path.join(assets, 'models.json'), encoding='utf-8'))
    models = models_doc['models']
    blocks = json.load(open(os.path.join(assets, 'blocks.json'), encoding='utf-8'))['blocks']
    meta = json.load(open(os.path.join(assets, 'meta.json'), encoding='utf-8'))
    manifest = json.load(open(os.path.join(assets, 'manifest.json'), encoding='utf-8'))
    atlas = np.asarray(Image.open(os.path.join(assets, 'atlas.png')).convert('RGBA'))
    size = atlas.shape[0]
    print('assets: %s  atlas %dx%d  models %d' % (assets, size, atlas.shape[1], len(models)))

    marker = meta.get('entityModels') or {}
    rects = {k: (int(v[0]), int(v[1])) for k, v in (marker.get('rects') or {}).items()}
    if not rects:
        bad('meta.entityModels.rects 缺失（后处理没跑？）')
        return 1
    print('  meta.entityModels: %r' % (rects,))

    # --- 1. 模型存在性 / quad 结构 ---
    jar = {}
    has_jar = os.path.exists(args.jars if os.path.isabs(args.jars) else os.path.join(ROOT, args.jars))
    if has_jar:
        z = zipfile.ZipFile(args.jars if os.path.isabs(args.jars) else os.path.join(ROOT, args.jars))
    my_rect = {base: rects[base] for _b, base, _t in BLOCKS}
    for block_id, base, jpath in BLOCKS:
        y = 0
        ids = [base] + ['%s#0,%d' % (base, d) for d in (90, 180, 270)]
        for mid in ids:
            m = models.get(mid)
            if not m or not m.get('quads'):
                bad('%s 缺失或没有 quads' % mid)
                continue
            if len(m['quads']) != 18:
                bad('%s quad 数 %d != 18' % (mid, len(m['quads'])))
            x0, y0 = rects[base]
            for i, q in enumerate(m['quads']):
                p, uv = q['p'], q['uv']
                if len(p) != 12 or len(uv) != 8:
                    bad('%s quad%d 字段长度错' % (mid, i))
                    continue
                if any(not (0 <= v <= 16) for v in p):
                    bad('%s quad%d p 越界 %r' % (mid, i, p))
                if any(not (0 <= v <= size) for v in uv):
                    bad('%s quad%d uv 越界 %r' % (mid, i, uv))
                if not (x0 + BORDER <= min(uv[0::2]) and max(uv[0::2]) <= x0 + BORDER + 56
                        and y0 + BORDER <= min(uv[1::2]) and max(uv[1::2]) <= y0 + BORDER + 43):
                    bad('%s quad%d uv 超出贴图矩形 (%d,%d)' % (mid, i, x0, y0))
                # 几何法线 vs n
                e1 = [p[3] - p[0], p[4] - p[1], p[5] - p[2]]
                e3 = [p[9] - p[0], p[10] - p[1], p[11] - p[2]]
                nx = e1[1] * e3[2] - e1[2] * e3[1]
                ny = e1[2] * e3[0] - e1[0] * e3[2]
                nz = e1[0] * e3[1] - e1[1] * e3[0]
                ln = (nx * nx + ny * ny + nz * nz) ** 0.5
                ax = FACE_AXIS[q['n']]
                if ln < 1e-9 or (nx * ax[0] + ny * ax[1] + nz * ax[2]) / ln < 0.999:
                    bad('%s quad%d 法线与 n 不一致' % (mid, i))
    ok('12 个模型结构检查完毕')

    # --- 2. 图集像素 == 源纹理 ---
    if has_jar:
        for _block, base, jpath in BLOCKS:
            with z.open('assets/minecraft/' + jpath) as fh:
                src = np.asarray(Image.open(fh).convert('RGBA'))
            x0, y0 = rects[base]
            sx0, sy0, sx1, sy1 = SOURCE_BOX
            want = src[sy0:sy1, sx0:sx1]
            got = atlas[y0 + BORDER:y0 + BORDER + (sy1 - sy0), x0 + BORDER:x0 + BORDER + (sx1 - sx0)]
            if not np.array_equal(want, got):
                diff = int((want != got).any(axis=2).sum())
                bad('%s 图集内容与源纹理不一致（%d 像素）' % (base, diff))
            else:
                ok('%s 图集内容与 jar 源纹理逐像素一致' % base)
        z.close()

    # --- 3. 不破坏既有模型 ---
    tiles = [(rects[base][0], rects[base][1], rects[base][0] + BOXSIZE[0],
              rects[base][1] + BOXSIZE[1]) for _b, base, _t in BLOCKS]
    myids = set()
    for _b, base, _t in BLOCKS:
        myids.add(base)
        myids |= {'%s#0,%d' % (base, d) for d in (90, 180, 270)}
    hits = 0
    worst = None
    for mid, m in models.items():
        if mid in myids:
            continue
        for q in m.get('quads') or ():
            uv = q['uv']
            u0, v0 = min(uv[0::2]), min(uv[1::2])
            u1, v1 = max(uv[0::2]), max(uv[1::2])
            for tx0, ty0, tx1, ty1 in tiles:
                if u0 < tx1 and u1 > tx0 and v0 < ty1 and v1 > ty0:
                    hits += 1
                    worst = (mid, (u0, v0, u1, v1))
    if hits:
        bad('有 %d 个既有 quad 与箱子贴图矩形重叠，例如 %r' % (hits, worst))
    else:
        ok('箱子贴图矩形与所有既有模型 quad 无重叠')

    # --- 4. facing 选型 + 锁扣朝向 ---
    def first_match(models_list, props):
        for v in models_list:
            if not v.get('when'):
                return v.get('models') or []
            if all(props.get(k) == str(val) for k, val in v['when'].items()):
                return v.get('models') or []
        return []

    def lock_normal(mid):
        """锁扣 = 面积最小的那个盒（2x4x1），它朝外最远的那个面就是锁扣正面。"""
        best = None
        for q in models[mid]['quads']:
            p = q['p']
            # 面面积（世界单位^2）
            v0 = (p[0], p[1], p[2])
            v1 = (p[3], p[4], p[5])
            v3 = (p[9], p[10], p[11])
            e1 = (v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2])
            e3 = (v3[0] - v0[0], v3[1] - v0[1], v3[2] - v0[2])
            cx = e1[1] * e3[2] - e1[2] * e3[1]
            cy = e1[2] * e3[0] - e1[0] * e3[2]
            cz = e1[0] * e3[1] - e1[1] * e3[0]
            area = (cx * cx + cy * cy + cz * cz) ** 0.5
            if area > 20:
                continue
            mx = sum(p[0::3]) / 4.0 - 8.0
            my = sum(p[1::3]) / 4.0 - 8.0
            mz = sum(p[2::3]) / 4.0 - 8.0
            ax = FACE_AXIS[q['n']]
            t = mx * ax[0] + my * ax[1] + mz * ax[2]
            if best is None or t > best[0]:
                best = (t, FACE_NAME[q['n']], ax)
        return best

    for block_id, base, _t in BLOCKS:
        d = blocks.get(block_id) or {}
        if d.get('kind') != 'variants' or not d.get('variants'):
            bad('%s 不是 variants 定义' % block_id)
            continue
        for fac, want in DIR_OF_FACING.items():
            mids = first_match(d['variants'], {'facing': fac})
            if not mids:
                bad('%s facing=%s 没有选中模型' % (block_id, fac))
                continue
            t, fname, ax = lock_normal(mids[0])
            if tuple(ax) != want:
                bad('%s facing=%s → %s 锁扣朝 %s（期望 %s）'
                    % (block_id, fac, mids[0], fname, fac))
            elif abs(t - 8.0) > 1e-6:
                bad('%s facing=%s → %s 锁扣凸出量 %.3f（期望 8 = 贴到方块边缘）'
                    % (block_id, fac, mids[0], t))
        # 兜底：空属性
        mids = first_match(d['variants'], {})
        if not mids:
            bad('%s 无属性时没有兜底模型' % block_id)
    ok('facing 选型 + 锁扣朝向检查完毕')

    # --- 5. 全库 uv 范围 ---
    oob = 0
    for mid, m in models.items():
        for q in m.get('quads') or ():
            if any(v < -0.01 or v > size + 0.01 for v in q['uv']):
                oob += 1
    if oob:
        bad('全库有 %d 个 quad 的 uv 越出图集' % oob)
    else:
        ok('全库 %d 个模型 uv 都在图集内' % len(models))

    print('\n结果：%s' % ('全部通过' if not problems else '有 %d 个问题' % len(problems)))
    return 0 if not problems else 1


if __name__ == '__main__':
    sys.exit(main())
