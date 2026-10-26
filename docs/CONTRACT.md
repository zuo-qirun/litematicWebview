# mcviewer 接口契约（v1，改动前必须先告知 Lead）

目标：一个**不需要启动 Minecraft** 的 `.litematic` 原理图查看器。形态为本地 Web 应用：
浏览器端解析文件 + WebGL(three.js) 渲染，`node server.mjs` 启动本地静态服务并打开浏览器，
`build.mjs` 用 esbuild 打包到 `dist/`（全静态、可离线、无 CDN 依赖）。

三条数据流水线，彼此只通过本文件定义的接口耦合：

```
client jar ──[tools/bake/*.py]──> assets/*.json + assets/atlas.png   (烘焙，离线一次性)
.litematic ──[src/core/*.js]──>  Schematic 对象（见 §2）             (浏览器内解析)
Schematic + assets ──[src/render/*, src/ui/*]──> 画面 + 交互         (渲染/UI)
```

契约中的字段名、单位、坐标约定一字不可改；新增字段只能**追加且可选**，并同步更新本文件。

---

## 0. 全局约定

- **坐标**：右手系，**Y 向上**，与 Minecraft 一致。方块占用 `[x, x+1) × [y, y+1) × [z, z+1)`。
- **schematic 局部空间**：以整个 schematic 的包围盒最小角为 `(0,0,0)`，渲染世界直接用这个空间（再做居中）。
- **模型空间**：单个方块内部坐标，`0..16`，Y 向上，与原版 block model 的 `elements.from/to` 一致。
  渲染时除以 16 得到方块单位，再叠加实例平移。
- **单位**：NBT 里没有单位，所有长度都是**方块（block）**。
- **颜色**：`[r,g,b]` 浮点 0..1（渲染用）或 `0xRRGGBB`（烘焙数据用，文档里写明）。
- **坐标负号**：`.litematic` 的 `Region.Size` 任意轴可为负。`Position` 是"起始角"，
  实际占据范围由 `minCorner = min(Position, Position + Size - sign(Size))` 决定（逐轴）。
  容器索引（`BlockStates` 解出的下标）**始终从 minCorner 开始、朝正方向**：
  `index = x + |sx|*z + |sx|*|sz|*y`，`local(x,y,z)` 对应 `world = minCorner + (x,y,z)`。
- **文件格式要点**（已实测 5 个真实文件）：
  - gzip + NBT（大写 `TAG_Compound` 根，无名字）。
  - `BlockStates` 是 `TAG_Long_Array`，**连续位打包**（`TightLongBackedIntArray`）：
    `bitpos = i*bits`，跨 64 位边界时拼接，**不是**原版 Anvil 的每 long 对齐打包。
  - `bits = max(2, 32 - clz(paletteSize - 1))`（最小 2，不是 1）。
  - `BlockStatePalette` 是 `TAG_List<TAG_Compound>`，每项 `Name`(string) + 可选 `Properties`(compound, 值为 string)。
  - `TileEntities` 两种写法都要支持（不同作者工具写出的文件不同）：
    1. **Litematica 原生**：`{Pos:[x,y,z] (TAG_List<int>), TileNBT:{...}}`
    2. **实测常见变体**：`{x,y,z (TAG_Int), ...方块实体 NBT 字段直接内联（含 id）}`
    坐标是**容器索引**（相对 minCorner，0 起）。
  - `Entities` 每项自带完整实体 NBT，`Pos`(TAG_List<double>) 是**相对 region 的 Position（起始角，非 minCorner）**的偏移。
  - `PendingBlockTicks` / `PendingFluidTicks` 每项 `{x,y,z,Block,Time,Priority,SubTick?}`，坐标是**容器索引**（实测范围落在 [0,|size|)）。
  - `Version`=7、`SubVersion`、`MinecraftDataVersion`（整体）、每个 region 还有 `DataVersion`（可缺省→沿用整体）。

---

## 1. 资产契约（`assets/`）

