// Главная страница: калькулятор + обратный расчёт.
(function (global) {
  'use strict';
  var E = global.AL.Engine;
  var UI = global.AL.UI;
  var S = global.AL.Store;

  var state = { entries: [] };

  function profile() { return S.get().profile; }

  function readProfileInputs() {
    S.patchProfile({
      sex: UI.qs('#p-sex').value,
      weightKg: Number(UI.qs('#p-weight').value) || 75,
      heightCm: Number(UI.qs('#p-height').value) || 175,
      age: Number(UI.qs('#p-age').value) || 35
    });
    return S.get().profile;
  }

  function writeProfileInputs() {
    var p = profile();
    var cfg = global.AL_CONFIG.defaults;
    UI.qs('#p-sex').value = p.sex || 'male';
    UI.qs('#p-weight').value = p.weightKg || 75;
    UI.qs('#p-height').value = p.heightCm || 175;
    UI.qs('#p-age').value = p.age || 35;
    UI.qs('#peak').value = String(Number(p.peakMinutes) || cfg.peakMinutes);
    UI.qs('#rate').value = String(Number(p.eliminationRate) || cfg.eliminationRate);
    UI.qs('#model').value = p.model || cfg.model;
    UI.qs('#units').value = UI.units();
  }

  function syncDrinkFields() {
    var d = UI.drinkById(UI.qs('#drink').value);
    if (!d) return;
    UI.qs('#volume').value = d.ml;
    UI.qs('#abv').value = d.abv;
  }

  function entryLabel(e) {
    var d = UI.drinkById(e.drinkId);
    return d ? d.name : (e.name || 'Напиток');
  }

  function zoneText(gL) {
    if (gL <= 0.05) return 'По расчёту — практически ноль';
    if (gL <= 0.32) return 'Ниже порога прибора — но это не гарантия';
    if (gL <= 0.8) return 'Лёгкое опьянение';
    if (gL <= 1.5) return 'Заметное опьянение';
    if (gL <= 2.5) return 'Сильное опьянение';
    return 'Тяжёлое состояние — риск для здоровья';
  }

  function metric(label, value, hint, cls) {
    return '<div class="metric ' + (cls || '') + '"><div class="label">' + label + '</div>' +
           '<div class="value">' + value + '</div>' +
           (hint ? '<div class="hint">' + hint + '</div>' : '') + '</div>';
  }

  function renderResult() {
    var p = profile();
    var opts = UI.opts();
    var box = UI.qs('#result-metrics');
    var units = UI.units();
    var sum = E.summary(state.entries, p, opts);

    if (!state.entries.length) {
      box.innerHTML = metric('Сейчас в крови', '—', 'Добавьте напиток слева') +
                      metric('До 0,00 ‰', '—', 'Появится после расчёта');
      UI.qs('#chart').innerHTML = '';
      UI.qs('#breakdown').innerHTML = '';
      return;
    }

    var zeroClock = UI.fmtTime(sum.curve.t0 + sum.zeroMin * 60000);
    var legalClock = UI.fmtTime(sum.curve.t0 + sum.legalMin * 60000);
    var zeroMs = sum.curve.t0 + sum.zeroMin * 60000;

    box.innerHTML =
      metric('Сейчас в крови', E.format(sum.nowGL, units), zoneText(sum.nowGL),
             sum.nowGL > 1.5 ? 'metric-stop' : (sum.nowGL > 0.32 ? 'metric-warn' : '')) +
      metric('До 0,00', E.duration(sum.zeroMin).text,
             'по расчёту в ' + zeroClock + (zeroMs > Date.now() ? ' · ' + UI.relative(zeroMs) : ''),
             'metric-accent') +
      metric('Ниже порога прибора', E.duration(sum.legalMin).text,
             'около ' + legalClock + ' · 0,16 мг/л (0,32 ‰) — погрешность прибора, а не разрешение');

    global.AL.Charts.line(UI.qs('#chart'), sum.curve.points, {
      t0: sum.curve.t0,
      legalGL: sum.legalGL,
      nowMin: sum.nowMin
    });

    var std = UI.standard();
    UI.qs('#breakdown').innerHTML =
      '<li><span>Всего спирта</span><b>' + UI.num(sum.totalGrams, 1) + ' г · ' +
        UI.num(E.toStandardDrinks(sum.totalGrams, std), 1) + ' ст. дозы</b></li>' +
      '<li><span>Максимум в крови</span><b>' + E.format(sum.peakGL, units) + ' в ' +
        UI.fmtTime(sum.curve.t0 + sum.peakMin * 60000) + '</b></li>' +
      '<li><span>Скорость выведения</span><b>' + UI.num(sum.opts.rate, 2) + ' ‰/ч</b></li>' +
      '<li><span>Объём распределения</span><b>' + UI.num(sum.vd, 1) + ' л · ' +
        (sum.opts.model === 'watson' ? 'Watson' : 'Видмарк') + '</b></li>' +
      '<li><span>Всасывание до пика</span><b>' + sum.opts.peakMinutes + ' мин</b></li>';
  }

  function renderReverse() {
    var p = profile();
    var opts = UI.opts();
    var targetTime = UI.qs('#target-time').value || '08:00';
    var dayOffset = Number(UI.qs('#target-day').value);
    if (!isFinite(dayOffset)) dayOffset = 1;
    var threshold = Number(UI.qs('#target-threshold').value) || 0;
    var margin = Number(UI.qs('#target-margin').value) || 0;
    var box = UI.qs('#reverse-result');
    var targetMs = UI.timeToMs(targetTime, dayOffset);
    // запас: считаем, что трезвым нужно быть раньше на величину запаса
    var effectiveMs = targetMs - margin * 60000;
    var res = E.maxNow(state.entries, p, opts, effectiveMs, threshold);
    var std = UI.standard();
    var st = E.STANDARDS[std] || E.STANDARDS.ru;
    var drinksStd = res.grams / st.grams;
    var beers = res.grams / E.grams(500, 4.5); // эквивалент в бокалах пива 0,5 л по 4,5%

    if (Date.now() > effectiveMs) {
      box.innerHTML = metric('Время уже прошло', '—', 'Выберите время в будущем', 'metric-warn');
      return;
    }
    if (!res.feasible) {
      box.innerHTML =
        metric('Максимум спиртного', 'нет запаса', 'До ' + UI.fmtTime(targetMs) + ' остаётся меньше ' +
               opts.peakMinutes + ' мин — новая доза не успеет выйти', 'metric-warn') +
        metric('Выведено к сроку', '—', 'Оценка по добавленным напиткам');
      return;
    }
    box.innerHTML =
      metric('Максимум чистого спирта', UI.num(res.grams, 0) + ' г',
             'успеет выйти до ' + UI.fmtTime(targetMs) + ' с запасом ' + margin + ' мин', 'metric-accent') +
      metric('Это примерно', UI.num(drinksStd, 1) + ' ст. дозы',
             'или ' + Math.max(0, Math.floor(beers)) + ' бокала пива 0,5 л по 4,5%') +
      metric('Порог к сроку', threshold === 0 ? '0,00 ‰' : '0,32 ‰',
             'при выведении ' + UI.num(opts.rate, 2) + ' ‰/ч');
  }

  function renderAdvice() {
    var box = UI.qs('#advice');
    var list = global.AL.Advice.build(state.entries, profile(), UI.opts());
    box.innerHTML = list.map(function (a) {
      return '<div class="advice-item ' + a.level + '"><h3>' + a.title + '</h3><p>' + a.text + '</p></div>';
    }).join('');
  }

  function renderList() {
    var box = UI.qs('#drink-list');
    if (!box) return;
    if (!state.entries.length) {
      box.innerHTML = '<li class="muted small">Список пуст. Добавьте напиток — расчёт появится сразу.</li>';
      return;
    }
    box.innerHTML = state.entries.map(function (e, i) {
      return '<li><span>' + UI.fmtDateTime(e.tMs) + ' · ' + entryLabel(e) +
        ' ' + (e.volumeMl ? e.volumeMl + ' мл' : '') + (e.abv ? ' · ' + UI.num(e.abv, 1) + '%' : '') +
        '</span><b>' + UI.num(e.grams, 1) + ' г · ' +
        UI.num(E.toStandardDrinks(e.grams, UI.standard()), 1) + ' ст. д.' +
        ' <button class="icon-btn" data-del="' + i + '" aria-label="Удалить">×</button></b></li>';
    }).join('');
    UI.qsa('[data-del]', box).forEach(function (b) {
      UI.on(b, 'click', function () {
        state.entries.splice(Number(b.getAttribute('data-del')), 1);
        recalc();
      });
    });
  }

  function recalc() {
    readProfileInputs();
    renderList();
    renderResult();
    renderReverse();
    renderAdvice();
    // Цель Метрики «расчёт»: не чаще раза в 30 секунд, только при наличии напитков.
    if (state.entries.length && global.AL.Metrika) global.AL.Metrika.goalOnce('calc', 30000);
  }

  function addDrinkFromForm() {
    var d = UI.drinkById(UI.qs('#drink').value) || { id: 'custom', name: 'Напиток', abv: 40, ml: 50 };
    var count = Math.max(1, Number(UI.qs('#count').value) || 1);
    var volume = Number(UI.qs('#volume').value) || d.ml;
    var abv = Number(UI.qs('#abv').value) || d.abv;
    var dayOffset = Number(UI.qs('#day').value) || 0;
    var tMs = UI.timeToMs(UI.qs('#when').value || UI.msToTimeInput(Date.now()), dayOffset);
    for (var i = 0; i < count; i++) {
      state.entries.push({
        id: S.uid(),
        tMs: tMs,
        volumeMl: volume,
        abv: abv,
        grams: E.grams(volume, abv),
        drinkId: d.id,
        name: d.name
      });
    }
    state.entries.sort(function (a, b) { return a.tMs - b.tMs; });
    recalc();
    UI.toast('Добавлено: ' + d.name + ' · ' + count + ' × ' + volume + ' мл');
  }

  function bind() {
    UI.on(UI.qs('#drink'), 'change', syncDrinkFields);
    UI.on(UI.qs('#add-drink'), 'click', addDrinkFromForm);
    UI.on(UI.qs('#reset-list'), 'click', function () {
      state.entries = [];
      recalc();
    });
    UI.on(UI.qs('#from-diary'), 'click', function () {
      var from = S.todayStart() - 86400000;
      var list = S.entriesBetween(from, Date.now() + 60000);
      if (!list.length) { UI.toast('В дневнике пока нет записей', 'warn'); return; }
      state.entries = list.map(function (e) {
        var copy = Object.assign({}, e);
        copy.savedToDiary = true; // чтобы «В дневник» не создал дубли
        return copy;
      });
      recalc();
      UI.toast('Загружено записей: ' + list.length);
    });
    UI.on(UI.qs('#save-diary'), 'click', function () {
      if (!state.entries.length) { UI.toast('Сначала добавьте напиток', 'warn'); return; }
      var n = 0;
      state.entries.forEach(function (e) {
        if (e.savedToDiary) return;
        S.addEntry({ tMs: e.tMs, grams: e.grams, volumeMl: e.volumeMl, abv: e.abv,
                     drinkId: e.drinkId, name: e.name });
        e.savedToDiary = true;
        n++;
      });
      UI.toast(n ? 'Сохранено в дневник: ' + n : 'Эти записи уже в дневнике');
      if (n && global.AL.Metrika) global.AL.Metrika.goal('diary-save');
    });
    ['#p-sex', '#p-weight', '#p-height', '#p-age'].forEach(function (sel) {
      UI.on(UI.qs(sel), 'input', recalc);
      UI.on(UI.qs(sel), 'change', recalc);
    });
    UI.on(UI.qs('#units'), 'change', function () {
      S.patchProfile({ units: UI.qs('#units').value });
      recalc();
    });
    UI.on(UI.qs('#model'), 'change', function () {
      S.patchProfile({ model: UI.qs('#model').value });
      recalc();
    });
    UI.on(UI.qs('#peak'), 'change', function () {
      S.patchProfile({ peakMinutes: Number(UI.qs('#peak').value) });
      recalc();
    });
    UI.on(UI.qs('#rate'), 'change', function () {
      S.patchProfile({ eliminationRate: Number(UI.qs('#rate').value) });
      recalc();
    });
    ['#target-time', '#target-day', '#target-threshold', '#target-margin'].forEach(function (sel) {
      UI.on(UI.qs(sel), 'input', renderReverse);
      UI.on(UI.qs(sel), 'change', renderReverse);
    });
  }

  function init() {
    UI.init();
    UI.fillDrinks(UI.qs('#drink'));
    UI.qs('#when').value = UI.msToTimeInput(Date.now());
    writeProfileInputs();
    syncDrinkFields();
    bind();
    recalc();
    if (global.AL.Reminders) global.AL.Reminders.init();
    setInterval(recalc, 60000); // «сейчас» обновляем раз в минуту
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);

