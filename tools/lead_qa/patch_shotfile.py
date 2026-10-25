import io, sys

p = "tests/ui/shot-file.mjs"
s = io.open(p, encoding="utf-8").read()

if 'const SLICE = flag("--slice", null);' not in s:
    a = 'const VIEW = flag("--view", "iso");'
    assert a in s
    s = s.replace(a, a + '\nconst SLICE = flag("--slice", null);\nconst PICK = argv.includes("--pick");', 1)

old_tail = """  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: OUT });"""
new_tail = """  const before = await page.evaluate(() => ({
    drawn: window.__VIEWER__.scene().drawnInstances(),
    full: window.__VIEWER__.scene().meshes.reduce((a, m) => a + (m.userData.fullCount != null ? m.userData.fullCount : m.count), 0),
    entityLabels: window.__VIEWER__.state().entityLabels,
    entityLabelsVisible: window.__VIEWER__.state().entityLabelsVisible,
  }));
  if (SLICE !== null) {
    const level = await page.evaluate((lv) => window.__VIEWER__.scene().setSlice(true, Number(lv)), SLICE);
    console.log("切片 level =", level);
  }
  if (PICK) {
    const vp = page.viewport();
    const info = await page.evaluate((cx, cy) => {
      const sc = window.__VIEWER__.scene();
      sc.applyPreset("iso");
      sc.frameAll();
      const hit = sc.pickAt(cx, cy);
      if (!hit) return null;
      sc.setSelected(hit.x, hit.y, hit.z, true, hit.stateKey);
      return { hit, scale: sc.selBox.scale.toArray().map((v) => +v.toFixed(3)), pos: sc.selBox.position.toArray().map((v) => +v.toFixed(3)) };
    }, Math.round(vp.width / 2), Math.round(vp.height / 2));
    console.log("拾取:", JSON.stringify(info));
    await page.evaluate(() => window.__VIEWER__.scene().frameAll());
  }
  await new Promise((r) => setTimeout(r, 1200));
  const after = await page.evaluate(() => ({ drawn: window.__VIEWER__.scene().drawnInstances() }));
  console.log("实例:", JSON.stringify(before), "→ 切片后 drawn =", after.drawn);
  await page.screenshot({ path: OUT });"""

if old_tail in s:
    s = s.replace(old_tail, new_tail, 1)
elif "切片后 drawn" not in s:
    print("TAIL MISSING")
    sys.exit(1)

io.open(p, "w", encoding="utf-8", newline="").write(s)
print("ok")
