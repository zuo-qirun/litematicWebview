r"""从真实投影里找相邻双箱，判定 type=left/right 与东西/南北方位的对应关系。

用法: python tools\lead_qa\probe_chest_types2.py <file.litematic> [...]
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import nbtref  # noqa: E402

MASK = (1 << 64) - 1
TARGETS = ('minecraft:chest', 'minecraft:trapped_chest')


def unpack(props_tag):
    out = {}
    for k, v in props_tag.items():
        out[k] = v
    return out


def iter_chest_halves(path):
    root = nbtref.load_litematic(path)
    root = root['value'] if 'value' in root else root
    regions = root['Regions']
    halves = []
    for rname in regions:
        reg = regions[rname]
        pos = reg['Position']
        size = reg['Size']
        palette = []
        for p in reg['BlockStatePalette']:
            nm = p.get('Name', '')
            props = p.get('Properties') or {}
            palette.append((nm, props))
        sx, sy, sz = abs(size['x']), abs(size['y']), abs(size['z'])
        n = sx * sy * sz
        bits = max(2, (len(palette) - 1).bit_length())
        vals = nbtref.unpack_states([v & MASK for v in reg['BlockStates']], bits, n)
        minx = min(pos['x'], pos['x'] + size['x'] - (1 if size['x'] > 0 else -1))
        miny = min(pos['y'], pos['y'] + size['y'] - (1 if size['y'] > 0 else -1))
        minz = min(pos['z'], pos['z'] + size['z'] - (1 if size['z'] > 0 else -1))
        for y in range(sy):
            for z in range(sz):
                for x in range(sx):
                    k = vals[x + sx * z + sx * sz * y]
                    if k >= len(palette):
                        continue
                    nm, props = palette[k]
                    if nm in TARGETS and props.get('type') in ('left', 'right'):
                        halves.append({
                            'pos': (minx + x, miny + y, minz + z),
                            'block': nm,
                            'facing': props.get('facing'),
                            'type': props.get('type'),
                            'region': rname,
                        })
    return halves


def main(paths):
    total = 0
    for p in paths:
        try:
            halves = iter_chest_halves(p)
        except Exception as exc:  # noqa: BLE001
            print('!! %s: %s' % (os.path.basename(p), exc))
            continue
        print('== %s: %d 个半箱' % (os.path.basename(p), len(halves)))
        total += len(halves)
        index = {(h['pos'], h['block']): h for h in halves}
        for h in halves:
            for dx, dz, label in ((1, 0, '+X/east'), (-1, 0, '-X/west'),
                                  (0, 1, '+Z/south'), (0, -1, '-Z/north')):
                nb = index.get(((h['pos'][0] + dx, h['pos'][1], h['pos'][2] + dz), h['block']))
                if nb:
                    print('   %s facing=%s type=%-5s @%s -> 邻块 %s (type=%s)'
                          % (h['block'].split(':')[1], h['facing'], h['type'], h['pos'],
                             label, nb['type']))
                    break
    print('total halves: %d' % total)


if __name__ == '__main__':
    main(sys.argv[1:])
