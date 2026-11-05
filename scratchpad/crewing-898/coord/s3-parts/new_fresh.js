    // No.898 под-стадия 2: ассерт следует за КЛЮЧОМ, а не за одной буквальной парой. Прежняя
    // форма пинила `"fresh_namespace_unavailable": "fresh_unavailable"` и краснела бы ПО
    // ПОСТРОЕНИЮ при любой смене ключа — по верной причине в неподходящий момент.
    const mapFresh=(html.match(/function loginRefusalText\(code\) \{\n  var map = (\{[\s\S]*?\});/)||['',''])[1];
    const freshTarget=(mapFresh.match(/"fresh_namespace_unavailable":\s*"([a-z_]+)"/)||[])[1];
    ok(!!freshTarget,'No.898: the live allocator refusal code is mapped at all — target '+String(freshTarget));
    ok((html.match(new RegExp('"settings\\.crewing\\.login\\.'+freshTarget+'"','g'))||[]).length===2,
       'No.898: the allocator refusal key '+freshTarget+' has a text in both dictionaries');
    // ДВА ассерта на само УДАЛЕНИЕ: «новый ключ работает» не ловит «старый остался», и без них
    // следующий писатель вернёт мёртвую запись, не покраснев. Заметь, ЧТО они различают: эти
    // два — про КАРТУ и СЛОВАРИ, тогда как отрицательный контроль популяции выше — про то, что
    // код под `cfg(test)` вне ПОПУЛЯЦИИ по семантике компилятора. Разные объекты, и снятие
    // записи из карты второй контроль не задевает.
    ok(!/"fresh_context_unavailable"\s*:/.test(mapFresh),
       'No.898: the test-only code fresh_context_unavailable is ABSENT from the map — dead data; it is unreachable in a product build by cfg');
    ok(!/"settings\.crewing\.login\.fresh_unavailable"/.test(html),
       'No.898: the retired key fresh_unavailable is ABSENT from both dictionaries');
    // Контроль инструмента рядом с двумя нулями: тот же предикат обязан НАХОДИТЬ существующий
    // ключ, иначе нули выше — свойство сломанного поиска, а не отсутствия.
    ok((html.match(/"settings\.crewing\.login\.storage_error"/g)||[]).length===2,
       'control: the same predicate finds a key that DOES exist (storage_error), so the two absences above are measured');
