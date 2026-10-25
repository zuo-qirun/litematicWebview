#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""mcviewer 材质包产物验收（verify_pack.py）。

用法：
    python tools\\bake\\verify_pack.py --pack tests\\packs\\texture-only.zip --out _dl\\_work_pack\\out_texture-only
    python tools\\bake\\verify_pack.py --pack <zip> --out <dir> -v --json _dl\\verify.json

对「pack.py 烘出来的 assets 输出」做独立验收，共 10 项：
  1. 文件齐全：manifest/blocks/models/lang/meta/atlas.png（成功烘焙时还应有 report.json）。
  2. 图集可开：PNG 为 RGBA 方形 2 的幂，尺寸与 manifest.atlas.size 一致。
  3. manifest / meta 自洽：format、dataVersion、textureScale、blockCount/modelCount/quadCount。
  4. blocks.json：kind 合法、render 字段齐全且取值合法（opaque/cutout/translucent）、
     minecraft:air 存在且 invisible、tintColors 合法、引用的 model id 全部存在。
  5. models.json：quad 的 p/uv/n/tint/tex 合法，uv 在图集内（有 report.atlasIndex 时做严格格内检查）。
  6. lang.json：zh_cn / en_us 结构合法，en_us 覆盖全部方块（block.<path> 键）。
  7. 5 个 .litematic fixture 的 palette 100% 可解析（blocks -> models -> quads -> uv）。
  8. 材质包覆盖的纹理确实出现在产物图集里（像素级比对，仅检查被模型引用的纹理）；
     另外校验 report.json 的 overrides/overridesDetail/stats 与 zip 实际内容一致，
     并把 report.warnings（如 pack.mcmeta 版本不匹配）原样当警告打印。
  9. 继承箱子实体模型（post_entity_models.py）生效。
 10. manifest 继承 base 且 models/ 分片齐全、modelsCount 与实际一致（viewer 按需加载契约）。

