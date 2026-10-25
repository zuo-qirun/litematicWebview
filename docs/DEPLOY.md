# 部署说明（ser8-home / 宝塔面板）

线上地址：<http://litematic.zuoqirun.top>（HTTPS 待域名解析后执行 `deploy/enable-ssl.sh`）
服务器：ser8-home（内网 `192.168.1.60`），Ubuntu 26.04，宝塔面板 13.1.0 + nginx 1.26.3。

## 架构

```
浏览器 ──HTTP/HTTPS──> nginx（宝塔 Node 项目 node_litematic_viewer.conf）
                          └─ location /  → 反向代理 127.0.0.1:5180（Node 服务，令牌鉴权可选）

Node 服务（宝塔 Node 项目 litematic_viewer，用户 www，端口 5180）
  ├─ server.mjs              静态文件 + /api 路由（不经过 nginx 也能单独跑）
  ├─ src/server/*.mjs        API / 存储 / 上传校验 / 材质包烘焙队列 / 安全头
  ├─ tools/bake/*.py         材质包烘焙（需要 Python + Pillow + numpy）
  ├─ _dl/client-1.21.1.jar   烘焙所需的原版客户端资源
  └─ 数据目录 ../data        投影与材质包（在 webroot 之外，不会被静态下载）
```

前端与 API 同源，全部由 Node 服务提供；nginx 只负责 80/443 入口与反向代理。
静态资源（`public/`）也由 Node 直接读盘返回，所以**不需要**在 nginx 里再写一份 root。

## 站点在宝塔里的样子

- 位置：宝塔「网站」→ **Node 项目**标签页 → 项目名 **`litematic_viewer`**，备注「Litematica 投影查看器」，域名 `litematic.zuoqirun.top`。
- 启动方式：宝塔用 `nohup npm run start` 起进程，PID 记在 `/www/server/nodejs/vhost/pids/litematic_viewer.pid`，启动脚本 `/www/server/nodejs/vhost/scripts/litematic_viewer.sh`，日志 `/www/wwwlogs/nodejs/litematic_viewer.log`。
- 实际启动命令来自 `app/package.json` 的 `scripts.start`：
  ```json
  "start": "node server.mjs --port 5180 --dir ../public --data ../data --max-upload-mb 64 --no-open"
  ```
  改启动参数要改这里（改完在面板里点「重启」）。
- 开机自启：`project_config.is_power_on = true`，由宝塔启动脚本 `class/jobs.py` → `script/run_script.py` → 各 `projectModel` 的 `auto_run()` 拉起（加 `is_power_on` 判断）。可用
  `btpython /www/server/panel/script/run_script.py` 手动模拟。
- 站点类型必须是 `project_type='Node'` **且** `project_config` 字段齐全（下面这份就是现场配置）：
  ```json
  {"project_name":"litematic_viewer","project_cwd":"/www/wwwroot/litematic.zuoqirun.top/app",
   "project_script":"start","bind_extranet":1,"domains":["litematic.zuoqirun.top:80"],
   "is_power_on":true,"run_user":"www","max_memory_limit":0,"nodejs_version":"v24.15.0",
   "port":5180,"log_path":"/www/wwwlogs/nodejs","pkg_manager":"npm",
   "pm2_name":"","watch":false,"cluster":1,"project_type":"nodejs","env":""}
  ```
  ⚠️ 反例：只有 `project_type='Node'`、`project_config='{}'` 时，面板「网站 → Node项目」页会 500：
  ```
  KeyError: 'project_script'  (class/projectModel/nodejsModel.py:2020)
  ```
  修复：补全 `project_config`（推荐用面板界面重建项目），或临时改回 `project_type='PHP'`。
- 从「普通站点 + systemd」迁到「Node 项目」的完整脚本见 `deploy/migrate-to-bt-node.sh`。
- **systemd 单元 `/etc/systemd/system/litematic-viewer.service` 已 disable**，只作为应急备用：
  面板挂了可 `systemctl start litematic-viewer`（先停掉面板的 Node 项目，否则抢 5180 端口）。

## 目录

