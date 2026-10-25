"""Lead 独立 QA：合成一个只含箱子家族的小 .litematic，用于肉眼验证实体模型几何。

用法：python tools/lead_qa/make_chest_schem.py [--out tests/_synthetic/chest-qa.litematic]

布局（5x1x1，前方朝 +Z，方便等距视角一眼看全）：
  x=0 chest[facing=north]   x=1 trapped_chest   x=2 ender_chest
  x=3 barrel                x=4 chest[facing=east]
"""
import argparse
import gzip
import os
import struct
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from nbtref import W, pack_states  # noqa: E402

AIR = 'minecraft:air'


def state(name, props=None):
    return (name, props or {})


def state_key(entry):
    name, props = entry
    if not props:
        return name
    inner = ','.join('%s=%s' % (k, props[k]) for k in sorted(props))
    return '%s[%s]' % (name, inner)


def palette_tag(palette):
    items = []
    for name, props in palette:
        comp = {'Name': (8, name)}
        if props:
            comp['Properties'] = (10, {k: (8, v) for k, v in props.items()})
        items.append(comp)
    return (10, items)


def required_bits(palette_size):
    if palette_size <= 1:
        return 2
    bits = (palette_size - 1).bit_length()
    return max(2, bits)


def build(rows, out_path, *, name='Chest QA', description='synthetic chest family showcase', region_name='chests'):
    palette = []
    index_of = {}
    for name, props in rows:
        key = state_key((name, props))
        if key not in index_of:
            index_of[key] = len(palette)
            palette.append((name, props))
    bits = required_bits(len(palette))
    values = [index_of[state_key(r)] for r in rows]
    longs = pack_states(values, bits)

    size_x, size_y, size_z = len(rows), 1, 1
    region = {
        'Position': (10, {'x': (3, 0), 'y': (3, 0), 'z': (3, 0)}),
        'Size': (10, {'x': (3, size_x), 'y': (3, size_y), 'z': (3, size_z)}),
        'BlockStatePalette': (9, palette_tag(palette)),
        'BlockStates': (12, longs),
        'TileEntities': (9, (10, [])),
        'Entities': (9, (10, [])),
        'PendingBlockTicks': (9, (10, [])),
        'PendingFluidTicks': (9, (10, [])),
    }
    root = {
        'Version': (3, 7),
        'SubVersion': (10, {'major': (3, 0), 'minor': (3, 1)}),
        'MinecraftDataVersion': (3, 3955),
        'Metadata': (10, {
            'Name': (8, name),
            'Author': (8, 'lead'),
            'Description': (8, description),
            'EnclosingSize': (10, {'x': (3, size_x), 'y': (3, size_y), 'z': (3, size_z)}),
            'RegionCount': (3, 1),
            'TotalVolume': (3, size_x * size_y * size_z),
            'TotalBlocks': (3, len(rows)),
            'TimeCreated': (4, 0),
            'TimeModified': (4, 0),
        }),
        'Regions': (10, {region_name: (10, region)}),
    }
    data = gzip.compress(W().root('', root), 9)
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, 'wb') as f:
        f.write(data)
    print('wrote %s (%d bytes), palette=%d bits=%d longs=%d' % (
        out_path, len(data), len(palette), bits, len(longs)))
    for i, (name, props) in enumerate(palette):
        print('  [%d] %s' % (i, state_key((name, props))))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(
        os.path.dirname(os.path.abspath(__file__)), '..', '..', 'tests', '_synthetic', 'chest-qa.litematic'))
    args = ap.parse_args()
    north = {'facing': 'north', 'type': 'single', 'waterlogged': 'false'}
    east = {'facing': 'east', 'type': 'single', 'waterlogged': 'false'}
    rows = [
        state(AIR),
        state('minecraft:chest', north),
        state('minecraft:trapped_chest', north),
        state('minecraft:ender_chest', north),
        state('minecraft:barrel', {'facing': 'north', 'open': 'false'}),
        state('minecraft:chest', east),
        state(AIR),
    ]
    build(rows, args.out)


if __name__ == '__main__':
    main()