烘焙产物必须只有这 6 个文件（+ 可选 `missing.png`），**再加可选的单文件模型目录 `assets/models/`**：

```
assets/manifest.json
assets/atlas.png           # 图集，RGBA，方形，尺寸 2 的幂，默认 1024
assets/atlas.webp          # 可选：同一张图集的无损 WebP（体积约为 PNG 的 45%）
assets/blocks.json         # 方块名 → 状态解析规则
assets/models.json         # 已烘焙好的模型几何（旋转已展开）；按需模式下作为回退全集
assets/lang.json           # 中英文方块名
assets/meta.json           # 版本、统计、生成时间、无法解析的清单
assets/models/<encoded>.json  # 可选：单文件模型，见 1.3b
assets/entity-icons.png    # 可选：实体头像图集（由 post_entity_icons.py 从 jar 裁脸拼成）
assets/entity-icons.json   # 可选：{file,size,cell,padding,icons:{ "<实体 id>": [x,y,w,h] }}
```

实体头像图集不是方块几何的一部分：`entity-icons.json` 的 `icons` 里每个实体 id 对应
图集里一格（`cell` 见文件，默认 16，图标间留 `padding` 像素）；渲染器按需取用，
没有对应条目的实体仍然退回名字标签。

### 1.1 manifest.json
```json
{
  "format": 1,
  "mcVersions": ["1.21.1", "26.3"],
  "dataVersion": 3955,
  "atlas": { "file": "atlas.png", "size": 1024, "padding": 2, "webp": "atlas.webp" },
  "textureScale": 16,
  "files": { "blocks": "blocks.json", "models": "models.json", "lang": "lang.json", "meta": "meta.json" },
  "modelsMode": "files",
  "modelsDir": "models",
  "modelsCount": 7174
}
```
`dataVersion` = 主 jar 的数据版本（用于 UI 提示），未知方块走 fallback。
`modelsMode`（可选）= `"files"` 时渲染器**不下载** `models.json`，改为打开投影后只下载实际用到的模型（见 1.3b）；缺省或其它值 = 一次加载 `models.json`。`modelsDir` 默认 `models`，`modelsCount` 仅供 UI/自检。

### 1.2 blocks.json
顶层：
```json
{
  "blocks": {
    "<block id 小写，含 minecraft: 前缀>": BlockDef
  }
}
```
`BlockDef` 三种形式（用 `kind` 区分）：

```json
// kind = "variants"：按属性全匹配选一个（或按 weight 随机，取第一个即确定性）
{ "kind": "variants",
  "variants": [ { "when": {"facing": "north", "half": "bottom"}, "models": ["oak_stairs#0,0,0"] } ],
  "default": ["stone"] }          // 所有 variants 都没匹配上时用它（可选）

// kind = "multipart"：所有 when 命中（null=无条件）的 parts 都要叠加渲染
{ "kind": "multipart",
  "parts": [ { "when": null, "models": ["redstone_dust_dot"] },
             { "when": {"north": "side"}, "models": ["redstone_dust_side0"] } ] }

// kind = "invisible" / "missing"
{ "kind": "invisible" }            // bubble_column / light / structure_void 等：不渲染但保留数据
```
- `when` 是**属性完全匹配**（AND）；没有的属性视为不限制。原版 `|`（OR）在烘焙期展开成多个条目。
- `models` 是 `models.json` 的 key，可含多个（weighted random）→ 渲染器取第 0 个。
- 属性值一律为字符串（原版 JSON 就是这样）。

**每个 `BlockDef` 还可带两个可选字段（v1 追加，渲染器与烘焙器共同遵守）**：

- `render`: `"opaque" | "cutout" | "translucent"` —— 渲染分组与材质。
  缺省时渲染器按 id 关键词兜底（water/ice/slime/honey/glass/stained_glass → 对应值），但仍以本字段为准。
