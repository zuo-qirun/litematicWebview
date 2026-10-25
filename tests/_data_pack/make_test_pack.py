"""生成一个最小可用资源包（仅覆盖 1 张方块纹理），用于端到端验证材质包烘焙。

用法：python tests/_data_pack/make_test_pack.py
产物：tests/_data_pack/red-stone.zip
"""
import os
import zipfile

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "red-stone.zip")


def make_png(path, rgb, size=16):
    img = Image.new("RGBA", (size, size), rgb + (255,))
    img.save(path, "PNG")


def main():
    os.makedirs(os.path.join(HERE, "_work"), exist_ok=True)
    tex = os.path.join(HERE, "_work", "stone.png")
    make_png(tex, (220, 40, 40))
    # 再加一张模型覆盖面：把一个方块换成"没有几何"的空模型不应崩，这里改成整块立方体
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(tex, "assets/minecraft/textures/block/stone.png")
        z.writestr(
            "assets/minecraft/blockstates/stone.json",
            '{"variants":{"":{"model":"minecraft:block/stone_custom"}}}',
        )
        z.writestr(
            "assets/minecraft/models/block/stone_custom.json",
            '{"parent":"block/cube_all","textures":{"all":"minecraft:block/stone"}}',
        )
        z.writestr("pack.mcmeta", '{"pack":{"pack_format":34,"description":"mcviewer test pack"}}')
    print("wrote", OUT, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()
