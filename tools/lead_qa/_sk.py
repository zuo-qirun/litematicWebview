import zipfile
z=zipfile.ZipFile(r"_dl\client-1.21.1.jar")
names=[n for n in z.namelist() if "shulker" in n]
for n in sorted(names): print(n)
print("----model shulker_box----")
for p in ["assets/minecraft/models/block/shulker_box.json"]:
    print(p, z.read(p).decode()[:300])
