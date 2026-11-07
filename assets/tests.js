// Автотесты: контрольные значения формул, единиц и хранилища. Без фреймворков.
(function (global) {
  'use strict';
  var E = global.AL.Engine;
  var S = global.AL.Store;
  var passed = 0, failed = 0;
  var log = [];

  function close(a, b, tol) {
    return Math.abs(Number(a) - Number(b)) <= (tol === undefined ? 0.01 : tol);
  }

  function check(name, cond) {
    if (cond) { passed++; log.push({ ok: true, name: name }); }
    else { failed++; log.push({ ok: false, name: name }); }
  }

  function eq(name, actual, expected, tol) {
    var shown = typeof actual === 'number' ? actual.toFixed(4) : String(actual);
    check(name + ' (ожидали ' + expected + ', получили ' + shown + ')', close(actual, expected, tol));
  }

  // ---------- 1. Граммы спирта ----------
  eq('500 мл пива 4,5% = 17,75 г', E.grams(500, 4.5), 17.75);
  eq('200 мл водки 40% = 63,12 г', E.grams(200, 40), 63.12);
  eq('150 мл вина 13% = 15,39 г', E.grams(150, 13), 15.39);
  eq('Пустой ввод = 0 г', E.grams(0, 0), 0);

  // ---------- 2. Объём распределения ----------
  eq('Видмарк, мужчина 75 кг = 51 л', E.distributionVolume({ sex: 'male', weightKg: 75 }, 'widmark'), 51);
  eq('Видмарк, женщина 60 кг = 33 л', E.distributionVolume({ sex: 'female', weightKg: 60 }, 'widmark'), 33);
  eq('Watson, мужчина 175/75/35: TBW ≈ 43,13 л',
     E.watsonTBW({ sex: 'male', heightCm: 175, weightKg: 75, age: 35 }), 43.13, 0.05);
  eq('Watson, женщина 165/60/35: TBW ≈ 30,34 л',
     E.watsonTBW({ sex: 'female', heightCm: 165, weightKg: 60, age: 35 }), 30.34, 0.05);

  // ---------- 3. Концентрация ----------
  var man75 = { sex: 'male', weightKg: 75, heightCm: 175, age: 35 };
  eq('40 г спирта у мужчины 75 кг = 0,784 ‰', E.bacFromGrams(40, man75, 'widmark'), 0.784, 0.002);

  // ---------- 4. Кривая и время до нуля ----------
  var t0 = Date.now() - 3600000; // час назад
  var one = [{ tMs: t0, grams: 40 }];
  var opts = { model: 'widmark', rate: 0.15, peakMinutes: 40 };
  var sum = E.summary(one, man75, opts);
  eq('Пик концентрации = 0,784 ‰', sum.peakGL, 40 / 51, 0.002);
  eq('Пик наступает через 40 минут', sum.peakMin, 40, 1);
  eq('Полное выведение ≈ 354 мин', sum.zeroMin, 354, 6);
  eq('Порог 0,30 ‰ ≈ 234 мин', sum.legalMin, 234, 4);

  // ---------- 4b. Количество выпитого удлиняет выведение ----------
  var oneShot = [{ tMs: t0, grams: E.grams(50, 40) }];
  var manyShots = [];
  for (var s = 0; s < 20; s++) manyShots.push({ tMs: t0, grams: E.grams(50, 40) });
  var sumOne = E.summary(oneShot, man75, opts);
  var sumMany = E.summary(manyShots, man75, opts);
  eq('20 стопок: всего 315,6 г', sumMany.totalGrams, 315.6, 0.2);
  eq('20 стопок: пик в 20 раз выше одной', sumMany.peakGL / sumOne.peakGL, 20, 0.2);
  eq('20 стопок: ноль ≈ 2516 мин (41 ч 56 мин)', sumMany.zeroMin, 2516, 6);
  check('20 стопок: выведение дольше, чем у одной, более чем в 10 раз',
        sumMany.zeroMin > sumOne.zeroMin * 10);

  // ---------- 5. Сумма напитков ----------
  var two = [{ tMs: t0, grams: 20 }, { tMs: t0 + 1800000, grams: 20 }];
  var sum2 = E.summary(two, man75, opts);
  eq('Всего спирта учтено', sum2.totalGrams, 40);
  check('Две дозы по 20 г дают более низкий пик, чем 40 г сразу', sum2.peakGL < sum.peakGL);
  check('Пик при двух дозах наступает позже 40 минут', sum2.peakMin > 40);

  // ---------- 6. Обратный расчёт ----------
  var target = Date.now() + 8 * 3600000; // через 8 часов
  var rev = E.maxNow([], man75, opts, target, 0);
  eq('За 8 часов при 0,00 можно 56 г спирта', rev.grams, 56.1, 2);
  var revSlow = E.maxNow([], man75, { model: 'widmark', rate: 0.10, peakMinutes: 40 }, target, 0);
  eq('При скорости 0,10 ‰/ч — 37,4 г', revSlow.grams, 37.4, 2);
  var revNo = E.maxNow([], man75, opts, Date.now() + 20 * 60000, 0);
  check('За 20 минут запаса нет', revNo.feasible === false);
  // если к сроку ещё не трезв — обратный расчёт не должен «дарить» граммы
  var revAfter20 = E.maxNow(manyShots, man75, opts, Date.now() + 8 * 3600000, 0);
  eq('После 20 стопок через 8 ч можно 0 г', revAfter20.grams, 0, 0.5);
  check('Причина: к сроку ещё не трезв', revAfter20.reason === 'not-clear');
  eq('Остаток к сроку ≈ 4,94 ‰', revAfter20.existingAtTarget, 4.94, 0.05);
  var revClear = E.maxNow([], man75, opts, Date.now() + 8 * 3600000, 0);
  check('Ровно на нуле пить можно столько, сколько успеет выйти', revClear.reason === 'ok' && revClear.feasible);

  // ---------- 7. Единицы ----------
  eq('0,32 ‰ = 0,16 мг/л выдоха', E.toBreath(0.32), 0.16);
  eq('0,16 мг/л = 0,32 ‰', E.fromBreath(0.16), 0.32);
  eq('0,5 ‰ = 0,05 % BAC', E.toPercent(0.5), 0.05);
  eq('0,05 % = 0,5 ‰', E.fromPercent(0.05), 0.5);
  eq('10 г = 1 стандартная доза РФ', E.toStandardDrinks(10, 'ru'), 1);
  eq('10 г = 0,71 дозы США', E.toStandardDrinks(10, 'us'), 0.714, 0.01);
  check('Формат промилле: "0,78 ‰"', E.format(0.784, 'promille') === '0,78 ‰');
  check('Формат выдоха: "0,160 мг/л"', E.format(0.32, 'breath') === '0,160 мг/л');
  check('Формат % BAC: "0,050 %"', E.format(0.5, 'percent') === '0,050 %');

  // ---------- 8. Длительность ----------
  var d = E.duration(354);
  eq('354 минуты = 5 ч 54 мин', d.h * 60 + d.m, 354);

  // ---------- 9. Хранилище ----------
  var before = S.exportJSON();
  S.wipe();
  check('После очистки дневник пуст', S.get().entries.length === 0);
  var added = S.addEntry({ tMs: Date.now(), volumeMl: 500, abv: 4.5, drinkId: 'beer-light', name: 'Пиво светлое' });
  eq('Запись получила граммы из объёма и крепости', added.grams, 17.75);
  check('Запись попала в выборку за сегодня', S.entriesSince(S.todayStart()).length === 1);
  var backup = S.exportJSON();
  S.wipe();
  check('После повторной очистки пусто', S.get().entries.length === 0);
  var imp = S.importJSON(backup);
  check('Импорт восстановил запись', imp.ok && S.get().entries.length === 1);
  check('Отказ на посторонний JSON', S.importJSON('{"foo":1}').ok === false);
  check('Отказ на битый JSON', S.importJSON('не json').ok === false);

  // ---------- 10. Недельная статистика и рекомендации ----------
  S.wipe();
  S.patchProfile({ sex: 'male', weightKg: 75, heightCm: 175, age: 35, eliminationRate: 0.15 });
  var now = Date.now();
  S.addEntry({ tMs: now - 3600000, grams: 20, name: 'Тест' });
  S.addEntry({ tMs: now - 3 * 86400000, grams: 30, name: 'Тест' });
  var ws = global.AL.Advice.weeklyStats(7);
  check('Недельная статистика: 7 дней', ws.perDay.length === 7);
  eq('Недельная статистика: всего 50 г', ws.totalGrams, 50);
  eq('Недельная статистика: 5 стандартных доз', ws.totalDrinks, 5);
  check('Недельная статистика: есть дни без алкоголя', ws.dryDays >= 5);
  var advice = global.AL.Advice.build(null, null, null);
  check('Рекомендации формируются', Array.isArray(advice) && advice.length > 0);

  // вернуть данные пользователя, если они были
  if (before) {
    try { S.importJSON(before); } catch (e) { /* пустая заготовка — нечего восстанавливать */ }
  }

  // ---------- вывод ----------
  function render() {
    document.getElementById('summary').innerHTML =
      '<div class="stat"><div class="k">Пройдено</div><div class="v" style="color:#3ddc9a">' + passed + '</div></div>' +
      '<div class="stat"><div class="k">Провалено</div><div class="v" style="color:' +
      (failed ? '#ff7a7a' : '#9bb3b4') + '">' + failed + '</div></div>';
    document.getElementById('results').innerHTML = log.map(function (t) {
      return '<div class="advice-item ' + (t.ok ? '' : 'stop') + '"><p><b>' +
        (t.ok ? 'OK' : 'FAIL') + '</b> — ' + t.name + '</p></div>';
    }).join('');
    document.title = failed ? 'ТЕСТЫ: ' + failed + ' провалено' : 'Тесты пройдены: ' + passed;
    global.__TESTS__ = { passed: passed, failed: failed, log: log };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})(window);

