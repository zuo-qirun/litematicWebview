"""Lead 独立 QA：合成一个只含石头的 .litematic，用来肉眼验证「材质包覆盖贴图」是否真的生效。

用法：python tools/lead_qa/make_stone_schem.py [--out tests/_synthetic/stone-qa.litematic]

布局 4x1x2：石头 + 平滑石头各一列，材质包把 stone.png 改成纯红后应出现明显对比。
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_chest_schem import build, state  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(
        os.path.dirname(os.path.abspath(__file__)), '..', '..', 'tests', '_synthetic', 'stone-qa.litematic'))
    args = ap.parse_args()
    rows = [
        state('minecraft:stone'),
        state('minecraft:stone'),
        state('minecraft:smooth_stone'),
        state('minecraft:smooth_stone'),
        state('minecraft:stone'),
        state('minecraft:stone'),
        state('minecraft:smooth_stone'),
        state('minecraft:smooth_stone'),
    ]
    # build() 只做 x 方向排列，这里把一维行数当作 8x1x1 使用，视觉上足够分辨
    build(rows, args.out, name='Stone QA', description='材质包覆盖贴图验证用（石头 / 平滑石头）', region_name='stone')


if __name__ == '__main__':
    main()
