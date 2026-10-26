#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""把客户端 jar 里的实体贴图裁成小头像，拼成 assets/entity-icons.png + .json。

为什么需要：投影里只有实体 id 与坐标，没有实体几何；原来渲染器只能画「名字标签」。
这里从原版贴图裁出每个实体的「脸」（或能代表它的那一小块），拼进一张小图集，
前端用 Sprite + texture.clone() 的 offset/repeat 取用，观感比纯文字好得多。

用法：
    python tools/bake/post_entity_icons.py            # 用默认 jar 列表
    python tools/bake/post_entity_icons.py --jars _dl/client-1.21.1.jar,_dl/client-26.3.jar
退出码：0 成功；1 失败。
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys
import zipfile

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ASSETS = os.path.join(ROOT, "assets")
DEFAULT_JARS = ["_dl/client-1.21.1.jar", "_dl/client-26.3.jar"]

# (实体 id, 贴图相对路径(不含 assets/minecraft/), x, y, w, h)
# 坐标是原版贴图里的像素矩形；绝大多数「头」都在 texOffs(0,0)，脸在 (w, h) 处。
HUMANOID = (8, 8, 8, 8)          # 8x8x8 头，正面脸
QUADRUPED = (6, 6, 8, 8)         # 8x8x6 头（w=8,h=8,d=6），正面在 (d,d)
ICONS: list[tuple[str, str, tuple[int, int, int, int]]] = [
    # ---- 人形 ----
    ("minecraft:zombie", "textures/entity/zombie/zombie.png", HUMANOID),
    ("minecraft:husk", "textures/entity/zombie/husk.png", HUMANOID),
    ("minecraft:drowned", "textures/entity/zombie/drowned.png", HUMANOID),
    ("minecraft:zombie_villager", "textures/entity/zombie_villager/zombie_villager.png", HUMANOID),
    ("minecraft:zombified_piglin", "textures/entity/piglin/zombified_piglin.png", HUMANOID),
    ("minecraft:skeleton", "textures/entity/skeleton/skeleton.png", HUMANOID),
    ("minecraft:wither_skeleton", "textures/entity/skeleton/wither_skeleton.png", HUMANOID),
    ("minecraft:stray", "textures/entity/skeleton/stray.png", HUMANOID),
    ("minecraft:bogged", "textures/entity/skeleton/bogged.png", HUMANOID),
    ("minecraft:villager", "textures/entity/villager/villager.png", HUMANOID),
    ("minecraft:wandering_trader", "textures/entity/wandering_trader.png", HUMANOID),
    ("minecraft:witch", "textures/entity/witch.png", HUMANOID),
    ("minecraft:pillager", "textures/entity/illager/pillager.png", HUMANOID),
    ("minecraft:vindicator", "textures/entity/illager/vindicator.png", HUMANOID),
    ("minecraft:evoker", "textures/entity/illager/evoker.png", HUMANOID),
    ("minecraft:illusioner", "textures/entity/illager/illusioner.png", HUMANOID),
    ("minecraft:armor_stand", "textures/entity/armorstand/wood.png", HUMANOID),
    # ---- 苦力怕 / 末影人 ----
    ("minecraft:creeper", "textures/entity/creeper/creeper.png", HUMANOID),
    ("minecraft:enderman", "textures/entity/enderman/enderman.png", HUMANOID),
    # ---- 蜘蛛 ----
    ("minecraft:spider", "textures/entity/spider/spider.png", (40, 12, 8, 8)),
    ("minecraft:cave_spider", "textures/entity/spider/cave_spider.png", (40, 12, 8, 8)),
    # ---- 四足 ----
    ("minecraft:cow", "textures/entity/cow/cow.png", QUADRUPED),
    ("minecraft:mooshroom", "textures/entity/cow/red_mooshroom.png", QUADRUPED),
    ("minecraft:pig", "textures/entity/pig/pig.png", QUADRUPED),
    ("minecraft:sheep", "textures/entity/sheep/sheep.png", QUADRUPED),
    ("minecraft:wolf", "textures/entity/wolf/wolf.png", (4, 4, 6, 6)),
    ("minecraft:cat", "textures/entity/cat/black.png", QUADRUPED),
    ("minecraft:ocelot", "textures/entity/cat/ocelot.png", QUADRUPED),
    ("minecraft:fox", "textures/entity/fox/fox.png", (6, 6, 8, 8)),
    ("minecraft:rabbit", "textures/entity/rabbit/white.png", (4, 4, 4, 5)),
    ("minecraft:horse", "textures/entity/horse/horse_brown.png", (4, 4, 12, 8)),
    ("minecraft:donkey", "textures/entity/horse/donkey.png", (4, 4, 12, 8)),
    ("minecraft:panda", "textures/entity/panda/panda.png", (4, 4, 12, 12)),
    ("minecraft:polar_bear", "textures/entity/bear/polarbear.png", (4, 4, 8, 8)),
    ("minecraft:llama", "textures/entity/llama/creamy.png", (4, 4, 12, 10)),
    ("minecraft:goat", "textures/entity/goat/goat.png", (4, 4, 8, 10)),
    ("minecraft:camel", "textures/entity/camel/camel.png", (4, 4, 12, 12)),
    # ---- 鸟类 / 小动物 ----
    ("minecraft:chicken", "textures/entity/chicken.png", (3, 3, 4, 6)),
    ("minecraft:bee", "textures/entity/bee/bee.png", HUMANOID),
    ("minecraft:parrot", "textures/entity/parrot/parrot_red_blue.png", (4, 4, 6, 6)),
    ("minecraft:bat", "textures/entity/bat.png", (4, 4, 6, 6)),
    ("minecraft:turtle", "textures/entity/turtle/turtle.png", (4, 4, 8, 8)),
    # ---- 水生灵 / 异形 ----
    ("minecraft:squid", "textures/entity/squid/squid.png", (8, 8, 8, 8)),
    ("minecraft:glow_squid", "textures/entity/squid/glow_squid.png", (8, 8, 8, 8)),
    ("minecraft:dolphin", "textures/entity/dolphin.png", (8, 8, 8, 8)),
    ("minecraft:axolotl", "textures/entity/axolotl/axolotl_lucy.png", (4, 4, 8, 6)),
    ("minecraft:guardian", "textures/entity/guardian.png", (12, 12, 12, 12)),
    ("minecraft:elder_guardian", "textures/entity/guardian_elder.png", (12, 12, 12, 12)),
    ("minecraft:shulker", "textures/entity/shulker/shulker.png", (0, 0, 16, 16)),
    ("minecraft:slime", "textures/entity/slime/slime.png", (8, 8, 8, 8)),
    ("minecraft:magma_cube", "textures/entity/slime/magmacube.png", (8, 8, 8, 8)),
    ("minecraft:blaze", "textures/entity/blaze.png", (8, 8, 8, 8)),
    ("minecraft:ghast", "textures/entity/ghast/ghast.png", (16, 16, 16, 16)),
    ("minecraft:phantom", "textures/entity/phantom.png", (4, 4, 8, 8)),
    ("minecraft:warden", "textures/entity/warden/warden.png", (4, 4, 12, 12)),
    ("minecraft:iron_golem", "textures/entity/iron_golem/iron_golem.png", (4, 4, 8, 10)),
    ("minecraft:snow_golem", "textures/entity/snow_golem.png", (4, 4, 8, 8)),
    ("minecraft:allay", "textures/entity/allay/allay.png", (4, 4, 8, 8)),
    ("minecraft:vex", "textures/entity/illager/vex.png", (4, 4, 8, 8)),
    ("minecraft:breeze", "textures/entity/breeze/breeze.png", (4, 4, 8, 8)),
    # ---- 载具（整张贴图不好看，取车头那块） ----
    ("minecraft:minecart", "textures/entity/minecart.png", (0, 0, 16, 16)),
    ("minecraft:chest_minecart", "textures/entity/minecart.png", (0, 0, 16, 16)),
    ("minecraft:hopper_minecart", "textures/entity/minecart.png", (0, 0, 16, 16)),
    ("minecraft:furnace_minecart", "textures/entity/minecart.png", (0, 0, 16, 16)),
    ("minecraft:tnt_minecart", "textures/entity/minecart.png", (0, 0, 16, 16)),
    ("minecraft:boat", "textures/entity/boat/oak.png", (0, 0, 16, 16)),
    # ---- 展示框 / 掉落物 ----
    ("minecraft:item_frame", "textures/block/item_frame.png", (0, 0, 16, 16)),
    ("minecraft:glow_item_frame", "textures/block/glow_item_frame.png", (0, 0, 16, 16)),
    ("minecraft:painting", "textures/painting/kebab.png", (0, 0, 16, 16)),
    ("minecraft:piglin", "textures/entity/piglin/piglin.png", HUMANOID),
    ("minecraft:piglin_brute", "textures/entity/piglin/piglin_brute.png", HUMANOID),
    ("minecraft:hoglin", "textures/entity/hoglin/hoglin.png", QUADRUPED),
    ("minecraft:strider", "textures/entity/strider/strider.png", (4, 4, 8, 8)),
    ("minecraft:sniffer", "textures/entity/sniffer/sniffer.png", (8, 8, 12, 8)),
    ("minecraft:frog", "textures/entity/frog/temperate_frog.png", (4, 4, 8, 8)),
    ("minecraft:wither", "textures/entity/wither/wither.png", HUMANOID),
    ("minecraft:silverfish", "textures/entity/silverfish.png", (4, 4, 8, 8)),
    ("minecraft:endermite", "textures/entity/endermite.png", (4, 4, 8, 8)),
]

