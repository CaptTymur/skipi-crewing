// No.898/F12: популяция ассерта определяется ДОСТИЖИМОСТЬЮ до `loginRefusalText`, а не
// рукописным списком модулей. Прежняя форма имела два слоя дефекта: (а) модули выбраны
// рукой, поэтому `lib.rs` и `native_fresh.rs` в неё не входили вовсе; (б) предикат искал
// только `Err("…")`/`ok_or`/`map_err` и НЕ ВИДЕЛ кодов, собранных полем структуры
// (`AllocationError { code }`, `Self { code: if … }`). Расширение списка модулей само по
// себе (б) не закрывает: `native_fresh.rs` прежним предикатом даёт ровно 0 кодов.
// Достижимость заменяет и список исключений: код, недостижимый продуктом, выходит из
// популяции ПО ПРАВИЛУ, а не попадает в пин исключений — возврат `OWNER_COPY_PENDING`
// отменял бы решение, принятое на слове владельца ((1493)/(1495)).
await run('No.898/F12 — every login refusal code within the measured horizon has its own text',async()=>{
  // Якорь со стороны интерфейса: популяция имеет право начинаться с одной команды только
  // пока `loginRefusalText` питается именно ей. Если появится второй источник — покраснеет
  // здесь, а не тихо сузит популяцию.
  const refusalCalls=(html.match(/loginRefusalText\(/g)||[]).length;
  ok(refusalCalls===4,'No.898: loginRefusalText has its definition plus exactly three call sites — found '+refusalCalls);
  const nalStart=html.indexOf('async function nativeAccountLogin(');
  ok(nalStart>0,'control: nativeAccountLogin is present in dist');
  const nalBody=html.slice(nalStart,html.indexOf('\n}',nalStart));
  const nalCmds=[...new Set([...nalBody.matchAll(/invoke\('([a-z_]+)'/g)].map((m)=>m[1]))];
  ok(nalCmds.length===1&&nalCmds[0]==='native_account_login',
     'No.898: the refusal-text consumer is fed by exactly ONE command — '+JSON.stringify(nalCmds));

  // Срез по cfg: атрибут — тестовый гейт только если `test` ВЫЖИВАЕТ после удаления всех
  // not(...). Без этого шага тот же шаблон ловит и `#[cfg(not(test))]` и срезает
  // ПРОДУКТОВУЮ ветвь — так и было в первой версии, и это поймал положительный контроль.
  function cfgIsTestGate(inner){
    let bare=inner,g=0;
    for(;;){const n=bare.replace(/not\s*\([^()]*\)/g,'');if(n===bare||++g>50)break;bare=n;}
    return /\btest\b/.test(bare);
  }
  function productionHalf(s){
    let out=s,guard=0;
    for(;;){
      if(++guard>500)throw new Error('productionHalf did not converge');
      let hit=null;
      for(const cand of out.matchAll(/#\[cfg\(/g)){
        const open=cand.index+cand[0].length-1;
        const close=balancedEnd(out,open+1,'(',')','"');
        if(close<0)continue;
        if(!cfgIsTestGate(out.slice(open+1,close)))continue;
        const endAttr=out.indexOf(']',close);
        hit={index:cand.index,end:endAttr+1};
        break;
      }
      if(!hit)break;
      let i=hit.end;
      while(i<out.length&&/\s/.test(out[i]))i++;
      while(out[i]==='#'){const e=out.indexOf(']',i);i=e<0?out.length:e+1;while(i<out.length&&/\s/.test(out[i]))i++;}
      let end;
      if(out[i]==='{')end=balancedEnd(out,i+1,'{','}','"');
      else{const b=out.indexOf('{',i),sc=out.indexOf(';',i);
        if(b>=0&&(sc<0||b<sc))end=balancedEnd(out,b+1,'{','}','"');else end=sc<0?out.length:sc+1;}
      out=out.slice(0,hit.index)+out.slice(end);
    }
    return out;
  }
  // КОНТРОЛЬ среза, и это НЕ `body.length>500`: тот проходит ровно в том случае, ради
  // которого стоит, потому что при несработавшем срезе body — весь файл (решение (1702)).
  const cutFixture='fn keep(){\n#[cfg(test)]\n{ x.ok_or("FIXTURE_TEST_ONLY")?; }\n#[cfg(not(test))]\n{ return Err("FIXTURE_PRODUCTION"); }\n}\n'
    +'#[cfg(all(test, target_os = "linux"))]\nmod t { fn a(){ Err("FIXTURE_IN_MODULE") } }\nfn after(){ Err("FIXTURE_AFTER") }\n';
  const cut=productionHalf(cutFixture);
  ok(!cut.includes('FIXTURE_TEST_ONLY'),'control: the cut removes a #[cfg(test)] BLOCK inside a function');
  ok(cut.includes('FIXTURE_PRODUCTION'),'control: the cut KEEPS the #[cfg(not(test))] branch — the arm the first version destroyed');
  ok(!cut.includes('FIXTURE_IN_MODULE'),'control: the cut removes a module gated by the COMPOUND cfg(all(test, …)) form');
  ok(cut.includes('FIXTURE_AFTER'),'control: the cut keeps code after a stripped item');

  const prod=Object.fromEntries(Object.entries(rsSources).map(([f,s])=>[f,productionHalf(s)]));
  // Строки, которые сам код использует как `phase`, кодами отказа не являются. Словарь
  // ВЫВОДИТСЯ из дерева, не набирается рукой, и несёт контроль непустоты.
  const PHASES=new Set();
  for(const s of Object.values(rsSources)){
    for(const m of s.matchAll(/\bphase\s*[:,]\s*"([a-z_]+)"/g))PHASES.add(m[1]);
    for(const m of s.matchAll(/\.phase\s*,\s*"([a-z_]+)"/g))PHASES.add(m[1]);
    for(const m of s.matchAll(/failed\([^,)]*,\s*"([a-z_]+)"\)/g))PHASES.add(m[1]);
  }
  ok(PHASES.size>0,'control: the phase vocabulary is derived and non-empty — '+PHASES.size+' names');

  // В закрытой форме литерал в map_err обязан БЫТЬ результатом замыкания, а не аргументом
  // внутри него: `map_err(|_| failed(Error::X, "write"))` возвращает структуру.
  const CODE_RE=/(?:Err|ok_or)\s*\(?\s*"([a-z_]+)"|map_err\(\s*\|[^|]*\|\s*"([a-z_]+)"\s*(?:\.to_string\(\))?\s*\)/g;
  function initializer(b,at){let d=0;
    for(let i=at;i<b.length;i++){const c=b[i];
      if('{(['.includes(c))d++;else if('})]'.includes(c)){if(d===0)return b.slice(at,i);d--;}
      else if(c===','&&d===0)return b.slice(at,i);}
    return b.slice(at);}
  function codesIn(body){const o=new Set();
    for(const m of body.matchAll(CODE_RE))o.add(m[1]||m[2]);
    for(const m of body.matchAll(/\bcode\s*:\s*/g))
      for(const t of initializer(body,m.index+m[0].length).matchAll(/"([a-z_]+)"/g))o.add(t[1]);
    return o;}
  const FN=new Map();
  function isFn(n){if(FN.has(n))return FN.get(n);
    const re=new RegExp('fn\\s+'+n+'\\s*(?:<[^>]*>)?\\s*\\(');
    const v=Object.values(prod).some((s)=>re.test(s));FN.set(n,v);return v;}
  function bodyOf(n){
    for(const [f,s] of Object.entries(prod)){
      const m=s.match(new RegExp('fn\\s+'+n+'\\s*(?:<[^>]*>)?\\s*\\('));
      if(!m)continue;
      const b=s.indexOf('{',m.index+m[0].length);
      if(b<0)continue;
      const e=balancedEnd(s,b+1,'{','}','"');
      if(e<0)continue;
      return {file:f,body:s.slice(b,e)};
    }
    return null;}
  const SKIP=new Set(['if','match','while','for','return','Ok','Err','Some','None','String','Vec',
    'format','println','assert','assert_eq','clone','to_string','unwrap','expect','map','and_then',
    'map_err','ok_or','is_some','is_none','as_ref','as_str','trim','len','push','insert','lock','borrow_mut']);
  // Обход параметризован ГЛУБИНОЙ, и это не косметика. Предикат измеряет не «достижимость»
  // в смысле компилятора, а «в пределах N переходов по именам вызовов» — и граница N обязана
  // быть ЗАМЕРЕНА, а не выбрана так, чтобы получился желаемый ответ. Замер (свип 1..12):
  // популяция НАСЫЩАЕТСЯ на 16 кодах к глубине 5 и не меняется на 6, а на 7 впервые входит
  // код, чей потребитель к пути входа не относится вовсе (`no_mail_client` из `contact.rs`,
  // `connection_not_configured` из `messaging.rs`). Поэтому 6 — граница с запасом в один
  // уровень с каждой стороны, и ОБА её края закреплены ассертами ниже: иначе число 6
  // осталось бы магическим, то есть верным ответом по неверной причине.
  function populate(maxDepth){
    const seen=new Set(),codes=new Set();let reached=0;
    (function walk(n,depth){
      if(depth>maxDepth||seen.has(n))return;
      seen.add(n);
      const f=bodyOf(n);
      if(!f)return;
      reached++;
      for(const c of codesIn(f.body))codes.add(c);
      // Функция может быть ПЕРЕДАНА без скобок — `map_err(NativePersistError::from_storage)`
      // именно так и достаёт `settings_cleanup_unconfirmed`, а шаблон `name(` его не видит.
      for(const m of f.body.matchAll(/\b([a-z_][a-z0-9_]*)\b/g)){
        const k=m[1];
        if(SKIP.has(k)||seen.has(k))continue;
        if(isFn(k))walk(k,depth+1);
      }
    })('native_account_login',0);
    for(const c of [...codes])if(PHASES.has(c))codes.delete(c);
    return {reached,codes};
  }
  const HORIZON=6;
  const below=populate(HORIZON-1), at=populate(HORIZON), above=populate(HORIZON+1);
  const reached=at.reached, codes=at.codes;
  ok(reached>50,'control: the walk is not trivially empty — functions reached='+reached);
  // Нижний край: на выбранной границе популяция НАСЫЩЕНА, то есть ещё один уровень вниз
  // ничего не теряет. Если появится новый код между 5 и 6 — горизонт мал, и это красное.
  const lostBelow=[...at.codes].filter((c)=>!below.codes.has(c)).sort();
  ok(lostBelow.length===0,'control: the population is SATURATED at the horizon — depth '+(HORIZON-1)+' already finds all of them, extra at '+HORIZON+': '+JSON.stringify(lostBelow));

  const mapBlock=(html.match(/function loginRefusalText\(code\) \{\n  var map = (\{[\s\S]*?\});/)||['',''])[1];
  const mapped=new Set([...mapBlock.matchAll(/"([a-z_]+)":\s*"([a-z_]+)"/g)].map((m)=>m[1]));
  ok(mapped.size>=20&&codes.size>=10,'control: both sides measured — reachable codes='+codes.size+' mapped='+mapped.size);
  // Защита от собственного сужения: имя из словаря фаз не имеет права быть известным кодом,
  // иначе сужение молча удалило бы настоящий отказ.
  const collide=[...PHASES].filter((p)=>mapped.has(p)).sort();
  ok(collide.length===0,'control: no derived phase name is also a known refusal code — '+JSON.stringify(collide));

  // Положительные контроли на ДВЕ формы, которые прежний предикат не видел.
  ok(codes.has('fresh_namespace_unavailable'),'No.898: a code assembled as a STRUCT FIELD enters the population (native_fresh.rs)');
  ok(codes.has('settings_cleanup_unconfirmed'),'No.898: a code in the SECOND ARM of a ternary enters the population (lib.rs:141)');
  // Отрицательные: недостижимое выходит ПО ПРАВИЛУ, а не по списку исключений.
  ok(!codes.has('fresh_context_unavailable'),'No.898: a cfg(test)-only code stays OUT of the population by compiler semantics, not by exemption');
  for(const c of ['external_url_refused','external_url_unavailable','external_url_unsupported'])
    ok(!codes.has(c),'No.898: '+c+' stays OUT — its consumer discards the code and shows the address verbatim');
  for(const c of ['connection_change_requires_login','connection_change_requires_validation'])
    ok(!codes.has(c),'No.898: '+c+' stays OUT — zero occurrences in dist, born behind save_settings, not the login command');

  // Верхний край: на один уровень ВЫШЕ горизонта обход обязан втянуть код, которого в карте
  // нет — то есть выйти за путь входа. Это доказывает, что граница лежит именно там, где
  // названа, а не что при любом N ответ один и тот же.
  // РАСТЯЖКА, названная заранее: этот контроль покраснеет и если кто-нибудь ЗАКОННО даст
  // текст одному из кодов, которые сегодня втягиваются на 7 (`no_mail_client`,
  // `connection_not_configured`) — тогда на 7 не останется неотображённых кодов. Красное
  // тогда значит «горизонт надо ПЕРЕМЕРИТЬ свипом», а НЕ «текст пропал»: проверь свип
  // 1..12 и подними HORIZON до нового края насыщения.
  const admittedAbove=[...above.codes].filter((c)=>!at.codes.has(c)&&!mapped.has(c)).sort();
  ok(admittedAbove.length>0,
     'control: one level ABOVE the horizon the walk leaves the login path and admits unmapped codes — '+JSON.stringify(admittedAbove));
  const textless=[...codes].filter((c)=>!mapped.has(c)).sort();
  ok(textless.length===0,'No.898/F12: every login refusal code within the MEASURED horizon ('+HORIZON+' call-name hops, saturated at '+(HORIZON-1)+', contaminated at '+(HORIZON+1)+') has its own text — textless '+JSON.stringify(textless));

  // И вторая сторона, сохранённая: каждое ЗНАЧЕНИЕ карты существует ключом словаря в обоих
  // языках, иначе карта указывает в пустоту.
  const values=[...new Set([...mapBlock.matchAll(/"([a-z_]+)":\s*"([a-z_]+)"/g)].map((m)=>m[2]))];
  const dangling=values.filter((v)=>!(html.includes('"settings.crewing.login.'+v+'"')));
  ok(dangling.length===0,'No.898: every map target resolves to a real text key — dangling '+JSON.stringify(dangling));
  for(const v of values){
    const both=(html.match(new RegExp('"settings\\.crewing\\.login\\.'+v+'"','g'))||[]).length;
    ok(both>=2,'No.898: the text '+v+' exists in BOTH dictionaries — found '+both);
  }
});
