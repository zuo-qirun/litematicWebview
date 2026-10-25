"""QA：合成一个小型「地形马赛克」.litematic，用来肉眼验证材质包覆盖是否在渲染里生效。

用法（在仓库根目录）：
    python tools/qa/make_terrain_schem.py [--out tests/_pack_out/terrain-qa.litematic]

布局：8x2x8（x/y/z）。y=0 全是泥土；y=1 是 9 种常用建材的马赛克地板。
等距视角下能同时看到 顶面（top 纹理）+ 侧面（side 纹理），方便检查：
  * 材质包覆盖后颜色/亮度是否真的变化；
  * 相邻方块之间是否出现裂缝 / 洋红（缺失纹理）；
  * 32x32 高清纹理被缩放到 16x16 后是否仍可辨认。
"""
import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
from nbtref import W, pack_states  # noqa: E402

AIR = 'minecraft:air'

# 这些方块都在 tests/packs/eye-care-1.21.2.zip 的覆盖列表里（glass 作为「未覆盖」对照）
MATERIALS = [
    ('minecraft:stone', {}),
    ('minecraft:dirt', {}),
    ('minecraft:grass_block', {'snowy': 'false'}),
    ('minecraft:sand', {}),
    ('minecraft:oak_planks', {}),
    ('minecraft:obsidian', {}),
    ('minecraft:snow_block', {}),
    ('minecraft:white_concrete', {}),
    ('minecraft:black_stained_glass', {}),
    ('minecraft:glass', {}),
]


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


def required_bits(n):
    if n <= 1:
        return 2
    return max(2, (n - 1).bit_length())


def build_grid(sx, sy, sz, cell_at, out_path, *, name, description, region_name='terrain'):
    """cell_at(x, y, z) -> (name, props) 或 None（air）。"""
    palette = []
    index_of = {}
    values = []
    # Litematica 下标顺序：x 最快，其次 z，最后 y
    for y in range(sy):
        for z in range(sz):
            for x in range(sx):
                entry = cell_at(x, y, z)
                if entry is None:
                    entry = (AIR, {})
                key = state_key(entry)
                if key not in index_of:
                    index_of[key] = len(palette)
                    palette.append(entry)
                values.append(index_of[key])
    bits = required_bits(len(palette))
    longs = pack_states(values, bits)
    region = {
        'Position': (10, {'x': (3, 0), 'y': (3, 0), 'z': (3, 0)}),
        'Size': (10, {'x': (3, sx), 'y': (3, sy), 'z': (3, sz)}),
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
            'Author': (8, 'qa'),
            'Description': (8, description),
            'EnclosingSize': (10, {'x': (3, sx), 'y': (3, sy), 'z': (3, sz)}),
            'RegionCount': (3, 1),
            'TotalVolume': (3, sx * sy * sz),
            'TotalBlocks': (3, sum(1 for v in values if palette[v][0] != AIR)),
            'TimeCreated': (4, 0),
            'TimeModified': (4, 0),
        }),
        'Regions': (10, {region_name: (10, region)}),
    }
    data = __import__('gzip').compress(W().root('', root), 9)
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, 'wb') as fh:
        fh.write(data)
    print('wrote %s (%d bytes), palette=%d bits=%d longs=%d' % (
        out_path, len(data), len(palette), bits, len(longs)))
    for i, (name_, props) in enumerate(palette):
        print('  [%d] %s' % (i, state_key((name_, props))))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(
        os.path.dirname(HERE), '..', 'tests', '_pack_out', 'terrain-qa.litematic'))
    args = ap.parse_args()

    n = len(MATERIALS)

    def cell_at(x, y, z):
        if y == 0:
            return ('minecraft:dirt', {})
        if y == 1:
            return MATERIALS[(x * 3 + z * 5) % n]
        return None

    build_grid(8, 2, 8, cell_at, args.out,
               name='Terrain QA',
               description='材质包覆盖验证：石头/泥土/草/沙/木板/黑曜石/雪/白混凝土/黑玻璃 + 玻璃对照')


if __name__ == '__main__':
    main()
