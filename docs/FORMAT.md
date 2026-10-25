# `.litematic` 文件格式备忘（实测版）

本文是 mcviewer 实现过程中反推出来的 `.litematic` 结构说明，来源有两条：
阅读 [Litematica](https://github.com/maruohon/litematica) 源码（`schematic/LitematicaSchematic.java`、
`schematic/container/*`、`util/PositionUtils.java` 等），以及对 5 个真实投影文件的逐字节验证
（`tools/truth.py` 是独立实现的参考 oracle，`tests/parser/expected.json` 是它输出的期望值）。

> 结论只覆盖 Litematica 自己的 `.litematic`（Version=7）。WorldEdit `.schem`、Sponge `.schematic` 不在本文范围。

---

## 1. 容器

- 文件 = **gzip 压缩的 NBT**（魔数 `1f 8b`）。解压后是标准 NBT，根标签是**无名的 `TAG_Compound`**。
- 因此读文件的第一步永远是 `gunzip`，浏览器里用 `DecompressionStream("gzip")` 即可，不需要第三方库。
- 也有少数工具写成未压缩 NBT（根标签 `0a 00` 开头），解析器顺手兼容一下成本很低。

## 2. 顶层结构

```
TAG_Compound ""                       <- 根
├── TAG_Int        Version            = 7
├── TAG_Int        SubVersion         (常见 1)
├── TAG_Int        MinecraftDataVersion  (如 3955 = 1.21.1，4189 = 1.21.4，4671 = 更新)
├── TAG_Compound   Metadata
│   ├── Name / Author / Description / TimeCreated / TimeModified (TAG_Long)
│   ├── EnclosingSize (TAG_Compound, 3×TAG_Int)     // 整个投影的包围盒尺寸，含符号
│   ├── RegionCount (TAG_Int)、TotalVolume (TAG_Int)、TotalBlocks (TAG_Int)
│   └── PreviewImage (可选，TAG_Byte_Array，缩略图)
└── TAG_Compound   Regions
    └── <任意名字> TAG_Compound      <- 一个 region（子投影）
```

- **Region 的名字是任意字符串**，可以是中文（真实文件里就有 `海带种植`、`信号传输部分A`），
  它对渲染没有语义，但 UI 里要能显示和勾选，所以解析器**必须保留原始名字**。
- 一个文件可以有 1 个到几十个 region，彼此会有空间重叠。

## 3. Region 结构

```
TAG_Compound <regionName>
├── TAG_Compound Position       {X,Y,Z}   // 起始角（世界/投影坐标），任意符号
├── TAG_Compound Size           {X,Y,Z}   // 尺寸，任意轴可为负！
├── TAG_Int      DataVersion              // 可缺省 → 用顶层 MinecraftDataVersion
├── TAG_List<Compound> BlockStatePalette  // 调色板，每项一个方块状态
├── TAG_Long_Array     BlockStates        // 位打包的索引数组
├── TAG_List<Compound> TileEntities       // 方块实体（箱子内容、告示牌文字…）
├── TAG_List<Compound> Entities           // 实体（矿车、盔甲架…）
├── TAG_List<Compound> PendingBlockTicks  // 计划方块刻
└── TAG_List<Compound> PendingFluidTicks  // 计划流体刻
```

### 3.1 Position / Size 与负尺寸（最大的坑）

**`Size` 的任意轴都可以是负数**，表示第二个角落在起始角的负方向。
源码 `SchematicRegion.getSize()` 的注释原文：

> The size can be negative on any axis, if the second corner is on the negative side on that axis
> compared to the primary/origin corner.

真实文件里这非常常见：`海草机打包收集` 是 `pos(14,0,0) size(-15,13,16)`，
`沼泽刷怪塔` 的 15 个 region 里大半都有负轴。

正确的换算（逐轴独立判断）：

```
abs(x)   = |x|
endPos   = pos + size - sign(size)          // 另一端（含）的坐标
minCorner= min(pos, endPos)                 // 包围盒最小角
span     = |size|
```

于是 region 占据 `[minCorner, minCorner + span)`。
**容器里的索引空间永远从 minCorner 起、朝正方向**，与 Size 的符号无关 —— 这一点由源码
`SchematicPlacingUtils` 里的 `posMinRel = getMinCorner(regionPos, getRelativeEndPositionFromAreaSize(regionSize))`
和注释 "Get the offset relative to the sub-region's minimum corner, instead of the origin corner
(which can be at any corner)" 双重确认。

### 3.2 方块索引的排布

```
index(x,y,z) = x + |sx| * z + |sx| * |sz| * y      // x 变化最快，y 最慢
world(minCorner + (x,y,z)) = 该索引对应的方块
```

对应源码 `ArrayBlockContainer.getIndex`：
`((long) y * sizeLayer) + (long) z * sizeX + (long) x`，其中 `sizeLayer = sizeX * sizeZ`。

**注意这是"x 最快"的顺序**，和很多人的直觉（y 最快）不同；写错会让模型整体"错位成条状"。

## 4. 调色板与位打包

### 4.1 BlockStatePalette

`TAG_List<TAG_Compound>`，每项：

```
{ Name: "minecraft:oak_stairs",
  Properties: { facing: "north", half: "bottom", shape: "straight_straight", waterlogged: "false" } }
```

- `Properties` 可缺省（无属性方块，如 `minecraft:stone`）。属性值**一律是字符串**。
- Litematica 写盘时属性按键名排序；解析器**不要**假设顺序，统一按排序后的键值对重建字符串，
  保证同一状态在不同文件里得到同一个 key。
- 状态字符串约定（本项目的 key 格式，也用作 UI 显示）：
  `minecraft:oak_stairs[facing=north,half=bottom,shape=straight_straight,waterlogged=false]`
  无属性时不带方括号。
- 调色板第 0 项**不保证**是空气（真实文件里通常是，但别依赖）。

### 4.2 BlockStates 的位打包

`TAG_Long_Array`，**连续位打包**（Litematica 自定义的 `TightLongBackedIntArray`），
不是原版 Anvil 的"每个 long 只放整数个元素、剩余位空着"的写法：

```
bits      = max(2, 32 - clz32(paletteSize - 1))     // 最小 2 位，不是 1 位
longCount = ceil(volume * bits / 64)                // volume = |sx| * |sy| * |sz|
```

取第 `i` 个索引：

```js
const bitPos   = i * bits;
const startIdx = bitPos >>> 6;
const offset   = bitPos & 63;
const mask     = (1n << BigInt(bits)) - 1n;
let v = (BigInt(longs[startIdx]) >>> BigInt(offset)) & mask;   // 注意用无符号右移
if (offset + bits > 64) {                                      // 跨 long 边界
  const spill = BigInt(offset + bits - 64);
  v |= (BigInt(longs[startIdx + 1]) & ((1n << spill) - 1n)) << BigInt(64 - offset);
}
index = Number(v);
```

**必须用无符号位移**（JS 里 `>>>` 对 32 位、BigInt 用 `BigInt.asUintN()` 或先 `BigInt(x) & 0xFFFFFFFFFFFFFFFFn`）。
Java 的 `long` 是有符号的，真实文件里出现过负的 long 值；当 `offset` 为 0 且 `bits == 64` 这类极端情况才无所谓，
但 `offset > 0` 时把负数当有符号右移会污染结果。

校验：`longCount === ceil(volume * bits / 64)` 不成立时说明 `bits` 猜错了（通常是 paletteSize 被读错）。

## 5. 方块实体的坐标空间

`TileEntities` 有两种实际出现的写法，**都要支持**：

```nbt
# 写法 1 —— Litematica 原生
{ Pos: [x, y, z],          # TAG_List<TAG_Int>，3 个
  TileNBT: { ...原始方块实体 NBT... } }

# 写法 2 —— 常见变体（部分工具/版本直接内联）
{ x: 0, y: 0, z: 0,        # TAG_Int
  id: "minecraft:chest", Items: [...], ...其余字段内联 }
```

两种写法的坐标都是**容器索引**（相对该 region 的 minCorner，范围 `[0, |size|)`）。
源码证据：`placeBlocksToWorld` 里先 `posMutable.set(x, y, z)`（容器索引）直接去 `blockEntityMap.get(posMutable)`，
之后才加上 `posMinRel - regionPos` 换算成世界坐标。

> 实测：`发射器A` region `pos(-53,3,-12) size(7,-10,-9)` 里一个 `hopper_minecart` 的 `Pos` 是
> `[1.5, -7.9375, -3.49]` —— 这是下面 §6 的实体规则（origin 相对，y 可以是负数）；
> 而同一文件的方块实体坐标全部是小非负整数（minCorner 相对）。两个空间不一样，别混用。

## 6. 实体的坐标空间（和方块实体不一致！）

`Entities` 每项是完整实体 NBT（`id`、`Pos`(TAG_List<double>)、`Motion`、`Rotation`、`Items`…）。

- 实体 `Pos` 是**相对 region 的 `Position`（起始角）**，**不是**相对 minCorner。
  源码 `placeEntitiesToWorld`：`x = pos.x + offX`，`offX = regionPosRelTransformed.getX() + origin.getX()`。
- 因为起始角可能不是最小角，实体的相对坐标**可以是负数**（上面那个 `-7.9375` 就是）。
- 换算：`world = regionPosition + entityPos`（再加上 region 在整体里的平移）。

渲染器可以先不画实体，但解析器必须把数据原样带出来，UI 检查面板和后续功能都要用。

## 7. 计划刻

`PendingBlockTicks` / `PendingFluidTicks` 每项：

```
{ Block: "minecraft:observer", Priority: 0, Time: 12, x: 4, y: 4, z: 14, SubTick: 0 }
```

`x/y/z` 是**容器索引**（实测落在 `[0, |size|)`），`Time` 是延迟刻数。
本查看器只做展示（统计数量、检查面板列出），不模拟刻逻辑。

## 8. 数据版本

一个文件里可能同时存在多个 `DataVersion`（顶层一个，每个 region 可各有一个）。
真实样本：3953（1.21）、3955（1.21.1）、4082（1.21.2/3）、4189（1.21.4）、4671（更新版本）。
本查看器**不做版本迁移**：方块状态名字符串原样透传，资产库里找不到的方块记为缺失并渲染成洋红色。

## 9. 实测校对表（`tests/parser/expected.json`）

| 文件 | 体积 | 非空方块 | region | 方块实体 | 实体 | 调色板 | 包围盒 |
|---|---|---|---|---|---|---|---|
| 25w简易海草机by-half_kite | 392 | 135 | 1 | 30 | 0 | 41 | 7×8×7 |
| 海草机打包收集-by小鱼 | 3120 | 966 | 1 | 272 | 5 | 106 | 15×13×16 |
| 沼泽刷怪塔_黑山大叔_1.21.1 | 13995 | 7515 | 15 | 218 | 49 | 103 | 52×130×37 |
| xianyu-MIS_configured_v2.1 | 32340 | 11685 | 1 | 2275 | 39 | 353 | 33×28×35 |
| 豪华版mis正式版v1.7 | 152880 | 40422 | 1 | 6517 | 37 | 617 | 65×49×48 |

"体积"= 所有 region 的 `|sx|*|sy|*|sz|` 之和；"非空方块"= 索引非空气的数量。

## 10. 容易踩的 8 个坑（按踩到概率排序）

1. **负 Size**：不取绝对值 → 体积为负、循环不执行、统计直接变 0。
2. **位打包**：按 Anvil 的对齐方式解 → 从第二个元素起全错（画面变成斜条纹）。
3. **bits 下限是 2**：调色板只有 2 项时用 1 位解 → 一半方块错位。
4. **索引顺序**：x 最快、y 最慢，写成 y 最快 → 模型"压扁/错层"。
5. **方块实体坐标系**用成实体那套（origin 相对）→ 箱子内容全部错位到界外，UI 里看起来"没有方块实体"。
6. **有符号 long**：`>>` 写成有符号右移，遇到负 long 时高位全 1。
7. **属性字符串顺序**：不做排序 → 同一状态被拆成两个 key，实例数暴涨、模型丢失。
8. **region 名当文件路径/键名**用：中文名合法，但不要假设唯一（不同 region 可以重名，Litematica 用 Compound 键名区分，
   解析时若遇到重名请加后缀并记 warning）。