CELL = 16          # 每个图标在输出图集里占 16x16
PAD = 1            # 图标之间的 1px 边距，避免最近邻采样吃到隔壁


def read_png(zips: list[zipfile.ZipFile], rel: str):
    full = "assets/minecraft/" + rel
    for z in zips:
        try:
            with z.open(full) as f:
                return Image.open(io.BytesIO(f.read())).convert("RGBA")
        except KeyError:
            continue
    return None


def build(rows: int, cols: int):
    icons = []
    for entity, rel, rect in ICONS:
        icons.append((entity, rel, rect))

    # 先按 CELL 尺寸过滤：太小的贴图直接跳过
    n = len(icons)
    cols = min(cols, max(1, n))
    rows = (n + cols - 1) // cols
    step = CELL + PAD * 2
    width = cols * step
    height = rows * step
    atlas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    out = {}
    zips = [zipfile.ZipFile(os.path.join(ROOT, j)) for j in DEFAULT_JARS if os.path.exists(os.path.join(ROOT, j))]
    missing = []
    for i, (entity, rel, (x, y, w, h)) in enumerate(icons):
        img = read_png(zips, rel)
        if img is None:
            missing.append(entity)
            continue
        w = min(w, img.width - x)
        h = min(h, img.height - y)
        if w <= 0 or h <= 0:
            missing.append(entity)
            continue
        crop = img.crop((x, y, x + w, y + h))
        # 等比缩放到 CELL 内，最近邻，保持像素风
        scale = CELL / max(w, h)
        nw = max(1, int(round(w * scale)))
        nh = max(1, int(round(h * scale)))
        crop = crop.resize((nw, nh), Image.NEAREST)
        cx = (i % cols) * step + PAD
        cy = (i // cols) * step + PAD
        atlas.paste(crop, (cx + (CELL - nw) // 2, cy + (CELL - nh) // 2))
        out[entity] = [cx, cy, CELL, CELL]
    for z in zips:
        z.close()
    return atlas, out, missing


JSON_NAME = "entity-icons.json"
PNG_NAME = "entity-icons.png"


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cols", type=int, default=8)
    args = ap.parse_args(argv[1:])
    atlas, icons, missing = build(0, args.cols)
    png_path = os.path.join(ASSETS, PNG_NAME)
    json_path = os.path.join(ASSETS, JSON_NAME)
    atlas.save(png_path)
    doc = {
        "file": PNG_NAME,
        "size": [atlas.width, atlas.height],
        "cell": CELL,
        "padding": PAD,
        "icons": icons,
    }
    with open(json_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    print("entity icons: %d 个（缺 %d） -> %s (%dx%d) / %s" % (
        len(icons), len(missing), PNG_NAME, atlas.width, atlas.height, JSON_NAME))
    if missing:
        print("  缺失：" + ", ".join(missing[:8]) + (" ..." if len(missing) > 8 else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
