import io

p = "src/render/entities.js"
s = io.open(p, encoding="utf-8").read()

subs = [
    (
        """const KIND_COLORS = {""",
        """// 默认只显示"有体积"的实体：生物 / 载具。物品展示框、画、盔甲架、掉落物在投影里
// 往往是成排装饰（动辄几十个），全部标出来会把画面糊满，所以默认跳过。
const DEFAULT_KINDS = new Set(["mob", "vehicle", "other"]);

const KIND_COLORS = {""",
    ),
    (
        """      const cellKey = `${rg.name}|${Math.round(px * 2)}|${Math.round(py * 2)}|${Math.round(pz * 2)}`;
      if (seen.has(cellKey)) { skipped++; continue; }
      seen.add(cellKey);""",
        """      const cellKey = `${rg.name}|${Math.round(px * 2)}|${Math.round(py * 2)}|${Math.round(pz * 2)}`;
      if (seen.has(cellKey)) { skipped++; continue; }
      seen.add(cellKey);
      const kindOfEnt = kindOf(id);
      if (!DEFAULT_KINDS.has(kindOfEnt)) { skipped++; continue; }""",
    ),
    (
        """      const kind = kindOf(id);
      const label = id.replace(/^minecraft:/, "");""",
        """      const kind = kindOfEnt;
      const label = id.replace(/^minecraft:/, "");""",
    ),
]

for a, b in subs:
    if a not in s:
        raise SystemExit("MISSING: " + a[:60])
    s = s.replace(a, b, 1)

io.open(p, "w", encoding="utf-8", newline="").write(s)
print("ok")
