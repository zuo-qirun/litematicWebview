"""Lead 独立 QA：合成流体样本（水位阶梯 / 岩浆 / 气泡柱 / 含水方块）。

用法：python tools/lead_qa/make_fluid_schem.py [--out tests/_synthetic/fluid-qa.litematic]

布局（y=0 层，X 向右、Z 向远）：
  z=0  water[level=0..3]  —— 从满格(8/9)到矮水，验证高度按 level 递减
  z=1  water[level=4..7]
  z=2  lava[level=0] / lava[level=3] / water[level=8]（下落水柱，整格）/ bubble_column
  z=3  waterlogged 台阶 + waterlogged 树叶 + water[level=0] 上方再叠一格水
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_double_chest_schem import build  # noqa: E402
from make_chest_schem import state  # noqa: E402


def water(level):
    return state("minecraft:water", {"level": str(level)})


def lava(level):
    return state("minecraft:lava", {"level": str(level)})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "..", "tests", "_synthetic",
        "fluid-qa.litematic"))
    args = ap.parse_args()

    cells = {}
    for lv in range(4):
        cells[(lv, 0)] = water(lv)
    for lv in range(4, 8):
        cells[(lv - 4, 1)] = water(lv)
    cells[(0, 2)] = lava(0)
    cells[(1, 2)] = lava(3)
    cells[(2, 2)] = water(8)          # 下落水柱 → 整格
    cells[(3, 2)] = state("minecraft:bubble_column", {"drag": "true"})
    cells[(0, 3)] = state("minecraft:quartz_slab",
                          {"type": "bottom", "waterlogged": "true"})
    cells[(1, 3)] = state("minecraft:oak_leaves",
                          {"distance": "1", "persistent": "false", "waterlogged": "true"})
    cells[(2, 3)] = state("minecraft:sea_lantern")   # 参照：不透水方块
    cells[(3, 3)] = water(0)
    build(cells, args.out, name="Fluid QA", region_name="fluids")


if __name__ == "__main__":
    main()
