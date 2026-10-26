import zipfile, io, os
from PIL import Image
jar = r"_dl\client-1.21.1.jar"
out = r"_dl\shulkertex"
os.makedirs(out, exist_ok=True)
z = zipfile.ZipFile(jar)
names = [n for n in z.namelist() if n.startswith("assets/minecraft/textures/entity/shulker/")]
print("textures:", len(names))
for n in names:
    if n.endswith(".png") and "_x" not in n:
        img = Image.open(io.BytesIO(z.read(n))).convert("RGBA")
        base = os.path.basename(n)
        img.save(os.path.join(out, base))
        img.resize((img.width*8, img.height*8), Image.NEAREST).save(os.path.join(out, base.replace(".png", "_x8.png")))
        print(base, img.size)
