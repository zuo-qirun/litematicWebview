import io
p = "README.md"
s = io.open(p, encoding="utf-8").read()
subs = [
    ("- 实体（矿车/盔甲架等）只统计和列出，不绘制。",
     "- 实体只有名字标签（生物/载具），没有办法还原原版实体模型（原版把生物模型放在 Java 代码里，资源包里没有几何）；\n  物品展示框/画/盔甲架这类成排装饰默认不标，`E` 键只控制这个标签层。"),
    ("- 水、气泡柱这类没有固定立方体模型的方块用 `#particle` 纹理整方块占位。",
     "- 水的贴图用的是原版 `water_still` 占位、颜色按主世界默认色着色，所以水面没有原版的流动感与波浪；\n  岩浆同理（用的是静态岩浆纹理）。\n- 双箱子依赖材质包里 `normal_left/right` 两张半块贴图；材质包如果只替换了 `normal.png`，双箱子的接缝面仍用内置贴图。"),
]
for a, b in subs:
    if a not in s:
        raise SystemExit("MISSING: " + a[:40])
    s = s.replace(a, b, 1)
io.open(p, "w", encoding="utf-8", newline="").write(s)
print("ok")
