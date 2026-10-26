import zipfile, json
z = zipfile.ZipFile(r"_dl\client-1.21.1.jar")
n = z.read("assets/minecraft/blockstates/shulker_box.json").decode()
print(n[:800])
