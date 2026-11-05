#!/usr/bin/env python3
"""3c, dist + harness half. Register is a PARAMETER: the owner picks once, for both texts.

  --register A   explicit two-step frame, carries "nothing on this device was changed"
  --register B   short, frame implied

Writes nothing unless every anchor is found exactly once.
"""
import argparse, hashlib, os, sys

TEXTS = {
 "A": {
  "workspace_unreachable": {
   "en": "Your account details were accepted, but we couldn't reach your Crewing workspace, so sign-in did not complete. Check your network and try again. Nothing on this device was changed.",
   "ru": "Данные аккаунта приняты, но связаться с рабочим местом Крюинга не удалось, поэтому вход не завершён. Проверьте сеть и попробуйте снова. На этом устройстве ничего не изменилось."},
  "workspace_unavailable": {
   "en": "Your account details were accepted, but your Crewing workspace did not accept the request, so sign-in did not complete. This is on our side — try later. Nothing on this device was changed.",
   "ru": "Данные аккаунта приняты, но рабочее место Крюинга не приняло запрос, поэтому вход не завершён. Это на нашей стороне — попробуйте позже. На этом устройстве ничего не изменилось."}},
 "B": {
  "workspace_unreachable": {
   "en": "Account accepted, but we didn't reach your Crewing workspace — sign-in did not complete. Check your network and try again.",
   "ru": "Аккаунт приняли, но до рабочего места Крюинга не дошли — вход не завершён. Проверьте сеть и попробуйте снова."},
  "workspace_unavailable": {
   "en": "Account accepted, but your Crewing workspace refused the request — sign-in did not complete. This is on our side, try later.",
   "ru": "Аккаунт приняли, но рабочее место Крюинга запрос не приняло — вход не завершён. Это на нашей стороне, попробуйте позже."}},
}

MAP_ANCHOR = '"transport_unreachable": "transport_unreachable",'
EN_ANCHOR  = '    "settings.crewing.login.transport_unreachable": "No connection to the server. Check your network and try again.",\n'
RU_ANCHOR  = '    "settings.crewing.login.transport_unreachable": "Нет связи с сервером. Проверьте сеть и попробуйте снова.",\n'

ORACLE_OLD = """  function codesIn(body){const o=new Set();
    for(const m of body.matchAll(CODE_RE))o.add(m[1]||m[2]);"""
ORACLE_NEW = r"""  function codesIn(body){const o=new Set();
    for(const m of body.matchAll(CODE_RE))o.add(m[1]||m[2]);
    // No.898 3c: ЧЕТВЁРТАЯ форма рождения кода — плечо `match`, возвращающее голый литерал.
    // Прежние три формы её не видели, и это давало ЛОЖНОЕ ЗЕЛЁНОЕ: на fixture-дереве 157/0 и
    // `textless []` при Rust 3c и нетронутом dist, то есть два кода БЕЗ ТЕКСТА при зелёном
    // ассерте покрытия.
    // Образец обязан СОДЕРЖАТЬ строковый литерал, а не БЫТЬ им. Это измерено, а не выбрано:
    //   образец ЕСТЬ литерал      -> 2 значения, и НИ ОДНОГО из карты отказов;
    //   образец СОДЕРЖИТ литерал  -> 15, из них 12 кодов карты;
    //   любое плечо               -> 36, из них 24 вне карты (построитель фаз и режимов).
    // Двенадцать — это таблица статус->код `native_account.rs:434-453`, где образцы КОРТЕЖИ
    // (`(403, "tenant_mismatch")`). Прежний оракул не видел и их: `Err(match …)` под
    // CODE_RE не подходит, потому что за `Err(` идёт не кавычка. То есть узкая форма была бы
    // слепа к самому вероятному месту появления СЛЕДУЮЩЕГО кода.
    for(const m of body.matchAll(/(?:^|[\s(|])[^=\n]*"[a-z_]+"[^=\n]*=>\s*"([a-z_]+)"\s*,/g))o.add(m[1]);"""

