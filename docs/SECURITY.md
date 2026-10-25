# mcviewer 部署与安全说明

本文覆盖三件事：**默认部署形态**、**安全审查结论**、**把查看器放到公网时的加固清单**。

查看器原本是纯静态页面（`node server.mjs` 只是静态文件服务器）。为了让投影能持久化保存到服务器、并能上传材质包改变方块外观，服务端新增了 `/api/**` 接口和 `data/` 数据目录。**接口是本项目唯一的攻击面**，因此下面逐项列出威胁与对应缓解措施。

---

## 1. 默认部署形态（安全默认值）

| 项目 | 默认值 | 说明 |
| --- | --- | --- |
| 监听地址 | `127.0.0.1:5178` | 只有本机能访问，公网/局域网默认不可达 |
| 上传接口 | 启用 | 本机使用时无需令牌 |
| 访问令牌 | 未设置 | 可用 `--token <口令>` 或环境变量 `MCVIEWER_TOKEN` 启用 |
| 单文件上限 | 32 MB | `--max-upload-mb` 可调 |
| 写入限速 | 20 次/分钟/IP | 上传、删除、烘焙提交都计入 |
| 数据目录 | `./data` | `--data` 可换；`data/projects`、`data/packs` |
| 配额 | 投影 200 个 / 512 MB，材质包 5 个 / 256 MB | 见 `src/server/store.mjs` |

本机双击 `启动查看器.bat` 就是这套默认值，**不需要额外配置**。

### 1.1 线上实例的现状：公开可写

`litematic.zuoqirun.top` 目前**故意没有启用令牌**（用户要求「允许任何人查看/上传」），所以：

- 任何人拿到地址就能**上传、删除**投影与材质包，不需要口令；
- 能防住的只有下面这些：写操作 **20 次/分钟/IP** 限速、单文件 64 MB 上限、投影库 200 个/512 MB 与材质包 5 个/256 MB 配额、`.litematic` 只当数据解析（见 2.1）、材质包 ZIP 结构校验（见 2.2）；
- 防不住的是：有人**删掉**已有投影/材质包（删除是无条件 204），或者把 200 个配额刷满。想让站点长期开放又不担心这两点，最省事的做法是定期 `tar -czf` 备份 `data/`（见 DEPLOY.md「备份」），必要时按 DEPLOY.md「访问令牌」一节把令牌重新打开。

---

## 2. 威胁模型与缓解

### 2.1 上传任意文件（RCE / 解析器攻击面）

- 上传的 `.litematic` 只被当作**数据**处理：`src/server/inspect.mjs` 先校验 gzip 魔数（`1f 8b`），再用 `zlib.gunzipSync` 解压，**解压输出上限 512 MB**（`maxOutputLength`，防解压炸弹），然后交给与浏览器完全相同的纯 JS NBT 解析器 `parseLitematic`。
- 服务端**不会**执行上传内容里的任何东西；NBT 解析器不 `eval`、不构造 `Function`，并且对 `__proto__` 键做了防原型污染处理。
- 解析失败 → `400 INVALID_FILE`，文件不落盘。

### 2.2 ZIP 炸弹 / 恶意材质包

材质包是 zip，因此单独加固（`src/server/zipinfo.mjs`）：

- 自行解析 EOCD + 中央目录，**拒绝 ZIP64**、拒绝加密条目；
- 条目名规范化：拒绝绝对路径、盘符、`..`、`\0`（防 zip-slip）；
- 条目数 ≤ 5000，声明解压总量 ≤ 256 MiB；
- 必须有 `assets/.../blockstates`、`models`、`textures` 结构，否则拒绝；
- 烘焙在**子进程**里跑（`python tools/bake/pack.py`），固定参数、`shell: false`、5 分钟超时、工作目录固定，失败即杀。

### 2.3 路径穿越

- 静态资源与材质包资产都走 `safeJoin()`（`src/server/paths.mjs`）：`decodeURIComponent` 失败、包含 `\0`、归一化后跳出根目录，一律返回 `404`。
- 官方发布目录里的文件名都是生成的 id（`[0-9a-z]{6,24}`），不直接拼接用户输入。

### 2.4 拒绝服务

- 请求体：`content-length` 预检 + 流式累计，超过上限立刻 `destroy`（`413`）；读超时 60 s。
- 全局：`requestTimeout=180s`、`headersTimeout=30s`、`keepAliveTimeout=10s`、`maxHeadersCount=100`。
- 写接口滑动窗口限速 20 次/分钟/IP，超限返回 `429` + `Retry-After`。
- 烘焙串行执行、队列长度上限 4，不会因为连续上传把机器跑满。

### 2.5 XSS / 注入

- 所有响应带 CSP：`default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; ...`，页面没有内联脚本，第三方脚本一律不允许加载（three.js 已打进 bundle）。
- 文件名进入 DOM 前经过渲染器的 `escapeHtml`/`textContent`（UI 面板由 `src/ui/*` 负责），服务端另有 `sanitizeFileName()`：去掉控制字符、把 `\ / < > : " | ? *` 换成 `_`、禁止以 `.` 开头、限长 120 码点。
- JSON 响应统一 `content-type: application/json; charset=utf-8` + `nosniff`。

