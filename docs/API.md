# mcviewer 服务端接口契约（v1）

> 本文件是「上传/持久化」「材质包」两条新功能的唯一接口契约。
> 实现方：`server.mjs` + `src/server/**`（Lead）；调用方：`src/ui/api-client.js`、`src/app.js`（Lead）；
> UI 组件：`src/ui/library.js`、`src/ui/packs.js`（ui-panels）。三处不得各自发明字段。

## 0. 总则

- 所有接口同源（同 host:port），前缀 `/api`。返回 JSON（`content-type: application/json; charset=utf-8`），除非注明为二进制流。
- 错误统一结构：`{ "error": { "code": "BAD_REQUEST", "message": "人类可读中文说明" } }`，HTTP 状态码见各接口。
- 所有写接口默认要求 `content-type` 明确（`application/octet-stream` 或 multipart 外的原始 body）。
- 令牌保护是**可选项**（启动参数 `--token <t>` 或环境变量 `MCVIEWER_TOKEN`），**不传则完全开放**（线上实例当前就是开放状态，便于任何人上传/查看）。启用后：
  - 所有 `/api/**` 必须带 `Authorization: Bearer <t>` 或 `?token=<t>`；
  - 未授权返回 `401 { error: { code: "UNAUTHORIZED" } }`；
  - `GET /api/capabilities` 例外（永远公开），其中 `auth: true/false` 告知前端当前是否需要令牌。
- 单次请求体上限：**32 MiB**（`maxUploadBytes`，`--max-upload-mb` 可调），超限 `413 { code: "PAYLOAD_TOO_LARGE" }`。
- 同一 IP 的写请求限速：**20 次 / 分钟**，超限 `429 { code: "RATE_LIMITED", retryAfter: 秒 }`。
- 服务端数据目录：`data/`（不在 `dist/` 内，不进版本库）：
  - `data/projects/<id>.litematic`
  - `data/projects/index.json`（服务器维护，前端只读不算）
  - `data/packs/<id>/pack.zip`、`data/packs/<id>/assets/**`、`data/packs/index.json`
  - `data/` 可通过 `--data <dir>` 覆盖，默认 `<repo>/data`。

## 1. 能力探测

### `GET /api/capabilities`
永远公开，用于前端判断是否启用服务器功能。

```json
{
  "version": 1,
  "projects": true,
  "packs": true,
  "auth": false,
  "maxUploadBytes": 33554432,
  "limits": { "projects": 200, "packs": 5, "totalBytes": 536870912 },
  "packsSupported": true,   // 服务端能找到 python 与烘焙脚本；false 时 UI 只显示提示
  "python": "3.13.2"
}
```

## 2. 投影库（持久化上传）

投影条目的公共形状 `Project`：

```json
{
  "id": "9f3c1a2b7d",            // 服务器生成：8-16 位 [a-z0-9]
  "name": "沼泽刷怪塔_黑山大叔_1.21.1.litematic",  // 原始文件名（已消毒，保留中文）
  "size": 14658,                  // 字节
  "blocks": 7515,                 // 服务端快速解析的非空气方块数（-1 表示未解析）
  "regions": 15,
  "author": "黑山大叔",           // 取自 Metadata.Author，可缺省 ""
  "mcVersion": "1.21.1",          // 取自 DataVersion 映射，可缺省 ""
  "createdAt": "2026-10-25T06:20:11.123Z",
  "url": "/api/projects/9f3c1a2b7d/file"
}
```

### `GET /api/projects`
`200 { "items": [Project...], "storage": { "count": 3, "bytes": 123456, "maxBytes": 536870912, "maxCount": 200 } }`
按 `createdAt` 倒序。

### `POST /api/projects`
- 请求：原始字节流（`.litematic` 文件内容），请求头必须含 `x-file-name: <encodeURIComponent(文件名)>`。
- 校验（服务端）：gzip 魔数 `1f 8b`、NBT 顶层可解、Magic/Version 合法、大小 ≤ 32 MiB、同名文件自动加后缀 `(2)`。
- 成功：`201 { "item": Project }`
- 失败：`400 { code: "INVALID_FILE" | "BAD_FILENAME" }`、`413`、`409 { code:"QUOTA_EXCEEDED" }`

### `GET /api/projects/:id/file`
返回 `application/octet-stream`，带 `content-disposition: attachment; filename*=UTF-8''<encoded>` 与 `etag`。
`404 { code: "NOT_FOUND" }`

### `DELETE /api/projects/:id`
`204`，`404`。

## 3. 材质包（资源包）

条目 `Pack`：

```json
{
  "id": "p_7d21c9",
  "name": "我的材质包.zip",
  "size": 1048576,
  "status": "ready",            // "queued" | "baking" | "ready" | "error"
  "progress": 1.0,              // 0..1
  "message": "",                // error 时的中文原因
  "assetsUrl": "/packs/p_7d21c9/assets/",   // ready 后可直接作为 BlockDB.load 的 baseUrl
  "stats": { "blocks": 1289, "models": 7164, "quads": 71185, "textures": 1114, "overrides": 27 },
  "createdAt": "2026-10-25T06:20:11.123Z"
}
```

