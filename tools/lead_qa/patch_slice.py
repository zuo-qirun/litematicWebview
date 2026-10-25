import io, sys

p = "src/render/scene.js"
s = io.open(p, encoding="utf-8").read()

subs = [
    (
        "            d[o + 12] = px + x + ox;\n            d[o + 13] = py + y + oy;\n            d[o + 14] = pz + z + oz;\n            slot.n++;",
        "            d[o + 12] = px + x + ox;\n            d[o + 13] = py + y + oy;\n            d[o + 14] = pz + z + oz;\n            slot.n++;\n            pushRun(slot, py + y + oy);",
    ),
    (
        "          d[o + 12] = px + x + ox;\n          d[o + 13] = py + y + oy;\n          d[o + 14] = pz + z + oz;\n          slot.n++;",
        "          d[o + 12] = px + x + ox;\n          d[o + 13] = py + y + oy;\n          d[o + 14] = pz + z + oz;\n          slot.n++;\n          pushRun(slot, py + y + oy);",
    ),
    (
        "            d[o + 14] = pz + z + oz + inset;\n            fslot.n++;",
        "            d[o + 14] = pz + z + oz + inset;\n            fslot.n++;\n            pushRun(fslot, py + y + oy);",
    ),
    (
        "          quadCount: built ? built.quadCount : 0,\n        };\n        this.group.add(inst);\n        this.meshes.push(inst);\n        if (group) group.push(inst);\n      }\n      // 流体层",
        "          quadCount: built ? built.quadCount : 0,\n          yLevels: toLevels(slot.runs),\n          fullCount: slot.n,\n        };\n        this.group.add(inst);\n        this.meshes.push(inst);\n        if (group) group.push(inst);\n      }\n      // 流体层",
    ),
    (
        "          quadCount: built ? built.quadCount : 0,\n          fluidKind: kind,",
        "          quadCount: built ? built.quadCount : 0,\n          fluidKind: kind,\n          yLevels: toLevels(slot.runs),\n          fullCount: slot.n,",
    ),
]

for a, b in subs:
    if a not in s:
        print("MISSING:", a[:70].replace("\n", "\\n"))
        sys.exit(1)
    s = s.replace(a, b, 1)

io.open(p, "w", encoding="utf-8", newline="").write(s)
print("ok pushRun:", s.count("pushRun("), "yLevels:", s.count("yLevels:"))
