#!/usr/bin/env bash
# ЕДИНСТВЕННЫЙ живой запрос к боевому серверу по разрешению владельца (1813, 15:23:19Z).
# Предмет: различить ЧЕТЫРЕ причины, по которым вход не активирует сессию.
# Запрос НИЧЕГО НЕ МЕНЯЕТ: GET, без кредов, без тела, без -L (редирект = второй запрос).
set -Eeuo pipefail
umask 0022
COORD=/home/linux/Developer/skipi-parallel-coordinator
WT=/home/linux/Developer/worktrees/crewing-930-20261105
SP="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EV="$WT/scratchpad/crewing-930/live-probe-20261105"      # ДОЛГОВЕЧНЫЙ диск, не /tmp
WRITER="skipi-crewing-53"
RESERVE=60
URL="https://assistant.skipi.app/api/app/crewing/bootstrap"
CERT="${1:?usage: run-930-probe.sh <certificate>}"
SELF_SHA="$(sha256sum "${BASH_SOURCE[0]}" | cut -d" " -f1)"
[ -n "$WRITER" ] || { echo "REFUSE: writer unresolved" >&2; exit 9; }

GATE="$(cd "$COORD" && python3 tools/stage_gate.py check --certificate "$CERT" 2>&1)" || {
  printf 'REFUSE: gate rc!=0\n%s\n' "$GATE" >&2; exit 2; }
printf '%s\n' "$GATE"
case "$GATE" in *PERMIT_CURRENT*) : ;; *) echo "REFUSE: not PERMIT_CURRENT" >&2; exit 2 ;; esac
REMAIN="$(python3 -c "
import json,datetime
c=json.load(open('$CERT'))
e=datetime.datetime.fromisoformat(c['expires_at'].replace('Z','+00:00'))
print(int((e-datetime.datetime.now(datetime.timezone.utc)).total_seconds()))")"
echo "remaining=${REMAIN}s"
[ $(( REMAIN - RESERVE )) -ge 25 ] || { echo "REFUSE: budget too small" >&2; exit 3; }

# ---- 0. РАЗРЕШЕНИЕ ВЛАДЕЛЬЦА сверяется с ПЕРВОИСТОЧНИКОМ, не с пересказом
ACK=/home/linux/.outbox/skipi-decisions-ack.jsonl
python3 - "$ACK" <<'PYACK'
import json,sys,datetime
line=open(sys.argv[1]).readline()
d=json.loads(line)
assert d['decision_id']=='ask-crewing-live-probe', f"wrong decision_id: {d['decision_id']}"
assert d['label']=='Разрешаю', f"not an approval: {d['label']}"
assert 'один живой запрос' in d['answer'], "scope text missing"
print('owner authorization verified from the primary file:', d['decision_id'], '|', d['label'], '| by', d['by'],
      '|', datetime.datetime.fromtimestamp(d['ts'],datetime.timezone.utc).isoformat())
PYACK
mkdir -p "$EV"
cp -- "$ACK" "$EV/owner-authorization.jsonl"

# ---- 1. ПОЛОЖИТЕЛЬНЫЙ КОНТРОЛЬ, локальный: доказать, что мой способ ВИДИТ ответ.
# Локальный, чтобы не тратить второй исходящий запрос: разрешён ровно один.
PORT=19877
python3 - "$PORT" "$EV" <<'PYSRV' &
import http.server, sys, socketserver, threading, time
port=int(sys.argv[1])
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body=b'{"control":"this is a known-good response"}'
        self.send_response(418); self.send_header('Content-Type','application/json')
        self.send_header('X-Control','positive'); self.send_header('Content-Length',str(len(body)))
        self.end_headers(); self.wfile.write(body)
    def log_message(self,*a): pass
