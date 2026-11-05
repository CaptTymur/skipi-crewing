  // No.898 под-стадия 2 (Н1): «в ОБОИХ словарях» измеряется НАРЕЗКОЙ, а не счётом. Прежнее
  // `>=2 вхождений` проходило и на двух вхождениях в ОДНОМ словаре — то есть не различало
  // того, ради чего стояло.
  const siAt=html.indexOf('var SETTINGS_I18N');
  const ruAt=html.indexOf('\n  ru: {',siAt);
  ok(siAt>0&&ruAt>siAt,'control: both dictionary regions are locatable — SETTINGS_I18N at '+siAt+', ru at '+ruAt);
  const siEnd=(()=>{let b=html.indexOf('{',siAt),d=0,i=b;for(;i<html.length;i++){if(html[i]==='{')d++;else if(html[i]==='}'){d--;if(d===0)break;}}return i;})();
  const enRegion=html.slice(siAt,ruAt), ruRegion=html.slice(ruAt,siEnd);
  ok(enRegion.length>1000&&ruRegion.length>1000,'control: both regions are substantial — en '+enRegion.length+' B, ru '+ruRegion.length+' B');
  // Контроль, что нарезка РАЗДЕЛИЛА ЯЗЫКИ, а не отрезала произвольно: английский текст
  // известного ключа обязан лежать в en-области и НЕ лежать в ru-области, и наоборот.
  // Без этого обе области могли бы оказаться половинами одного словаря.
  ok(/That does not look like an email/.test(enRegion)&&!/That does not look like an email/.test(ruRegion),
     'control: the en region holds the ENGLISH text of a known key and the ru region does not');
  ok(/Это не похоже/.test(ruRegion)&&!/Это не похоже/.test(enRegion),
     'control: the ru region holds the RUSSIAN text of a known key and the en region does not');
  for(const v of values){
    const key='"settings.crewing.login.'+v+'"';
    const inEn=enRegion.split(key).length-1, inRu=ruRegion.split(key).length-1;
    ok(inEn===1&&inRu===1,'No.898: the text '+v+' exists ONCE IN EACH dictionary — en='+inEn+' ru='+inRu);
  }