| 路径 | 说明 |
| --- | --- |
| `/www/wwwroot/litematic.zuoqirun.top/public/` | 前端（dist 直接上传，`.user.ini` 为宝塔保护文件可忽略） |
| `/www/wwwroot/litematic.zuoqirun.top/app/` | Node 服务代码；`app/assets` 是指向 `../public/assets` 的软链；`app/node_modules/` 是空目录（宝塔要求存在才能启动） |
| `/www/wwwroot/litematic.zuoqirun.top/data/` | `projects/`、`packs/`、`index.json`（**唯一需要备份的目录**） |
| `/www/wwwroot/litematic.zuoqirun.top/venv/` | 烘焙用 Python（`--system-site-packages` 继承系统 numpy，另装 Pillow） |
| `/etc/litematic-viewer.env` | 令牌与 Python 路径（`root:www 640`，Node 以 www 运行，服务启动时自行读取） |
| `/www/server/panel/vhost/nginx/node_litematic_viewer.conf` | 宝塔为 Node 项目生成的 vhost（**不要手改**，面板会重写；要加配置写到 `extension/litematic_viewer/*.conf`） |
| `/www/server/nodejs/vhost/scripts/litematic_viewer.sh` | 宝塔生成的启动脚本（每次启动会重写） |
| `/www/wwwlogs/nodejs/litematic_viewer.log` | 运行日志 |

## 常用命令

```bash
# 进程状态/日志（面板也能看，命令行更快）
cat  /www/server/nodejs/vhost/pids/litematic_viewer.pid
ps -o pid,user,args -p $(cat /www/server/nodejs/vhost/pids/litematic_viewer.pid)
tail -f /www/wwwlogs/nodejs/litematic_viewer.log

# 重启用面板的接口（等价于点面板上的「重启」）
btpython - <<'PY'
import sys, time
sys.path.insert(0, '/www/server/panel/class'); sys.path.insert(0, '/www/server/panel')
from projectModel.nodejsModel import main
class Get(dict):
    def __getattr__(self, k):
        try: return self[k]
        except KeyError: raise AttributeError(k)
    def __setattr__(self, k, v): self[k] = v
m = main()
print(m.restart_project(Get({'project_name': 'litematic_viewer'})))
PY

cat /etc/litematic-viewer.env        # 查看访问令牌（MCVIEWER_TOKEN）
nginx -t && /www/server/nginx/sbin/nginx -s reload
```

访问 `/api/capabilities` 可确认服务健康与能力：

```bash
curl -s http://127.0.0.1:5180/api/capabilities
```

## 访问令牌（当前：未启用）

线上实例**没有设置访问令牌**，任何人都能浏览、上传、删除投影与材质包（只读浏览本来就不需要令牌）。服务端有三道兜底：

- 写接口限速 **20 次/分钟/IP**（`RATE_LIMITED` 429）；
- 单次上传上限 64 MB（三处联动，见下一节）；
- 投影库配额 200 个 / 512 MB，材质包 5 个 / 256 MB，超了会被拒。

如果哪天想收紧成「只让知道口令的人上传」：

1. 在 `/etc/litematic-viewer.env`（`root:www 640`）里加一行 `MCVIEWER_TOKEN=<至少8位随机串>`，`server.mjs` 启动时自动读取，**不会出现在 `ps` 命令行里**（文件位置可用 `--env-file` 或 `MCVIEWER_ENV_FILE` 覆盖）；
2. 重启项目（见上面「常用命令」）；
3. 页面左栏「服务器投影」面板会出现令牌输入框，填一次存浏览器 localStorage；`GET /api/capabilities` 的 `auth` 会变 `true`；
4. 生成口令：`head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'`；查看当前：`cat /etc/litematic-viewer.env`。

`/etc/litematic-viewer.env` 里另有 `MCVIEWER_PYTHON`（材质包烘焙用的 venv 解释器）与 `MCVIEWER_ALLOW_PUBLIC_WRITES=1`（仅作记录，代码不读这个键）。

## 上传体积

`/api/projects`、`/api/packs` 的上限由三处共同决定，改的时候三处一起改：