- `tintColors`: `{ "<tintindex>": [r, g, b] }` —— 该方块各 tintindex 的**固定着色**（浮点 0..1）。
  渲染规则：quad 的 `tint >= 0` 且 `tintColors[String(tint)]` 存在 → 顶点色 × 该 RGB；**不存在或该字段缺省 → 白（不着色）**。
  颜色表见 §1.6（由烘焙器硬编码，来源是原版 `GrassColors / FoliageColors / WaterColor` 的默认值）。

### 1.3 models.json
```json
{
  "models": {
    "<model id>": {
      "quads": [
        { "p": [x0,y0,z0, x1,y1,z1, x2,y2,z2, x3,y3,z3],
          "uv": [u0,v0, u1,v1, u2,v2, u3,v3],
          "n": 1,
          "tint": 0,
          "tex": "block/stone" }
      ]
    }
  }
}
```
- `p`：12 个 float，模型空间 `0..16`，**顶点顺序必须是逆时针（从正面看）**，即与法线成右手系。
- `uv`：8 个 float，**图集内绝对像素坐标**（左上原点 = 图集左上角，v 向下）。渲染器 `uv / atlasSize` 得到纹理坐标，v 需翻转。
- `n`：面朝向整数：`0=下(-Y) 1=上(+Y) 2=北(-Z) 3=南(+Z) 4=西(-X) 5=东(+X)`。
  用于原版式面明暗（下 0.5 / 上 1.0 / 南北 0.8 / 东西 0.6）。非立方体斜面按最大法向分量取整。
- `tint`：`>=0` 表示该面受方块着色（原版 `tintindex`），`-1` 表示不受影响。
- `tex`：仅调试/UI 用，可为纹理路径 `block/xxx`。

### 1.3b 单文件模型（`assets/models/`，`modelsMode: "files"` 时启用）
每个模型一个文件，内容就是该模型的 **quad 数组**（与 1.3 里 `quads` 完全同构，省掉外层的 `{"models": {...}}`）：

```
assets/models/block$stone.json                 ← block/stone
assets/models/block$oak_stairs@90!0u.json      ← block/oak_stairs#90,0u
```

文件名 = 模型 id 做三处替换（两端必须完全一致，否则就 404）：
```
'/' → '$'        '#' → '@'        ',' → '!'
```
即 JS 侧 `id.replace(/\//g,"$").replace(/#/g,"@").replace(/,/g,"!")`，Python 侧 `tools/bake/bake.py:model_file_name()`。
- 渲染器在 `scene.build()` 收齐「本投影实际用到的模型 id」后一次性批量下载（并发 8），并带上 `?v=<manifest.version>` 以便长期缓存。
- 任一分片 404 时客户端自动回退到整份 `models.json`（兼容旧产物/第三方托管）。
- 烘焙顺序：`bake.py` 写分片 → `post_entity_models.py` 再刷新它改过的 12 个箱子模型分片并更新 `modelsCount`。

### 1.4 lang.json
```json
{ "zh_cn": { "block.minecraft.stone": "石头" },
  "en_us": { "block.minecraft.stone": "Stone" } }
```
键就是原版 lang 的 `block.<path>`；运行时 `zh_cn["block." + name.split(":")[1]]`，缺失回退 en_us，再回退 id 本身。

### 1.5 meta.json
```json
{ "generated": "2026-10-25T12:00:00+08:00",
  "blockCount": 1200, "modelCount": 1500, "quadCount": 26000, "textureCount": 900,
  "atlasUsage": 0.71,
  "missingBlocks": ["minecraft:foo"], "missingTextures": ["block/bar"],
  "notes": ["..."] }
```
`missingBlocks` 会显示在 UI 的告警里。

### 1.6 tint 颜色表（烘焙器必须按此写入 `tintColors`，缺表项一律留空＝不着色）

原版的生物群系着色 = 固定的"默认颜色"（本查看器不区分群系，一律用默认值）。以下颜色为 **1.21.1 的默认值**，
以 `0xRRGGBB` 给出，写入 blocks.json 时转成 `[r,g,b]` 浮点（`/255`）。

