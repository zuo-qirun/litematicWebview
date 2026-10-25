# -*- coding: utf-8 -*-
"""从 assets/ 直接离线渲染指定模型（用真实 atlas 像素），用于后处理后的快速核对。

    python tools/qa/render_asset_models.py --models block/chest,block/ender_chest \
        --views iso,front --out _dl/qa/x.png [--assets assets] [--size 220] [--scale 11]

不依赖浏览器/three.js：直接从 assets/models.json + assets/atlas.png 采样，验证
uv 是否真的落在想贴的像素上（浏览器截图只能看个大概）。
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from PIL import Image

from soft_render import montage, render_view

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--assets', default='assets')
    ap.add_argument('--models', required=True)
    ap.add_argument('--views', default='iso,front')
    ap.add_argument('--out', default='_dl/qa/render_models.png')
    ap.add_argument('--size', type=int, default=220)
    ap.add_argument('--scale', type=float, default=11.0)
    ap.add_argument('--labels', default='')
    args = ap.parse_args()

    assets = args.assets if os.path.isabs(args.assets) else os.path.join(ROOT, args.assets)
    models = json.load(open(os.path.join(assets, 'models.json'), encoding='utf-8'))['models']
    atlas = Image.open(os.path.join(assets, 'atlas.png'))
    out = args.out if os.path.isabs(args.out) else os.path.join(ROOT, args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)

    ids = [m.strip() for m in args.models.replace('|', ';').split(';') if m.strip()]
    views = [v.strip() for v in args.views.split(',') if v.strip()]
    labels_extra = [x.strip() for x in args.labels.split(',')] if args.labels else []
    ims, labels = [], []
    for mid in ids:
        m = models.get(mid)
        if not m or not m.get('quads'):
            print('  缺失模型:', mid)
            continue
        us = [q['uv'][i] for q in m['quads'] for i in (0, 2, 4, 6)]
        vs = [q['uv'][i] for q in m['quads'] for i in (1, 3, 5, 7)]
        print('  %-26s quads=%d uv u%d..%d v%d..%d'
              % (mid, len(m['quads']), min(us), max(us), min(vs), max(vs)))
        for view in views:
            ims.append(render_view(m['quads'], atlas, view=view, size=args.size,
                                   scale=args.scale, center=(8.0, 8.0, 8.0)))
            labels.append('%s | %s' % (mid, view))
    if not ims:
        raise SystemExit('没有可渲染的模型')
    img = montage(ims, labels, cols=len(views))
    img.save(out)
    print(out, img.size)


if __name__ == '__main__':
    main()
