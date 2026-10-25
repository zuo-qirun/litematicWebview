#!/bin/bash
# 为 litematic.zuoqirun.top 申请 Let's Encrypt 证书并启用 HTTPS。
# 前提：域名 A/AAAA 已解析到本机公网地址（Cloudflare 代理开启也可以，但 SSL 模式需为 Flexible 或 Full）。
# 站点形态：宝塔「Node 项目」litematic_viewer，Node 服务监听 127.0.0.1:5180（静态 + /api 都由它提供）。
# 用法：bash enable-ssl.sh [邮箱]
set -eu
D=litematic.zuoqirun.top
SITE=/www/wwwroot/$D
PUB=$SITE/public
WEBROOT=$PUB
EMAIL=${1:-admin@zuoqirun.top}
PROJECT=litematic_viewer
NODE_PORT=5180
EXT=/www/server/panel/vhost/nginx/extension/$PROJECT

echo "1) 检查 DNS 与本地服务"
ip=$(getent hosts $D | awk '{print $1}' | head -1 || true)
echo "   $D -> ${ip:-（未解析）}"
if [ -z "$ip" ]; then echo "   ✗ 域名尚未解析，请先在 Cloudflare / 腾讯云配置 A 记录后重试"; exit 1; fi
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $D" http://127.0.0.1/)
echo "   本机 Host 头请求 http://127.0.0.1/ -> $code"
curl -s -o /dev/null -w "   Node 服务 127.0.0.1:$NODE_PORT -> %{http_code}\n" http://127.0.0.1:$NODE_PORT/ || true

echo "2) 让 ACME 校验目录指向 public/（Node 项目 vhost 的 /.well-known/ 默认指向 app/）"
mkdir -p "$EXT" "$WEBROOT/.well-known/acme-challenge"
cat > "$EXT/acme.conf" <<NGXEOF
# 由 enable-ssl.sh 生成：ACME 校验文件落在 public/（比站点自带的 /.well-known/ 更具体，优先生效）
location ^~ /.well-known/acme-challenge/ {
    root $WEBROOT;
}
NGXEOF
/www/server/nginx/sbin/nginx -t >/dev/null && /www/server/nginx/sbin/nginx -s reload
echo "   已写入 $EXT/acme.conf"

echo "3) 申请证书（webroot 模式，不修改宝塔站点配置）"
if [ ! -d /etc/letsencrypt/live/$D ]; then
  certbot certonly --webroot -w "$WEBROOT" -d "$D" --non-interactive --agree-tos -m "$EMAIL" \
    --deploy-hook "systemctl reload nginx" || { echo "   ✗ 证书申请失败（检查 80 端口是否放行、Cloudflare 是否拦截 ACME）"; exit 1; }
else
  echo "   已存在 /etc/letsencrypt/live/$D，跳过申请"
fi

echo "4) 写入 443 站点配置（与 80 的 Node vhost 分离，同样反代到 Node 服务）"
cat > /www/server/panel/vhost/nginx/$D-ssl.conf <<NGXEOF
# 本文件由 enable-ssl.sh 生成；80 端口由宝塔 Node 项目 vhost（node_$PROJECT.conf）负责
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name $D;

    ssl_certificate     /etc/letsencrypt/live/$D/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$D/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    add_header Strict-Transport-Security "max-age=31536000" always;

    client_max_body_size 72m;

    location ^~ /.well-known/acme-challenge/ { root $WEBROOT; }

    location / {
        proxy_pass http://127.0.0.1:$NODE_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_connect_timeout 30s;
        proxy_read_timeout 86400s;
        proxy_send_timeout 360s;
        proxy_request_buffering off;
    }
    access_log /www/wwwlogs/$D.ssl.log;
    error_log  /www/wwwlogs/$D.ssl.error.log;
}
NGXEOF

echo "5) http 侧加 301 跳转（保留 ACME 校验路径）"
cat > "$EXT/force-https.conf" <<'NGXEOF'
# 仅当请求是 http 时跳转到 https；ACME 校验与本地探测除外
set $mcviewer_redirect "";
if ($scheme = http) { set $mcviewer_redirect "https://$host$request_uri"; }
if ($request_uri ~ "^/\.well-known/") { set $mcviewer_redirect ""; }
if ($mcviewer_redirect != "") { return 301 $mcviewer_redirect; }
NGXEOF

echo "6) 校验并重载 nginx"
/www/server/nginx/sbin/nginx -t
systemctl reload nginx

echo "7) 验收"
sleep 1
curl -s -o /dev/null -w "   http  -> %{http_code} (301 为正常)\n" -H "Host: $D" http://127.0.0.1/
curl -sk -o /dev/null -w "   https / -> %{http_code}\n" --resolve $D:443:127.0.0.1 https://$D/
curl -sk --resolve $D:443:127.0.0.1 https://$D/api/capabilities | head -c 200; echo
echo "完成。证书续期由 certbot.timer 负责，续期后用 deploy-hook 自动 reload nginx。"
echo "如需回退 301：rm $EXT/force-https.conf && nginx -t && systemctl reload nginx"
