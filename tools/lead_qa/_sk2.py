import zipfile, hashlib
z=zipfile.ZipFile(r"_dl\client-1.21.1.jar")
for p in ["assets/minecraft/atlases/shulker_boxes.json",
          "assets/minecraft/models/item/template_shulker_box.json",
          "assets/minecraft/models/item/shulker_box.json",
          "assets/minecraft/blockstates/shulker_box.json"]:
    print("=== "+p)
    print(z.read(p).decode()[:600])
from PIL import Image
import io
for p in ["assets/minecraft/textures/block/shulker_box.png","assets/minecraft/textures/item/shulker_shell.png"]:
    im=Image.open(io.BytesIO(z.read(p)))
    print(p, im.size, im.mode)
