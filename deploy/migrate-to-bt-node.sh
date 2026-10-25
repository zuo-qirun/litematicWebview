#!/bin/bash
# 把 litematic.zuoqirun.top 从「普通站点 + systemd」迁移为「宝塔 Node 项目」
set -eu

SITE=/www/wwwroot/litematic.zuoqirun.top
APP=$SITE/app
NAME=litematic_viewer
PANEL=/www/server/panel

echo "===== 1. 停掉 systemd 版（释放 5180） ====="
systemctl disable --now litematic-viewer.service 2>/dev/null || true
systemctl stop litematic-viewer.service 2>/dev/null || true
sleep 1
ss -lntp | grep -q ':5180 ' && echo "  !! 5180 仍被占用" || echo "  5180 已释放"
echo "  systemd: $(systemctl is-active litematic-viewer.service 2>/dev/null || echo stopped)"

echo
echo "===== 2. 准备项目目录（宝塔要求 package.json 同级有 node_modules） ====="
mkdir -p "$APP/node_modules"
chown root:www /etc/litematic-viewer.env
chmod 640 /etc/litematic-viewer.env
echo "  env 文件权限: $(stat -c '%U:%G %a' /etc/litematic-viewer.env)"
python3 - "$APP/package.json" <<'PY'
import json, sys
p = sys.argv[1]
with open(p, encoding='utf-8-sig') as f:
    pkg = json.load(f)
pkg['name'] = 'litematic-viewer'
pkg['private'] = True
pkg.setdefault('scripts', {})['start'] = 'node server.mjs --port 5180 --dir ../public --data ../data --max-upload-mb 64 --no-open'
with open(p, 'w', encoding='utf-8') as f:
    json.dump(pkg, f, ensure_ascii=False, indent=2)
    f.write('\n')
print('  package.json scripts.start =', pkg['scripts']['start'])
PY

echo
echo "===== 3. 备份并移除旧的普通站点配置 ====="
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p /root/bt-node-migrate-$STAMP
cp -a "$PANEL/vhost/nginx/litematic.zuoqirun.top.conf" /root/bt-node-migrate-$STAMP/ 2>/dev/null || true
rm -rf "$PANEL/vhost/nginx/extension/litematic.zuoqirun.top"
rm -f "$PANEL/vhost/nginx/litematic.zuoqirun.top.conf"
cp -a "$PANEL/data/db/site.db" /root/bt-node-migrate-$STAMP/site.db
echo "  备份 -> /root/bt-node-migrate-$STAMP"

echo
echo "===== 4. 改成宝塔 Node 项目（sites 行 + project_config） ====="
btpython - "$NAME" "$APP" <<'PY'
import sqlite3, json, sys
name, app = sys.argv[1], sys.argv[2]
db = sqlite3.connect('/www/server/panel/data/db/site.db')
cfg = {
    "project_name": name,
    "pm2_name": "",
    "add_type": None,
    "watch": False,
    "cluster": 1,
    "project_cwd": app,
    "project_file": "",
    "project_script": "start",
    "project_args": "",
    "project_type": "nodejs",
    "config_file": "",
    "config_body": "",
    "env": "",
    "bind_extranet": 1,
    "domains": ["litematic.zuoqirun.top:80"],
    "is_power_on": True,
    "run_user": "www",
    "max_memory_limit": 0,
    "nodejs_version": "v24.15.0",
    "port": 5180,
    "log_path": "/www/wwwlogs/nodejs",
    "pkg_manager": "npm",
}
db.execute(
    "update sites set name=?, path=?, ps=?, status=1, type_id=0, project_type='Node', project_config=?, "
    '"index"=NULL, rname=\'\', stop=\'\' where id=12',
    (name, app, 'Litematica 投影查看器', json.dumps(cfg, ensure_ascii=False)),
)
db.commit()
db.row_factory = sqlite3.Row
r = db.execute('select id,name,path,project_type,project_config from sites where id=12').fetchone()
print('  sites 行:', r['id'], r['name'], r['project_type'])
print('  domains:', [tuple(x) for x in db.execute('select id,pid,name,port from domain where pid=12').fetchall()])
PY

