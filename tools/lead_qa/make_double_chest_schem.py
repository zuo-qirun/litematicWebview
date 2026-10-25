"""Lead 独立 QA：合成「单箱 / 双箱（left+right 成对）」共存的 .litematic。

用法：python tools/lead_qa/make_double_chest_schem.py [--out tests/_synthetic/double-chest.litematic]

布局（在 y=0 平面，X 向右、Z 向远）：
  (0,0) chest[facing=north,type=single]
  (1,0) trapped_chest[facing=north,type=single]
  (2,0) ender_chest[facing=north]
  北向双箱：西侧 (3,0)=type=right，东侧 (4,0)=type=left
  东向双箱：北侧 (6,2)=type=right，南侧 (6,3)=type=left
  (8,0) chest[facing=east,type=single]

判定要点：双箱两块之间不能有缝、锁扣要各在中轴两侧、整体宽度 30px。
"""
import argparse
import gzip
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from nbtref import W, pack_states  # noqa: E402
from make_chest_schem import state_key, palette_tag, required_bits, AIR, state  # noqa: E402


def build(cells, out_path, *, name='Double Chest QA', region_name='chests'):
    """cells: {(x, z): (block_name, props)}，y 方向只有 0 一层；未给出的格子填空气。"""
    xs = [c[0] for c in cells]
    zs = [c[1] for c in cells]
    x0, x1, z0, z1 = min(xs), max(xs), min(zs), max(zs)
    sx, sz = x1 - x0 + 1, z1 - z0 + 1

    grid = []
    for z in range(z0, z1 + 1):
        for x in range(x0, x1 + 1):
            grid.append(cells.get((x, z), state(AIR)))

    palette, index_of = [], {}
    for entry in grid:
        key = state_key(entry)
        if key not in index_of:
            index_of[key] = len(palette)
            palette.append(entry)
    bits = required_bits(len(palette))
    longs = pack_states([index_of[state_key(e)] for e in grid], bits)

    # Position 用最小角，Size 全正，避免负 size 干扰肉眼判断
    region = {
        'Position': (10, {'x': (3, x0), 'y': (3, 0), 'z': (3, z0)}),
        'Size': (10, {'x': (3, sx), 'y': (3, 1), 'z': (3, sz)}),
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
            'Description': (8, 'single vs double chest QA'),
            'EnclosingSize': (10, {'x': (3, sx), 'y': (3, 1), 'z': (3, sz)}),
            'RegionCount': (3, 1),
            'TotalVolume': (3, sx * sz),
            'TotalBlocks': (3, len(grid)),
            'TimeCreated': (4, 0),
            'TimeModified': (4, 0),
        }),
        'Regions': (10, {region_name: (10, region)}),
    }
    data = gzip.compress(W().root('', root), 9)
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, 'wb') as f:
        f.write(data)
    print('wrote %s (%d bytes) size=%dx1x%d palette=%d bits=%d longs=%d'
          % (out_path, len(data), sx, sz, len(palette), bits, len(longs)))
    for i, (nm, props) in enumerate(palette):
        print('  [%d] %s' % (i, state_key((nm, props))))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(
        os.path.dirname(os.path.abspath(__file__)), '..', '..', 'tests', '_synthetic',
        'double-chest.litematic'))
    args = ap.parse_args()

    def chest(face, typ):
        return state('minecraft:chest',
                     {'facing': face, 'type': typ, 'waterlogged': 'false'})

    cells = {
        (0, 0): chest('north', 'single'),
        (1, 0): state('minecraft:trapped_chest',
                      {'facing': 'north', 'type': 'single', 'waterlogged': 'false'}),
        (2, 0): state('minecraft:ender_chest',
                      {'facing': 'north', 'waterlogged': 'false'}),
        # 北向双箱：facing=north 时 left 在东侧（+X）
        (3, 0): chest('north', 'right'),
        (4, 0): chest('north', 'left'),
        # 东向双箱：facing=east 时 left 在南侧（+Z）
        (6, 2): chest('east', 'right'),
        (6, 3): chest('east', 'left'),
        (8, 0): chest('east', 'single'),
    }
    build(cells, args.out)


if __name__ == '__main__':
    main()
