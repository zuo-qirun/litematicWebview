"""Debug: compare region geometry/packing across fixtures."""
import glob
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from nbtref import load_litematic, unpack_states  # noqa: E402


def main(root='tests/fixtures'):
    for f in sorted(glob.glob(os.path.join(root, '*.litematic'))):
        print('=' * 90)
        print(os.path.basename(f))
        root_nbt = load_litematic(f)['value']
        md = root_nbt['Metadata']
        print('  meta TotalBlocks', md.get('TotalBlocks'), 'EnclosingSize', md.get('EnclosingSize'))
        for rn, rv in root_nbt['Regions'].items():
            s = rv['Size']
            p = rv['Position']
            pal = rv['BlockStatePalette']
            arr = rv['BlockStates']
            n = s['x'] * s['y'] * s['z']
            bits = max(1, (len(pal) - 1).bit_length()) if len(pal) > 1 else 1
            print('  region %r pos=%s size=%s pal=%d bits=%d n=%d longs=%d contiguous_needed=%d padded_needed=%d'
                  % (rn, p, s, len(pal), bits, n, len(arr),
                     (n * bits + 63) // 64, n * ((bits + 63) // 64)))
            if arr and len(pal) > 1 and n > 0 and abs(n) < 5_000_000:
                contig = unpack_states(arr, bits, abs(n))
                c1 = sum(1 for v in contig if v)
                padded = []
                per = 64 // bits
                for i in range(abs(n)):
                    if i // per >= len(arr):
                        break
                    w = arr[i // per]
                    off = (i % per) * bits
                    padded.append((w >> off) & ((1 << bits) - 1))
                c2 = sum(1 for v in padded if v)
                if len(padded) < abs(n):
                    print('    (padded decode truncated: per-long padding needs %d longs, have %d)'
                          % ((abs(n) * bits + 63) // 64 * 1, len(arr)))
                print('    contiguous non-air=%d  padded non-air=%d (palette max %d)' % (c1, c2, len(pal) - 1))
                # sample first 20 values
                print('    first20 contig', contig[:20])
                print('    first20 padded', padded[:20])
                # out-of-range?
                bad = sum(1 for v in contig if v >= len(pal))
                print('    contig out-of-range', bad)


if __name__ == '__main__':
    main(*sys.argv[1:])
