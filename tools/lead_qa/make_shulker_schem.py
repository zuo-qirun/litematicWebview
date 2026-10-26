#!/usr/bin/env python3
"""生成潜影盒 QA 用的合成 litematic。

布局（x 向右、z 向里）：
  第一行：17 个潜影盒（默认 + 16 色），facing=north
  第二行：程序性朝向（east/south/west）与原色、以及两个叠放

用法：python tools/lead_qa/make_shulker_schem.py
输出：tests/_synthetic/shulker-qa.litematic
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from make_double_chest_schem import build  # noqa: E402

OUT = Path(__file__).resolve().parents[2] / "tests" / "_synthetic" / "shulker-qa.litematic"

COLORS = [
    "shulker_box",
    "white_shulker_box",
    "orange_shulker_box",
    "magenta_shulker_box",
    "light_blue_shulker_box",
    "yellow_shulker_box",
    "lime_shulker_box",
    "pink_shulker_box",
    "gray_shulker_box",
    "light_gray_shulker_box",
    "cyan_shulker_box",
    "purple_shulker_box",
    "blue_shulker_box",
    "brown_shulker_box",
    "green_shulker_box",
    "red_shulker_box",
    "black_shulker_box",
]


def shulker(color: str, facing: str = "north"):
    return (f"minecraft:{color}", {"facing": facing})


def main() -> int:
    cells = {}
    # 第一行：17 个颜色，facing=north
    for x, color in enumerate(COLORS):
        cells[(x, 0)] = shulker(color, "north")

    # 第二行：朝向测试（同色不同 facing）
    for x, facing in enumerate(("north", "east", "south", "west")):
        cells[(x, 2)] = shulker("purple_shulker_box", facing)
    # 六边形环：朝向 + 颜色交叉
    cells[(6, 2)] = shulker("red_shulker_box", "east")
    cells[(7, 2)] = shulker("lime_shulker_box", "south")
    cells[(8, 2)] = shulker("cyan_shulker_box", "west")
    # 上下叠放 + 地面
    cells[(10, 2)] = shulker("orange_shulker_box", "north")
    cells[(10, 3)] = shulker("yellow_shulker_box", "north")

    build(cells, OUT, name="Shulker Box QA", region_name="shulkers")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
