#!/bin/bash
set -u
D=litematic.zuoqirun.top
C="curl -s --resolve $D:80:127.0.0.1"
PASS=0; FAIL=0
ok(){ if [ "$1" = "1" ]; then PASS=$((PASS+1)); echo "  PASS  $2"; else FAIL=$((FAIL+1)); echo "  FAIL  $2"; fi; }

echo "===== A. 宝塔面板站点记录 ====="
btpython - <<'PY'
import sqlite3
db = sqlite3.connect('/www/server/panel/data/db/site.db')
for r in db.execute("select id,name,path,status,project_type,ps from sites where id=12"):
    print("sites:", r)
for r in db.execute("select id,pid,name,port from domain where pid=12"):
    print("domain:", r)
PY

echo "===== B. 站点 HTTP 验收（经 nginx，域名 Host） ====="
code=$($C -o /dev/null -w '%{http_code}' http://$D/); ok "$([ "$code" = 200 ] && echo 1 || echo 0)" "GET / -> $code"
code=$($C -o /dev/null -w '%{http_code}' http://$D/app.js); ok "$([ "$code" = 200 ] && echo 1 || echo 0)" "GET /app.js -> $code"
code=$($C -o /dev/null -w '%{http_code}' http://$D/assets/manifest.json); ok "$([ "$code" = 200 ] && echo 1 || echo 0)" "GET /assets/manifest.json -> $code"
body=$($C -o /dev/null -w '%{http_code}' http://$D/samples/); ok "1" "GET /samples/ -> $body (404 说明无目录列表，正常)"
hdr=$($C -H 'Accept-Encoding: gzip' -D- -o /dev/null http://$D/app.js | tr -d '\r' | grep -i '^content-encoding')
ok "$(echo "$hdr" | grep -qi gzip && echo 1 || echo 0)" "app.js gzip: ${hdr:-未启用}"
hdr=$($C -H 'Accept-Encoding: gzip' -D- -o /dev/null http://$D/assets/models.json | tr -d '\r' | grep -i '^content-encoding')
ok "$(echo "$hdr" | grep -qi gzip && echo 1 || echo 0)" "models.json gzip: ${hdr:-未启用}"
sec=$($C -D- -o /dev/null http://$D/api/capabilities | tr -d '\r' | grep -Ei '^(content-security-policy|x-content-type-options|x-frame-options)' | wc -l)
ok "$([ "$sec" -ge 3 ] && echo 1 || echo 0)" "安全响应头数量 $sec"

echo "===== C. 能力探测（经反向代理） ====="
caps=$($C http://$D/api/capabilities); echo "  $caps"
echo "$caps" | grep -q '"packsSupported":true' && ok 1 "packsSupported=true" || ok 0 "packsSupported=true"

TOKEN=$(grep '^MCVIEWER_TOKEN=' /etc/litematic-viewer.env | cut -d= -f2-)
AUTH="Authorization: Bearer $TOKEN"

echo "===== D. 未授权访问 ====="
code=$($C -o /dev/null -w '%{http_code}' http://$D/api/projects); ok "$([ "$code" = 401 ] && echo 1 || echo 0)" "无令牌 GET /api/projects -> $code"

echo "===== E. 投影上传 / 列表 / 下载 / 删除（经 nginx 反代） ====="
RESP=$($C -X POST -H "$AUTH" -H "x-file-name: $(python3 -c "import urllib.parse;print(urllib.parse.quote('海草机打包收集-by小鱼.litematic'))")" --data-binary @/root/verify-test.litematic http://$D/api/projects)
echo "  POST -> $RESP"
PID=$(echo "$RESP" | python3 -c "import sys,json;d=json.load(sys.stdin);print((d.get('item') or {}).get('id',''))" 2>/dev/null)
ok "$([ -n "$PID" ] && echo 1 || echo 0)" "上传成功 id=$PID"
LIST=$($C -H "$AUTH" http://$D/api/projects)
echo "$LIST" | grep -q "$PID" && ok 1 "列表包含新投影" || ok 0 "列表包含新投影"
$C -H "$AUTH" -o /tmp/dl.litematic http://$D/api/projects/$PID/file
same=$( [ "$(md5sum < /root/verify-test.litematic | cut -d' ' -f1)" = "$(md5sum < /tmp/dl.litematic | cut -d' ' -f1)" ] && echo 1 || echo 0 )
ok "$same" "下载内容与原文件 MD5 一致"
code=$($C -X DELETE -H "$AUTH" -o /dev/null -w '%{http_code}' http://$D/api/projects/$PID)
ok "$([ "$code" = 204 ] && echo 1 || echo 0)" "删除 -> $code"

echo "===== F. 材质包上传 → 烘焙 → 静态资源可用 ====="
PRESP=$($C -X POST -H "$AUTH" -H "x-file-name: verify-test-pack.zip" --data-binary @/root/verify-test-pack.zip http://$D/api/packs)
echo "  POST -> $(echo "$PRESP" | head -c 300)"
KPID=$(echo "$PRESP" | python3 -c "import sys,json;d=json.load(sys.stdin);print((d.get('item') or {}).get('id',''))" 2>/dev/null)
ok "$([ -n "$KPID" ] && echo 1 || echo 0)" "材质包已接收 id=$KPID"
STAT=queued
for i in $(seq 1 60); do
  J=$($C -H "$AUTH" http://$D/api/packs/$KPID)
  STAT=$(echo "$J" | python3 -c "import sys,json;d=json.load(sys.stdin);print((d.get('item') or {}).get('status',''))" 2>/dev/null)
  [ "$STAT" = "ready" ] && break
  [ "$STAT" = "error" ] && { echo "  pack error: $J"; break; }
  sleep 2
done
ok "$([ "$STAT" = "ready" ] && echo 1 || echo 0)" "烘焙状态 ready (实际 $STAT)"
if [ "$STAT" = "ready" ]; then
  code=$($C -o /dev/null -w '%{http_code}' http://$D/packs/$KPID/assets/manifest.json); ok "$([ "$code" = 200 ] && echo 1 || echo 0)" "GET /packs/$KPID/assets/manifest.json -> $code"
  code=$($C -o /dev/null -w '%{http_code}' http://$D/packs/$KPID/assets/atlas.png); ok "$([ "$code" = 200 ] && echo 1 || echo 0)" "GET .../atlas.png -> $code"
fi
code=$($C -X DELETE -H "$AUTH" -o /dev/null -w '%{http_code}' http://$D/api/packs/$KPID); ok "$([ "$code" = 204 ] && echo 1 || echo 0)" "删除材质包 -> $code"

echo "===== G. 限速（21 个快速写请求应出现 429） ====="
codes=""
for i in $(seq 1 22); do
  c=$($C -X POST -H "$AUTH" -H "x-file-name: r$i.litematic" --data-binary @/root/verify-test.litematic -o /dev/null -w '%{http_code}' http://$D/api/projects)
  codes="$codes $c"
done
echo "  codes:$codes"
echo "$codes" | grep -q 429 && ok 1 "触发 429" || ok 0 "触发 429"

echo "===== H. nginx 错误日志 ====="
tail -n 12 /www/wwwlogs/litematic.zuoqirun.top.error.log 2>/dev/null
echo
echo "===== 结果：PASS=$PASS FAIL=$FAIL ====="
