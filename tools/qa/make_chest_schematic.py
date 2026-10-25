"""生成箱子材质验收用的合成投影（.litematic）。

用途：`tools/bake/post_entity_models.py` 修好箱子几何后，需要肉眼自证「投影里箱子不再是
一块木板方块」。这里合成两个投影（都用 tools/nbtref.py 手写 NBT）：

1) `_dl/qa/chest_showcase.litematic` —— 18×2×10 的展示台：一层石砖地面 + 后排四面朝向的
   橡木箱 + 前排 2 个诱捕箱 2 个末影箱 + 橡木板/黑曜石对照块。iso / front / top 三个视角
   都能一眼看出朝向、比例、锁扣位置对不对。
2) `_dl/qa/chest.litematic` —— 任务书里要求的 5×3×1 最小版本：只有三个箱子（朝向各不相同，
   末影箱单独放在对角），没有地面。

命令：python tools/qa/make_chest_schematic.py
"""

import gzip
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parents[1]
sys.path.insert(0, str(PROJECT / "tools"))

from nbtref import W, load_litematic, pack_states, unpack_states  # noqa: E402

# Windows 控制台默认 GBK，打印 ✓ / → 会 UnicodeEncodeError，这里强制 UTF-8 输出
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # pragma: no cover
    pass

QA = PROJECT / "_dl" / "qa"
OUT = QA / "chest_showcase.litematic"
OUT_TINY = QA / "chest.litematic"

AIR = "minecraft:air"

# ---------------------------------------------------------------- 大展示台
# region 尺寸（x, y, z）：y 只有 0(地面) / 1(箱子) 两层
SX, SY, SZ = 18, 2, 10

# palette（顺序即索引；0 必须是 air）
PALETTE = [
    AIR,
    "minecraft:stone_bricks",
    "minecraft:chest[facing=south,type=single,waterlogged=false]",
    "minecraft:chest[facing=north,type=single,waterlogged=false]",
    "minecraft:chest[facing=east,type=single,waterlogged=false]",
    "minecraft:chest[facing=west,type=single,waterlogged=false]",
    "minecraft:trapped_chest[facing=south,type=single,waterlogged=false]",
    "minecraft:trapped_chest[facing=north,type=single,waterlogged=false]",
    "minecraft:ender_chest[facing=south,waterlogged=false]",
    "minecraft:ender_chest[facing=east,waterlogged=false]",
    "minecraft:oak_planks",
    "minecraft:obsidian",
]

# (x, z) -> palette 索引。z=2 是后排（离 +Z 视角较远），z=6 是前排。
# 前排留给 front 视角：橡木箱 facing=south 与诱捕箱 facing=south 正对镜头。
LAYOUT = {
    # 后排：四个朝向的橡木箱，验证 facing -> 模型旋转
    (2, 2): 2,   # chest  south   （默认朝北，这里转 180°）
    (5, 2): 3,   # chest  north
    (8, 2): 4,   # chest  east
    (11, 2): 5,  # chest  west
    # 前排：诱捕箱 / 末影箱 + 对照方块
    (2, 6): 6,   # trapped south
    (5, 6): 7,   # trapped north
    (8, 6): 8,   # ender   south
    (11, 6): 9,  # ender   east
    (14, 2): 10,  # oak_planks：对照「以前的箱子长这样」
    (14, 6): 11,  # obsidian  ：对照末影箱的黑曜石质感
}

# ---------------------------------------------------------------- 5×3×1 最小版
TX, TY, TZ = 5, 3, 1
TINY_PALETTE = [
    AIR,
    "minecraft:chest[facing=north,type=single,waterlogged=false]",
    "minecraft:trapped_chest[facing=south,type=single,waterlogged=false]",
    "minecraft:ender_chest[facing=east,waterlogged=false]",
]
# (1,0,1) 橡木箱朝北、(3,0,1) 诱捕箱朝南、(4,0,0) 末影箱朝东 —— 三者互不贴面（末影箱只和诱捕箱对角相邻）
TINY_LAYOUT = {
    (1, 0, 1): 1,
    (3, 0, 1): 2,
    (4, 0, 0): 3,
}


def build_palette_entries(palette):
    """palette 字符串 -> NBT compound（Name + Properties）。"""
    out = []
    for spec in palette:
        if "[" in spec:
            name, props = spec[:-1].split("[", 1)
            kv = {}
            for part in props.split(","):
                k, v = part.split("=", 1)
                kv[k] = v
            out.append({"Name": name, "Properties": kv})
        else:
            out.append({"Name": spec})
    return out