socketserver.TCPServer.allow_reuse_address=True
s=socketserver.TCPServer(('127.0.0.1',port),H)
threading.Thread(target=s.serve_forever,daemon=True).start()
time.sleep(8); s.shutdown()
PYSRV
SRV=$!
sleep 1
# `set -e` со строки 5 убил бы скрипт на САМОМ ПРИСВАИВАНИИ при rc!=0 — и тогда ни REFUSE,
# ни `exit 4`, ни `kill` ниже не исполнились бы: категория отказа подменилась бы на rc curl,
# а слушатель утёк бы. Боевой запрос я обернул, а контрольный забыл — находка координатора.
set +e
CTRL_CODE="$(curl -sS --max-time 5 -o "$EV/control-body.txt" -D "$EV/control-headers.txt" \
             -w '%{http_code}' "http://127.0.0.1:$PORT/probe")"
CTRL_RC=$?
set -e
[ -n "$CTRL_CODE" ] || CTRL_CODE="CURL_FAILED_rc${CTRL_RC}"
echo "positive control: http_code=$CTRL_CODE curl_rc=$CTRL_RC (expect 418/0), body bytes $(wc -c < "$EV/control-body.txt" 2>/dev/null || echo 0)"
if [ "$CTRL_CODE" != "418" ]; then
  echo "REFUSE: positive control did not see a response — молчание боевого сервера было бы НЕЧИТАЕМО" >&2
  kill "$SRV" 2>/dev/null || true; exit 4
fi
kill "$SRV" 2>/dev/null || true
echo "control proves the method sees responses: status, headers and body all captured"

# ---- 2. ЕДИНСТВЕННЫЙ исходящий запрос. Без -L: редирект был бы ВТОРЫМ запросом.
echo "=== the one authorized request: GET $URL ==="
set +e
curl -sS --max-time 20 --no-location \
     -o "$EV/prod-body.bin" -D "$EV/prod-headers.txt" \
     -w '%{http_code}|%{content_type}|%{size_download}|%{time_total}|%{remote_ip}|%{num_redirects}\n' \
     -H 'Accept: application/json' \
     "$URL" > "$EV/prod-metrics.txt" 2> "$EV/prod-stderr.txt"
CURL_RC=$?
set -e
echo "curl rc=$CURL_RC"; cat "$EV/prod-metrics.txt" 2>/dev/null || true

# ---- 3. РАЗБОР: четыре версии против наблюдённого
python3 - "$EV" "$CURL_RC" "$URL" "$SELF_SHA" "$WRITER" "$SP" <<'PYAN'
import sys, pathlib, json, hashlib, datetime, uuid
EV=pathlib.Path(sys.argv[1]); rc=int(sys.argv[2]); url=sys.argv[3]; self_sha=sys.argv[4]; writer=sys.argv[5]; SP=pathlib.Path(sys.argv[6])
now=datetime.datetime.now(datetime.timezone.utc)
met=(EV/'prod-metrics.txt').read_text().strip()
hdr=(EV/'prod-headers.txt').read_text(errors='replace') if (EV/'prod-headers.txt').exists() else ''
body=(EV/'prod-body.bin').read_bytes() if (EV/'prod-body.bin').exists() else b''
code=ct=size=tt=ip=nred=None
if met and '|' in met:
    parts=met.split('|'); code,ct,size,tt,ip,nred=(parts+[None]*6)[:6]
looks_json = body.strip().startswith((b'{',b'['))
looks_html = b'<html' in body[:400].lower() or b'<!doctype' in body[:400].lower()
verdict={}
if rc!=0 and not code:
    verdict['conclusion']='СЕТЬ/TLS: соединение не состоялось — версия (4) «настоящая недоступность»'
elif code=='404':
    verdict['conclusion']='ПУТЬ: 404 — этот хост по этому пути bootstrap НЕ обслуживает (версия 1, расхождение пути/хоста)'