### 2.6 CSRF

- 写接口只接受 `POST`/`DELETE`，且**不读取 cookie**；鉴权只认 `Authorization: Bearer` 或 `?token=`，浏览器跨站表单无法伪造这两种凭证。
- 因此不存在 cookie 型 CSRF。若以后要加 cookie 登录，必须同时加 `SameSite=Lax` + 自定义头校验。

### 2.7 信息泄露

- `5xx` 只返回「服务器内部错误」，堆栈只写服务端日志。
- 未匹配的 `/api/**` 一律返回 JSON `404`，不会落到静态目录（避免探测目录结构）。
- 目录列表功能不存在；`data/` 不在站点根目录内，只有 `/api/projects/:id/file` 与 `/packs/:id/assets/**` 两个受控出口。
- 响应头：`referrer-policy: no-referrer`、`x-frame-options: SAMEORIGIN`、`cross-origin-resource-policy: same-origin`、`permissions-policy` 关闭摄像头/麦克风/定位。

### 2.8 缓存投毒 / 缓存泄露

- 所有 `/api/**`、上传文件、材质包资产响应都是 `cache-control: no-store`（或 `private, must-revalidate`），不会被中间层缓存后串号。

---

## 3. 部署到服务器（公网/局域网）

### 3.1 必须做的三件事

1. **决定要不要令牌**：想公开浏览 + 公开上传就留空（线上实例当前如此，风险见 1.1）；只想让特定的人上传就加 `--token "至少8位的随机口令"`，页面左栏「服务器投影」面板里填入同一个口令（只存浏览器 localStorage）。
2. **走 TLS**：不要把明文 HTTP 暴露到公网，用 nginx / Caddy 反代到 `127.0.0.1:5178`。
3. **绑定回环 + 反代**：`server.mjs` 监听 `127.0.0.1`，只让反代访问；反代再对外提供 443。

### 3.2 nginx 反向代理示例

```nginx
server {
  listen 443 ssl http2;
  server_name mcviewer.example.com;

  ssl_certificate     /etc/letsencrypt/live/mcviewer.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/mcviewer.example.com/privkey.pem;

  client_max_body_size 40m;          # 要 >= --max-upload-mb

  location / {
    proxy_pass http://127.0.0.1:5178;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;   # 限速按真实 IP 计
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 300s;                            # 材质包烘焙可能要几分钟
  }
}
```

> 限速用的是 `req.socket.remoteAddress`。如果你在反代后面也想按真实客户端 IP 限速，把 `src/server/body.mjs` 的 `clientIp()` 改成优先读 `x-real-ip`。

### 3.3 systemd 单元（Linux）

```ini
[Unit]
Description=mcviewer
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/mcviewer
ExecStart=/usr/bin/node server.mjs --host 127.0.0.1 --port 5178 --token 你的口令 --no-open
Restart=on-failure
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Windows 下可以用 `nssm` 或任务计划程序把 `node server.mjs --token ... --no-open` 注册为服务。

### 3.4 材质包烘焙依赖

上传材质包需要在服务器上能跑 Python 与烘焙脚本：

- 需要 `python`（PATH 里可执行）+ 项目目录下存在 `tools/bake/pack.py` 与 `_dl/client-1.21.1.jar`；
- 缺失时 `/api/capabilities` 返回 `packsSupported: false`，上传会得到 `503 PACK_BAKE_UNAVAILABLE`，其余功能不受影响；
- 若你的服务器不打算开放这个能力，启动加 `--no-api`（纯只读静态站），或不要放置 `_dl/`。

### 3.5 备份与清理

- 备份 `data/` 目录即可（`data/projects/index.json` + `*.litematic`、`data/packs/index.json` + 每个包的 `pack.zip`/`assets/`）。
- `data/packs/<id>/assets/` 是烘焙产物，可按需删除后用 `pack.zip` 重新烘焙。
- 启动时残留的 `queued`/`baking` 材质包会被自动标记为 `error`（避免前端一直转圈），删除后重传即可。

---

## 4. 已知残留风险

1. **未启用令牌 + 对外反代** 等于把上传/删除接口交给所有能访问站点的人（线上实例当前就是这个状态）。启动日志会明确打印「访问令牌 未启用」，请对照检查；不想公开写入就按 DEPLOY.md 加回 `MCVIEWER_TOKEN`。
2. 解析器要完整解压 NBT，单个超大 `.litematic`（几十 MB）会占用相应内存；上限 64 MB 是「文件大小」而不是「解压后大小」，解压上限单独设为 512 MB。
3. 材质包烘焙会调用 Python 处理第三方 zip。烘焙脚本只读取 zip 内声明的资源文件并写出 JSON/PNG，不执行包内脚本；但仍建议只给可信用户开放上传权限。
4. 没有用户体系：公开部署时所有人的投影/材质包都在同一个库里，谁都能删。
5. 上传接口没有做「图片内容嗅探」之类的深度校验，靠 gzip + NBT 结构校验拦截垃圾数据。
