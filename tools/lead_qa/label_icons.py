# -*- coding: utf-8 -*-
"""把 assets/entity-icons.png 放大并标注实体名，方便肉眼核对每个图标的裁剪是否正确。"""
import json
import os

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ASSETS = os.path.join(ROOT, "assets")
OUT = os.path.join(ROOT, "tests", "ui", "_shots", "entity-icons-labeled.png")


def main():
    doc = json.load(open(os.path.join(ASSETS, "entity-icons.json"), encoding="utf-8"))
    atlas = Image.open(os.path.join(ASSETS, doc["file"])).convert("RGBA")
    cell = doc["cell"]
    pad = doc["padding"]
    step = cell + pad * 2
    cols = max(1, atlas.width // step)
    scale = 3
    label_h = 14
    rows = (atlas.height + step - 1) // step
    sheet = Image.new("RGBA", (cols * cell * scale + 8, rows * (cell * scale + label_h) + 8), (12, 16, 24, 255))
    draw = ImageDraw.Draw(sheet)
    names = {tuple(v): k for k, v in doc["icons"].items()}
    for i in range(cols * rows):
        cx = (i % cols) * step + pad
        cy = (i // cols) * step + pad
        tile = atlas.crop((cx, cy, cx + cell, cy + cell)).resize((cell * scale, cell * scale), Image.NEAREST)
        dx = (i % cols) * cell * scale + 4
        dy = (i // cols) * (cell * scale + label_h) + 4
        sheet.alpha_composite(tile, (dx, dy))
        name = names.get((cx, cy), "")
        short = name.replace("minecraft:", "")
        draw.text((dx, dy + cell * scale + 1), short[:22], fill=(190, 200, 215))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    sheet.save(OUT)
    print("wrote", OUT, sheet.size, "icons=", len(doc["icons"]))


if __name__ == "__main__":
    main()