elif code in ('405','401','403'):
    verdict['conclusion']=(f'ПУТЬ СУЩЕСТВУЕТ: {code} — эндпоинт по этому адресу ЕСТЬ и отвечает; '
        'версия (1) «расхождения пути» ОПРОВЕРГНУТА, остаются форма/скоупы/кредит')
elif code=='503':
    verdict['conclusion']='503 — совместимо с версией (2): CREWING_NATIVE_PUBLIC_SERVER_URL не задана на проде'
elif code and code.startswith('2'):
    verdict['conclusion']='2xx без кредов — неожидаемо; требует разбора, выводов не делаю'
else:
    verdict['conclusion']=f'код {code} — не покрыт заготовленной таблицей, разбираю отдельно'
doc={"document":"LIVE_PROBE_RESULT","observed_at":now.isoformat(),
 "authorization":{"decision_id":"ask-crewing-live-probe","recorded_at":"2026-11-05T15:23:19Z","by":"Тимур",
   "source":"~/.outbox/skipi-decisions-ack.jsonl, строка 1, сверено драйвером с первоисточником",
   "scope":"ОДИН запрос, ничего не меняющий"},
 "request":{"method":"GET","url":url,"credentials_sent":False,"body_sent":False,
   "follow_redirects":False,"why":"редирект был бы ВТОРЫМ запросом, а разрешён один",
   "requests_made_outward":1,"num_redirects_reported_by_curl":nred},
 "response":{"http_code":code,"content_type":ct,"bytes":size,"seconds":tt,"remote_ip":ip,
   "body_sha256":hashlib.sha256(body).hexdigest(),"body_is_json":looks_json,"body_is_html":looks_html,
   "body_first_300":body[:300].decode('utf-8','replace'),
   "headers_sha256":hashlib.sha256(hdr.encode()).hexdigest()},
 "curl_rc":rc,
 "positive_control":{"local":True,"expected":418,"observed":(EV/'control-headers.txt').read_text(errors='replace').split('\n')[0] if (EV/'control-headers.txt').exists() else None,
   "why_local":"разрешён ровно один ИСХОДЯЩИЙ запрос, поэтому контроль поставлен на loopback, а не на второй внешний адрес",
   "what_it_proves":"метод видит статус, заголовки и тело; значит молчание боевого адреса читалось бы как молчание, а не как слепота прибора"},
 "verdict":verdict,
 "driver_sha256":self_sha,"driver_sha256_is":"запись о том, что бежало, не доказательство заверенности",
 "evidence_dir":str(EV),"evidence_on_durable_disk":True,"umask_declared":"0022"}
(EV/'LIVE_PROBE_RESULT.json').write_text(json.dumps(doc,ensure_ascii=False,indent=1),encoding='utf-8')
json.dump(doc,open(SP/'AFTER_STAGE-930-probe.json','w'),ensure_ascii=False,indent=1)
print(json.dumps(verdict,ensure_ascii=False,indent=1))
print('http_code',code,'| content_type',ct,'| bytes',size,'| remote_ip',ip,'| redirects',nred)
json.dump({"document":"ACK_STOP",
 "ack_stop_event_id":f"crewing-930-probe-ackstop-{now.strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}",
 "ack_stop_writer":writer,"observed_at":now.isoformat(),
 "operations_terminated":True,"queued_operations_cancelled":True,
 "evidence":{"live_probe_result":str(EV/'LIVE_PROBE_RESULT.json'),
   "sha256":hashlib.sha256((EV/'LIVE_PROBE_RESULT.json').read_bytes()).hexdigest(),
   "outward_requests_made":1,"local_control_requests":1,
   "queued_operations_note":"локальный контрольный сервер остановлен; фоновых процессов не осталось"}},
 open(SP/'ACK_STOP-930-probe.json','w'),ensure_ascii=False,indent=1)
print('LIVE_PROBE_RESULT + ACK_STOP written')
PYAN
printf 'STAGE ACTIONS COMPLETE. umask=0022 self_sha256=%s\n' "$SELF_SHA"
