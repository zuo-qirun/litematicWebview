from PIL import Image, ImageDraw
im = Image.open("_dl/shulkertex/shulker.png").convert("RGBA")
bg = Image.new("RGBA", im.size, (18, 20, 26, 255))
bg.alpha_composite(im)
out = bg.resize((512, 512), Image.NEAREST)
d = ImageDraw.Draw(out)
for g in range(0, 65, 16):
    p = g * 8
    d.line([(p, 0), (p, 512)], fill=(90, 220, 200, 120))
    d.line([(0, p), (512, p)], fill=(90, 220, 200, 120))
for g in range(0, 65, 8):
    p = g * 8
    d.line([(p, 0), (p, 512)], fill=(255, 200, 100, 40))
    d.line([(0, p), (512, p)], fill=(255, 200, 100, 40))
out.save("tests/ui/_shots/shulker-tex.png")
print("ok")
