r"""聚合统计：真实投影里双箱 left/right 两半的相对方位。

对每条 (type=left, type=right) 相邻对，记录 facing 与「left -> right」的位移向量，输出计数表。
"""
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import nbtref  # noqa: E402
from probe_chest_types2 import iter_chest_halves  # noqa: E402

DIRS = {(1, 0): 'east/+X', (-1, 0): 'west/-X', (0, 1): 'south/+Z', (0, -1): 'north/-Z'}


def build_index(halves):
    return {(h['pos'], h['block']): h for h in halves}


def main(paths):
    stats = Counter()
    samples = {}
    leftovers = Counter()
    for p in paths:
        try:
            halves = iter_chest_halves(p)
        except Exception as exc:  # noqa: BLE001
            print('!! %s: %s' % (os.path.basename(p), exc))
            continue
        index = build_index(halves)
        used = set()
        for h in halves:
            x, y, z = h['pos']
            for dx, dz in DIRS:
                nb = index.get(((x + dx, y, z + dz), h['block']))
                if not nb or nb['type'] == h['type'] or nb['facing'] != h['facing']:
                    continue
                key = (h['pos'], nb['pos'])
                if key in used or (key[1], key[0]) in used:
                    continue
                used.add(key)
                left, right = (h, nb) if h['type'] == 'left' else (nb, h)
                d = (right['pos'][0] - left['pos'][0], right['pos'][2] - left['pos'][2])
                label = DIRS.get(d, str(d))
                stats[(left['facing'], label)] += 1
                samples.setdefault((left['facing'], label), (os.path.basename(p), left['pos'], right['pos']))
            # 统计孤立半块（没有配对）
        for h in halves:
            x, y, z = h['pos']
            if not any(((x + dx, y, z + dz), h['block']) in index for dx, dz in DIRS):
                leftovers[h['type']] += 1
    print('=== (facing, left->right 方向) 计数 ===')
    for (facing, label), n in sorted(stats.items(), key=lambda kv: -kv[1]):
        print('  %-6s %-10s %5d   例: %s L%s R%s' % (facing, label, n, *samples[(facing, label)]))
    print('=== 孤立半块 ===', dict(leftovers))


if __name__ == '__main__':
    main(sys.argv[1:])
