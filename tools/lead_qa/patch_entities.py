import io

p = "src/render/entities.js"
s = io.open(p, encoding="utf-8").read()

subs = [
    (
        """  const textures = [];
  const materials = [];
  let count = 0;""",
        """  const textures = [];
  const materials = [];
  let count = 0;
  let skipped = 0;
  // 同一格子附近常常堆着多个实体（盔甲架、物品展示框、掉落物），标签会糊成一团：
  // 用一个 1/2 格的栅格做去重，同一格里只保留第一个。
  const seen = new Set();""",
    ),
    (
        """      const id = String(ent.id || (ent.nbt && ent.nbt.id) || "unknown");""",
        """      const id = String(ent.id || (ent.nbt && ent.nbt.id) || "unknown");
      const cellKey = `${rg.name}|${Math.round(px * 2)}|${Math.round(py * 2)}|${Math.round(pz * 2)}`;
      if (seen.has(cellKey)) { skipped++; continue; }
      seen.add(cellKey);""",
    ),
    (
        """      const sprH = worldScale * 0.62;""",
        """      const sprH = worldScale * 0.42;""",
    ),
    (
        """  return {
    group,
    count,""",
        """  return {
    group,
    count,
    skipped,""",
    ),
]

for a, b in subs:
    if a not in s:
        raise SystemExit("MISSING: " + a[:60])
    s = s.replace(a, b, 1)

io.open(p, "w", encoding="utf-8", newline="").write(s)
print("ok")
