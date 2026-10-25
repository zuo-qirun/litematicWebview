"""Ground truth for parser tests: independent (Python) implementation of the
litematic reader per docs/CONTRACT.md, emitting tests/parser/expected.json."""
import gzip
import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from nbtref import read_nbt  # noqa: E402

ROOT = os.path.dirname(HERE)
FIXTURES = os.path.join(ROOT, 'tests', 'fixtures')
OUT = os.path.join(ROOT, 'tests', 'parser', 'expected.json')


def clz32(v):
    if v == 0:
        return 32
    n = 0
    for i in range(31, -1, -1):
        if v & (1 << i):
            break
        n += 1
    return n


def required_bits(palette_size):
    return max(2, 32 - clz32(palette_size - 1))


def unpack(longs, bits, count):
    if bits <= 0 or count == 0:
        return [0] * count
    mask = (1 << bits) - 1
    out = [0] * count
    mask64 = (1 << 64) - 1
    for i in range(count):
        bitpos = i * bits
        a = bitpos >> 6
        off = bitpos & 63
        v = (longs[a] & mask64) >> off
        if off + bits > 64:
            v |= (longs[a + 1] & mask64) << (64 - off)
        out[i] = v & mask
    return out


def palette_key(entry):
    name = entry.get('Name', 'minecraft:air')
    props = entry.get('Properties') or {}
    if not props:
        return name
    inner = ','.join('%s=%s' % (k, props[k]) for k in sorted(props))
    return '%s[%s]' % (name, inner)


def min_corner(pos, size):
    out = []
    for p, s in zip((pos['x'], pos['y'], pos['z']), (size['x'], size['y'], size['z'])):
        sign = (s > 0) - (s < 0)
        end = p + s - sign
        out.append(min(p, end))
    return out


def describe(path):
    with gzip.open(path, 'rb') as f:
        root = read_nbt(f.read())['value']
    regions_in = root.get('Regions') or {}
    data_version = root.get('MinecraftDataVersion', 0)
    out_regions = []
    tot_blocks = 0
    tot_nonair = 0
    tot_volume = 0
    palette_counts = {}
    min_all = [None, None, None]
    max_all = [None, None, None]
    for name, r in regions_in.items():
        pos = r.get('Position')
        size = r.get('Size')
        if pos is None or size is None:
            continue
        pal = r.get('BlockStatePalette') or []
        pal_keys = [palette_key(p) for p in pal]
        longs = r.get('BlockStates') or []
        sx, sy, sz = abs(size['x']), abs(size['y']), abs(size['z'])
        volume = sx * sy * sz
        bits = required_bits(len(pal_keys))
        idx = unpack(list(longs), bits, volume) if volume else []
        nonair = 0
        zero = 0
        for v in idx:
            if v == 0 or pal_keys[v] == 'minecraft:air':
                zero += 1
            else:
                nonair += 1
        mc = min_corner(pos, size)
        mx = [mc[i] + (sx, sy, sz)[i] for i in range(3)]
        for i in range(3):
            min_all[i] = mc[i] if min_all[i] is None else min(min_all[i], mc[i])
            max_all[i] = mx[i] if max_all[i] is None else max(max_all[i], mx[i])
        be = r.get('TileEntities') or []
        en = r.get('Entities') or []
        tk = (r.get('PendingBlockTicks') or []) + (r.get('PendingFluidTicks') or [])
        # block counts per palette entry (skip air)
        for v in idx:
            k = pal_keys[v]
            if k != 'minecraft:air':
                palette_counts[k] = palette_counts.get(k, 0) + 1
        tot_volume += volume
        tot_blocks += volume
        tot_nonair += nonair
        out_regions.append({
            'name': name,
            'position': [pos['x'], pos['y'], pos['z']],
            'size': [size['x'], size['y'], size['z']],
            'absSize': [sx, sy, sz],
            'min': mc,
            'max': mx,
            'volume': volume,
            'bits': bits,
            'paletteSize': len(pal_keys),
            'blockCount': nonair,
            'airCount': zero,
            'blockEntityCount': len(be),
            'entityCount': len(en),
            'tickCount': len(tk),
            'longCount': len(longs),
            'dataVersion': r.get('DataVersion', data_version),
        })
    size_all = [max_all[i] - min_all[i] for i in range(3)]
    top = sorted(palette_counts.items(), key=lambda kv: -kv[1])
    return {
        'fileName': os.path.basename(path),
        'fileSize': os.path.getsize(path),
        'version': root.get('Version'),
        'subVersion': root.get('SubVersion'),
        'dataVersion': data_version,
        'regionCount': len(out_regions),
        'volume': tot_volume,
        'blockCount': tot_nonair,
        'blockEntityCount': sum(r['blockEntityCount'] for r in out_regions),
        'entityCount': sum(r['entityCount'] for r in out_regions),
        'tickCount': sum(r['tickCount'] for r in out_regions),
        'min': min_all,
        'max': max_all,
        'size': size_all,
        'paletteSize': len(palette_counts),
        'paletteTop': [{'id': k, 'count': v} for k, v in top[:40]],
        'regions': out_regions,
    }


def main():
    files = sorted(glob.glob(os.path.join(FIXTURES, '*.litematic')))
    result = {'note': 'generated by tools/truth.py (independent python oracle)', 'files': []}
    for p in files:
        d = describe(p)
        print('%-46s regions=%-3d blocks=%-7d vol=%-8d be=%-5d ent=%-4d size=%s pal=%d' % (
            os.path.basename(p), d['regionCount'], d['blockCount'], d['volume'],
            d['blockEntityCount'], d['entityCount'], d['size'], d['paletteSize']))
        result['files'].append(d)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=1)
    print('wrote', OUT)


if __name__ == '__main__':
    main()
