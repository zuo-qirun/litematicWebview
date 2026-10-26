"""在真实投影里找双箱（type=left/right），反推 left/right 与「东/西」的对应关系。"""
import glob
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from nbtref import load_litematic  # noqa: E402

M64 = (1 << 64) - 1


def iter_states(root):
    for _name, reg in root['value']['Regions'].items():
        p = reg['Position']           # {'x','y','z'}
        s = reg['Size']
        sx, sy, sz = abs(s['x']), abs(s['y']), abs(s['z'])
        mn = [p['x'] if s['x'] >= 0 else p['x'] + s['x'] + 1,
              p['y'] if s['y'] >= 0 else p['y'] + s['y'] + 1,
              p['z'] if s['z'] >= 0 else p['z'] + s['z'] + 1]
        pal = [d['Name'] if isinstance(d, dict) else d for d in reg['BlockStatePalette']]
        longs = [v & M64 for v in reg['BlockStates']]
        bits = max(2, (len(pal) - 1).bit_length())
        mask = (1 << bits) - 1
        for y in range(sy):
            for z in range(sz):
                for x in range(sx):
                    i = x + sx * z + sx * sz * y
                    off = i * bits
                    li = off >> 6
                    bo = off & 63
                    got = (longs[li] >> bo) & mask
                    if bo + bits > 64:
                        got |= (longs[li + 1] << (64 - bo)) & mask
                    st = pal[got]
                    if 'chest' in st:
                        yield (mn[0] + x, mn[1] + y, mn[2] + z), st


def main():
    hits = 0
    for f in sorted(glob.glob('tests/fixtures/*.litematic')):
        table = dict(iter_states(load_litematic(f)))
        for (x, y, z), st in table.items():
            if 'type=left' not in st and 'type=right' not in st:
                continue
            facing = st.split('facing=')[1].split(',')[0].split(']')[0]
            me = 'left' if 'type=left' in st else 'right'
            for dx, dz in ((1, 0), (0, 1)):
                nb = table.get((x + dx, y, z + dz))
                if not nb or 'chest' not in nb:
                    continue
                if ('type=left' in nb) == (me == 'left'):
                    continue
                f2 = nb.split('facing=')[1].split(',')[0].split(']')[0]
                if f2 != facing:
                    continue
                other = 'left' if 'type=left' in nb else 'right'
                print('%-26s facing=%-5s me=%-5s @(%d,%d,%d) other=%-5s @%+d,%+d' % (
                    os.path.basename(f)[:26], facing, me, x, y, z, other, dx, dz))
                hits += 1
                if hits >= 12:
                    return
    print('hits', hits)


main()
