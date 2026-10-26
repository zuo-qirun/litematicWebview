# -*- coding: utf-8 -*-
"""一次性补丁：给 post_entity_icons.py 的 ICONS 追加若干实体。"""
import pathlib

p = pathlib.Path("tools/bake/post_entity_icons.py")
s = p.read_text(encoding="utf-8")
if "minecraft:piglin_brute" in s:
    print("already patched")
    raise SystemExit(0)
marker = "]\n\nCELL = 16"
extra = (
    '    ("minecraft:piglin", "textures/entity/piglin/piglin.png", HUMANOID),\n'
    '    ("minecraft:piglin_brute", "textures/entity/piglin/piglin_brute.png", HUMANOID),\n'
    '    ("minecraft:hoglin", "textures/entity/hoglin/hoglin.png", QUADRUPED),\n'
    '    ("minecraft:strider", "textures/entity/strider/strider.png", (4, 4, 8, 8)),\n'
    '    ("minecraft:sniffer", "textures/entity/sniffer/sniffer.png", (8, 8, 12, 8)),\n'
    '    ("minecraft:frog", "textures/entity/frog/temperate_frog.png", (4, 4, 8, 8)),\n'
    '    ("minecraft:wither", "textures/entity/wither/wither.png", HUMANOID),\n'
    '    ("minecraft:silverfish", "textures/entity/silverfish.png", (4, 4, 8, 8)),\n'
    '    ("minecraft:endermite", "textures/entity/endermite.png", (4, 4, 8, 8)),\n'
    "]\n\nCELL = 16"
)
assert marker in s, "marker not found"
s = s.replace(marker, extra, 1)
p.write_text(s, encoding="utf-8", newline="\n")
print("patched")