CONTROLS_OLD = """  const SKIP=new Set(['if','match','while','for','return','Ok','Err','Some','None','String','Vec',"""
CONTROLS_NEW = """  // No.898 3c: `account_session_state` (lib.rs:669) — производитель СОСТОЯНИЙ СЕССИИ, не кодов
  // отказа. Его значения (`active`, `locked`, `expired`, `legacy`, `none`, …) доходят до
  // интерфейса через `s.account_session` (dist:1319, 1686), а НЕ через `loginRefusalText`;
  // `settings.crewing.login.expired` в dist встречается ноль раз. Его плечи имеют ту же форму,
  // что таблица отказов, поэтому вычитать их надо ИМЕНЕМ ФУНКЦИИ, а не формой образца.
  // Словарь ВЫВОДИТСЯ из тела, как PHASES, и несёт те же два контроля — непустоту и
  // столкновение с картой: если в эту функцию однажды положат настоящий код отказа,
  // исключение не станет молчаливой дырой.
  const STATES=new Set();
  const SKIP=new Set(['if','match','while','for','return','Ok','Err','Some','None','String','Vec',"""

STATES_OLD = """  function populate(maxDepth){"""
STATES_NEW = r"""  {
    const asb=bodyOf('account_session_state');
    if(asb)for(const m of asb.body.matchAll(/=>\s*"([a-z_]+)"/g))STATES.add(m[1]);
  }
  function populate(maxDepth){"""

SUBTRACT_OLD = """    for(const c of [...codes])if(PHASES.has(c))codes.delete(c);"""
SUBTRACT_NEW = """    for(const c of [...codes])if(PHASES.has(c)||STATES.has(c))codes.delete(c);"""

EXTRA_OLD = """  ok(codes.has('settings_cleanup_unconfirmed'),'No.898: a code in the SECOND ARM of a ternary enters the population (lib.rs:141)');"""
EXTRA_NEW = """  ok(codes.has('settings_cleanup_unconfirmed'),'No.898: a code in the SECOND ARM of a ternary enters the population (lib.rs:141)');
  ok(STATES.size>0,'control: the session-state vocabulary is derived and non-empty :: '+STATES.size+' names');
  const stateCollide=[...STATES].filter((v)=>mapped.has(v)).sort();
  ok(stateCollide.length===0,'control: no derived session state is also a known refusal code — '+JSON.stringify(stateCollide));
  ok(STATES.has('expired')&&!codes.has('expired'),
     'No.898/3c: the session-state producer is subtracted BY FUNCTION, not by arm shape — `expired` is a state, absent from dist as a login text key');
  ok(codes.has('workspace_unreachable')&&codes.has('workspace_unavailable'),
     'No.898/3c: a code born as a MATCH ARM enters the population (native_lifecycle.rs second_step_code)');
  for(const c of ['tenant_mismatch','ownership_conflict','entitlement_revoked','too_many_attempts','bad_email','scope_denied'])
    ok(codes.has(c),'No.898/3c: the status->code TABLE is now covered — '+c+' was invisible to the old oracle (Err(match …) escapes CODE_RE)');
  for(const p of ['base_create','base_sync','container_metadata','database_sync','keys_sync','context_metadata'])
    ok(!codes.has(p),'No.898/3c: the rule keeps the enum->label phase builder OUT (native_fresh.rs:55,64) — '+p);"""

STEP_OLD = """  // И вторая сторона, сохранённая: каждое ЗНАЧЕНИЕ карты существует ключом словаря в обоих
  // языках, иначе карта указывает в пустоту."""
STEP_NEW = """  // No.898 3c: различение ДВУХ ступеней живёт в карте, а не только в Rust-тесте. Пара обязана
  // остаться парой: слияние потеряло бы «проверьте сеть» (действие СЕЙЧАС) и «это на нашей
  // стороне» (действие ЖДАТЬ) — два разных действия по правилу дома.
  const pairs=Object.fromEntries([...mapBlock.matchAll(/"([a-z_]+)":\\s*"([a-z_]+)"/g)].map((m)=>[m[1],m[2]]));
  for(const c of ['workspace_unreachable','workspace_unavailable'])
    ok(typeof pairs[c]==='string','No.898/3c: the second-step code '+c+' is mapped to a text');
  ok(pairs['workspace_unreachable']!==pairs['workspace_unavailable'],
     'No.898/3c: the two second-step codes map to DIFFERENT texts — collapsing them would merge two different actions');
  // Первый шаг и `refresh` по-прежнему выдают исходные коды, поэтому их тексты обязаны остаться.
  for(const c of ['transport_unreachable','upstream_unavailable'])
    ok(typeof pairs[c]==='string','No.898/3c: the first-step code '+c+' keeps its own text — refresh and step one still emit it');

  // И вторая сторона, сохранённая: каждое ЗНАЧЕНИЕ карты существует ключом словаря в обоих
  // языках, иначе карта указывает в пустоту. No.898 3a долг 3: нарезаемая таблица —
  // `SETTINGS_I18N`, популяция ассерта — ЗНАЧЕНИЯ карты `loginRefusalText`, не её ключи."""