def build(sx, sy, sz, palette, layout, name, region_name, floor=None):
    """layout: {(x, z): idx} 或 {(x, y, z): idx}；floor 给定时把 y=0 整层铺成该 palette 下标。"""
    volume = sx * sy * sz
    # palette 下标 -> 全局方块索引。契约 §2：index = x + |sx|*z + |sx|*|sz|*y
    indices = [0] * volume

    def put(x, y, z, idx):
        indices[x + sx * z + sx * sz * y] = idx

    if floor is not None:
        for z in range(sz):
            for x in range(sx):
                put(x, 0, z, floor)
    for key, idx in layout.items():
        if len(key) == 2:
            (x, z), y = key, (1 if floor is not None else 0)
        else:
            x, y, z = key
        put(x, y, z, idx)

    # 与 src/core/litematic.js 的 requiredBits 完全一致：max(2, bits_of(paletteSize-1))
    bits = max(2, (len(palette) - 1).bit_length()) if len(palette) > 1 else 0
    longs = pack_states(indices, bits)
    longs = [v - (1 << 64) if v >= (1 << 63) else v for v in longs]  # TAG_Long 有符号

    now = int(time.time() * 1000)
    total_blocks = sum(1 for v in indices if v != 0)

    pal = []
    for e in build_palette_entries(palette):
        c = {"Name": (8, e["Name"])}
        if "Properties" in e:
            c["Properties"] = (10, {k: (8, v) for k, v in e["Properties"].items()})
        pal.append(c)

    root = {
        "Version": (3, 7),
        "SubVersion": (3, 1),
        "MinecraftDataVersion": (3, 3955),
        "Metadata": (10, {
            "Name": (8, name),
            "Author": (8, "mcviewer qa"),
            "Description": (8, "post_entity_models.py 验收：chest / trapped_chest / ender_chest"),
            "RegionCount": (3, 1),
            "TotalVolume": (3, volume),
            "TotalBlocks": (3, total_blocks),
            "TimeCreated": (4, now),
            "TimeModified": (4, now),
            "EnclosingSize": (10, {"x": (3, sx), "y": (3, sy), "z": (3, sz)}),
        }),
        "Regions": (10, {
            region_name: (10, {
                "Position": (10, {"x": (3, 0), "y": (3, 0), "z": (3, 0)}),
                "Size": (10, {"x": (3, sx), "y": (3, sy), "z": (3, sz)}),
                "BlockStatePalette": (9, (10, pal)),
                "BlockStates": (12, longs),
                "TileEntities": (9, (10, [])),
                "Entities": (9, (10, [])),
                "PendingBlockTicks": (9, (10, [])),
                "PendingFluidTicks": (9, (10, [])),
            }),
        }),
    }
    return W().root("", root), bits, indices


def verify(path, bits, indices, sx, sy, sz, palette, layout, region_name):
    """用同一套 nbtref 读回来，抽查关键坐标是否落在预期 palette 下标上。"""
    nbt = load_litematic(path)["value"]
    reg = nbt["Regions"][region_name]
    assert reg["Size"] == {"x": sx, "y": sy, "z": sz}, reg["Size"]
    got = unpack_states(reg["BlockStates"], bits, sx * sy * sz)
    if list(got) != list(indices):
        bad = [(i, a, b) for i, (a, b) in enumerate(zip(got, indices)) if a != b][:5]
        raise AssertionError(f"BlockStates 回读不一致：{bad}")
    pal = reg["BlockStatePalette"]
    for key, idx in layout.items():
        if len(key) == 2:
            x, y, z = key[0], (1 if any(len(k) == 2 for k in layout) and sy > 1 else 0), key[1]
        else:
            x, y, z = key
        at = x + sx * z + sx * sz * y
        assert got[at] == idx, (key, got[at], idx)
        entry = pal[idx]
        props = entry.get("Properties") or {}
        print(f"  ({x},{y},{z}) -> {entry['Name']}"
              f"{'[' + ','.join(f'{k}={v}' for k, v in sorted(props.items())) + ']' if props else ''}")
    assert pal[0]["Name"] == AIR, pal[0]["Name"]
    print(f"  ✓ 回读一致：体积 {sx * sy * sz}，palette {len(pal)}，非空 {sum(1 for v in got if v)}")


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)

    data, bits, indices = build(SX, SY, SZ, PALETTE, LAYOUT, "chest showcase", "showcase", floor=1)
    OUT.write_bytes(gzip.compress(data, 9))
    print(f"写入 {OUT.name}  {len(data)} B（gzip 后 {OUT.stat().st_size} B）  bits={bits}")
    verify(OUT, bits, indices, SX, SY, SZ, PALETTE, LAYOUT, "showcase")

    data, bits, indices = build(TX, TY, TZ, TINY_PALETTE, TINY_LAYOUT, "chest 5x3x1", "chest")
    OUT_TINY.write_bytes(gzip.compress(data, 9))
    print(f"写入 {OUT_TINY.name}  {len(data)} B（gzip 后 {OUT_TINY.stat().st_size} B）  bits={bits}")
    verify(OUT_TINY, bits, indices, TX, TY, TZ, TINY_PALETTE, TINY_LAYOUT, "chest")


if __name__ == "__main__":
    main()