| 方块 | tintindex | 色值 | 说明 |
|---|---|---|---|
| `grass_block` / `grass_block[snowy=false]` | 0 | `#91BD59` | 草方块顶面与侧边 overlay（`GrassColors` 默认） |
| `short_grass` `tall_grass` `fern` `large_fern` `sugar_cane` | 0 | `#91BD59` | 同草色 |
| `oak_leaves` `jungle_leaves` `acacia_leaves` `dark_oak_leaves` | 0 | `#48B518` | `FoliageColors` 默认 |
| `mangrove_leaves` | 0 | `#8DB127` | |
| `birch_leaves` | 0 | `#80A755` | |
| `spruce_leaves` | 0 | `#619961` | |
| `vine` | 0 | `#48B518` | |
| `lily_pad` | 0 | `#208030` | `LilyPadBlock` 固定色 |
| `water` `bubble_column` | 0 | `#3F76E4` | `WaterColor` 默认 |
| `redstone_wire` | 0 | `#FF0000` | **近似**：原版按 power 变红，这里固定用最高强度（power=15）；渲染器不再做状态插值 |

- 表中没有的方块即使模型里有 `tintindex` 也**不要**写 `tintColors`（原版没有为它注册颜色，画出来应是白色）。
- 若烘焙器发现某模型 quad 的 tintindex 在该方块 `BlockColors` 中不存在，可把该 quad 的 `tint` 写 `-1`（更准确）。
- 26.3 新增方块同理：没有公认默认色的不要瞎猜。

---

## 2. 解析器契约（`src/core/`）

纯 ES module，零依赖，浏览器 / Node 都能跑。

```js
// src/core/index.js
export async function loadSchematic(arrayBuffer, fileName = "") -> Promise<Schematic>
export function isLitematic(arrayBuffer) -> boolean   // 魔数 1f 8b 或 0a 00
```

### Schematic
```js
{
  fileName: string,
  format: "litematic",
  version: 7, subVersion: 1, dataVersion: 3955,
  metadata: {
    name: string, author: string, description: string,
    timeCreated: number,      // ms 时间戳（NBT 里是 long）
    timeModified: number,
    totalBlocks: number,      // 文件元数据里声明的值（可能不准）
    totalVolume: number,
    enclosingSize: {x,y,z}    // 元数据里的原始值
  },
  size: {x:number,y:number,z:number},   // 实际包围盒尺寸（各轴 > 0）
  min: {x,y,z},                          // 包围盒最小角（schematic 局部空间）
  max: {x,y,z},                          // min + size（排他上界）
  regions: [Region],
  stats: {
    blockCount: number,        // 非空方块总数
    volume: number,            // 所有 region 体积之和
    regionCount: number,
    blockEntityCount: number,
    entityCount: number,
    palette: [ { id: string, name: string, count: number } ]  // 按 count 降序
  },
  warnings: string[]
}
```

### Region
```js
{
  name: string,
  position: {x,y,z},          // 原样（可为负）
  size: {x,y,z},              // 原样（可为负）
  absSize: {x,y,z},
  min: {x,y,z},               // = min(position, position + size - sign(size))
  max: {x,y,z},               // = min + absSize
  dataVersion: number,
  palette: string[],          // ["minecraft:stone", "minecraft:oak_stairs[facing=north,half=bottom]"]
  // 长度 = absSize.x*absSize.y*absSize.z；索引顺序 index = x + sx*z + sx*sz*y
  indices: Uint32Array,
  blockEntities: [ { x:number, y:number, z:number, id:string, nbt:object } ], // 容器索引
  entities:      [ { pos:[x,y,z], id:string, nbt:object } ],                  // 相对 region.position
  ticks:         [ { x:number, y:number, z:number, block:string, delay:number, priority:number } ]
}
```
- `nbt` 是"干净"的 JS 对象：`TAG_Compound`→普通对象，`TAG_List`→数组，`TAG_Int/Long/Float/Double`→number，
  `TAG_Long_Array/Int_Array/Byte_Array`→对应 TypedArray 或普通数组（byte array 用 Uint8Array），`TAG_String`→string。