退出码：0 = 全部通过（允许警告），1 = 有失败项。
"""
import argparse
import collections
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, 'tools'))

import numpy as np                    # noqa: E402
from PIL import Image                 # noqa: E402

import verify as V                    # noqa: E402  （复用 fixture 解析 / 状态匹配 / 几何检查）
import pack as P                      # noqa: E402  （复用 zip 材质包解析：路径规范化/校验逻辑与烘焙端一致）

FAIL = []
WARN = []
VERBOSE = False


def fail(msg):
    FAIL.append(msg)
    print('  [FAIL] ' + msg)


def warn(msg):
    WARN.append(msg)
    if VERBOSE:
        print('  [warn] ' + msg)


def load_json(path):
    with open(path, encoding='utf-8') as fh:
        return json.load(fh)


# ---------------------------------------------------------------------------
# 各项检查
# ---------------------------------------------------------------------------
def check_files(out):
    print('-' * 78)
    print('1. 文件齐全')
    names = ['manifest.json', 'blocks.json', 'models.json', 'lang.json',
             'meta.json', 'atlas.png']
    for name in names:
        path = os.path.join(out, name)
        if not os.path.isfile(path):
            fail('缺少产物文件：%s' % name)
        elif os.path.getsize(path) == 0:
            fail('产物文件为空：%s' % name)
        else:
            print('   %-14s %10d B' % (name, os.path.getsize(path)))
    if not os.path.isfile(os.path.join(out, 'report.json')):
        warn('没有 report.json（非 pack.py 产物，跳过第 8 项中的 report 一致性检查）')
    data = {}
    for name, key in (('manifest.json', 'manifest'), ('blocks.json', 'blocks'),
                      ('models.json', 'models'), ('lang.json', 'lang'),
                      ('meta.json', 'meta')):
        path = os.path.join(out, name)
        if not os.path.isfile(path):
            data[key] = None
            continue
        try:
            data[key] = load_json(path)
        except Exception as exc:
            fail('%s 无法解析：%s' % (name, exc))
            data[key] = None
    if data.get('blocks') is not None and not isinstance(data['blocks'].get('blocks'), dict):
        fail('blocks.json 缺少 {"blocks": {...}} 结构')
    if data.get('models') is not None and not isinstance(data['models'].get('models'), dict):
        fail('models.json 缺少 {"models": {...}} 结构')
    if data.get('lang') is not None and not isinstance(data['lang'], dict):
        fail('lang.json 顶层必须是对象')
    return data


def check_atlas(manifest, out):
    print('-' * 78)
    print('2. 图集可开')
    size = 0
    try:
        size = int((manifest.get('atlas') or {}).get('size') or 0)
    except Exception:
        size = 0
    if not size:
        fail('manifest.atlas.size 缺失或非法')
    path = os.path.join(out, 'atlas.png')
    if not os.path.isfile(path):
        fail('缺少 atlas.png')
        return None, size
    try:
        im = Image.open(path)
        im.load()
    except Exception as exc:
        fail('atlas.png 无法打开：%s' % exc)
        return None, size
    if im.mode != 'RGBA':
        fail('atlas.png 必须是 RGBA，实际是 %s' % im.mode)
    if im.width != im.height:
        fail('atlas.png 必须是方形，实际 %dx%d' % (im.width, im.height))
    if im.width and (im.width & (im.width - 1)) != 0:
        fail('atlas.png 边长必须是 2 的幂，实际 %d' % im.width)
    if size and im.width != size:
        fail('atlas.png 尺寸 %d 与 manifest.atlas.size=%d 不一致' % (im.width, size))
    pad = int((manifest.get('atlas') or {}).get('padding', 2) or 0)
    print('   atlas.png %dx%d %s padding=%d' % (im.width, im.height, im.mode, pad))
    return im.convert('RGBA'), (size or im.width)


def check_manifest(manifest, meta, blocks, models, out):
    print('-' * 78)
    print('3. manifest / meta 自洽')
    if manifest.get('format') != 1:
        fail('manifest.format 必须为 1，实际 %r' % manifest.get('format'))
    if not manifest.get('mcVersions'):
        warn('manifest.mcVersions 为空')
    if manifest.get('dataVersion') is None:
        warn('manifest.dataVersion 缺失')
    if not manifest.get('textureScale'):
        warn('manifest.textureScale 缺失')
    files = manifest.get('files') or {}
    for key in ('blocks', 'models', 'lang', 'meta'):
        if not files.get(key):
            fail('manifest.files.%s 缺失' % key)
    if meta is not None:
        if blocks is not None and meta.get('blockCount') is not None \
                and int(meta['blockCount']) != len(blocks):
            fail('meta.blockCount=%s 与实际 %d 不一致' % (meta['blockCount'], len(blocks)))
        if models is not None and meta.get('modelCount') is not None \
                and int(meta['modelCount']) != len(models):
            fail('meta.modelCount=%s 与实际 %d 不一致' % (meta['modelCount'], len(models)))
        quads = sum(len(m.get('quads') or []) for m in (models or {}).values())
        if meta.get('quadCount') is not None and int(meta['quadCount']) != quads:
            fail('meta.quadCount=%s 与实际 %d 不一致' % (meta['quadCount'], quads))
        print('   blocks=%d models=%d quads=%d textureCount=%s atlasUsage=%s'
              % (len(blocks or {}), len(models or {}), quads,
                 meta.get('textureCount'), meta.get('atlasUsage')))
        if meta.get('missingBlocks'):
            warn('missingBlocks=%s' % (meta.get('missingBlocks'),))
        if meta.get('missingTextures'):
            warn('缺失纹理 %d 张（用占位图）' % len(meta.get('missingTextures') or []))
    else:
        fail('缺少 meta.json')
    quad_total = sum(len(m.get('quads') or []) for m in (models or {}).values())
    print('   quad 总数 %d' % quad_total)
    return quad_total


def check_blocks(blocks, models):
    print('-' * 78)
    print('4. blocks.json 结构 / render / model 引用')
    if not blocks:
        fail('blocks.json 为空')
        return set()
    referenced = set()
    bad = 0
    kinds = collections.Counter()
    for name, defn in blocks.items():
        if not isinstance(name, str) or ':' not in name:
            fail('方块 id 非法：%r' % (name,))
            bad += 1
            continue
        if not isinstance(defn, dict):
            fail('%s 的 BlockDef 不是对象' % name)
            bad += 1
            continue
        kind = defn.get('kind')
        kinds[kind] += 1
        renders = defn.get('render')
        if renders not in ('opaque', 'cutout', 'translucent'):
            fail('%s 的 render 非法/缺失：%r' % (name, renders))
            bad += 1
        if kind == 'variants':
            variants = defn.get('variants')
            if not isinstance(variants, list) or not variants:
                fail('%s kind=variants 但 variants 为空' % name)
                bad += 1
                continue
            if not defn.get('default'):
                if not any(not e.get('when') for e in variants):
                    fail('%s kind=variants 没有无 when 的默认项，也没有 default 字段' % name)
                    bad += 1
            for e in variants:
                when = e.get('when')
                if when is not None and not isinstance(when, dict):
                    fail('%s 的 variants[].when 不是对象' % name)
                    bad += 1
                mids = e.get('models')
                if not isinstance(mids, list) or not mids:
                    fail('%s 有 variants 条目的 models 为空' % name)
                    bad += 1
                    continue
                referenced.update(mids)
        elif kind == 'multipart':
            parts = defn.get('parts')
            if not isinstance(parts, list) or not parts:
                fail('%s kind=multipart 但 parts 为空' % name)
                bad += 1
                continue
            for p in parts:
                when = p.get('when')
                if when is not None and not isinstance(when, dict):
                    fail('%s 的 parts[].when 不是对象' % name)
                    bad += 1
                mids = p.get('models')
                if not isinstance(mids, list) or not mids:
                    fail('%s 有 parts 条目的 models 为空' % name)
                    bad += 1
                    continue
                referenced.update(mids)
        elif kind == 'invisible':
            pass
        else:
            fail('%s 的 kind 非法：%r' % (name, kind))
            bad += 1
        tint = defn.get('tintColors')
        if tint is not None:
            if not isinstance(tint, dict):
                fail('%s 的 tintColors 不是对象' % name)
                bad += 1
            else:
                for k, v in tint.items():
                    if not (isinstance(v, list) and len(v) == 3
                            and all(isinstance(x, (int, float)) and 0.0 <= x <= 1.0 for x in v)):
                        fail('%s 的 tintColors[%s] 非法：%r' % (name, k, v))
                        bad += 1
    air = blocks.get('minecraft:air')
    if air is None:
        fail('缺少 minecraft:air')
    elif air.get('kind') != 'invisible':
        fail('minecraft:air 必须 kind=invisible，实际 %r' % air.get('kind'))
    print('   blocks=%d kind=%s 引用 model id %d 个'
          % (len(blocks), dict(kinds), len(referenced)))
    missing = sorted(mid for mid in referenced if mid not in (models or {}))
    if missing:
        for mid in missing[:10]:
            fail('引用了不存在的 model id：%s' % mid)
        if len(missing) > 10:
            fail('…… 共 %d 个 model id 缺失' % len(missing))
    return referenced


def check_models(models, atlas, atlas_size, index, referenced):
    print('-' * 78)
    print('5. models.json quad / uv')
    if not models:
        fail('models.json 为空')
        return
    pad = 2
    bad_uv = bad_p = bad_n = 0
    bad_tex = 0
    uv_cell_bad = 0
    texs = set()
    checked = 0
    for mid in sorted(models):
        m = models[mid]
        qs = m.get('quads')
        if not isinstance(qs, list):
            fail('%s 的 quads 不是数组' % mid)
            continue
        for q in qs:
            checked += 1
            p = q.get('p')
            if not (isinstance(p, list) and len(p) == 12
                    and all(isinstance(x, (int, float)) for x in p)):
                bad_p += 1
                continue
            if any(x < -16.0 or x > 32.0 for x in p):
                bad_p += 1
            uv = q.get('uv')
            if not (isinstance(uv, list) and len(uv) == 8
                    and all(isinstance(x, (int, float)) for x in uv)):
                bad_uv += 1
                continue
            if any(x < -0.01 or x > atlas_size + 0.01 for x in uv):
                bad_uv += 1
                continue
            n = q.get('n')
            if not isinstance(n, int) or not (0 <= n <= 5):
                bad_n += 1
            tint = q.get('tint')
            if not isinstance(tint, int) or tint < -1:
                bad_n += 1
            tex = q.get('tex')
            if not isinstance(tex, str) or not tex:
                bad_tex += 1
                continue
            texs.add(tex)
            if index is not None:
                cell = index.get(tex)
                if cell is None:
                    bad_tex += 1
                    continue
                x, y, w, h = cell
                for i in range(4):
                    u, v = uv[i * 2], uv[i * 2 + 1]
                    if not (x - pad - 0.01 <= u <= x + w + pad + 0.01
                            and y - pad - 0.01 <= v <= y + h + pad + 0.01):
                        uv_cell_bad += 1
                        break
    if bad_p:
        fail('%d 个 quad 的 p 非法（需 12 个数字且在 [-16,32]）' % bad_p)
    if bad_uv:
        fail('%d 个 quad 的 uv 非法或超出图集' % bad_uv)
    if bad_n:
        fail('%d 个 quad 的 n/tint 字段非法' % bad_n)
    if bad_tex:
        fail('%d 个 quad 的 tex 非法或不在图集布局中' % bad_tex)
    if uv_cell_bad:
        fail('%d 个 quad 的 uv 超出纹理格（report.atlasIndex 严格检查）' % uv_cell_bad)
    print('   models=%d quads=%d 引用纹理 %d 张；p/uv/n/tint/tex 异常=%d/%d/%d/%d'
          % (len(models), checked, len(texs), bad_p, bad_uv, bad_n, bad_tex))
    # 被引用的模型必须存在且 quad 非空（invisible 除外由 blocks 检查处理）
    zero = sorted(mid for mid in referenced if mid in models
                  and not (models[mid].get('quads') or []))
    if zero:
        # 原版里确实有 0 quad 的模型（block/air、block/barrier 等），只有可见方块引用才失败
        warn('被引用的 0 quad 模型 %d 个（如不可见方块模板）：%s'
             % (len(zero), ', '.join(zero[:8])))
    return texs


def check_lang(lang, blocks):
    print('-' * 78)
    print('6. lang.json')
    en = (lang or {}).get('en_us') or {}
    zh = (lang or {}).get('zh_cn') or {}
    if not isinstance(en, dict) or not isinstance(zh, dict):
        fail('lang.json 必须含 zh_cn / en_us 两个对象')
        return
    miss_en = []
    miss_zh = 0
    for name in sorted(blocks or {}):
        path = name.split(':')[-1]
        keys = ('block.' + path, 'block.minecraft.' + path, 'block.' + name)
        if not any(k in en for k in keys):
            miss_en.append(name)
        if not any(k in zh for k in keys):
            miss_zh += 1
    if miss_en:
        for name in miss_en[:10]:
            fail('en_us 缺少方块名：%s' % name)
        if len(miss_en) > 10:
            fail('…… en_us 共缺 %d 个方块名' % len(miss_en))
    print('   en_us=%d zh_cn=%d 键；en_us 缺 %d，zh_cn 缺 %d（缺 zh 时前端回退 en）'
          % (len(en), len(zh), len(miss_en), miss_zh))
    if miss_zh:
        warn('zh_cn 缺 %d 个方块名（可回退 en_us）' % miss_zh)


def check_fixtures(blocks, models, atlas_size, index):
    print('-' * 78)
    print('7. fixture palette 解析率（5 个 .litematic）')
    fixtures = V.FIXTURES
    files = sorted(f for f in os.listdir(fixtures)
                   if f.endswith('.litematic')) if os.path.isdir(fixtures) else []
    if len(files) < 5:
        fail('tests/fixtures 下 .litematic 不足 5 个（实际 %d）' % len(files))
    total = 0
    ok = 0
    bad = []
    for fn in files:
        path = os.path.join(fixtures, fn)
        try:
            stats, nregions, blocks_total = V.read_fixture(path)
        except Exception as exc:
            fail('%s 读取失败：%s' % (fn, exc))
            continue
        seen = set()
        for reg in stats:
            for st, cnt in reg['states']:
                if st in seen or st.startswith('minecraft:air'):
                    continue
                seen.add(st)
                name, props = V.parse_state(st)
                defn = blocks.get(name)
                if defn is None:
                    bad.append((fn, st, 'block 不存在'))
                    total += 1
                    continue
                ids, how = V.resolve_models(defn, props)
                if defn.get('kind') == 'invisible':
                    total += 1
                    ok += 1          # 不可见方块按契约跳过几何，算解析成功
                    continue
                total += 1
                problem = None
                for mid in ids:
                    m = models.get(mid)
                    if m is None:
                        problem = 'model 缺失 %s' % mid
                        break
                    if not (m.get('quads') or []):
                        problem = 'model 无 quad %s' % mid
                        break
                if problem:
                    bad.append((fn, st, problem))
                else:
                    ok += 1
    print('   fixture %d 个：palette 状态 %d，通过 %d，失败 %d，解析率 %.2f%%'
          % (len(files), total, ok, len(bad),
             100.0 * ok / total if total else 100.0))
    for fn, st, why in bad[:10]:
        fail('%s 的 %s 无法解析：%s' % (fn, st, why))
    if total and ok < total:
        fail('fixture palette 解析率 %.2f%% < 100%%' % (100.0 * ok / total))


def check_pack_textures(pack_path, out, report, blocks, models, atlas, atlas_size):
    print('-' * 78)
    print('8. 材质包覆盖纹理 / report 一致性')
    if pack_path is None:
        warn('未提供 --pack，跳过材质包纹理检查')
        return
    try:
        layer = P.PackLayer(pack_path)
    except Exception as exc:
        fail('材质包无法解析：%s' % exc)
        return
    ref_texs = set()
    for m in (models or {}).values():
        for q in m.get('quads') or []:
            if isinstance(q.get('tex'), str):
                ref_texs.add(q['tex'])
    index = None
    if isinstance(report, dict):
        idx_obj = report.get('atlasIndex') or {}
        index = idx_obj.get('index') if isinstance(idx_obj.get('index'), dict) else None
    checked = 0
    not_ref = []
    mismatch = 0
    for key in layer.textures:
        tex = P.texture_key_to_name(key)
        if tex not in ref_texs:
            not_ref.append(tex)
            continue
        raw = layer.read(key)
        try:
            im = Image.open(io.BytesIO(raw)).convert('RGBA')
            im.load()
        except Exception as exc:
            fail('材质包纹理无法解码：%s（%s）' % (tex, exc))
            continue
        cell = (index or {}).get(tex)
        if cell is None:
            fail('材质包纹理 %s 没有出现在图集布局里' % tex)
            mismatch += 1
            continue
        # 动画纹理：烘焙端只取首帧（高度 > 宽度时裁最上面的正方形帧）
        if im.height > im.width:
            im = im.crop((0, 0, im.width, im.width))
        x, y, w, h = cell
        want = im
        if want.size != (w, h):
            want = want.resize((w, h), Image.NEAREST)
        got = atlas.crop((x, y, x + w, y + h))
        want_np = np.asarray(want, dtype=np.int16)
        got_np = np.asarray(got, dtype=np.int16)
        diff = int(np.abs(want_np - got_np).max()) if want_np.size else 0
        if diff > 0:
            mismatch += 1
            fail('材质包纹理 %s 与图集内容不一致（最大像素差 %d，cell=%s）'
                 % (tex, diff, cell))
        checked += 1
    if not_ref:
        warn('材质包内 %d 张纹理未被任何模型引用（已忽略，不会进图集）：%s'
             % (len(not_ref), ', '.join(not_ref[:8])))
    print('   材质包纹理 %d 张：被模型引用 %d 张，像素一致 %d 张，不一致 %d 张'
          % (len(layer.textures), len(layer.textures) - len(not_ref),
             checked - mismatch, mismatch))
    if index is None:
        warn('无 report.atlasIndex，材质包纹理只做了边界检查，未做像素比对')

    # ---- report.json 一致性 ----
    if not isinstance(report, dict):
        warn('未找到 report.json，跳过 overrides/stats 一致性检查')
        layer.close()
        return
    if report.get('ok') is not True:
        fail('report.json ok 不为 true：%r' % report.get('ok'))
    # 烘焙端会把 pack.mcmeta 的版本兼容问题写进 warnings（如 pack_format 41 > 基准 34）
    for wmsg in report.get('warnings') or []:
        warn('report.warnings: %s' % wmsg)
    mcmeta = (report.get('pack') or {}).get('mcmeta') or {}
    if mcmeta:
        sf = mcmeta.get('supportedFormats')
        print('   pack.mcmeta：pack_format=%r supported_formats=%r 兼容=%r'
              % (mcmeta.get('packFormat'), sf, mcmeta.get('compatible')))
    expect = collections.OrderedDict([
        ('blockstates', len(layer.blockstates)),
        ('models', len(layer.models)),
        ('textures', len(layer.textures)),
        ('lang', len(layer.lang)),
    ])
    # 新版 report：overrides 是数字（受影响条目总数），明细在 overridesDetail；
    # 兼容旧版：overrides 是对象。
    detail = report.get('overridesDetail')
    if not isinstance(detail, dict):
        detail = report.get('overrides') if isinstance(report.get('overrides'), dict) else None
        if detail is not None:
            warn('report.overrides 是旧版对象结构（缺少 overridesDetail），按旧格式校验')
    if detail is None:
        fail('report 缺少 overridesDetail（无法核对 zip 实际条目数）')
    else:
        for k, v in expect.items():
            if int(detail.get(k, -1)) != v:
                fail('report.overridesDetail.%s=%r，与 zip 实际 %d 不一致'
                     % (k, detail.get(k), v))
    total = report.get('overrides')
    if isinstance(total, int) and not isinstance(total, bool):
        if total != sum(expect.values()):
            fail('report.overrides=%d，与 zip 实际受影响条目总数 %d 不一致'
                 % (total, sum(expect.values())))
    elif detail is None:
        pass
    else:
        fail('report.overrides 应为数字（受影响条目总数），实际 %r' % (total,))
    stats = report.get('stats') or {}
    quads = sum(len(m.get('quads') or []) for m in (models or {}).values())
    if int(stats.get('blocks', -1)) != len(blocks or {}):
        fail('report.stats.blocks=%r 与实际 %d 不一致'
             % (stats.get('blocks'), len(blocks or {})))
    if int(stats.get('models', -1)) != len(models or {}):
        fail('report.stats.models=%r 与实际 %d 不一致'
             % (stats.get('models'), len(models or {})))
    if int(stats.get('quads', -1)) != quads:
        fail('report.stats.quads=%r 与实际 %d 不一致' % (stats.get('quads'), quads))
    if int(stats.get('atlasSize', -1)) != atlas_size:
        fail('report.stats.atlasSize=%r 与实际 %d 不一致'
             % (stats.get('atlasSize'), atlas_size))
    print('   report: ok=true overrides=%r（明细 %r） stats=%r'
          % (total, dict(detail or {}), dict(stats)))
    layer.close()


def _referenced_models(defn):
    ids = []

    def walk(x):
        if isinstance(x, dict):
            for k, v in x.items():
                if k == 'models' and isinstance(v, list):
                    ids.extend(str(i) for i in v)
                else:
                    walk(v)
        elif isinstance(x, list):
            for i in x:
                walk(i)

    walk(defn)
    return ids


def check_entity_models(models, blocks, report):
    """bake-entities 后处理：箱子/陷阱箱/末影箱应继承 18 quad 实体模型。"""
    print('9. 继承箱子实体模型（post_entity_models.py）')
    post = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        'post_entity_models.py')
    applied = bool(isinstance(report, dict)
                   and (report.get('postEntityModels') or {}).get('applied'))
    if not os.path.isfile(post) and not applied:
        warn('未发现 tools/bake/post_entity_models.py，跳过箱子实体模型检查')
        return
    if not applied and isinstance(report, dict):
        warn('report.postEntityModels.applied 不为 true（后处理可能未生效，见 report.notes）')
    expect = [
        ('minecraft:chest', 'block/chest', 'entity/chest/normal'),
        ('minecraft:trapped_chest', 'block/trapped_chest', 'entity/chest/trapped'),
        ('minecraft:ender_chest', 'block/ender_chest', 'entity/chest/ender'),
    ]
    found = 0
    for block_id, base_mid, expect_tex in expect:
        bd = (blocks or {}).get(block_id)
        if not bd:
            warn('%s 不存在，跳过' % block_id)
            continue
        ids = [m for m in _referenced_models(bd) if m.startswith(base_mid)]
        if not ids:
            fail('%s 未引用 %s 模型（应继承实体箱子模型）' % (block_id, base_mid))
            continue
        for mid in ids:
            md = (models or {}).get(mid)
            if not md:
                fail('%s 引用的模型 %s 不存在' % (block_id, mid))
                continue
            quads = md.get('quads') or []
            if len(quads) != 18:
                fail('%s 的 quad 数=%d，应为 18（实体箱子）' % (mid, len(quads)))
                continue
            texs = {str(q.get('tex')) for q in quads}
            if not any(t.startswith('entity/chest/') for t in texs):
                fail('%s 未使用实体箱子纹理（实际 %s）' % (mid, sorted(texs)[:3]))
                continue
            found += 1
        print('   方块 %-22s 模型 %d 个（含旋转展开），quad 均为 18，纹理 %s'
              % (block_id, len(ids), expect_tex))
    if found:
        print('   共 %d 个继承模型通过（方块 %d 个）' % (found, len(expect)))


# ---------------------------------------------------------------------------
# 10. manifest 继承 + 模型分片
# ---------------------------------------------------------------------------
def encode_model_id(model_id):
    """与 bake.model_file_name / src/render/db.js encodeModelId 完全一致。"""
    return str(model_id).replace('/', '$').replace('#', '@').replace(',', '!')


def check_manifest_shards(out, manifest, models):
    print('-' * 78)
    print('10. manifest 继承与模型分片（viewer 按需加载契约）')
    if not isinstance(manifest, dict) or not manifest:
        fail('缺少 manifest.json，无法检查模型分片')
        return
    base_manifest = {}
    try:
        base_manifest = load_json(os.path.join(ROOT, 'assets', 'manifest.json'))
    except Exception:
        warn('找不到内置 assets/manifest.json，跳过 manifest 继承比对')
    for key in (base_manifest or {}):
        if key not in manifest:
            warn('manifest 缺少内置 base 的字段 %r（viewer 可能取不到）' % key)
    mode = manifest.get('modelsMode')
    models_dir_name = manifest.get('modelsDir') or 'models'
    declared = manifest.get('modelsCount')
    if mode != 'files':
        warn('manifest.modelsMode=%r（不是 files，viewer 会整体下载 models.json）' % mode)
        return
    models_dir = os.path.join(out, models_dir_name)
    if not os.path.isdir(models_dir):
        fail('manifest.modelsMode=files 但缺少分片目录：%s' % (models_dir,))
        return
    names = [n for n in os.listdir(models_dir) if n.endswith('.json')]
    count = len(names)
    models = models or {}
    if not isinstance(declared, int) or isinstance(declared, bool):
        fail('manifest.modelsCount=%r 缺失或非法' % (declared,))
    elif declared != count:
        fail('manifest.modelsCount=%d 与实际分片数 %d 不一致' % (declared, count))
    elif declared != len(models):
        fail('manifest.modelsCount=%d 与 models.json 模型数 %d 不一致'
             % (declared, len(models)))
    else:
        print('   modelsMode=files modelsDir=%s 分片 %d 个（与 modelsCount / models.json 一致）'
              % (models_dir_name, count))
    # 每个模型都必须有对应分片（缺一个 viewer 就整体回退到 9MB 的 models.json）
    have = set(n[:-len('.json')] for n in names)
    missing = [mid for mid in models if encode_model_id(mid) not in have]
    if missing:
        fail('%d 个模型缺少分片（例：%s）' % (len(missing), ', '.join(missing[:5])))
    # 抽查分片内容与 models.json 一致（后处理修改模型后忘了同步分片的兜底）
    import random
    ids = sorted(models)
    sample = ids if len(ids) <= 200 else random.Random(7).sample(ids, 200)
    bad = 0
    for mid in sample:
        path = os.path.join(models_dir, encode_model_id(mid) + '.json')
        try:
            got = load_json(path)
        except Exception:
            bad += 1
            continue
        if got != (models[mid].get('quads') or []):
            bad += 1
    if bad:
        fail('%d/%d 个抽查分片的内容与 models.json 不一致（先跑 pack.py 的同步修复）'
             % (bad, len(sample)))
    else:
        print('   抽查 %d 个分片：内容与 models.json 一致' % len(sample))


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------
def main(argv=None):
    global VERBOSE
    ap = argparse.ArgumentParser(
        description='mcviewer 材质包产物验收（pack.py 输出目录）')
    ap.add_argument('--pack', help='材质包 zip（用于校验覆盖纹理与 overrides 统计）')
    ap.add_argument('--out', required=True, help='pack.py 的输出目录（应为 <dir>/assets 内容）')
    ap.add_argument('--json', dest='json_out', help='把验收结果另存为 JSON')
    ap.add_argument('-v', '--verbose', action='store_true', help='打印警告与更多细节')
    args = ap.parse_args(argv)
    VERBOSE = args.verbose
    out = os.path.abspath(args.out)

    print('=' * 78)
    print('mcviewer 材质包验收')
    print('  out : %s' % out)
    print('  pack: %s' % (os.path.abspath(args.pack) if args.pack else '(未提供)'))
    print('=' * 78)
    if not os.path.isdir(out):
        print('  [FAIL] 输出目录不存在：%s' % out)
        return 1

    data = check_files(out)
    manifest = data.get('manifest') or {}
    blocks = (data.get('blocks') or {}).get('blocks') or {}
    models = (data.get('models') or {}).get('models') or {}
    lang = data.get('lang')
    meta = data.get('meta')
    atlas, atlas_size = check_atlas(manifest, out)
    check_manifest(manifest, meta, blocks, models, out)

    # report.json（可选）里的图集布局索引：用于严格 uv/像素检查
    report = None
    rpath = os.path.join(out, 'report.json')
    if os.path.isfile(rpath):
        try:
            report = load_json(rpath)
        except Exception as exc:
            warn('report.json 无法解析：%s' % exc)
    index = None
    if isinstance(report, dict):
        idx = report.get('atlasIndex') or {}
        if isinstance(idx.get('index'), dict) and int(idx.get('size') or 0) == atlas_size:
            index = idx['index']
    if index is not None:
        print('   图集布局索引：%d 张纹理（严格 uv 格内检查开启）' % len(index))

    referenced = check_blocks(blocks, models)
    check_models(models, atlas, atlas_size, index, referenced)
    check_lang(lang, blocks)
    check_fixtures(blocks, models, atlas_size, index)
    if atlas is not None:
        check_pack_textures(args.pack, out, report, blocks, models, atlas, atlas_size)
    check_entity_models(models, blocks, report)
    check_manifest_shards(out, manifest, models)

    print('=' * 78)
    if FAIL:
        print('验收结果: 失败 %d 项 / 警告 %d 项' % (len(FAIL), len(WARN)))
        for f in FAIL:
            print('  - ' + f)
        code = 1
    else:
        print('验收结果: 全部通过（警告 %d 项）' % len(WARN))
        code = 0
    if args.json_out:
        payload = {'ok': code == 0, 'fail': FAIL, 'warn': WARN,
                   'out': out, 'pack': os.path.abspath(args.pack) if args.pack else None}
        with open(args.json_out, 'w', encoding='utf-8') as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=1)
    return code


if __name__ == '__main__':
    sys.exit(main())
