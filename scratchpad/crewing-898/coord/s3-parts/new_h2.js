  // No.898 под-стадия 2 (Н2): порог `>=18` СНЯТ. Это было число из размера СТАРОГО
  // рукописного списка, то есть оно отставало от измеренного ещё в момент написания (после
  // F12 карта даёт 27 пар и 23 цели — отставание на пять). Вместо числа, которое надо
  // поддерживать руками, стоят контроли РАЗБОРА: если регекс карты сломается, список
  // обрушится, и поймают это они, а не порог.
  ok(/"bad_email":\s*"bad_email"/.test(mapForKeys),'control: the map block really parsed — a known pairing is present');
  ok(expectedKeys.includes('refused_unspecified')&&expectedKeys.includes('storage_error'),
     'control: the derived list holds known-required keys, so it is a list and not a fragment');
  ok(expectedKeys.length>0,'control: the derived key list is non-empty — '+expectedKeys.length+' keys, measured and not a maintained constant');