### `GET /api/packs`
`200 { "items": [Pack...], "storage": { "count": 1, "bytes": 1048576, "maxBytes": 268435456, "maxCount": 5 } }`

### `POST /api/packs`
- 原始字节流 = 资源包 zip；请求头 `x-file-name`（同上传）。
- 校验：zip 中央目录可读、条目数 ≤ 5000、解压后总量 ≤ 256 MiB（防 zip 炸弹）、无绝对路径/`..`（防 zip-slip）、必须包含 `assets/minecraft/` 下至少一个 `blockstates/*.json | models/*.json | textures/**/*.png`。
- 成功：`202 { "item": Pack }`（`status` 为 `"queued"` 或已进入 `"baking"`，取决于烘焙队列是否空闲），后台任务开始烘焙；前端轮询 `GET /api/packs/:id`。
- 失败：`400 { code: "INVALID_PACK" }`、`413`、`409 { code:"QUOTA_EXCEEDED" }`

### `GET /api/packs/:id`
`200 { "item": Pack }`，`404`。

### `DELETE /api/packs/:id`
`204`（同时删除烘焙产物），`404`。

### 静态产物
`GET /packs/:id/assets/**` → 烘焙后的资产（与 `dist/assets/**` 同构，含 `manifest.json`）。带 `etag`、可 gzip。

## 4. UI 模块契约（ui-panels 实现，app.js 调用）

### `src/ui/api-client.js`
```js
export class ApiError extends Error { constructor(message, { status, code } = {}) {} }
export const api = {
  capabilities(),                      // -> Capabilities
  listProjects(),                      // -> { items, storage }
  uploadProject(file, onProgress),     // file: File；onProgress(0..1)；-> Project
  deleteProject(id),
  projectFileUrl(id),                  // 字符串，不请求
  listPacks(),                         // -> { items, storage }
  uploadPack(file, onProgress),        // -> Pack
  getPack(id),                         // -> Pack
  deletePack(id),
  setToken(token),                     // localStorage 保存，null 清除
  getToken(),
};
```
- 上传必须用 `XMLHttpRequest` 以获得 `upload.onprogress`；`onProgress` 至少在有 body 时调用。
- 当 `capabilities()` 抛 404 或网络错误时，`api.available = false`，所有方法抛 `ApiError("服务器未启用该功能", {status:0,code:"UNAVAILABLE"})`。

### `src/ui/library.js`
```js
export function createLibrary(container, hooks)
// container: 左侧栏内的一个 <div class="card"> 挂载点（由 app-shell.js 提供）
// hooks: {
//   onOpen(project) -> Promise<void>,    // 由 app.js 实现：fetch(project.url) → bytes → viewer.openFile
//   onError(err, project?),              // 展示 toast，由 app.js 提供
// }
// 返回: { refresh(): Promise<void>, setEnabled(bool), destroy() }
```
自渲染内容：标题行（「服务器投影」+ 计数 + 刷新按钮）、上传按钮（点击触发隐藏 `<input type=file accept=".litematic">`）、条目列表（名称、方块数、大小、时间；hover 出现「加载 / 删除」）、空态一行说明、上传中进度条。列表为空且 `onOpen` 未提供时显示「服务器未启用」灰态。

### `src/ui/packs.js`
```js
export function createPackPanel(container, hooks)
// hooks: {
//   onApply(pack) -> Promise<void>,   // app.js 用 pack.assetsUrl 重新加载 BlockDB
//   onClear() -> Promise<void>,       // 恢复内置资产
//   onError(err, pack?),
// }
// 返回: { refresh(): Promise<void>, setEnabled(bool), setActive(packId|null), destroy() }
```
自渲染内容：当前材质包名（或「内置默认」）、上传按钮、列表（名称 / 覆盖方块数 / 状态徽章 排队|烘焙中 xx%|就绪|失败）、「使用」「取消使用」「删除」。`status !== "ready"` 的条目禁用「使用」；有 baking 条目时每 2s 轮询一次 `refresh()`，无 baking 时停止轮询。

### 样式
ui-panels 在 `styles.css` 里新增区块，沿用既有 token（`--bg-panel` 等）；新增类名以 `.lib-` / `.pack-` 前缀，避免与既有 `.card-*` 冲突。

## 5. app.js 侧接线（Lead 负责，供 ui-panels 参考）

```js
const caps = await api.capabilities().catch(() => null);
library = createLibrary(refs.library, { onOpen: openServerProject, onError: showApiError });
packs   = createPackPanel(refs.packPanel, { onApply: applyPack, onClear: clearPack, onError: showApiError });
if (caps?.projects) await library.refresh(); else library.setEnabled(false);
if (caps?.packs)    await packs.refresh();   else packs.setEnabled(false);
// applyPack: assetsBase = pack.assetsUrl; db = await BlockDB.load(assetsBase); scene.db = db; 重建场景
```

- `BlockDB.load()` 的 baseUrl 允许为绝对路径（`/packs/xxx/assets/`）；`src/render/db.js` 用 `new URL(name, new URL(base, location.href))` 拼接，确保绝对/相对都正确。
- 材质包切换后必须重建 `ViewerScene`（`dispose()` 后重新 `new`，或复用 `build()`）。
