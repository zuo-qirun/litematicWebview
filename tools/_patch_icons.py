import io, re, pathlib
p = pathlib.Path("tools/bake/post_entity_icons.py")
s = p.read_text(encoding="utf-8")
repl = {
 '("minecraft:zombie_villager", "textures/entity/zombie/zombie_villager.png"': '("minecraft:zombie_villager", "textures/entity/zombie_villager/zombie_villager.png"',
 '("minecraft:zombified_piglin", "textures/entity/zombie_pigman.png"': '("minecraft:zombified_piglin", "textures/entity/piglin/zombified_piglin.png"',
 '("minecraft:magma_cube", "textures/entity/slime/magma_cube.png"': '("minecraft:magma_cube", "textures/entity/slime/magmacube.png"',
 '("minecraft:minecart", "textures/entity/minecart/minecart.png"': '("minecraft:minecart", "textures/entity/minecart.png"',
 '("minecraft:chest_minecart", "textures/entity/minecart/minecart_chest.png"': '("minecraft:chest_minecart", "textures/entity/minecart.png"',
 '("minecraft:hopper_minecart", "textures/entity/minecart/minecart_hopper.png"': '("minecraft:hopper_minecart", "textures/entity/minecart.png"',
 '("minecraft:furnace_minecart", "textures/entity/minecart/minecart_furnace.png"': '("minecraft:furnace_minecart", "textures/entity/minecart.png"',
 '("minecraft:tnt_minecart", "textures/entity/minecart/minecart_tnt.png"': '("minecraft:tnt_minecart", "textures/entity/minecart.png"',
 '("minecraft:item_frame", "textures/entity/frame/item_frame.png"': '("minecraft:item_frame", "textures/block/item_frame.png"',
 '("minecraft:glow_item_frame", "textures/entity/frame/glow_item_frame.png"': '("minecraft:glow_item_frame", "textures/block/glow_item_frame.png"',
 '("minecraft:painting", "textures/entity/painting/kebab.png"': '("minecraft:painting", "textures/painting/kebab.png"',
}
n = 0
for a, b in repl.items():
    if a in s:
        s = s.replace(a, b); n += 1
extra = '''    ("minecraft:piglin", "textures/entity/piglin/piglin.png", HUMANOID),
    ("minecraft:piglin_brute", "textures/entity/piglin/piglin_brute.png", HUMANOID),
    ("minecraft:hoglin", "textures/entity/hoglin/hoglin.png", QUADRUPED),
    ("minecraft:strider", "textures/entity/strider/strider.png", (4, 4, 8, 8)),
    ("minecraft:sniffer", "textures/entity/sniffer/sniffer.png", (8, 8, 12, 8)),
    ("minecraft:frog", "textures/entity/frog/temperate_frog.png", (4, 4, 8, 8)),
    ("minecraft:wither", "textures/entity/wither/wither.png", HUMANOID),
    ("minecraft:silverfish", "textures/entity/silverfish.png", (4, 4, 8, 8)),
    ("minecraft:endermite", "textures/entity/endermite.png", (4, 4, 8, 8)),
    ("minecraft:llama", "textures/entity/llama/creamy.png", (4, 4, 12, 10)),
]'''
s = s.replace('("minecraft:llama", "textures/entity/llama/creamy.png", (4, 4, 12, 10)),\n]', '("minecraft:llama", "textures/entity/llama/creamy.png", (4, 4, 12, 10)),\n' + extra, 1)
p.write_text(s, encoding="utf-8", newline="\n")
print("patched", n)