1. 服务端 `--max-upload-mb 64`（在 `app/package.json` 的 `start` 脚本里）；
2. nginx 全局 `client_max_body_size 72m`（`/www/server/nginx/conf/nginx.conf`，宝塔生成的 Node vhost 不含该指令）；
3. 页面上传前的本地预检（读 `/api/capabilities` 的 `maxUploadBytes`）。

## 升级（本地改完代码后）

```bash
node build.mjs                              # 本地构建前端到 dist/
# 上传 public/ 与 app/ 的同名文件（或整目录覆盖），然后重启项目
node _deploy/put.mjs dist /www/wwwroot/litematic.zuoqirun.top/public
node _deploy/put.mjs app  /www/wwwroot/litematic.zuoqirun.top/app
# 重启见上面「常用命令」
```

只改前端时可以只覆盖 `public/`，浏览器强刷即可；改服务端必须重启。

## 材质包烘焙依赖

服务器需要能执行烘焙脚本：

```bash
/www/wwwroot/litematic.zuoqirun.top/venv/bin/python3 -c "import PIL, numpy; print('ok')"
```

`MCVIEWER_PYTHON` 已指向该 venv。若能力探测显示 `packsSupported:false`，先检查这里。

**两个客户端 jar 都要放**：`app/_dl/` 下需要 `client-1.21.1.jar`（主基准）**和** `client-26.3.jar`（补新方块）。只放 1.21.1 时烘焙产物会少掉 200 多个 26.3 新增方块，用这些方块的投影会出现缺失模型。

材质包里的单个坏文件不会让整包失败：解析失败的 `blockstates/models/lang` JSON 或坏 PNG 会被跳过（回退到内置资源），并写进 `report.json` 的 `skippedEntries` 与 `warnings`，面板照常可以用。

## 首屏体积与缓存（2026-10 优化）

远端带宽是家庭宽带上行，所以前端按「能省则省」设计，`node build.mjs` 会自动做五件事：

1. **按需模型分片**：`assets/models/` 下每个模型一个 JSON（7174 个，共 8.8 MB）。首页完全不碰它们；打开投影时只下载**这个投影实际用到的**那批模型（几十到几百个小文件，每片 br 后 0.3–0.9 KB），并带 `?v=` 永久缓存。`models.json`（9.1 MB）只作为分片 404 时的回退全集，正常访问不会下载。
2. **预压缩**：`dist/**/*.json|js|css|html` 旁边生成 `.br`（brotli；大文件 q11、小分片 q9）与 `.gz`（gzip -9），`server.mjs` 按 `Accept-Encoding` 直接发预压缩文件，不再现场压缩。
3. **版本号 + immutable**：`index.html` 里引用带 `?v=<hash>`，`assets/*.json` 与模型分片带 `?v=<assets hash>`；`server.mjs` 对带 `?v=` 的请求回 `Cache-Control: public, max-age=31536000, immutable`，二次访问几乎零下载。
4. **图集 WebP**：烘焙同时产出 `atlas.webp`（无损，374 KB → 171 KB），前端优先用它，失败自动回退 `atlas.png`。
5. **分段加载**：首页只拉 `manifest.json` + `meta.json`（约 3 KB）+ 面板接口；`blocks.json` / `lang.json` / 图集 / 模型都等真正打开投影时才下载。

实测（局域网，见 `node tests/ui/perf.mjs`）：

| 阶段 | 优化前 | 优化后（HTTP/gzip） | 优化后（HTTPS/br） |
| --- | --- | --- | --- |
| 首屏（空态） | 1.14 MB | 198 KB | ≈ 169 KB |
| 打开一个投影（966 方块） | 1.14 MB（含首屏） | **+371 KB** | ≈ +250 KB |
| 二次访问 | 1.14 MB | — | **6 KB** |

注意：**Chrome 只在 HTTPS 下才和服务器协商 brotli**，所以走 Cloudflare / 装好证书后能再省 40% 左右。模型分片多了几十上百个请求，HTTP/1.1 下受浏览器每域名 6 并发限制；上了 HTTPS（HTTP/2 多路复用）后这批请求基本不增加等待时间。

