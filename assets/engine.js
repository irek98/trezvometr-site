// Ядро расчёта. Без зависимостей, без DOM — можно тестировать отдельно (tests.html).
// Формулы и допущения:
//   граммы спирта      = объём(мл) × крепость(%) / 100 × 0,789 (плотность этанола)
//   концентрация, г/л  = граммы / объём_распределения(л)
//     Видмарк: Vd = вес × r,  r = 0,68 (муж) / 0,55 (жен) / 0,615 (не указан)
//     Watson:  Vd = TBW × 0,8 (учитывает возраст и рост; оценка выше — консервативнее)
//   кривая: подъём до пика за peakMinutes, затем линейное падение eliminationRate г/л в час
//   несколько напитков складываются (суперпозиция) — приближение, но объяснимое
// Единицы: 1 г/л = 1 ‰ (промилле) = 0,1 % BAC; мг/л выдоха ≈ г/л крови / 2,0
(function (global) {
  'use strict';

  var ETH_DENSITY = 0.789;   // г/мл
  var BLOOD_BREATH = 2.0;    // г/л крови на 1 мг/л выдоха (приближение; закон: 0,16 мг/л ≈ 0,32 г/л)

  // Стандартная доза в разных странах — для дневника и статистики.
  var STANDARDS = {
    ru:  { grams: 10, label: '10 г спирта (Россия, стандартная доза)' },
    who: { grams: 10, label: '10 г спирта (ВОЗ)' },
    us:  { grams: 14, label: '14 г спирта (США, standard drink)' },
    uk:  { grams: 8,  label: '8 г спирта (Великобритания, unit)' },
    au:  { grams: 10, label: '10 г спирта (Австралия)' }
  };

  // База напитков: типичная порция и крепость. Пользователь может ввести своё.
  var DRINKS = [
    { id: 'beer-light',   name: 'Пиво светлое',         abv: 4.5, ml: 500, cat: 'Пиво' },
    { id: 'beer-strong',  name: 'Пиво крепкое',         abv: 8.0, ml: 500, cat: 'Пиво' },
    { id: 'beer-ipa',     name: 'Пиво крафтовое / IPA', abv: 6.5, ml: 330, cat: 'Пиво' },
    { id: 'cider',        name: 'Сидр',                 abv: 5.0, ml: 500, cat: 'Пиво' },
    { id: 'wine-white',   name: 'Вино белое сухое',     abv: 12.0, ml: 150, cat: 'Вино' },
    { id: 'wine-red',     name: 'Вино красное',         abv: 13.0, ml: 150, cat: 'Вино' },
    { id: 'champagne',    name: 'Шампанское',           abv: 11.0, ml: 150, cat: 'Вино' },
    { id: 'mulled',       name: 'Глинтвейн',            abv: 11.0, ml: 200, cat: 'Вино' },
    { id: 'port',         name: 'Портвейн / креплёное', abv: 20.0, ml: 80,  cat: 'Вино' },
    { id: 'vodka-shot',   name: 'Водка, стопка',        abv: 40.0, ml: 50,  cat: 'Крепкое' },
    { id: 'vodka-glass',  name: 'Водка, рюмка',         abv: 40.0, ml: 100, cat: 'Крепкое' },
    { id: 'whisky',       name: 'Виски / ром',          abv: 40.0, ml: 50,  cat: 'Крепкое' },
    { id: 'cognac',       name: 'Коньяк',               abv: 40.0, ml: 50,  cat: 'Крепкое' },
    { id: 'liqueur',      name: 'Ликёр',                abv: 20.0, ml: 50,  cat: 'Крепкое' },
    { id: 'sake',         name: 'Саке',                 abv: 15.0, ml: 60,  cat: 'Крепкое' },
    { id: 'custom',       name: 'Свой вариант',         abv: 40.0, ml: 50,  cat: 'Своё' }
  ];

  function num(v, fallback) {
    var n = Number(v);
    return isFinite(n) ? n : fallback;
  }

  // Граммы чистого спирта
  function grams(volumeMl, abvPercent) {
    return num(volumeMl, 0) * (num(abvPercent, 0) / 100) * ETH_DENSITY;
  }

  // Общий объём воды в теле по Watson (литры)
  function watsonTBW(p) {
    var h = num(p.heightCm, 175), w = num(p.weightKg, 75), a = num(p.age, 35);
    if (p.sex === 'female') return Math.max(18, -2.097 + 0.1069 * h + 0.2466 * w);
    return Math.max(20, 2.447 - 0.09516 * a + 0.1074 * h + 0.3362 * w);
  }

  // Объём распределения, литры
  function distributionVolume(p, model) {
    var w = num(p.weightKg, 75);
    if (model === 'watson') {
      // 0,8 — доля воды в крови; оценка выше, чем у Видмарка (консервативно)
      return Math.max(20, watsonTBW(p) * 0.8);
    }
    var r = p.sex === 'female' ? 0.55 : (p.sex === 'male' ? 0.68 : 0.615);
    return Math.max(20, w * r);
  }

  // Концентрация в крови от дозы, г/л
  function bacFromGrams(g, profile, model) {
    return num(g, 0) / distributionVolume(profile || {}, model || 'widmark');
  }

  // Приведение записи к { tMs, grams } — одна запись дневника или разовый ввод
  function normalize(entry) {
    if (!entry) return null;
    var tMs = Number(entry.tMs);
    if (!isFinite(tMs)) return null;
    var g = Number(entry.grams);
    if (!isFinite(g)) g = grams(entry.volumeMl, entry.abv);
    if (!(g > 0)) return null;
    return { tMs: tMs, grams: g, id: entry.id, name: entry.name, note: entry.note };
  }

  // Параметры расчёта: приоритет — явные opts, затем профиль, затем config.js
  function resolveOpts(profile, opts) {
    var cfg = (global.AL_CONFIG && global.AL_CONFIG.defaults) || {};
    var p = profile || {};
    var o = opts || {};
    return {
      model: o.model || p.model || cfg.model || 'widmark',
      rate: num(o.rate, num(p.eliminationRate, num(cfg.eliminationRate, 0.15))),
      peakMinutes: num(o.peakMinutes, num(p.peakMinutes, num(cfg.peakMinutes, 40))),
      marginMinutes: num(o.marginMinutes, 0),
      stepMin: num(o.stepMin, 5)
    };
  }

  // Вклад одного напитка в момент tMin (минуты от начала)
  function drinkAt(tMin, t0Min, peakBac, rate, peakMinutes) {
    var dt = tMin - t0Min;
    if (dt <= 0) return 0;
    if (dt < peakMinutes) return peakBac * (dt / peakMinutes);
    return Math.max(0, peakBac - rate * ((dt - peakMinutes) / 60));
  }

  // Полная кривая: { points:[{tMin,gL,breath,percent}], t0, zeroMin, peakMin, peakGL, totalGrams }
  function curve(entries, profile, opts) {
    var list = (entries || []).map(normalize).filter(Boolean);
    if (!list.length) {
      return { points: [], t0: 0, zeroMin: 0, peakMin: 0, peakGL: 0, totalGrams: 0,
               opts: resolveOpts(profile, opts), vd: distributionVolume(profile || {}, (opts || {}).model || 'widmark') };
    }
    var o = resolveOpts(profile, opts);
    var vd = distributionVolume(profile || {}, o.model);
    var t0Ms = Math.min.apply(null, list.map(function (e) { return e.tMs; }));
    var items = list.map(function (e) {
      return { t0Min: (e.tMs - t0Ms) / 60000, peakBac: e.grams / vd, grams: e.grams };
    });
    var lastMin = 0;
    items.forEach(function (it) {
      var end = it.t0Min + o.peakMinutes + (it.peakBac / o.rate) * 60;
      if (end > lastMin) lastMin = end;
    });
    var points = [], peakMin = 0, peakGL = 0;
    for (var t = 0; t <= lastMin + o.stepMin; t += o.stepMin) {
      var gL = 0;
      for (var i = 0; i < items.length; i++) {
        gL += drinkAt(t, items[i].t0Min, items[i].peakBac, o.rate, o.peakMinutes);
      }
      points.push({ tMin: t, gL: gL, breath: gL / BLOOD_BREATH, percent: gL / 10 });
      if (gL > peakGL) { peakGL = gL; peakMin = t; }
    }
    return {
      points: points, t0: t0Ms, zeroMin: lastMin, peakMin: peakMin, peakGL: peakGL,
      totalGrams: items.reduce(function (s, it) { return s + it.grams; }, 0),
      opts: o, vd: vd
    };
  }

  // Концентрация в момент tMin (минуты от первой записи)
  function bacAtMin(entries, profile, opts, tMin) {
    var list = (entries || []).map(normalize).filter(Boolean);
    if (!list.length) return 0;
    var o = resolveOpts(profile, opts);
    var vd = distributionVolume(profile || {}, o.model);
    var t0Ms = Math.min.apply(null, list.map(function (e) { return e.tMs; }));
    var total = 0;
    list.forEach(function (e) {
      total += drinkAt(tMin, (e.tMs - t0Ms) / 60000, e.grams / vd, o.rate, o.peakMinutes);
    });
    return total;
  }

  // Когда концентрация упадёт до порога (после пика). Минуты от первой записи.
  function timeToThreshold(cur, thresholdGL) {
    var pts = cur.points || [];
    if (!pts.length) return 0;
    var th = num(thresholdGL, 0);
    if (cur.peakGL <= th) return cur.peakMin;
    // последний замер, который ещё выше порога: его время и берём (осторожная оценка)
    for (var i = pts.length - 1; i > 0; i--) {
      if (pts[i].tMin > cur.peakMin && pts[i].gL > th) return pts[i].tMin;
    }
    return cur.zeroMin;
  }

  // Итог расчёта: пик, ноль, пороги, «не ранее чем» с запасом
  function summary(entries, profile, opts) {
    var cur = curve(entries, profile, opts);
    var o = cur.opts || resolveOpts(profile, opts);
    var legal = 0.32;
    var cfg = global.AL_CONFIG || {};
    if (cfg.thresholds && cfg.thresholds.legalBloodGL) legal = cfg.thresholds.legalBloodGL;
    var atLegal = timeToThreshold(cur, legal);
    var nowMin = cur.points.length ? (Date.now() - cur.t0) / 60000 : 0;
    return {
      curve: cur,
      totalGrams: cur.totalGrams,
      peakGL: cur.peakGL,
      peakMin: cur.peakMin,
      legalGL: legal,
      zeroMin: cur.zeroMin,
      legalMin: atLegal,
      zeroWithMarginMin: cur.zeroMin + o.marginMinutes,
      legalWithMarginMin: atLegal + o.marginMinutes,
      nowMin: nowMin,
      nowGL: bacAtMin(entries, profile, opts, nowMin),
      opts: o,
      vd: cur.vd
    };
  }

  // Сколько спирта можно добавить сейчас, чтобы к targetMs быть не выше thresholdGL.
  // Возвращает { grams, standardDrinks, minutesAhead, existingAtTarget, feasible }
  function maxNow(entries, profile, opts, targetMs, thresholdGL) {
    var o = resolveOpts(profile, opts);
    var th = num(thresholdGL, 0);
    var list = (entries || []).map(normalize).filter(Boolean);
    var nowMs = Date.now();
    var minutesAhead = Math.max(0, (Number(targetMs) - nowMs) / 60000);
    var vd = distributionVolume(profile || {}, o.model);
    if (minutesAhead <= o.peakMinutes) {
      return { grams: 0, standardDrinks: 0, minutesAhead: minutesAhead,
               existingAtTarget: 0, feasible: false, vd: vd };
    }
    var existingAtTarget = 0;
    if (list.length) {
      var t0Ms = Math.min.apply(null, list.map(function (e) { return e.tMs; }));
      var tTarget = (nowMs + minutesAhead * 60000 - t0Ms) / 60000;
      list.forEach(function (e) {
        existingAtTarget += drinkAt(tTarget, (e.tMs - t0Ms) / 60000, e.grams / vd, o.rate, o.peakMinutes);
      });
    }
    var room = th + o.rate * ((minutesAhead - o.peakMinutes) / 60) - existingAtTarget;
    var g = Math.max(0, room * vd);
    return {
      grams: g,
      standardDrinks: g / 10,
      minutesAhead: minutesAhead,
      existingAtTarget: existingAtTarget,
      feasible: g > 0.5,
      vd: vd
    };
  }

  // ---------- Единицы ----------
  function toBreath(gL) { return num(gL, 0) / BLOOD_BREATH; }       // мг/л выдоха
  function fromBreath(mgL) { return num(mgL, 0) * BLOOD_BREATH; }    // г/л крови
  function toPercent(gL) { return num(gL, 0) / 10; }                // % BAC
  function fromPercent(pct) { return num(pct, 0) * 10; }            // г/л
  function toStandardDrinks(g, country) {
    var st = STANDARDS[country || 'ru'] || STANDARDS.ru;
    return num(g, 0) / st.grams;
  }
  function format(valueGL, units) {
    var v = num(valueGL, 0);
    if (units === 'breath') return (v / BLOOD_BREATH).toFixed(3).replace('.', ',') + ' мг/л';
    if (units === 'percent') return (v / 10).toFixed(3).replace('.', ',') + ' %';
    return v.toFixed(2).replace('.', ',') + ' ‰';
  }

  // Сколько часов/минут: {h, m, text}
  function duration(minutes) {
    var m = Math.max(0, Math.round(num(minutes, 0)));
    var h = Math.floor(m / 60);
    var mm = m % 60;
    return { h: h, m: mm, text: (h ? h + ' ч ' : '') + (mm || !h ? mm + ' мин' : '') };
  }

  global.AL = global.AL || {};
  global.AL.Engine = {
    ETH_DENSITY: ETH_DENSITY,
    BLOOD_BREATH: BLOOD_BREATH,
    STANDARDS: STANDARDS,
    DRINKS: DRINKS,
    grams: grams,
    watsonTBW: watsonTBW,
    distributionVolume: distributionVolume,
    bacFromGrams: bacFromGrams,
    normalize: normalize,
    resolveOpts: resolveOpts,
    drinkAt: drinkAt,
    curve: curve,
    bacAtMin: bacAtMin,
    timeToThreshold: timeToThreshold,
    summary: summary,
    maxNow: maxNow,
    toBreath: toBreath,
    fromBreath: fromBreath,
    toPercent: toPercent,
    fromPercent: fromPercent,
    toStandardDrinks: toStandardDrinks,
    format: format,
    duration: duration
  };
})(window);

