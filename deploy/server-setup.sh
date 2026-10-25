#!/bin/bash
set -eu
SITE=/www/wwwroot/litematic.zuoqirun.top
APP=$SITE/app
PUB=$SITE/public
VENV=$SITE/venv

echo "===== 1. 目录与属主 ====="
mkdir -p "$SITE/data"
# 宝塔会把 public/.user.ini 设为不可变（chattr +i），跳过它
find "$PUB" -name '.user.ini' -prune -o -print0 | xargs -0 -r chown -h www:www
chown -R www:www "$APP" "$SITE/data"
chmod 755 "$SITE"

echo "===== 2. 共享资源（app/assets -> public/assets） ====="
if [ ! -e "$APP/assets" ]; then ln -s "$PUB/assets" "$APP/assets"; fi
ls -l "$APP/assets/"

echo "===== 3. Python venv（继承系统 numpy + 安装 Pillow） ====="
if [ ! -x "$VENV/bin/python3" ]; then
  python3 -m venv --system-site-packages "$VENV"
fi
"$VENV/bin/python3" -m pip install -q -i https://pypi.tuna.tsinghua.edu.cn/simple Pillow 2>&1 | tail -3
"$VENV/bin/python3" -c "import numpy, PIL; print('venv OK numpy', numpy.__version__, 'PIL', PIL.__version__)"
chown -R www:www "$VENV"

echo "===== 4. 令牌与运行环境文件 ====="
if [ ! -f /etc/litematic-viewer.env ]; then
  TOKEN=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
  cat > /etc/litematic-viewer.env <<ENVEOF
MCVIEWER_TOKEN=$TOKEN
MCVIEWER_PYTHON=$VENV/bin/python3
NODE_ENV=production
ENVEOF
  chmod 600 /etc/litematic-viewer.env
  echo "已生成新令牌"
else
  echo "沿用已有 /etc/litematic-viewer.env"
fi
sed -e 's/^MCVIEWER_TOKEN=.*/MCVIEWER_TOKEN=<hidden>/' /etc/litematic-viewer.env

echo "===== 5. systemd 服务 ====="
cat > /etc/systemd/system/litematic-viewer.service <<'UNITEOF'
[Unit]
Description=Litematica 投影查看器 (mcviewer) API + 静态站点
Documentation=https://litematic.zuoqirun.top/
After=network-online.target nginx.service
Wants=network-online.target

[Service]
Type=simple
User=www
Group=www
WorkingDirectory=/www/wwwroot/litematic.zuoqirun.top/app
EnvironmentFile=/etc/litematic-viewer.env
ExecStart=/usr/bin/node server.mjs --port 5180 --dir ../public --data ../data --max-upload-mb 64 --no-open
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/www/wwwroot/litematic.zuoqirun.top/data

[Install]
WantedBy=multi-user.target
UNITEOF
systemctl daemon-reload
systemctl enable litematic-viewer.service >/dev/null 2>&1
systemctl restart litematic-viewer.service
sleep 2
systemctl is-active litematic-viewer.service
journalctl -u litematic-viewer.service -n 12 --no-pager

echo "===== 6. nginx 扩展配置（反向代理 /api 与 /packs） ====="
EXT=/www/server/panel/vhost/nginx/extension/litematic.zuoqirun.top
mkdir -p "$EXT"
cat > "$EXT/proxy-api.conf" <<'NGXEOF'
# mcviewer 动态接口反向代理（宝塔扩展目录，面板改站点配置不会覆盖）
client_max_body_size 72m;

location ~ ^/(api|packs)(/|$) {
    proxy_pass http://127.0.0.1:5180;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 10s;
    proxy_send_timeout 360s;
    proxy_read_timeout 360s;
    proxy_request_buffering off;
}

# 首屏资源争取一点缓存（文件名不带 hash，用校验式缓存）
location = /index.html {
    add_header Cache-Control "no-cache";
}
NGXEOF
/www/server/nginx/sbin/nginx -t
systemctl reload nginx

echo "===== 7. 本机验收 ====="
sleep 1
curl -s -o /dev/null -w "GET /            -> %{http_code}\n" -H "Host: litematic.zuoqirun.top" http://127.0.0.1/
curl -s -o /dev/null -w "GET /app.js      -> %{http_code} (%{size_download} B)\n" -H "Host: litematic.zuoqirun.top" http://127.0.0.1/app.js
curl -s -H "Host: litematic.zuoqirun.top" http://127.0.0.1/api/capabilities
echo
echo "===== 8. 端口与进程 ====="
ss -lntp | grep ':5180' || echo "5180 未监听"
ps -o pid,user,cmd -C node | head -5
