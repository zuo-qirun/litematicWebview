import io
p = "src/app.js"
s = io.open(p, encoding="utf-8").read()
subs = [
  ("      scene.setHover(hit.x, hit.y, hit.z, true);", "      scene.setHover(hit.x, hit.y, hit.z, true, hit.stateKey);"),
  ("      scene.setSelected(hit.x, hit.y, hit.z, true);", "      scene.setSelected(hit.x, hit.y, hit.z, true, hit.stateKey);"),
  ("      scene.setSelected(entry.first.x, entry.first.y, entry.first.z, true);", "      scene.setSelected(entry.first.x, entry.first.y, entry.first.z, true, entry.stateKey);"),
]
for a, b in subs:
    if a not in s:
        raise SystemExit("MISSING: " + a)
    s = s.replace(a, b, 1)
io.open(p, "w", encoding="utf-8", newline="").write(s)
print("ok")