def write_atomic(path, text):
    tmp = path + ".tmp"
    open(tmp, "w").write(text)
    os.chmod(tmp, os.stat(path).st_mode & 0o7777)
    os.replace(tmp, path)
    if open(path).read() != text:
        sys.exit("REFUSE: re-read differs")

def once(text, needle, label):
    n = text.count(needle)
    if n != 1:
        sys.exit("REFUSE: anchor %r found %d times (want 1)" % (label, n))

ap = argparse.ArgumentParser()
ap.add_argument("--root", required=True)
ap.add_argument("--register", required=True, choices=["A", "B"])
a = ap.parse_args()
T = TEXTS[a.register]

for code, langs in T.items():
    for lang, s in langs.items():
        if '"' in s:
            sys.exit("REFUSE: %s/%s holds a raw double quote — it would break the JS string layer" % (code, lang))
        if "Вход выполнен" in s or "Signed in" in s:
            sys.exit("REFUSE: %s/%s claims a completed sign-in — forbidden for this path" % (code, lang))

# ---- dist ----
dist = os.path.join(a.root, "dist/index.html")
h = open(dist).read()
print("dist sha256 before: %s  mode %o" % (hashlib.sha256(h.encode()).hexdigest()[:16], os.stat(dist).st_mode & 0o7777))
once(h, MAP_ANCHOR, "map")
h = h.replace(MAP_ANCHOR, MAP_ANCHOR
      + ' "workspace_unreachable": "workspace_unreachable",'
      + ' "workspace_unavailable": "workspace_unavailable",')
print("  map: +2 entries")
for lang, anchor in (("en", EN_ANCHOR), ("ru", RU_ANCHOR)):
    once(h, anchor, "%s dictionary" % lang)
    add = "".join('    "settings.crewing.login.%s": "%s",\n' % (c, T[c][lang])
                  for c in ("workspace_unreachable", "workspace_unavailable"))
    h = h.replace(anchor, anchor + add)
    print("  %s dictionary: +2 texts" % lang)
for c in T:
    if h.count('"settings.crewing.login.%s"' % c) != 2:
        sys.exit("REFUSE: %s must appear exactly twice (once per dictionary)" % c)
write_atomic(dist, h)
print("dist sha256 after:  %s  mode %o" % (hashlib.sha256(open(dist).read().encode()).hexdigest()[:16], os.stat(dist).st_mode & 0o7777))

# ---- harness ----
hp = os.path.join(a.root, "tests/crewing635_public_settings_harness.mjs")
s = open(hp).read()
print("harness sha256 before: %s  mode %o" % (hashlib.sha256(s.encode()).hexdigest()[:16], os.stat(hp).st_mode & 0o7777))
for label, old, new in (("oracle: arm pattern CONTAINS a literal", ORACLE_OLD, ORACLE_NEW),
                        ("STATES declaration", CONTROLS_OLD, CONTROLS_NEW),
                        ("STATES derivation", STATES_OLD, STATES_NEW),
                        ("STATES subtraction", SUBTRACT_OLD, SUBTRACT_NEW),
                        ("population controls", EXTRA_OLD, EXTRA_NEW),
                        ("step-distinction asserts", STEP_OLD, STEP_NEW)):
    once(s, old, label)
    s = s.replace(old, new)
    print("  applied: %s" % label)
write_atomic(hp, s)
print("harness sha256 after:  %s  mode %o" % (hashlib.sha256(open(hp).read().encode()).hexdigest()[:16], os.stat(hp).st_mode & 0o7777))
print("register used: %s" % a.register)
