"""Inspect litematic fixtures: metadata, block histogram, data versions."""
import collections
import glob
import gzip
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from nbtref import load_litematic, unpack_states  # noqa: E402


def region_blocks(rv):
    s = rv['Size']
    sx, sy, sz = s['x'], s['y'], s['z']
    pal = rv['BlockStatePalette']
    bits = max(1, (len(pal) - 1).bit_length()) if len(pal) > 1 else 1
    idx = unpack_states(rv['BlockStates'], bits, sx * sy * sz)
    return sx, sy, sz, pal, idx, bits


def main(root='tests/fixtures'):
    blocks = collections.Counter()
    summary = []
    versions = collections.Counter()
    for f in sorted(glob.glob(os.path.join(root, '*.litematic'))):
        root_nbt = load_litematic(f)['value']
        md = root_nbt['Metadata']
        versions[root_nbt.get('MinecraftDataVersion')] += 1
        total = 0
        names = set()
        for rn, rv in root_nbt['Regions'].items():
            sx, sy, sz, pal, idx, bits = region_blocks(rv)
            total += sum(1 for i in idx if i)
            for i, c in collections.Counter(idx).items():
                if i:
                    names.add(pal[i]['Name'])
                    blocks[pal[i]['Name']] += c
        summary.append(dict(file=os.path.basename(f),
                            formatVersion=root_nbt.get('Version'),
                            subVersion=root_nbt.get('SubVersion'),
                            dataVersion=root_nbt.get('MinecraftDataVersion'),
                            name=md.get('Name'), author=md.get('Author'),
                            metaBlocks=md.get('TotalBlocks'), counted=total,
                            uniqueBlocks=len(names)))
        print('%-46s v%s dv=%-5s meta=%-7s counted=%-7s uniq=%d' % (
            os.path.basename(f), root_nbt.get('Version'),
            root_nbt.get('MinecraftDataVersion'), md.get('TotalBlocks'),
            total, len(names)))

    print('\n=== data versions:', dict(versions))
    print('=== distinct block ids:', len(blocks))
    print('=== top 30 ===')
    for n, c in blocks.most_common(30):
        print('%9d  %s' % (c, n))

    # missing-vanilla check happens in the bake tool; here just dump the list
    names = sorted(blocks)
    json.dump({'summary': summary, 'blocks': dict(blocks), 'names': names},
              open(os.path.join(root, '_fixture_blocks.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    print('\nwrote', os.path.join(root, '_fixture_blocks.json'))


if __name__ == '__main__':
    main(*sys.argv[1:])
