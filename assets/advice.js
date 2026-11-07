// Рекомендации и недельная статистика. Без категоричных обещаний: только «снизь риск».
(function (global) {
  'use strict';

  function cfgVal(path, fallback) {
    var cfg = global.AL_CONFIG || {};
    var cur = cfg;
    path.split('.').forEach(function (k) { cur = cur && cur[k]; });
    return (cur === undefined || cur === null) ? fallback : cur;
  }

  // Недельная статистика: perDay [{tMs, label, grams, drinks}], total, dryDays, hoursAbove
  function weeklyStats(days) {
    var E = global.AL.Engine;
    var S = global.AL.Store;
    var n = days || 7;
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var from = today.getTime() - (n - 1) * 86400000;
    var list = S.entriesSince(from);
    var std = global.AL.UI.standard();
    var perDay = [];
    for (var i = 0; i < n; i++) {
      var d = new Date(from + i * 86400000);
      var start = d.getTime(), end = start + 86400000;
      var grams = list.filter(function (e) { return e.tMs >= start && e.tMs < end; })
        .reduce(function (s, e) { return s + e.grams; }, 0);
      perDay.push({
        tMs: start,
        label: String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0'),
        grams: grams,
        drinks: E.toStandardDrinks(grams, std)
      });
    }
    var totalGrams = perDay.reduce(function (s, d) { return s + d.grams; }, 0);
    var dryDays = perDay.filter(function (d) { return d.grams < 1; }).length;
    // часы выше порога прибора — по кривой, шаг 15 минут
    var hoursAbove = 0;
    if (list.length) {
      var legal = cfgVal('thresholds.legalBloodGL', 0.32);
      var opts = global.AL.UI.opts();
      var firstMs = Math.min.apply(null, list.map(function (e) { return e.tMs; }));
      for (var t = 0; t < n * 24 * 60; t += 15) {
        var at = from + t * 60000;
        var gL = E.bacAtMin(list, S.get().profile, opts, (at - firstMs) / 60000);
        if (gL > legal) hoursAbove += 0.25;
      }
    }
    return {
      days: n,
      fromMs: from,
      perDay: perDay,
      totalGrams: totalGrams,
      totalDrinks: E.toStandardDrinks(totalGrams, std),
      dryDays: dryDays,
      hoursAbove: Math.round(hoursAbove * 10) / 10,
      maxDay: perDay.reduce(function (m, d) { return d.grams > m.grams ? d : m; },
                             perDay[0] || { grams: 0, label: '' })
    };
  }

  // Рекомендации: массив {level, title, text}
  function build(entries, profile, opts) {
    var E = global.AL.Engine;
    var S = global.AL.Store;
    var UI = global.AL.UI;
    var out = [];
    var p = profile || S.get().profile;
    var o = opts || UI.opts();
    var list = entries || S.get().entries;
    if (!list.length) {
      out.push({
        level: 'info',
        title: 'Начните с профиля и одной записи',
        text: 'Укажите пол, вес, рост и возраст в профиле — расчёт станет точнее. Потом добавьте напиток: дневник покажет стандартные дозы за неделю и дни без алкоголя.'
      });
      return out;
    }
    var sum = E.summary(list, p, o);
    var nowGL = sum.nowGL;
    var rising = sum.nowMin < sum.peakMin;

    if (nowGL > 0) {
      if (rising) {
        out.push({
          level: 'warn',
          title: 'Концентрация ещё растёт',
          text: 'Пик впереди, примерно в ' + UI.fmtTime(sum.curve.t0 + sum.peakMin * 60000) +
                '. Пока идёт всасывание, человек трезвеет позже, чем кажется. Вода и еда замедляют всасывание, но не ускоряют выведение.'
        });
      }
      out.push({
        level: 'info',
        title: 'Вода и еда — по делу',
        text: 'На каждую стандартную дозу (10 г спирта) — примерно стакан воды 200 мл. Плотная еда до и во время замедляет подъём концентрации. Кофе, холодный душ и сон «на улице» выведение не ускоряют.'
      });
    }

    // сон
    var sleepMs = UI.timeToMs(p.sleepFrom || '23:30', 0);
    if (sleepMs < Date.now()) sleepMs += 86400000;
    var minutesToSleep = (sleepMs - Date.now()) / 60000;
    if (minutesToSleep > 0 && minutesToSleep < 12 * 60) {
      var atSleep = E.bacAtMin(list, p, o, (sleepMs - sum.curve.t0) / 60000);
      if (atSleep > 0.5) {
        out.push({
          level: 'warn',
          title: 'К отходу ко сну концентрация будет ещё высокой',
          text: 'Расчётная концентрация к ' + UI.fmtTime(sleepMs) + ' — ' + E.format(atSleep, UI.units()) +
                '. Алкоголь перед сном сокращает глубокую фазу сна и прибавляет ночные пробуждения: 7–8 часов в постели не дают отдыха.'
        });
      }
      var last = list[list.length - 1];
      if (last && (sleepMs - last.tMs) > 0 && (sleepMs - last.tMs) / 3600000 < 3) {
        out.push({
          level: 'info',
          title: 'Последний напиток ближе чем за 3 часа до сна',
          text: 'Чтобы сон не пострадал, старайтесь прекращать пить за 3–4 часа до отхода ко сну: к моменту засыпания концентрация успевает упасть.'
        });
      }
    }

    // недельная норма
    var ws = weeklyStats(7);
    var weekly = cfgVal('thresholds.lowRiskWeekly', 14);
    if (ws.totalDrinks > weekly * 1.5) {
      out.push({
        level: 'stop',
        title: 'Неделя далеко выше порога низкого риска',
        text: 'За 7 дней — ' + UI.num(ws.totalDrinks, 1) + ' стандартных доз при ориентире ВОЗ до ' + weekly +
              '. На этом уровне уже заметны риски для печени и давления. Запланируйте 2–3 дня без алкоголя на следующей неделе.'
      });
    } else if (ws.totalDrinks > weekly) {
      out.push({
        level: 'warn',
        title: 'Недельная норма превышена',
        text: 'За 7 дней ' + UI.num(ws.totalDrinks, 1) + ' стандартных доз (ориентир низкого риска — до ' + weekly +
              '). Разбейте остаток недели днями без алкоголя.'
      });
    }
    if (ws.dryDays < 2 && ws.totalGrams > 0) {
      out.push({
        level: 'info',
        title: 'Мало дней без алкоголя',
        text: 'В последние 7 дней дней без алкоголя — ' + ws.dryDays +
              '. Два дня подряд без спиртного дают печени время восстановиться.'
      });
    }

    // подсказка про калибровку
    if (!p.calibrated && S.get().readings.length >= 2) {
      out.push({
        level: 'info',
        title: 'Есть замеры алкотестера',
        text: 'Скорость выведения можно подстроить под себя на странице профиля — это уменьшит ошибку расчёта. Пока используется среднее значение.'
      });
    }

    return out;
  }

  global.AL = global.AL || {};
  global.AL.Advice = { weeklyStats: weeklyStats, build: build };
})(window);

