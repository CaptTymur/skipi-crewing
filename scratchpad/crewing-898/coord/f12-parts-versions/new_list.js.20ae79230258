  // No.898/F12: список ключей ВЫВОДИТСЯ из значений карты, а не набирается рукой. Прежняя
  // форма держала 18 имён поимённо, и удаление ключа из источника делало её лгущей о
  // требовании: копия рядом с источником — второе место сборки одного решения.
  const mapForKeys=(html.match(/function loginRefusalText\(code\) \{\n  var map = (\{[\s\S]*?\});/)||['',''])[1];
  const derivedKeys=[...new Set([...mapForKeys.matchAll(/"([a-z_]+)":\s*"([a-z_]+)"/g)].map((m)=>m[2]))];
  // `refused_unspecified` — цель ФОЛЛБЭКА, она живёт в коде функции, а не в карте; назвать
  // её здесь обязательно, иначе ключ, который человек видит чаще всего, никем не проверен.
  const expectedKeys=[...new Set(derivedKeys.concat(['refused_unspecified']))];
  ok(expectedKeys.length>=18,'control: the key list is DERIVED and non-trivial — '+expectedKeys.length+' keys');
  const missing=expectedKeys.map((k)=>'settings.crewing.login.'+k).filter((k)=>!(html.includes('"'+k+'"')));
