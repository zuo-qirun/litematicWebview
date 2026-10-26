from PIL import Image
import numpy as np
img = Image.open(r"_dl\shulkertex\shulker.png").convert("RGBA")
a = np.asarray(img)
print("size", img.size)
for cy in range(4):
    row = []
    for cx in range(4):
        cell = a[cy*16:(cy+1)*16, cx*16:(cx+1)*16]
        alpha = float(cell[...,3].mean())/255.0
        rgb = cell[...,:3].reshape(-1,3).mean(axis=0)
        row.append("(%3d,%3d,%3d) a%.2f" % (int(rgb[0]),int(rgb[1]),int(rgb[2]),alpha))
    print("v%2d: " % (cy*16) + " | ".join(row))
lum = a[...,:3].mean(axis=2)
out=[]
for y in range(0,64,2):
    line=""
    for x in range(0,64,2):
        v=float(lum[y:y+2,x:x+2].mean()); al=float(a[y:y+2,x:x+2,3].mean())/255
        line += " " if al<0.05 else ("." if v<60 else ("-" if v<100 else ("+" if v<150 else "#")))
    out.append(line)
print("\n".join(out))
