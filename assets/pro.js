// Страница «0,00 для профессионалов»: консервативный расчёт и три сценария.
(function (global) {
  'use strict';
  var E = global.AL.Engine;
  var UI = global.AL.UI;
  var S = global.AL.Store;

  var state = { entries: [] };
  // Пессимистичный сценарий — нижняя граница нормы, оптимистичный — верхняя.
  var SCENARIOS = [
    { key: 'slow', name: 'Пессимистичный', rate: 0.08 },
    { key: 'base', name: 'Базовый «0,00»', rate: 0.10 },
    { key: 'fast', name: 'Оптимистичный', rate: 0.15 }
  ];

  function profile() { return S.get().profile; }

  function optsFor(rate) {
    var p = profile();
    var cfg = global.AL_CONFIG.defaults;
    return {
      model: 'watson',                                 // консервативная модель объёма
      rate: rate,
      peakMinutes: Number(p.peakMinutes) || cfg.peakMinutes,
      marginMinutes: 0
    };
  }

  // Запас: 20% расчётного времени плюс минимум 60 минут
  function reserveMinutes(zeroMin) {
    return Math.round(zeroMin * 0.2) + 60;
  }

  function scenarioResult(rate) {
    var sum = E.summary(state.entries, profile(), optsFor(rate));
    var reserve = reserveMinutes(sum.zeroMin);
    return {
      rate: rate,
      zeroMin: sum.zeroMin,
      reserve: reserve,
      readyMin: sum.zeroMin + reserve,
      readyMs: sum.curve.t0 + (sum.zeroMin + reserve) * 60000,
      sum: sum
    };
  }

  function metric(label, value, hint, cls) {
    return '<div class="metric ' + (cls || '') + '"><div class="label">' + label + '</div>' +
           '<div class="value">' + value + '</div>' +
           (hint ? '<div class="hint">' + hint + '</div>' : '') + '</div>';
  }

  function renderList() {
    var box = UI.qs('#drink-list');
    if (!box) return;
    if (!state.entries.length) {
      box.innerHTML = '<li class="muted small">Список пуст: добавьте напитки или возьмите их из дневника.</li>';
      return;
    }
    box.innerHTML = state.entries.map(function (e, i) {
      var d = UI.drinkById(e.drinkId);
      return '<li><span>' + UI.fmtDateTime(e.tMs) + ' · ' + (d ? d.name : (e.name || 'Напиток')) +
        ' ' + (e.volumeMl || '') + ' мл · ' + (e.abv || '') + '%</span><b>' +
        Number(e.grams).toFixed(1) + ' г <button class="icon-btn" data-del="' + i +
        '" aria-label="Удалить">×</button></b></li>';
    }).join('');
    UI.qsa('[data-del]', box).forEach(function (b) {
      UI.on(b, 'click', function () {
        state.entries.splice(Number(b.getAttribute('data-del')), 1);
        recalc();
      });
    });
  }

  function renderVerdict() {
    var box = UI.qs('#verdict');
    var rows = UI.qs('#scenario-rows');
    if (!state.entries.length) {
      box.innerHTML = metric('Готовность', '—', 'Добавьте напиток для расчёта');
      rows.innerHTML = '';
      UI.qs('#chart').innerHTML = '';
      return;
    }
    var base = scenarioResult(0.10);
    var deadlineMs = UI.timeToMs(UI.qs('#deadline').value || '08:00',
                                 Number(UI.qs('#deadline-day').value) || 1);
    var okForWork = base.readyMs <= deadlineMs;
    var diffMin = (base.readyMs - deadlineMs) / 60000;

    box.innerHTML =
      metric('Не ранее чем', UI.fmtDateTime(base.readyMs),
             'ноль ' + UI.fmtDateTime(base.sum.curve.t0 + base.zeroMin * 60000) +
             ' + запас ' + E.duration(base.reserve).text, 'metric-accent') +
      metric('Допуск к ' + UI.fmtTime(deadlineMs), okForWork ? 'успеваете' : 'не успеваете',
             okForWork ? 'до срока остаётся ' + E.duration(-diffMin).text
                       : 'не хватает ' + E.duration(diffMin).text + ' — риск высок',
             okForWork ? '' : 'metric-stop') +
      metric('Сейчас в крови', E.format(base.sum.nowGL, 'promille'),
             base.sum.nowGL > 0.32 ? 'выше порога прибора' : 'ниже порога прибора по модели');

    global.AL.Charts.line(UI.qs('#chart'), base.sum.curve.points, {
      t0: base.sum.curve.t0,
      legalGL: base.sum.legalGL,
      nowMin: base.sum.nowMin
    });

    rows.innerHTML = SCENARIOS.map(function (sc) {
      var r = scenarioResult(sc.rate);
      var mark = r.readyMs > deadlineMs ? ' <span style="color:#ff9b8a">позже</span>' : '';
      return '<tr><td>' + sc.name + '</td>' +
             '<td class="num">' + UI.num(sc.rate, 2) + ' ‰/ч</td>' +
             '<td class="num">' + E.duration(r.zeroMin).text + '</td>' +
             '<td class="num">' + UI.fmtTime(r.readyMs) + mark + '</td></tr>';
    }).join('');
  }

  function addDrink() {
    var d = UI.drinkById(UI.qs('#drink').value) || { id: 'custom', name: 'Напиток', abv: 40, ml: 50 };
    var count = Math.max(1, Number(UI.qs('#count').value) || 1);
    var volume = Number(UI.qs('#volume').value) || d.ml;
    var abv = Number(UI.qs('#abv').value) || d.abv;
    var dayOffset = Number(UI.qs('#day').value) || 0;
    var tMs = UI.timeToMs(UI.qs('#when').value || UI.msToTimeInput(Date.now()), dayOffset);
    for (var i = 0; i < count; i++) {
      state.entries.push({
        id: S.uid(), tMs: tMs, volumeMl: volume, abv: abv,
        grams: E.grams(volume, abv), drinkId: d.id, name: d.name
      });
    }
    state.entries.sort(function (a, b) { return a.tMs - b.tMs; });
    recalc();
    UI.toast('Добавлено: ' + d.name + ' · ' + count + ' × ' + volume + ' мл');
  }

  function recalc() {
    renderList();
    renderVerdict();
  }

  function bind() {
    UI.on(UI.qs('#drink'), 'change', function () {
      var d = UI.drinkById(UI.qs('#drink').value);
      if (!d) return;
      UI.qs('#volume').value = d.ml;
      UI.qs('#abv').value = d.abv;
    });
    UI.on(UI.qs('#add-drink'), 'click', addDrink);
    UI.on(UI.qs('#reset-list'), 'click', function () {
      state.entries = [];
      recalc();
    });
    UI.on(UI.qs('#from-diary'), 'click', function () {
      var list = S.entriesBetween(S.todayStart() - 86400000, Date.now() + 60000);
      if (!list.length) { UI.toast('В дневнике пока нет записей', 'warn'); return; }
      state.entries = list.map(function (e) { return Object.assign({}, e); });
      recalc();
      UI.toast('Загружено записей: ' + list.length);
    });
    ['#deadline', '#deadline-day'].forEach(function (sel) {
      UI.on(UI.qs(sel), 'change', renderVerdict);
      UI.on(UI.qs(sel), 'input', renderVerdict);
    });
  }

  function init() {
    UI.init();
    UI.fillDrinks(UI.qs('#drink'));
    UI.qs('#when').value = UI.msToTimeInput(Date.now());
    var d = UI.drinkById(UI.qs('#drink').value);
    if (d) { UI.qs('#volume').value = d.ml; UI.qs('#abv').value = d.abv; }
    bind();
    recalc();
    setInterval(renderVerdict, 60000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);

