// No.894 (половина, достижимая в dist): подпись про демонстрацию принадлежит двери «Демо»,
// а не форме входа. До правки `<p>` с `entry.demo_note` лежал ПОСЛЕ обоих контейнеров —
// вне `ec-doors` и вне `ec-login-form`, — поэтому `entryShowLogin(true)` скрывал двери,
// показывал форму, а подпись оставалась под формой и читалась как её описание. Это
// воспроизведено в разметке, а не выведено из жалобы: индексы были doors 139119,
// form 140263, note 141758. Теперь подпись внутри `ec-doors` и скрывается вместе с ними.
// Ассерт ПОЗИЦИОННЫЙ и текста не касается: текст идёт владельцу на живую приёмку, и пин
// к буквальной строке дал бы ложный красный ровно в момент, когда он её поменяет.
await run('No.894 — the demonstration caption belongs to the Demo door, not to the login form',async()=>{
  const doors=html.indexOf('id="ec-doors"');
  const form=html.indexOf('id="ec-login-form"');
  const note=html.indexOf('id="ec-demo-note"');
  ok(doors>0&&form>doors,'control: both containers present and ordered — doors at '+doors+', form at '+form);
  ok(note>0,'No.894: the caption carries its own id so its PLACE can be asserted — ec-demo-note');
  ok(note>doors&&note<form,
     'No.894: the caption sits INSIDE the doors container and hides with the door it describes — note '+note+' between '+doors+' and '+form);
  // Контроль инструмента: тот же предикат на синтетической разметке, где подпись стоит
  // ПОСЛЕ формы (как было до правки), обязан быть ЛОЖНЫМ — иначе он согласен на любое
  // положение и не различает того, ради чего стоит.
  const synth='<div id="ec-doors"></div><div id="ec-login-form"></div><p id="ec-demo-note"></p>';
  const sD=synth.indexOf('id="ec-doors"'),sF=synth.indexOf('id="ec-login-form"'),sN=synth.indexOf('id="ec-demo-note"');
  ok(!(sN>sD&&sN<sF),'control: on markup with the caption AFTER the form the same predicate is FALSE, so it discriminates position');
  // И подпись по-прежнему рисуется из КЛЮЧА, а не из литерала — иначе перевод отвалится молча.
  ok(/tr\('entry\.demo_note'\)/.test(html),'No.894: the caption still renders from the key entry.demo_note, not from a literal');
});

