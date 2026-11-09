// Ядро расчёта. Без зависимостей, без DOM — можно тестировать отдельно (tests.html).
// Формулы и допущения:
//   граммы спирта      = объём(мл) × крепость(%) / 100 × 0,789 (плотность этанола)
//   концентрация, г/л  = граммы / объём_распределения(л)
//     Видмарк: Vd = вес × r,  r = 0,68 (муж) / 0,55 (жен) / 0,615 (не указан)
//     Watson:  Vd = TBW × 0,8 (учитывает возраст и рост; оценка выше — консервативнее)
//   кривая: всасывание линейно за peakMinutes, затем выведение с постоянной скоростью
//     eliminationRate г/л в час. Скорость выведения — ОДНА на весь организм (кинетика
//     нулевого порядка: печень за час перерабатывает примерно одинаковое количество спирта),
//     а не отдельная на каждый напиток. Поэтому 20 стопок дают в 20 раз более высокий пик
//     и в 20 раз более долгое выведение, чем одна стопка.
//     Считается поминутно (simulate), а не «кривая на каждый напиток»: иначе время до нуля
//     не зависело бы от количества выпитого.
// Единицы: 1 г/л = 1 ‰ (промилле) = 0,1 % BAC; мг/л выдоха ≈ г/л крови / 2,0
(function (global) {
  'use strict';

  var ETH_DENSITY = 0.789;   // г/мл
  var BLOOD_BREATH = 2.0;    // г/л крови на 1 мг/л выдоха — грубое приближение для пересчёта единиц.
                             // В законе это ДВЕ отдельные нормы: 0,16 мг/л в выдохе и 0,30 г/л в крови,
                             // поэтому порог считаем по крови (0,30), а мг/л показываем как справку.

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
    { id: 'vodka-shot',   name: 'Водка',                abv: 40.0, ml: 50,  cat: 'Крепкое' },
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

  // Предохранитель: не считаем дольше 30 суток (защита от сотни порций в дневнике).
  var MAX_MINUTES = 60 * 24 * 30;

  // Одна точка кривой в нужном формате.
  function pointOf(series, t) {
    var gL = series[t] || 0;
    return { tMin: t, gL: gL, breath: gL / BLOOD_BREATH, percent: gL / 10 };
  }

  // Поминутная модель концентрации: { series:[gL по минутам от t0], t0, vd, opts, totalGrams }
  // Всасывание — линейно за peakMinutes, выведение — постоянная скорость на весь организм.
  // untilMin ограничивает расчёт (нужно для «сколько сейчас в крови» и недельной статистики).
  function simulate(entries, profile, opts, untilMin) {
    var o = resolveOpts(profile, opts);
    var peakMin = Math.max(1, o.peakMinutes);
    var list = (entries || []).map(normalize).filter(Boolean);
    var vd = distributionVolume(profile || {}, o.model);
    var totalGrams = list.reduce(function (s, e) { return s + e.grams; }, 0);
    var res = { series: [0], t0: 0, vd: vd, opts: o, totalGrams: totalGrams };
    if (!list.length) return res;
    var t0Ms = Math.min.apply(null, list.map(function (e) { return e.tMs; }));
    var firstStart = Infinity, lastStart = 0, sumPeak = 0;
    var drinks = list.map(function (e) {
      var start = (e.tMs - t0Ms) / 60000;
      var peakBac = e.grams / vd;
      if (start < firstStart) firstStart = start;
      if (start > lastStart) lastStart = start;
      sumPeak += peakBac;
      return { start: start, end: start + peakMin, step: peakBac / peakMin };
    });
    var elimStart = firstStart + peakMin;                        // выведение — после пика первой дозы
    var naturalEnd = lastStart + peakMin + (sumPeak / o.rate) * 60;
    var limit = Math.ceil(naturalEnd) + 1;
    if (untilMin !== undefined && isFinite(Number(untilMin))) {
      limit = Math.min(limit, Math.max(1, Math.ceil(num(untilMin, 0))));
    }
    limit = Math.max(1, Math.min(limit, MAX_MINUTES));
    var bac = 0, series = [0];
    for (var t = 1; t <= limit; t++) {
      for (var i = 0; i < drinks.length; i++) {
        var d = drinks[i];
        if (t > d.start && t <= d.end) bac += d.step;             // всасывание за эту минуту
      }
      if (t > elimStart) bac -= o.rate / 60;                      // выведение — одно на всех
      if (bac < 0) bac = 0;
      series.push(bac);
    }
    res.series = series;
    res.t0 = t0Ms;
    return res;
  }

  // Точки кривой с шагом stepMin (для графиков и недельной статистики)
  function seriesPoints(entries, profile, opts, stepMin, untilMin) {
    var sim = simulate(entries, profile, opts, untilMin);
    var step = Math.max(1, Math.round(num(stepMin, 15)));
    var out = [];
    for (var t = 0; t < sim.series.length; t += step) out.push(pointOf(sim.series, t));
    var last = sim.series.length - 1;
    if (!out.length || out[out.length - 1].tMin !== last) out.push(pointOf(sim.series, last));
    return out;
  }


  // Полная кривая: { points:[{tMin,gL,breath,percent}], series, t0, zeroMin, peakMin, peakGL, totalGrams }
  // points — прорежены для графика (не больше ~300 точек), series — поминутно.
  function curve(entries, profile, opts) {
    var sim = simulate(entries, profile, opts);
    var o = sim.opts;
    var series = sim.series;
    var n = series.length;
    if (n < 2) {
      return { points: [], series: series, t0: 0, zeroMin: 0, peakMin: 0, peakGL: 0,
               totalGrams: 0, opts: o, vd: sim.vd, stepMin: o.stepMin };
    }
    var peakGL = 0, peakMin = 0, zeroMin = n - 1, t;
    for (t = 0; t < n; t++) {
      if (series[t] > peakGL) { peakGL = series[t]; peakMin = t; }
    }
    for (t = peakMin; t < n; t++) {
      if (series[t] <= 0) { zeroMin = t; break; }
    }
    var stepMin = Math.max(1, Math.round(num(o.stepMin, 5)), Math.ceil((n - 1) / 300));
    var points = [];
    for (t = 0; t < n - 1; t += stepMin) points.push(pointOf(series, t));
    points.push(pointOf(series, peakMin));
    points.push(pointOf(series, zeroMin));
    points.sort(function (a, b) { return a.tMin - b.tMin; });
    var uniq = [];
    points.forEach(function (p) {
      if (!uniq.length || uniq[uniq.length - 1].tMin !== p.tMin) uniq.push(p);
    });
    return {
      points: uniq, series: series, t0: sim.t0, zeroMin: zeroMin, peakMin: peakMin, peakGL: peakGL,
      totalGrams: sim.totalGrams, opts: o, vd: sim.vd, stepMin: stepMin
    };
  }

  // Концентрация в момент tMin (минуты от первой записи). Время дробное —
  // между минутами интерполируем, иначе напиток, добавленный «только что», показывал бы 0.
  function bacAtMin(entries, profile, opts, tMin) {
    var list = (entries || []).map(normalize).filter(Boolean);
    if (!list.length) return 0;
    var t = Math.max(0, num(tMin, 0));
    var lo = Math.floor(t);
    if (lo === t) {
      if (t === 0) return 0;
      var exact = simulate(entries, profile, opts, t).series;
      return exact[Math.min(t, exact.length - 1)] || 0;
    }
    var series = simulate(entries, profile, opts, lo + 1).series;
    var a = series[Math.min(lo, series.length - 1)] || 0;
    var b = series[Math.min(lo + 1, series.length - 1)] || 0;
    return a + (b - a) * (t - lo);
  }

  // Когда концентрация впервые упадёт до порога (после пика). Минуты от первой записи.
  function timeToThreshold(cur, thresholdGL) {
    var series = (cur && cur.series) || [];
    if (series.length < 2) return 0;
    var th = num(thresholdGL, 0);
    if (cur.peakGL <= th) return cur.peakMin;   // пик ниже порога — он и так не превышен
    for (var t = cur.peakMin; t < series.length; t++) {
      if (series[t] <= th) return t;
    }
    return series.length - 1;
  }

  // Итог расчёта: пик, ноль, пороги, «не ранее чем» с запасом
  function summary(entries, profile, opts) {
    var cur = curve(entries, profile, opts);
    var o = cur.opts || resolveOpts(profile, opts);
    var legal = 0.30;   // г/л крови — норма РФ (вторая норма в законе: 0,16 мг/л в выдохе)
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
  // Возвращает { grams, standardDrinks, minutesAhead, existingAtTarget, feasible, reason }
  // reason: 'ok' | 'not-clear' (к сроку ещё не трезв — пить нельзя) | 'too-early' (меньше пика)
  function maxNow(entries, profile, opts, targetMs, thresholdGL) {
    var o = resolveOpts(profile, opts);
    var th = num(thresholdGL, 0);
    var list = (entries || []).map(normalize).filter(Boolean);
    var nowMs = Date.now();
    var minutesAhead = Math.max(0, (Number(targetMs) - nowMs) / 60000);
    var vd = distributionVolume(profile || {}, o.model);
    var res = { grams: 0, standardDrinks: 0, minutesAhead: minutesAhead,
                existingAtTarget: 0, feasible: false, vd: vd, reason: 'too-early' };
    if (minutesAhead <= o.peakMinutes) return res;
    var existingAtTarget = 0;
    if (list.length) {
      var t0Ms = Math.min.apply(null, list.map(function (e) { return e.tMs; }));
      existingAtTarget = bacAtMin(list, profile, opts,
                                  (nowMs + minutesAhead * 60000 - t0Ms) / 60000);
    }
    res.existingAtTarget = existingAtTarget;
    // К сроку концентрация ещё выше порога — любая новая доза только добавит.
    // Ровно на пороге (в том числе 0,00) пить можно ровно столько, сколько успеет выйти.
    if (existingAtTarget > th + 1e-9) {
      res.reason = 'not-clear';
      return res;
    }
    // Сколько новая доза успеет вывестись к сроку и при этом остаться в пределах порога
    var k = o.rate * (minutesAhead - o.peakMinutes) / 60;
    var g = vd * (th - existingAtTarget + k);
    res.grams = g;
    res.standardDrinks = g / 10;
    res.feasible = g > 0.5;
    res.reason = 'ok';
    return res;
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
    simulate: simulate,
    series: seriesPoints,
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

