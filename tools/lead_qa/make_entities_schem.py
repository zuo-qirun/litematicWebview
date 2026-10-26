# -*- coding: utf-8 -*-
r"""合成一个带实体（生物 / 载具 / 展示框）的 .litematic，用来验收实体图标层。

用法：python tools/lead_qa/make_entities_schem.py [--out tests/_synthetic/entities-qa.litematic]
"""
import argparse
import gzip
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from nbtref import W, pack_states  # noqa: E402
from make_chest_schem import state, state_key, palette_tag, required_bits  # noqa: E402

AIR = 'minecraft:air'
FLOOR = ('minecraft:smooth_stone', {})

# (实体 id, 摆放的格子 x 偏移)
ENTITIES = [
    ('minecraft:pig', 0),
    ('minecraft:cow', 1),
    ('minecraft:sheep', 2),
    ('minecraft:chicken', 3),
    ('minecraft:zombie', 4),
    ('minecraft:skeleton', 5),
    ('minecraft:creeper', 6),
    ('minecraft:villager', 7),
    ('minecraft:iron_golem', 8),
    ('minecraft:hopper_minecart', 0),
    ('minecraft:wolf', 1),
    ('minecraft:bee', 2),
    ('minecraft:shulker', 3),
    ('minecraft:allay', 4),
]


def build(out_path, size_x=9, size_z=7):
    rows = []
    for _z in range(size_z):
        for _x in range(size_x):
            rows.append(FLOOR)
    palette, index_of = [], {}
    for entry in rows:
        key = state_key(entry)
        if key not in index_of:
            index_of[key] = len(palette)
            palette.append(entry)
    values = [index_of[state_key(r)] for r in rows]
    bits = required_bits(len(palette))
    longs = pack_states(values, bits)

    entities = []
    for i, (eid, xo) in enumerate(ENTITIES):
        z = 2 if i < 9 else 4
        entities.append({
            'id': (8, eid),
            'Pos': (9, (6, [float(xo) + 0.5, 1.0, float(z) + 0.5])),
        })

    region = {
        'Position': (10, {'x': (3, 0), 'y': (3, 0), 'z': (3, 0)}),
        'Size': (10, {'x': (3, size_x), 'y': (3, 1), 'z': (3, size_z)}),
        'BlockStatePalette': (9, palette_tag(palette)),
        'BlockStates': (12, longs),
        'TileEntities': (9, (10, [])),
        'Entities': (9, (10, entities)),
        'PendingBlockTicks': (9, (10, [])),
        'PendingFluidTicks': (9, (10, [])),
    }
    root = {
        'Version': (3, 7),
        'SubVersion': (10, {'major': (3, 0), 'minor': (3, 1)}),
        'MinecraftDataVersion': (3, 3955),
        'Metadata': (10, {
            'Name': (8, 'Entities QA'),
            'Author': (8, 'lead'),
            'Description': (8, 'synthetic entity icon showcase'),
            'EnclosingSize': (10, {'x': (3, size_x), 'y': (3, 1), 'z': (3, size_z)}),
            'RegionCount': (3, 1),
            'TotalVolume': (3, size_x * size_z),
            'TotalBlocks': (3, len(rows)),
            'TimeCreated': (4, 0),
            'TimeModified': (4, 0),
        }),
        'Regions': (10, {'entities': (10, region)}),
    }
    data = gzip.compress(W().root('', root), 9)
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, 'wb') as f:
        f.write(data)
    print('wrote %s (%d bytes) entities=%d' % (out_path, len(data), len(entities)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(
        os.path.dirname(os.path.abspath(__file__)), '..', '..', 'tests', '_synthetic', 'entities-qa.litematic'))
    args = ap.parse_args()
    build(args.out)


if __name__ == '__main__':
    main()
