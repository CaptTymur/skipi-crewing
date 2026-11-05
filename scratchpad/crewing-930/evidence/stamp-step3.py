#!/usr/bin/env python3
"""Штамп шага 3: свежий пульс + новый event_id, НИЧЕГО больше.
Печатает одну строку для отправки координатору. Диффа считается обходом."""
import json, hashlib, pathlib, datetime, copy, subprocess
SP = pathlib.Path(__file__).resolve().parent
base = json.loads((SP/'REQUEST-930-probe-step1-review-only.json').read_text(encoding='utf-8'))
r = copy.deepcopy(base); s = r['streams'][0]
for e in s['evidence_files']:
    e['sha256'] = hashlib.sha256(pathlib.Path(e['path']).read_bytes()).hexdigest()
now = datetime.datetime.now(datetime.timezone.utc)
r['submission'] = {"version":"v3","mode":"grant","note":"шаг 3: свежий пульс, содержание дословно как в отревьюированном шаге 1"}
s['event_id'] = 'crewing-930-probe-VERIFY_BUILD-grant-' + now.strftime('%Y%m%dT%H%M%SZ')
s['heartbeat'] = now.isoformat()
out = SP/'REQUEST-930-probe-step3-grant.json'
out.write_text(json.dumps(r, ensure_ascii=False, indent=1), encoding='utf-8')
def flat(o,p=''):
    if isinstance(o,dict):
        for k,v in o.items(): yield from flat(v,f'{p}.{k}')
    elif isinstance(o,list):
        for i,v in enumerate(o): yield from flat(v,f'{p}[{i}]')
    else: yield p,o
a,b = dict(flat(base)), dict(flat(r))
diff = [k for k in sorted(set(a)|set(b)) if a.get(k,'<x>') != b.get(k,'<x>')]
ALLOWED = {'.submission.mode','.submission.note','.submission.version','.streams[0].event_id','.streams[0].heartbeat'}
extra = [k for k in diff if k not in ALLOWED]
insp = subprocess.run(['python3','tools/inspect_requests.py','--live',str(out)],
                      cwd='/home/linux/Developer/skipi-parallel-coordinator',
                      capture_output=True, text=True)
v = json.loads(insp.stdout)
print(f"{out.name} · sha {hashlib.sha256(out.read_bytes()).hexdigest()} · "
      f"event_id {s['event_id']} · пульс {now.isoformat()} · листьев {len(diff)}, вне разрешённого "
      f"{len(extra)} · inspect {v['verdict']} errors {len(v['errors'])} conflicts {len(v['conflicts'])}")
