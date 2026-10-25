# -*- coding: utf-8 -*-
"""mcviewer 资产验收脚本。

用法：
    python tools\\bake\\verify.py            # 全量验收
    python tools\\bake\\verify.py -v         # 打印更多细节

做四件事：
  A. 读 5 个 .litematic fixture 的**全部** region palette 条目（跳过 minecraft:air），
     逐条验证 blocks.json 能解析出 >=1 个 model id，且这些 model id 存在于 models.json、
     quad 数 > 0、每个 quad 的纹理 uv 落在图集的有效区域（有 _work/atlas_index.json 时做严格格内检查）。
  B. 反向一致性：blocks.json 里引用的每个 model id 都在 models.json 里存在。
  C. 几何自检：随机抽 30 个模型，检查每个 quad 四顶点共面、面积 > 0、顶点在 [-16, 32]。
  D. 语言文件覆盖：fixture 用到的方块在 lang.json 里是否有 en_us / zh_cn。
"""
import collections
import glob
import gzip
import json
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
ASSETS = os.path.join(ROOT, 'assets')
FIXTURES = os.path.join(ROOT, 'tests', 'fixtures')
sys.path.insert(0, os.path.join(ROOT, 'tools'))

import nbtref  # noqa: E402

VERBOSE = '-v' in sys.argv

FACE_NORMAL = [
    (0.0, -1.0, 0.0),   # 0 down
    (0.0, 1.0, 0.0),    # 1 up
    (0.0, 0.0, -1.0),   # 2 north
    (0.0, 0.0, 1.0),    # 3 south
    (-1.0, 0.0, 0.0),   # 4 west
    (1.0, 0.0, 0.0),    # 5 east
]

FAIL = []
WARN = []


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


def gz_size(path):
    with open(path, 'rb') as fh:
        return len(gzip.compress(fh.read(), 6))


# ---------------------------------------------------------------- 状态串解析
def parse_state(s):
    s = s.strip()
    if '[' not in s:
        return s, {}
    name, rest = s.split('[', 1)
    rest = rest.rsplit(']', 1)[0]
    props = {}
    for part in rest.split(','):
        part = part.strip()
        if '=' in part:
            k, v = part.split('=', 1)
            props[k.strip()] = v.strip()
    return name.strip(), props


def vanilla_state_string(name, props):
    """原版 / litematic 的状态串：属性按字母序，值不加引号。"""
    if not props:
        return name
    return name + '[' + ','.join('%s=%s' % (k, props[k]) for k in sorted(props)) + ']'


def palette_entry_state(entry):
    """litematic palette 条目（NBT compound）-> 状态串。"""
    name = entry.get('Name') or entry.get('name') or ''
    props = entry.get('Properties') or entry.get('properties') or {}
    return vanilla_state_string(name, dict(props))


def when_match(when, props):
    """原版 blockstate 属性匹配：when 里的属性必须全部相等；未提及的属性不限。"""
    if not when:
        return True
    for k, v in when.items():
        if props.get(k) != v:
            return False
    return True


def resolve_models(defn, props):
    """返回 (model_ids, 说明)。"""
    kind = defn.get('kind')
    if kind == 'invisible':
        return [], 'invisible'
    if kind == 'variants':
        hit = [e for e in defn.get('variants') or [] if when_match(e.get('when'), props)]
        if hit:
            return [m for e in hit for m in (e.get('models') or [])], 'variants'
        if defn.get('default'):
            return list(defn['default']), 'default'
        return [], 'variants(no match)'
    if kind == 'multipart':
        out = []
        for p in defn.get('parts') or []:
            if when_match(p.get('when'), props):
                out.extend(p.get('models') or [])
        return out, 'multipart'
    return [], 'unknown kind %r' % (kind,)


# ---------------------------------------------------------------- fixture 读取
def region_size(region):
    sz = region.get('Size') or {}
    if isinstance(sz, dict):
        return (int(sz.get('x', 0)), int(sz.get('y', 0)), int(sz.get('z', 0)))
    return (int(sz[0]), int(sz[1]), int(sz[2]))


def bits_for(palette_size):
    """原版 litematic 位宽：max(2, 32 - clz(paletteSize - 1))，等价于 (n-1).bit_length() 且至少 2。"""
    n = max(1, int(palette_size))
    return max(2, (n - 1).bit_length())