- 方块实体/实体/刻的数据**不要**预先生成 palette 字符串，原样保留 NBT 供 UI 检查面板使用。
- 解析器遇到的异常（未知 layout、越界索引、负容积等）→ 记进 `warnings`，不抛异常。

---

## 3. 渲染器契约（`src/render/`）

```js
// src/render/db.js
export class BlockDB {
  static async load(baseUrl = "./assets/") -> Promise<BlockDB>
  atlasTexture: THREE.Texture; atlasSize: number
  // 状态字符串 → 已烘焙模型 id 列表（已按 when 匹配）；找不到返回 null
  resolve(stateKey: string) -> string[] | null
  // 状态字符串 → 是否不渲染
  isInvisible(stateKey: string) -> boolean
  // 状态字符串 → 方块级着色（约定取 tintindex 0 的颜色），无则 null。
  // 仅供图例色块/高亮等 UI 用途；真正 per-quad 的着色由 §1.2 的 tintColors[tintindex] 在建几何时决定。
  tint(stateKey: string) -> [number,number,number] | null
  // 状态字符串 → render 分类（opaque|cutout|translucent），供渲染器分组
  renderKind(stateKey: string) -> "opaque"|"cutout"|"translucent"
  // 方块 id（不含属性）→ 本地化名（zh / en）
  displayName(blockId: string, lang = "zh_cn") -> string
  // 直接拿模型几何（缓存解析结果）
  model(modelId: string) -> { quads: Quad[] }
}
```

- 渲染器**自己**负责：把每个方块状态映射成 InstancedMesh（`three` 的 `InstancedMesh`），
  几何 = 该状态所有 baked 模型的 quad 合并；UV、面明暗（vertex color）、tint、`alphaTest` 都在建几何时定死。
- 半透明（水、冰、史莱姆）走单独 pass：`transparent: true, depthWrite: false`，最后绘制。
- `alphaTest = 0.5` 用于玻璃/树叶/植物等 cutout，避免排序问题。
- 方块→状态的字符串格式必须与 `Region.palette` 完全一致（直接当 key 用，不要再解析再序列化）。

### 3.1 运行时合成（资产里没有的东西，渲染器自己补）

以下几类在原版是「代码生成」的，烘焙产物里没有对应几何，必须由渲染器按状态字符串合成：

| 类别 | 规则 | 实现位置 |
| --- | --- | --- |
| 流体高度 | `minecraft:water` / `minecraft:lava` 按 `level` 决定高度：`level>=8`（下落柱）→ 1；否则 `(8-level)/9`。`minecraft:bubble_column` → 水、满高。上方仍是同种流体时取满格，避免层间裂缝。 | `src/render/fluids.js` `fluidInfo()` |
| 含水方块 | `props.waterlogged === "true"` → 在方块内叠一层 8/9 高的水，水平内缩 0.004 避免与方块面共面闪烁。 | `src/render/fluids.js` `waterloggedInfo()` |
| 实体 | 不做几何，只画名字标签 Sprite；位置 = `region.position + entity.pos`；默认只标 mob/vehicle/other（`frame`/`item` 类成排装饰跳过），`E` 键开合。 | `src/render/entities.js` |
| 双箱子 | 依赖 `blocks.json` 里 `when:{facing,type}` 的变体（`type=left/right` 各 4 朝向），**带 `type` 的变体必须排在只有 `facing` 的变体前面**，因为 `db.resolve()` 取第一个命中项、且 `propsMatch()` 只校验 `when` 里出现的键。 | `tools/bake/post_entity_models.py` |
| 切片 | 不用 `renderer.clippingPlanes`（会切出背面 = 视觉重叠）；实例按 y 递增写入并记录「y → 累积数量」表，切片时直接截断 `mesh.count`。 | `src/render/scene.js` `_applySlice()` |
| 选择框 | 用该状态几何的 `boundingBox` 定位/缩放 hover 框与选中框，不完整方块不再套整格。 | `src/render/scene.js` `_fitSelBox()` |

