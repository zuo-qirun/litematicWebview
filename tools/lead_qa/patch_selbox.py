import io, sys

p = "src/render/scene.js"
s = io.open(p, encoding="utf-8").read()

subs = [
    # setHover: 支持按状态包围盒收缩
    (
        """  setHover(x, y, z, visible = true) {
    if (!visible || x === null || x === undefined) {
      if (this.hoverBox.visible) { this.hoverBox.visible = false; this._needRender = true; }
      return;
    }
    this.hoverBox.position.set(x + 0.5 + this.offset.x, y + 0.5 + this.offset.y, z + 0.5 + this.offset.z);
    this.hoverBox.visible = true;
    this._needRender = true;
  }
""",
        """  /** 选择框贴合方块实际几何体积（台阶/栅栏/火把等不完整方块不再用整格框） */
  _fitSelBox(box, x, y, z, stateKey) {
    const bb = stateKey ? this._stateBox.get(stateKey) : null;
    const bx = x + this.offset.x, by = y + this.offset.y, bz = z + this.offset.z;
    if (bb) {
      const sx = Math.max(bb.max.x - bb.min.x, 0.02) + 0.02;
      const sy = Math.max(bb.max.y - bb.min.y, 0.02) + 0.02;
      const sz = Math.max(bb.max.z - bb.min.z, 0.02) + 0.02;
      box.scale.set(sx, sy, sz);
      box.position.set(
        bx + (bb.min.x + bb.max.x) / 2,
        by + (bb.min.y + bb.max.y) / 2,
        bz + (bb.min.z + bb.max.z) / 2,
      );
    } else {
      box.scale.set(1.002, 1.002, 1.002);
      box.position.set(bx + 0.5, by + 0.5, bz + 0.5);
    }
    box.visible = true;
    this._needRender = true;
  }

  setHover(x, y, z, visible = true, stateKey = null) {
    if (!visible || x === null || x === undefined) {
      if (this.hoverBox.visible) { this.hoverBox.visible = false; this._needRender = true; }
      return;
    }
    this._fitSelBox(this.hoverBox, x, y, z, stateKey);
  }
""",
    ),
    # setSelected 同样处理
    (
        """  setSelected(x, y, z, visible = true) {
    if (!visible || x === null || x === undefined) {
      if (this.selBox.visible) { this.selBox.visible = false; this._needRender = true; }
      return;
    }
    this.selBox.position.set(x + 0.5 + this.offset.x, y + 0.5 + this.offset.y, z + 0.5 + this.offset.z);
    this.selBox.visible = true;
    this._needRender = true;
  }
""",
        """  setSelected(x, y, z, visible = true, stateKey = null) {
    if (!visible || x === null || x === undefined) {
      if (this.selBox.visible) { this.selBox.visible = false; this._needRender = true; }
      return;
    }
    this._fitSelBox(this.selBox, x, y, z, stateKey);
  }
""",
    ),
    # 记录每个状态的几何包围盒（建实例时顺便取）
    (
        """        inst.userData = {
          stateKey: sk,
          regionName: rs.name,
          regionIndex: ki,
          quadCount: built ? built.quadCount : 0,""",
        """        if (built && geo.boundingBox && !this._stateBox.has(sk)) {
          this._stateBox.set(sk, {
            min: { x: geo.boundingBox.min.x, y: geo.boundingBox.min.y, z: geo.boundingBox.min.z },
            max: { x: geo.boundingBox.max.x, y: geo.boundingBox.max.y, z: geo.boundingBox.max.z },
          });
        }
        inst.userData = {
          stateKey: sk,
          regionName: rs.name,
          regionIndex: ki,
          quadCount: built ? built.quadCount : 0,""",
    ),
    # clear() 清空 bbox 缓存
    (
        """    if (this.fluidMeshes) this.fluidMeshes.length = 0;""",
        """    if (this.fluidMeshes) this.fluidMeshes.length = 0;
    this._stateBox.clear();""",
    ),
]

for a, b in subs:
    if a not in s:
        print("MISSING:", a[:80].replace("\n", "\\n"))
        sys.exit(1)
    s = s.replace(a, b, 1)

io.open(p, "w", encoding="utf-8", newline="").write(s)
print("ok")