def read_fixture(path):
    """返回 [(状态串, 实例数)]、region 数、block 总数。"""
    nbt = nbtref.load_litematic(path)
    if isinstance(nbt, dict) and 'value' in nbt and 'Regions' not in nbt:
        nbt = nbt['value']          # nbtref 返回 {'name':..., 'value': RootTag}
    regions = nbt.get('Regions') or {}
    stats = []
    total_blocks = 0
    for rname in sorted(regions):
        reg = regions[rname]
        palette = reg.get('BlockStatePalette') or []
        states = [palette_entry_state(e) for e in palette]
        sx, sy, sz = region_size(reg)
        vol = abs(sx) * abs(sy) * abs(sz)
        counts = collections.Counter()
        longs = reg.get('BlockStates')
        if longs:
            bits = bits_for(len(palette))
            values = nbtref.unpack_states(longs, bits, vol)
            bad = [v for v in values if v >= len(palette)]
            if bad:
                warn('%s:%s 有 %d 个 palette 越界索引（位宽 %d）'
                     % (os.path.basename(path), rname, len(bad), bits))
            counts.update(values)
        else:
            counts[0] = vol
        stat = []
        for i, st in enumerate(states):
            stat.append((st, counts.get(i, 0)))
        stats.append({'name': rname, 'states': stat, 'volume': vol,
                      'bits': bits_for(len(palette)) if longs else 0})
        total_blocks += sum(counts.values())
    return stats, len(regions), total_blocks


# ---------------------------------------------------------------- 几何自检
def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0])


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def norm(a):
    return dot(a, a) ** 0.5


def geometry_check(models, sample=30, seed=20251025):
    keys = sorted(models)
    random.seed(seed)
    picked = random.sample(keys, min(sample, len(keys)))
    bad_geom = 0
    bad_uv = 0
    bad_range = 0
    bad_norm = 0
    worst = []
    for mid in picked:
        for qi, q in enumerate(models[mid]['quads']):
            p = q['p']
            assert len(p) == 12, mid
            pts = [(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]) for i in range(4)]
            n = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]))
            area2 = norm(n)
            if area2 < 1e-9:
                bad_geom += 1
                worst.append((mid, qi, 'area=0'))
                continue
            nhat = (n[0] / area2, n[1] / area2, n[2] / area2)
            # 共面：第四点到平面距离
            dist = abs(dot(sub(pts[3], pts[0]), nhat))
            if dist > 1e-6:
                bad_geom += 1
                worst.append((mid, qi, 'coplanar dist=%.4g' % dist))
            # 法向与 n 字段一致（斜面取最大分量，故用 0.25 的宽松阈值）
            nd = dot(nhat, FACE_NORMAL[q['n']]) if 0 <= q['n'] < 6 else -1
            if nd < 0.25:
                bad_norm += 1
                worst.append((mid, qi, 'normal dot=%.3f n=%d' % (nd, q['n'])))
            for pt in pts:
                if min(pt) < -16.0 or max(pt) > 32.0:
                    bad_range += 1
                    worst.append((mid, qi, 'vertex %s' % (pt,)))
                    break
            uv = q['uv']
            if len(uv) != 8:
                bad_uv += 1
                continue
    if bad_geom or bad_norm or bad_range:
        for rec in worst[:10]:
            print('    几何异常 %s' % (rec,))
    return {'models': len(picked), 'badGeometry': bad_geom, 'badNormal': bad_norm,
            'badRange': bad_range}


