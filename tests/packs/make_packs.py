#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""生成 mcviewer 材质包烘焙测试素材（tests/packs/*.zip）。

用法：
    python tests/packs/make_packs.py

产物（每个都很小，< 8KB）：
    texture-only.zip   只替换纹理：block/oak_planks（16x48 动画条，首帧亮红）、
                       block/stone（醒目青色纯色，文件名故意用大写 Stone.png，
                       验证「大小写不敏感」匹配）
    model-override.zip 替换 block/stone 模型为自造几何（内缩立方体 + 顶部小柱）
                       + 自定义纹理 block/pack_stone（绿黄斜纹）；zip 外面套一层
                       TestPack/ 目录、模型文件名用大写 Stone.json、带 __MACOSX 垃圾条目
    empty-pack.zip     只有 pack.mcmeta，不含任何 assets/minecraft 资源（等价性测试用）

所有 zip 固定时间戳与条目顺序，重复生成逐字节一致。
"""
import io
import json
import os
import zipfile

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
FIXED_TIME = (2026, 1, 1, 0, 0, 0)

PACK_MCMETA = ('{\n'
               '  "pack": {\n'
               '    "description": "mcviewer test pack",\n'
               '    "pack_format": 34\n'
               '  }\n'
               '}\n')


def png_bytes(im):
    buf = io.BytesIO()
    im.save(buf, format='PNG')
    return buf.getvalue()


def solid(w, h, rgb):
    return Image.new('RGBA', (w, h), tuple(rgb) + (255,))


def animated_strip(frames):
    """frames: list of (w, rgb) -> 竖条动画纹理（宽 w，高 w*len(frames)）。"""
    im = Image.new('RGBA', (frames[0][0], frames[0][0] * len(frames)), (0, 0, 0, 0))
    for i, (w, rgb) in enumerate(frames):
        im.paste(solid(w, w, rgb), (0, i * w))
    return im


def striped_texture(w=16, h=16):
    """绿黄 45 度斜纹，方便肉眼确认 uv 方向。"""
    a = np.zeros((h, w, 4), dtype=np.uint8)
    xs, ys = np.meshgrid(np.arange(w), np.arange(h))
    band = ((xs + ys) // 3) % 2
    a[..., 0] = np.where(band == 0, 0x2E, 0xC8)
    a[..., 1] = np.where(band == 0, 0xC8, 0x2E)
    a[..., 2] = 0x3A
    a[..., 3] = 255
    return Image.fromarray(a, 'RGBA')


def write_zip(path, entries):
    """entries: list of (zip 内路径, bytes)。固定时间戳，重复生成一致。"""
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for name, data in entries:
            info = zipfile.ZipInfo(name, date_time=FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            zf.writestr(info, data)
    print('生成 %s（%d 条目，%d B）' % (os.path.basename(path), len(entries),
                                      os.path.getsize(path)))


def make_texture_only():
    entries = [
        ('pack.mcmeta', PACK_MCMETA.encode('utf-8')),
        # 16x48 动画纹理：首帧亮红，后两帧绿/蓝（烘焙必须取首帧）
        ('assets/minecraft/textures/block/oak_planks.png', png_bytes(
            animated_strip([(16, (0xE0, 0x1C, 0x2B)), (16, (0x1C, 0xC8, 0x3C)),
                            (16, (0x20, 0x40, 0xE0))]))),
        # 纯色青：块状纹理，肉眼极易辨认；文件名大写，验证大小写不敏感
        ('assets/minecraft/textures/block/Stone.png', png_bytes(
            solid(16, 16, (0x12, 0xB8, 0xD8)))),
    ]
    write_zip(os.path.join(HERE, 'texture-only.zip'), entries)


STONE_MODEL = {
    "ambientocclusion": False,
    "textures": {"particle": "block/pack_stone", "all": "block/pack_stone"},
    "elements": [
        {
            "from": [2, 2, 2],
            "to": [14, 14, 14],
            "faces": {
                "down": {"texture": "#all", "cullface": "down"},
                "up": {"texture": "#all", "cullface": "up"},
                "north": {"texture": "#all", "cullface": "north"},
                "south": {"texture": "#all", "cullface": "south"},
                "west": {"texture": "#all", "cullface": "west"},
                "east": {"texture": "#all", "cullface": "east"},
            },
        },
        {
            "from": [7, 14, 7],
            "to": [9, 16, 9],
            "faces": {
                "down": {"texture": "#all"},
                "up": {"texture": "#all"},
                "north": {"texture": "#all"},
                "south": {"texture": "#all"},
                "west": {"texture": "#all"},
                "east": {"texture": "#all"},
            },
        },
    ],
}


def make_model_override():
    root = 'TestPack/'          # 外套一层目录（真实资源包常见结构）
    entries = [
        ('__MACOSX/TestPack/._assets', b'junk'),    # 必须被忽略
        (root + 'pack.mcmeta', PACK_MCMETA.encode('utf-8')),
        # 模型文件名大写，验证「大小写不敏感」匹配
        (root + 'assets/minecraft/models/block/Stone.json',
         json.dumps(STONE_MODEL, ensure_ascii=False, indent=1).encode('utf-8')),
        (root + 'assets/minecraft/textures/block/pack_stone.png',
         png_bytes(striped_texture())),
    ]
    write_zip(os.path.join(HERE, 'model-override.zip'), entries)


def make_empty_pack():
    entries = [
        ('pack.mcmeta', PACK_MCMETA.encode('utf-8')),
        ('README.txt', b'mcviewer empty pack: no assets/minecraft resources\n'),
    ]
    write_zip(os.path.join(HERE, 'empty-pack.zip'), entries)


def main():
    os.makedirs(HERE, exist_ok=True)
    make_texture_only()
    make_model_override()
    make_empty_pack()


if __name__ == '__main__':
    main()
