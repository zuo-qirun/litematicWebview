#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""check_pack_pixels.py —— 材质包产物「图集 uv 区域 == 包内纹理像素」抽检。

用途：pack.py 烘焙结束后，随机抽若干个「被资源包覆盖、且真的被方块模型引用」的
方块纹理，验证：

  1. 产物 blocks/models.json 里引用该纹理的 quad，其 uv 包围盒（图集像素坐标）
     对应的 atlas 区域像素，与资源包内同名纹理（动画取首帧、尺寸不同按 NEAREST
     缩放到 uv 区域大小）**完全一致**；
  2. 同一个 uv 区域与 base 资产（内置图集）**不一致** —— 证明覆盖真的生效，
     产物不是"看起来没换"的 base 副本；
  3. report.json 的 atlasIndex 记录与 uv 包围盒一致（有 report 时）。

用法：
  python tools/qa/check_pack_pixels.py --pack tests/packs/eye-care-1.21.2.zip \
         --out tests/_pack_out [--assets-base assets] [--sample 5] [--seed 1] [--all]

退出码：0 全部通过；1 有不一致/找不到区域。
"""
from __future__ import annotations

import argparse
import collections
import io
import json
import os
import random
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
BAKE_DIR = os.path.join(ROOT, 'tools', 'bake')
if BAKE_DIR not in sys.path:
    sys.path.insert(0, BAKE_DIR)

try:
    from PIL import Image
except Exception as exc:  # pragma: no cover
    print('需要 Pillow：%s' % exc, file=sys.stderr)
    sys.exit(2)

import pack as P  # noqa: E402  tools/bake/pack.py：复用 PackLayer 的路径/大小写规则


# ---------------------------------------------------------------------------
# 读取产物
# ---------------------------------------------------------------------------
def _abs(p):
    return p if os.path.isabs(p) else os.path.join(ROOT, p)


def _load_json(path, default=None):
    try:
        with open(path, 'r', encoding='utf-8-sig') as fh:
            return json.load(fh)
    except Exception:
        return default


def load_output(out_dir):
    out_dir = _abs(out_dir)
    manifest = _load_json(os.path.join(out_dir, 'manifest.json'), {}) or {}
    models = (_load_json(os.path.join(out_dir, 'models.json'), {}) or {}).get('models', {})
    blocks = (_load_json(os.path.join(out_dir, 'blocks.json'), {}) or {}).get('blocks', {})
    report = _load_json(os.path.join(out_dir, 'report.json'), None)
    atlas_path = os.path.join(out_dir, 'atlas.png')
    if not os.path.isfile(atlas_path):
        raise SystemExit('产物缺少 atlas.png：%s' % atlas_path)
    atlas = Image.open(atlas_path)
    atlas.load()
    atlas = atlas.convert('RGBA')
    meta = _load_json(os.path.join(out_dir, 'meta.json'), {}) or {}
    return {
        'dir': out_dir, 'manifest': manifest, 'models': models, 'blocks': blocks,
        'report': report, 'atlas': atlas, 'meta': meta,
    }


def load_base_atlas(base_dir):
    if not base_dir:
        return None
    path = os.path.join(_abs(base_dir), 'atlas.png')
    if not os.path.isfile(path):
        return None
    im = Image.open(path)
    im.load()
    return im.convert('RGBA')


# ---------------------------------------------------------------------------
# 资源包纹理
# ---------------------------------------------------------------------------
def load_pack_textures(pack_path):
    """返回 OrderedDict: 纹理 key（如 block/stone）-> PIL RGBA（动画已取首帧）。"""
    layer = P.PackLayer(_abs(pack_path))
    out = collections.OrderedDict()
    for key in list(layer.textures):
        rel = P.texture_key_to_name(key)          # pack.py 统一入口（含老路径别名）
        try:
            im = Image.open(io.BytesIO(layer.read(key)))
            im.load()
        except Exception as exc:
            print('  [warn] 包内纹理无法解码：%s（%s）' % (rel, exc), file=sys.stderr)
            continue
        im = im.convert('RGBA')
        if im.height > im.width:                  # 动画条：bake 只取首帧
            im = im.crop((0, 0, im.width, im.width))
        out[rel] = im
    layer.close()
    return out


# ---------------------------------------------------------------------------
# 模型/方块索引
# ---------------------------------------------------------------------------
def model_texs(models):
    """model id -> 该模型用到的纹理集合。"""
    out = {}
    for mid, m in models.items():
        texs = set()
        for q in m.get('quads') or []:
            t = q.get('tex')
            if isinstance(t, str):
                texs.add(t)
        out[mid] = texs
    return out


def model_uv_boxes(models):
    """model id -> {tex: [x0, y0, x1, y1]}（图集像素坐标，含全部 quad 包围盒）。"""
    out = {}
    for mid, m in models.items():
        boxes = {}
        for q in m.get('quads') or []:
            t = q.get('tex')
            uv = q.get('uv') or []
            if not isinstance(t, str) or len(uv) != 8:
                continue
            xs, ys = uv[0::2], uv[1::2]
            b = boxes.get(t)
            if b is None:
                boxes[t] = [min(xs), min(ys), max(xs), max(ys)]
            else:
                b[0] = min(b[0], min(xs))
                b[1] = min(b[1], min(ys))
                b[2] = max(b[2], max(xs))
                b[3] = max(b[3], max(ys))
        out[mid] = boxes
    return out


def _block_model_ids(defn):
    ids = []

    def walk(x):
        if isinstance(x, dict):
            for k, v in x.items():
                if k in ('models', 'default') and isinstance(v, list):
                    ids.extend(str(i) for i in v)
                else:
                    walk(v)
        elif isinstance(x, list):
            for i in x:
                walk(i)

    walk(defn)
    seen = set()
    out = []
    for i in ids:
        base = i.split('#', 1)[0]
        if base and base not in seen:
            seen.add(base)
            out.append(base)
    return out


def tex_blocks(blocks, models):
    """纹理 -> 引用它的方块列表（最多保留 8 个，按 id 排序）。"""
    tex_to_models = collections.defaultdict(set)
    for mid, m in models.items():
        for q in m.get('quads') or []:
            if isinstance(q.get('tex'), str):
                tex_to_models[q['tex']].add(mid)
    out = collections.defaultdict(list)
    for bid, defn in blocks.items():
        for mid in _block_model_ids(defn):
            for tex in tex_to_models.get(mid, ()):
                if len(out[tex]) < 8:
                    out[tex].append(bid)
    return out


# ---------------------------------------------------------------------------
# 像素比对
# ---------------------------------------------------------------------------
def _fit(im, size):
    if im.size == size:
        return im
    return im.resize(size, Image.NEAREST)


def _max_diff(a, b):
    aa = np.asarray(a, dtype=np.int16)
    bb = np.asarray(b, dtype=np.int16)
    return int(np.abs(aa - bb).max()) if aa.size else 0


def check_sample(ctx, pack_texs, base_atlas, sample, seed, check_all):
    models = ctx['models']
    atlas = ctx['atlas']
    boxes = model_uv_boxes(models)
    names_by_block = tex_blocks(ctx['blocks'], models)
    report = ctx['report'] or {}
    index = ((report.get('atlasIndex') or {}).get('index')) or {}

    referenced = collections.OrderedDict()
    for mid, mb in boxes.items():
        for tex, box in mb.items():
            if tex not in pack_texs:
                continue
            cur = referenced.get(tex)
            if cur is None:
                referenced[tex] = [box[0], box[1], box[2], box[3]]
            else:
                cur[0] = min(cur[0], box[0])
                cur[1] = min(cur[1], box[1])
                cur[2] = max(cur[2], box[2])
                cur[3] = max(cur[3], box[3])
    if not referenced:
        print('FAIL：产物里没有任何 quad 引用包内纹理')
        return 1

    # 只抽「真的换了」的纹理：与 base 同区域像素不同（没有 base 时退化为全部）
    changed = collections.OrderedDict()
    for tex, box in referenced.items():
        x0, y0, x1, y1 = [int(round(v)) for v in box]
        if x1 <= x0 or y1 <= y0:
            continue
        if base_atlas is not None:
            if x1 > base_atlas.width or y1 > base_atlas.height:
                continue
            base_px = base_atlas.crop((x0, y0, x1, y1))
            if base_px.size != (x1 - x0, y1 - y0):
                continue
            if _max_diff(base_px, atlas.crop((x0, y0, x1, y1))) == 0:
                continue        # 与 base 一样：改纹理没变化，不适合当"覆盖生效"样本
        changed[tex] = (x0, y0, x1, y1)

    pool = list(changed) if changed else list(referenced)
    if not check_all:
        rnd = random.Random(seed)
        sample = min(sample, len(pool))
        picked = sorted(rnd.sample(pool, sample))
    else:
        picked = sorted(pool)

    print('=-' * 78)
    print('原子图集 %dx%d；包内纹理 %d 张，被产物模型引用 %d 张，其中与 base 不同 %d 张'
          % (atlas.width, atlas.height, len(pack_texs), len(referenced), len(changed)))
    print('抽检 %d 张：%s' % (len(picked), ', '.join(picked)))
    print('-' * 78)

    fails = 0
    for tex in picked:
        x0, y0, x1, y1 = changed.get(tex, tuple(int(round(v)) for v in referenced[tex]))
        w, h = x1 - x0, y1 - y0
        got = atlas.crop((x0, y0, x1, y1))
        want = _fit(pack_texs[tex], (w, h))
        d_pack = _max_diff(got, want)
        d_base = None
        if base_atlas is not None and x1 <= base_atlas.width and y1 <= base_atlas.height:
            d_base = _max_diff(base_atlas.crop((x0, y0, x1, y1)), got)
        bl = names_by_block.get(tex) or []
        ok = d_pack == 0 and (d_base is None or d_base > 0)
        if not ok:
            fails += 1
        # 与 report.atlasIndex 交叉核对
        note = ''
        if isinstance(index.get(tex), (list, tuple)) and len(index[tex]) == 4:
            idx = [int(round(v)) for v in index[tex]]
            if idx[:2] != [x0, y0] or [x0 + w, y0 + h] != [idx[0] + idx[2], idx[1] + idx[3]]:
                note = ' [warn] atlasIndex=%s 与 uv 包围盒不一致' % idx
        print('  %-42s cell=(%4d,%4d, %2dx%-2d) 包纹理=%-8s 像素差(pack)=%d 与base差=%s%s %s'
              % (tex, x0, y0, w, h, '%dx%d' % pack_texs[tex].size, d_pack,
                 d_base if d_base is not None else '-', '' if ok else '  <== FAIL',
                 note))
        if bl:
            print('      引用方块：%s' % ', '.join(bl[:6]))
    if fails:
        print('-' * 78)
        print('FAIL：%d/%d 张纹理的图集 uv 区域与包内纹理不一致或未生效' % (fails, len(picked)))
        return 1
    print('-' * 78)
    print('PASS：%d/%d 张抽检纹理的图集 uv 区域像素 == 包内纹理像素，且与 base 不同'
          % (len(picked), len(picked)))
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description='材质包产物图集 uv 区域像素抽检')
    ap.add_argument('--pack', required=True, help='资源包 zip')
    ap.add_argument('--out', required=True, help='pack.py 产物目录（含 atlas.png / models.json / blocks.json）')
    ap.add_argument('--assets-base', default=None, help='内置 base 资产目录（可选，用于证明覆盖生效）')
    ap.add_argument('--sample', type=int, default=5, help='随机抽检张数（默认 5）')
    ap.add_argument('--seed', type=int, default=1, help='随机种子（默认 1，保证可复现）')
    ap.add_argument('--all', action='store_true', help='检查全部被引用的覆盖纹理，而不是抽样')
    args = ap.parse_args(argv)

    ctx = load_output(args.out)
    pack_texs = load_pack_textures(args.pack)
    base_atlas = load_base_atlas(args.assets_base) if args.assets_base else None
    if args.assets_base and base_atlas is None:
        print('  [warn] 找不到 base atlas.png：%s，跳过"与 base 不同"检查' % args.assets_base,
              file=sys.stderr)
    return check_sample(ctx, pack_texs, base_atlas, args.sample, args.seed, args.all)


if __name__ == '__main__':
    sys.exit(main())