# ---------------------------------------------------------------- 主流程
def main():
    print('=' * 78)
    print('mcviewer 资产验收  assets=%s' % ASSETS)
    print('=' * 78)

    manifest = load_json(os.path.join(ASSETS, 'manifest.json'))
    meta = load_json(os.path.join(ASSETS, 'meta.json'))
    blocks = load_json(os.path.join(ASSETS, 'blocks.json'))['blocks']
    models = load_json(os.path.join(ASSETS, 'models.json'))['models']
    lang = load_json(os.path.join(ASSETS, 'lang.json'))
    atlas_size = int(manifest['atlas']['size'])
    pad = int(manifest['atlas'].get('padding', 2))

    idx_path = os.path.join(HERE, '_work', 'atlas_index.json')
    atlas_index = None
    if os.path.exists(idx_path):
        obj = load_json(idx_path)
        atlas_index = obj.get('index') or {}
        atlas_size = int(obj.get('size') or atlas_size)
        pad = int(obj.get('padding') or pad)
        print('图集: %dx%d padding=%d 纹理 %d 张（_work/atlas_index.json 可用 -> 严格格内校验）'
              % (atlas_size, atlas_size, pad, len(atlas_index)))
    else:
        print('图集: %dx%d padding=%d（无 _work/atlas_index.json，仅做边界校验）'
              % (atlas_size, atlas_size, pad))

    quad_ids = sum(len(m.get('quads') or []) for m in models.values())
    print('资产: blocks=%d models=%d quads=%d lang=(zh_cn %d / en_us %d)'
          % (len(blocks), len(models), quad_ids,
             len(lang.get('zh_cn') or {}), len(lang.get('en_us') or {})))
    for fn in ('blocks.json', 'models.json', 'lang.json', 'atlas.png'):
        p = os.path.join(ASSETS, fn)
        print('   %-12s %10d B   gzip %9d B' % (fn, os.path.getsize(p), gz_size(p)))

    # ---- A. fixture 解析率 ----
    print('-' * 78)
    print('A. fixture palette 解析')
    files = sorted(glob.glob(os.path.join(FIXTURES, '*.litematic')))
    if not files:
        fail('tests/fixtures 下没有 .litematic 文件')
    grand_states = 0
    grand_ok = 0
    grand_instances = 0
    grand_bad_instances = 0
    grand_invisible = 0
    bad_uv_quads = 0
    bad_uv_samples = []
    lang_missing = collections.Counter()
    for path in files:
        base = os.path.basename(path)
        stats, nregions, total_blocks = read_fixture(path)
        seen = set()
        ok = 0
        bad = []
        used_blocks = set()
        invisible = []
        for reg in stats:
            for st, cnt in reg['states']:
                if st in seen:
                    continue
                seen.add(st)
                name, props = parse_state(st)
                if name == 'minecraft:air':
                    continue
                grand_states += 1
                grand_instances += cnt
                defn = blocks.get(name)
                if defn is None:
                    bad.append((st, cnt, 'block 不存在'))
                    continue
                ids, how = resolve_models(defn, props)
                if defn.get('kind') == 'invisible':
                    invisible.append(st)
                    continue
                if not ids:
                    bad.append((st, cnt, 'no model (%s)' % how))
                    continue
                problem = None
                for mid in ids:
                    m = models.get(mid)
                    if m is None:
                        problem = 'model 缺失: %s' % mid
                        break
                    qs = m.get('quads') or []
                    if not qs:
                        problem = 'model 无 quad: %s' % mid
                        break
                    for q in qs:
                        uv = q.get('uv') or []
                        if len(uv) != 8:
                            problem = 'uv 长度异常: %s' % mid
                            break
                        for i in range(4):
                            u, v = uv[i * 2], uv[i * 2 + 1]
                            if not (0.0 <= u <= atlas_size and 0.0 <= v <= atlas_size):
                                problem = 'uv 超出图集: %s (%.2f,%.2f)' % (mid, u, v)
                                break
                            cell = atlas_index.get(q.get('tex')) if atlas_index is not None else None
                            if cell is not None:
                                x, y, w, h = cell
                                if not (x - pad - 0.01 <= u <= x + w + pad + 0.01
                                        and y - pad - 0.01 <= v <= y + h + pad + 0.01):
                                    problem = 'uv 不在纹理格内: %s tex=%s uv=(%.2f,%.2f) cell=%s' % (
                                        mid, q.get('tex'), u, v, cell)
                                    bad_uv_quads += 1
                                    if len(bad_uv_samples) < 5:
                                        bad_uv_samples.append(problem)
                                    break
                        if problem:
                            break
                    if problem:
                        break
                if problem:
                    bad.append((st, cnt, problem))
                else:
                    ok += 1
                    used_blocks.add(name)
        slots = sum(1 for s in seen if not s.startswith('minecraft:air'))
        checked = slots - len(invisible)
        print('  %-42s regions=%d palette=%-4d 检查=%-4d 通过=%-4d 失败=%d'
              % (base, nregions, len(seen), checked, ok, len(bad)))
        if invisible:
            print('     不可见方块(按契约跳过几何)：%s' % ', '.join(sorted(invisible)))
        if bad:
            for st, cnt, why in bad:
                print('     [FAIL] %-56s x%-5d %s' % (st, cnt, why))
                grand_bad_instances += cnt
        grand_ok += ok
        grand_invisible += len(invisible)
        # 语言覆盖
        for name in sorted(used_blocks):
            k1 = 'block.' + name.split(':')[-1]
            k2 = 'block.' + name
            en = lang.get('en_us') or {}
            zh = lang.get('zh_cn') or {}
            if k1 not in en and k2 not in en:
                lang_missing['en_us:' + name] += 1
            if k1 not in zh and k2 not in zh:
                lang_missing['zh_cn:' + name] += 1

    print('  --------------------------------------------------------------')
    checked_states = grand_states - grand_invisible
    if grand_states:
        print('  合计: palette 状态 %d（其中 %d 个按契约 kind=invisible 无几何，跳过），'
              '检查 %d，通过 %d，失败 %d，解析率 %.2f%%'
              % (grand_states, grand_invisible, checked_states, grand_ok,
                 checked_states - grand_ok,
                 100.0 * grand_ok / checked_states if checked_states else 100.0))
    if bad_uv_quads:
        print('  uv 越界排查: %d 个 quad 的 uv 不在纹理格内（可能是 uv>16 的特殊模型）' % bad_uv_quads)
        for s in bad_uv_samples:
            print('     ' + s)
    if lang_missing:
        print('  语言缺口: %s' % ', '.join('%s(%d)' % kv for kv in sorted(lang_missing.items())[:12]))
    if grand_states and grand_ok < checked_states:
        fail('fixture palette 解析率 %.2f%% < 100%%'
             % (100.0 * grand_ok / checked_states if checked_states else 0.0))

    # ---- B. blocks.json -> models.json 反向一致性 ----
    print('-' * 78)
    print('B. blocks.json 引用的 model id 一致性')
    missing_ids = set()
    total_refs = 0
    for bname, defn in blocks.items():
        groups = []
        if defn.get('kind') == 'variants':
            groups.append(defn.get('variants') or [])
            if defn.get('default'):
                groups.append([{'models': defn['default']}])
        elif defn.get('kind') == 'multipart':
            groups.append(defn.get('parts') or [])
        for grp in groups:
            for e in grp:
                for mid in e.get('models') or []:
                    total_refs += 1
                    if mid not in models:
                        missing_ids.add((bname, mid))
    print('  引用 %d 个 model id，缺失 %d' % (total_refs, len(missing_ids)))
    for bname, mid in sorted(missing_ids)[:10]:
        print('     [FAIL] %s -> %s' % (bname, mid))
    if missing_ids:
        fail('blocks.json 引用了不存在的 model id: %d 处' % len(missing_ids))

    # 未被 blocks.json 引用的模型（仅统计，不算失败）
    used = set()
    for defn in blocks.values():
        for grp in ([defn.get('variants') or []] if defn.get('kind') == 'variants' else
                    ([defn.get('parts') or []] if defn.get('kind') == 'multipart' else [])):
            for e in grp:
                used.update(e.get('models') or [])
        used.update(defn.get('default') or [])
    print('  未被引用的模型: %d 个（多为 parent 模板/26.3 独有，属正常）' % len(set(models) - used))

    # ---- C. 几何自检 ----
    print('-' * 78)
    print('C. 几何自检（随机 30 个模型）')
    geom = geometry_check(models)
    print('  抽样 %d 个模型：非共面/退化 %d，法向不符 %d，顶点越界 %d'
          % (geom['models'], geom['badGeometry'], geom['badNormal'], geom['badRange']))
    if geom['badGeometry']:
        fail('存在 %d 个退化/非共面 quad' % geom['badGeometry'])
    if geom['badRange']:
        fail('存在 %d 个 quad 顶点超出 [-16,32]' % geom['badRange'])

    # ---- D. meta 自洽 ----
    print('-' * 78)
    print('D. meta / manifest 自洽')
    checks = [('quadCount', meta.get('quadCount'), quad_ids),
              ('modelCount', meta.get('modelCount'), len(models)),
              ('blockCount', meta.get('blockCount'), len(blocks))]
    for k, a, b in checks:
        if a is not None and int(a) != int(b):
            fail('meta.%s=%s 与实际 %s 不一致' % (k, a, b))
        else:
            print('   %-12s %s ok' % (k, b))
    print('   atlasUsage %s  missingBlocks=%s  missingTextures=%s'
          % (meta.get('atlasUsage'), len(meta.get('missingBlocks') or []),
             len(meta.get('missingTextures') or [])))
    for n in meta.get('notes') or []:
        print('   note: ' + n)

    # ---- 汇总 ----
    print('=' * 78)
    if FAIL:
        print('验收结果: 失败 %d 项 / 警告 %d 项' % (len(FAIL), len(WARN)))
        for f in FAIL:
            print('  - ' + f)
        return 1
    print('验收结果: 全部通过（警告 %d 项）' % len(WARN))
    return 0


if __name__ == '__main__':
    sys.exit(main())
