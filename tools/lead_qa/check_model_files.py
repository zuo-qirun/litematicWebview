# -*- coding: utf-8 -*-
"""校验 assets/models/ 单文件模型：数量、编码映射、内容结构、与 models.json 一致。"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def enc(mid):
    return mid.replace('/', '$').replace('#', '@').replace(',', '!')


def main():
    out = os.path.join(ROOT, 'assets')
    with open(os.path.join(out, 'manifest.json'), encoding='utf-8') as fh:
        manifest = json.load(fh)
    with open(os.path.join(out, 'models.json'), encoding='utf-8') as fh:
        doc = json.load(fh)
    models = doc['models']
    models_dir = os.path.join(out, manifest.get('modelsDir') or 'models')
    print('manifest.modelsMode = %r modelsDir = %r modelsCount = %r'
          % (manifest.get('modelsMode'), manifest.get('modelsDir'), manifest.get('modelsCount')))
    files = sorted(os.listdir(models_dir))
    print('目录内文件 %d 个（models.json 里 %d 个模型）' % (len(files), len(models)))
    bad = []
    total = 0
    for mid, model in models.items():
        name = enc(mid) + '.json'
        path = os.path.join(models_dir, name)
        if not os.path.exists(path):
            bad.append('缺少文件 %s' % name)
            continue
        with open(path, encoding='utf-8') as fh:
            quads = json.load(fh)
        expect = model.get('quads') or []
        if not isinstance(quads, list):
            bad.append('%s 不是数组' % name)
        elif len(quads) != len(expect):
            bad.append('%s quad 数 %d != %d' % (name, len(quads), len(expect)))
        else:
            for q in quads:
                keys = set(q.keys())
                if not {'p', 'uv', 'n', 'tint'} <= keys:
                    bad.append('%s 的 quad 缺字段: %r' % (name, sorted(keys)))
                    break
        total += 1
    extra = [f for f in files if f[:-5] not in set(enc(m) for m in models)]
    if extra:
        bad.append('多余文件 %d 个：%r' % (len(extra), extra[:3]))
    print('校验 %d 个模型，%d 处问题' % (total, len(bad)))
    for b in bad[:10]:
        print('  -', b)
    # 抽查：普通方块 / 带旋转后缀的变体 / 箱子实体模型
    for mid in ('block/stone', 'block/oak_stairs#90,0u', 'block/chest', 'block/hopper#0,90'):
        path = os.path.join(models_dir, enc(mid) + '.json')
        if os.path.exists(path):
            with open(path, encoding='utf-8') as fh:
                q = json.load(fh)
            print('  抽查 %-26s %d quad' % (mid, len(q)))
        else:
            print('  抽查 %-26s 不存在（若该模型未烘焙则正常）' % mid)
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