CDN 相关：静态资源已带 immutable 缓存头，代理/CDN 开启缓存后回源只发生一次。**当前 EdgeOne 加速域名实测把所有资源都回源（`EO-Cache-Status: MISS`，连 `?v=` 的不可变资源也不缓存），且没有为该域名绑定证书（HTTPS 报证书不匹配）**——这是「下载慢」的主因，需要在 EdgeOne 控制台：① 绑定/上传 `litematic.zuoqirun.top` 的证书；② 打开缓存并配置缓存规则（按 `Cache-Control` 遵循源站、缓存键忽略查询字符串、`.js/.css/.json/.webp` 长缓存）；③ 开启 Brotli。若改用 Cloudflare：不要开「Rocket Loader」（会破坏 ES module），也不用开 Mirage/Polish（图集是像素画，二次编码会糊）。


## 启用 HTTPS（域名解析生效后）

```bash
scp deploy/enable-ssl.sh root@ser8-home:/root/ && ssh root@ser8-home 'bash /root/enable-ssl.sh'
```

脚本做的事：证书申请（webroot，不动宝塔站点配置）→ 写 `litematic.zuoqirun.top-ssl.conf`（443）→ 在扩展目录加 301 跳转（放行 ACME）→ `nginx -t` 后 reload → 自检。
证书续期由 `certbot.timer` 负责，续期后通过 `--deploy-hook "systemctl reload nginx"` 自动生效。

注意：Node 项目的 vhost 里 `/.well-known/` 的 root 指向 `app/`，而 webroot 校验文件应落在 `public/.well-known/`。`enable-ssl.sh` 里已用 `-w .../public` 显式指定；如果校验失败，临时在 `extension/litematic_viewer/acme.conf` 里覆盖：

```nginx
location /.well-known/ { root /www/wwwroot/litematic.zuoqirun.top/public; }
```

Cloudflare 注意：
- SSL/TLS 模式用 **Flexible**（Cloudflare 终止 TLS、回源走 http）或 **Full**（回源 https，需要源站有证书 —— 装好 Let's Encrypt 后可用 Full(strict)）。
- 若开了「Always Use HTTPS」，ACME 校验路径可能被 CF 改写成 https；此时把 SSL 模式临时切到 Flexible 再跑证书脚本，或改用 Cloudflare DNS-01。
- 大文件上传别开「Under Attack」模式，会被挑战页拦截。

## 备份

```bash
tar -czf /root/litematic-data-$(date +%F).tar.gz -C /www/wwwroot/litematic.zuoqirun.top data
```

`data/` 之外都可以从仓库重新生成（`assets/` 由 `python tools/bake/bake.py` 产出，`public/` 由 `node build.mjs` 产出）。

## 排错

| 现象 | 排查 |
| --- | --- |
| 页面 404 / 显示宝塔默认「站点创建成功」 | 是不是还有旧的 `litematic.zuoqirun.top.conf` 跟 `node_litematic_viewer.conf` 抢 `server_name`；`nginx -t` 看有无冲突 |
| `/api/*` 502 | 项目没起来：`cat /www/wwwlogs/nodejs/litematic_viewer.log`、`ss -lntp \| grep 5180` |
| 面板「网站 → Node项目」页 500 | `project_config` 缺字段，见上文反例 |
| 上传 401 | 页面里填的令牌与服务端 `MCVIEWER_TOKEN` 不一致 |
| 上传 413 | `client_max_body_size`（72m）与服务 `--max-upload-mb`（64） |
| 上传 429 | 写操作限速 20 次/分钟/IP |
| 材质包一直 queued/baking | 服务器 Python/磁盘；`tail /www/wwwlogs/nodejs/litematic_viewer.log` 看烘焙输出 |
| 重启后面板显示"启动失败" | 多为 5180 被旧进程占着：`pkill -f "node server.mjs"` 后重试 |
| https 访问到别的站点 | 还没跑 `enable-ssl.sh`，443 由宝塔默认站点接管 |
