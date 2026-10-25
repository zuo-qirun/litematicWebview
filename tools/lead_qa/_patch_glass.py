import io
p = "src/render/scene.js"
s = io.open(p, encoding="utf-8").read()
a = """      translucent: new THREE.MeshBasicMaterial({
        ...base, transparent: true, depthWrite: false, alphaTest: 0, side: THREE.DoubleSide,
      }),"""
b = """      // 玻璃类：半透明但**写深度**（原版半透明方块也写），否则玻璃后面的方块会透过来，
      // 看起来像"玻璃渲染错了"。
      translucent: new THREE.MeshBasicMaterial({
        ...base, transparent: true, depthWrite: true, alphaTest: 0, side: THREE.DoubleSide,
      }),"""
assert a in s
s = s.replace(a, b, 1)
a2 = """      water: new THREE.MeshBasicMaterial({
        ...base, transparent: true, opacity: 0.72, depthWrite: false, alphaTest: 0,
        side: THREE.DoubleSide,
      }),"""
b2 = """      water: new THREE.MeshBasicMaterial({
        ...base, transparent: true, opacity: 0.78, depthWrite: true, alphaTest: 0,
        side: THREE.DoubleSide,
      }),"""
assert a2 in s
s = s.replace(a2, b2, 1)
io.open(p, "w", encoding="utf-8", newline="").write(s)
print("ok")