## 4. UI 契约（`src/ui/`）

- 单页；中文界面；深色主题；`index.html` 由 Lead 维护骨架，UI 用 `#app` 挂载。
- 必须提供的交互：打开/拖放文件、视角 orbit、平移、缩放、Y 层切片、Region 显隐、方块图例搜索、
  悬停/点击方块显示坐标 + id + 属性 + 方块实体内容、重置视角、截图、全屏。
- 不允许外链 CDN、不允许 `eval`、不允许后端运行时依赖。

## 5. 构建/运行契约（Lead 维护）

- `pnpm i`（three + esbuild + puppeteer-core，均 devDependency，产物不依赖 node_modules）
- `node build.mjs` → `dist/`（`app.js` 打包 + `index.html` + `styles.css` + `assets/` + `samples/`）；
  `--dev` 不压缩 + inline sourcemap；`--watch` 持续构建
- `node server.mjs [--port 5178] [--dir dist] [--host 127.0.0.1] [--open]` → 静态服务
- `node tests/parser/run.mjs` → 解析器自检（对 5 个 fixture，比对 `tests/parser/expected.json`）
- `node tests/e2e/run.mjs` → 端到端：构建 → 起服务 → 用本机 Chrome（puppeteer-core）
  逐个打开 fixture → 断言 §6 钩子返回的统计量 → 截图 → 要求控制台零错误
- `启动查看器.bat` → 最终用户入口：双击 = 构建（如需）+ 起服务 + 开浏览器
- `pnpm test` = `node tests/parser/run.mjs && node tests/e2e/run.mjs`

## 6. 测试钩子契约（`window.__VIEWER__`，e2e 依赖，渲染器必须实现）

页面在 `src/app.js` 启动完成后挂上 `window.__VIEWER__`，并把 `window.__APP_READY__` 置 `true`。
`__VIEWER__` 只用于自动化测试与调试，不得影响正常交互；实现要小、同步、幂等。

```js
window.__VIEWER__ = {
  version: "1",                              // 钩子版本
  ready: Promise<void>,                      // 与 __APP_READY__ 同步完成
  openFile(bytes: Uint8Array, name: string) -> Promise<SchematicSummary>,
  loadSample(name: string) -> Promise<SchematicSummary>,
  state() -> {
    loaded: boolean,
    fileName: string|null,
    size: [x,y,z]|null,                      // schematic 总包围盒
    min: [x,y,z]|null, max: [x,y,z]|null,     // 世界坐标包围盒（含负 region）
    blockCount: number,                       // 非空气方块总数（所有 region）
    drawnInstances: number,                   // 当前实际提交的实例数（考虑 region 隐藏/切片）
    regionCount: number,
    paletteCount: number,                     // 全局不同方块状态数
    blockEntityCount: number,
    entityCount: number,
    drawCalls: number,                        // renderer.info.render.calls
    triangles: number,                        // renderer.info.render.triangles
    warnings: string[],
    errors: string[]                          // 运行期捕获的错误（可为空）
  },
  getBlocks(filter?: { region?: string, max?: number }) -> [{x,y,z,state,region}] | length,
  setSlice(y: number|null) -> void,           // null = 关闭切片
  setRegionVisible(name: string, visible: boolean) -> void,
  resetCamera() -> void,
  screenshot() -> string                      // data:image/png;base64（与 UI 里的截图同源）
}
```

`SchematicSummary` = `{ fileName, size:[x,y,z], blockCount, regionCount, paletteCount, blockEntityCount, entityCount, warnings:string[] }`。
统计口径必须与 `tests/parser/expected.json`（Lead 的独立 Python oracle）一致：
同一 fixture 的 `blockCount / regionCount / blockEntityCount / entityCount / size` 必须**完全相等**。
`openFile` 收到的是原始字节（不是 File），内部自行解压解析；失败时 reject 一个带 `message` 的 Error 并把消息同时推入 `state().errors`。