echo
echo "===== 5. 生成 nginx 反向代理配置 ====="
btpython - "$NAME" <<'PY'
import sys
sys.path.insert(0, '/www/server/panel/class')
sys.path.insert(0, '/www/server/panel')
from projectModel.nodejsModel import main

class Get(dict):
    def __getattr__(self, k):
        try: return self[k]
        except KeyError: raise AttributeError(k)
    def __setattr__(self, k, v): self[k] = v

name = sys.argv[1]
m = main()
res = m.set_config(name)
print('  set_config ->', res)
PY
cat "$PANEL/vhost/nginx/node_$NAME.conf" | head -20

echo
echo "===== 6. 提升上传体积上限（生成配置里没有 client_max_body_size） ====="
python3 - <<'PY'
import re
p = '/www/server/nginx/conf/nginx.conf'
s = open(p, encoding='utf-8').read()
if 'client_max_body_size 72m;' in s:
    print('  已是 72m')
else:
    s2 = re.sub(r'client_max_body_size\s+50m;', 'client_max_body_size 72m;', s, count=1)
    if s2 == s and 'client_max_body_size' in s:
        print('  !! 未找到 50m 配置，请人工检查')
    else:
        open(p, 'w', encoding='utf-8').write(s2)
        print('  已把全局 50m 改为 72m')
PY
/www/server/nginx/sbin/nginx -t 2>&1 | tail -2
/www/server/nginx/sbin/nginx -s reload
sleep 1

echo
echo "===== 7. 用宝塔的启动接口拉起项目 ====="
btpython - "$NAME" <<'PY'
import sys
sys.path.insert(0, '/www/server/panel/class')
sys.path.insert(0, '/www/server/panel')
from projectModel.nodejsModel import main

class Get(dict):
    def __getattr__(self, k):
        try: return self[k]
        except KeyError: raise AttributeError(k)
    def __setattr__(self, k, v): self[k] = v

name = sys.argv[1]
m = main()
print('  start_project ->', m.start_project(Get({'project_name': name})))
PY
sleep 2
echo "  pid 文件: $(cat /www/server/nodejs/vhost/pids/$NAME.pid 2>/dev/null || echo 缺失)"
echo "  pm2/nohup 进程:"
ps -eo pid,user,args | grep -E "server\.mjs" | grep -v grep || true
ls -l /www/wwwlogs/nodejs/$NAME.log 2>/dev/null || true
tail -n 12 /www/wwwlogs/nodejs/$NAME.log 2>/dev/null || true

echo
echo "===== 8. 站点与接口验证 ====="
curl -s -o /dev/null -w "  GET /            -> %{http_code}\n" -H "Host: litematic.zuoqirun.top" http://127.0.0.1/
curl -s -o /dev/null -w "  GET /app.js      -> %{http_code}\n" -H "Host: litematic.zuoqirun.top" http://127.0.0.1/app.js
curl -s -H "Host: litematic.zuoqirun.top" http://127.0.0.1/api/capabilities | head -c 200; echo
TOKEN=$(grep -oP '^MCVIEWER_TOKEN=\K.*' /etc/litematic-viewer.env 2>/dev/null || true)
if [ -n "$TOKEN" ]; then
  curl -s -o /dev/null -w "  授权 /api/projects -> %{http_code}\n" -H "Host: litematic.zuoqirun.top" -H "Authorization: Bearer $TOKEN" http://127.0.0.1/api/projects
  curl -s -H "Host: litematic.zuoqirun.top" -H "Authorization: Bearer $TOKEN" http://127.0.0.1/api/projects | head -c 300; echo
else
  echo "  !! 没读到 MCVIEWER_TOKEN"
fi
