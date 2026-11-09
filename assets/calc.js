// Главная страница: калькулятор + обратный расчёт.
(function (global) {
  'use strict';
  var E = global.AL.Engine;
  var UI = global.AL.UI;
  var S = global.AL.Store;

  var state = { entries: [] };
  var formEntries = [];     // позиция, добавленная последним нажатием «Добавить напиток»: её правит смена мл/крепости/времени
  var formDrinkId = null;   // напиток этой позиции: смена напитка в списке не переписывает уже добавленное
  var lastAddSig = '';      // подпись последнего добавления — нужна, чтобы двойной клик не удваивал дозировку
  var lastAddAt = 0;
  var lastSummary = null;   // итог последнего расчёта — нужен обратному расчёту для времени нуля

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
    // Подсказка под селектом: «500 мл · 4,5 % · ≈17,8 г чистого спирта» — чтобы не гадать, что за порция.
    var hint = UI.qs('#drink-hint');
    if (hint) {
      hint.textContent = d.ml + ' мл · ' + UI.num(d.abv, 1) + ' % · ≈' + UI.num(E.grams(d.ml, d.abv), 1) +
                         ' г чистого спирта';
    }
  }

  function entryLabel(e) {
    var d = UI.drinkById(e.drinkId);
    return d ? d.name : (e.name || 'Напиток');
  }

  // Порог прибора по крови: в законе две нормы — 0,16 мг/л в выдохе и 0,30 г/л (‰) в крови.
  // Считаем по крови: это то же число, что в config.js, поэтому подписи на странице не расходятся.
  function legalGL() {
    var cfg = global.AL_CONFIG || {};
    return (cfg.thresholds && cfg.thresholds.legalBloodGL) || 0.30;
  }

  function zoneText(gL) {
    if (gL <= 0.05) return 'По расчёту — практически ноль';
    if (gL <= legalGL()) return 'Ниже порога прибора — но это не гарантия';
    if (gL <= 0.8) return 'Лёгкое опьянение';
    if (gL <= 1.5) return 'Заметное опьянение';
    if (gL <= 2.5) return 'Сильное опьянение';
    if (gL <= 4) return 'Тяжёлое состояние — риск для здоровья';
    // Линейная модель «досчитывает» и заведомо смертельные концентрации: предупреждаем прямо.
    return 'Опасная для жизни концентрация — нужна скорая помощь (103/112)';
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
    lastSummary = sum;

    if (!state.entries.length) {
      box.innerHTML = metric('Сейчас в крови', '—', 'Добавьте напиток — расчёт появится сразу') +
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
             sum.nowGL > 1.5 ? 'metric-stop' : (sum.nowGL > legalGL() ? 'metric-warn' : '')) +
      metric('До 0,00 ‰', E.duration(sum.zeroMin).text,
             'полное выведение, по расчёту в ' + zeroClock + (zeroMs > Date.now() ? ' · ' + UI.relative(zeroMs) : ''),
             'metric-accent') +
      metric('Ниже порога прибора', E.duration(sum.legalMin).text,
             'около ' + legalClock + ' · 0,16 мг/л (0,30 ‰) — погрешность прибора, а не разрешение');

    global.AL.Charts.line(UI.qs('#chart'), sum.curve.points, {
      t0: sum.curve.t0,
      legalGL: sum.legalGL,
      nowMin: sum.nowMin
    });

    var std = UI.standard();
    var st = E.STANDARDS[std] || E.STANDARDS.ru;
    UI.qs('#breakdown').innerHTML =
      '<li><span>Всего чистого спирта</span><b>' + UI.num(sum.totalGrams, 1) + ' г · ' +
        UI.num(E.toStandardDrinks(sum.totalGrams, std), 1) + ' станд. доз (1 = ' + st.grams + ' г)</b></li>' +
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
    var units = UI.units();
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
    var thText = threshold === 0 ? '0,00 ‰' : E.format(threshold, units);

    if (Date.now() > effectiveMs) {
      box.innerHTML = metric('Время уже прошло', '—', 'Выберите время в будущем', 'metric-warn');
      return;
    }
    if (res.reason === 'too-early') {
      box.innerHTML =
        metric('Максимум спиртного', 'нет запаса', 'До ' + UI.fmtTime(targetMs) +
               ' меньше ' + opts.peakMinutes + ' мин: доза не успеет всосаться и выйти', 'metric-warn') +
        metric('Порог к сроку', thText, 'при выведении ' + UI.num(opts.rate, 2) + ' ‰/ч');
      return;
    }
    if (res.reason === 'not-clear') {
      var zeroMs = lastSummary && lastSummary.curve.t0
        ? lastSummary.curve.t0 + lastSummary.zeroMin * 60000 : 0;
      box.innerHTML =
        metric('Максимум спиртного', '0 г — пить нельзя',
               'К ' + UI.fmtTime(targetMs) + ' по расчёту останется ' + E.format(res.existingAtTarget, units) +
               ', а нужно ' + thText, 'metric-stop') +
        metric('Ноль по расчёту', zeroMs ? UI.fmtDateTime(zeroMs) : '—',
               'по уже добавленным напиткам; каждая новая доза отодвигает этот срок', 'metric-warn');
      return;
    }
    box.innerHTML =
      metric('Максимум чистого спирта', UI.num(res.grams, 0) + ' г',
             'успеет выйти к ' + UI.fmtTime(targetMs) + ' с запасом ' + margin + ' мин', 'metric-accent') +
      metric('Это примерно', UI.num(drinksStd, 1) + ' станд. доз',
             'или ' + Math.max(0, Math.floor(beers)) + ' бокала пива 0,5 л по 4,5%') +
      metric('Порог к сроку', thText,
             'при выведении ' + UI.num(opts.rate, 2) + ' ‰/ч');
  }

  function renderAdvice() {
    var box = UI.qs('#advice');
    var list = global.AL.Advice.build(state.entries, profile(), UI.opts());
    // Линейная модель честно «досчитывает» и смертельные концентрации — предупреждаем отдельно.
    if (lastSummary && state.entries.length && lastSummary.peakGL > 4) {
      list.unshift({
        level: 'stop',
        title: 'Расчётная концентрация опасна для жизни',
        text: 'По введённым напиткам максимум ' + E.format(lastSummary.peakGL, UI.units()) +
              '. При таких значениях возможны потеря сознания и остановка дыхания. Если это не учебный ' +
              'расчёт, а реальная ситуация — нужна помощь: 103 или 112. Значения выше 4–5 ‰ модель считает ' +
              'по инерции и показывает для наглядности, а не как «сколько человек выдержит».'
      });
    }
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
    // Длинный список (20 порций) не разворачиваем целиком: показываем последние записи,
    // расчёт при этом учитывает все.
    var MAX_ROWS = 8;
    var start = Math.max(0, state.entries.length - MAX_ROWS);
    var rows = state.entries.slice(start);
    var head = start > 0
      ? '<li class="muted small">… и ещё ' + start + ' записей выше — в расчёте учтены все</li>'
      : '';
    box.innerHTML = head + rows.map(function (e, k) {
      var i = start + k;
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

  // «Когда» по умолчанию — «сейчас»: поле времени скрыто, пока не нажали «другое время».
  function whenInputVisible() {
    var el = UI.qs('#when');
    return !!(el && !el.hidden);
  }

  function whenMs() {
    if (!whenInputVisible()) return Date.now();
    var dayOffset = Number(UI.qs('#day').value) || 0;
    return UI.timeToMs(UI.qs('#when').value || UI.msToTimeInput(Date.now()), dayOffset);
  }

  function applyForm(silent) {
    var d = UI.drinkById(UI.qs('#drink').value) || { id: 'custom', name: 'Напиток', abv: 40, ml: 50 };
    var volume = Number(UI.qs('#volume').value) || d.ml;
    var abv = Number(UI.qs('#abv').value) || d.abv;
    var tMs = whenMs();
    var sig = d.id + '|' + volume + '|' + abv + '|' + Math.round(tMs / 60000);
    // Правка мл/крепости/времени после расчёта обновляет последнюю добавленную позицию — но только
    // если напиток тот же. Сменили напиток в списке — это заготовка следующей порции, старая остаётся.
    if (silent) {
      if (!formEntries.length || d.id !== formDrinkId) return;
      if (!formEntries.every(function (e) { return state.entries.indexOf(e) !== -1; })) return;
      state.entries = state.entries.filter(function (e) { return formEntries.indexOf(e) === -1; });
    } else if (sig === lastAddSig && Date.now() - lastAddAt < 700) {
      return; // двойной клик по «Рассчитать»: та же порция в ту же минуту не добавляется второй раз
    }
    // Одна позиция = один объём и одна крепость: 2 стопки — это 100 мл, а не «2 порции по 50».
    var entry = {
      id: S.uid(),
      tMs: tMs,
      volumeMl: volume,
      abv: abv,
      grams: E.grams(volume, abv),
      drinkId: d.id,
      name: d.name
    };
    formEntries = [entry];
    formDrinkId = d.id;
    state.entries.push(entry);
    state.entries.sort(function (a, b) { return a.tMs - b.tMs; });
    if (!silent) { lastAddSig = sig; lastAddAt = Date.now(); }
    recalc();
    if (!silent) UI.toast('Добавлено: ' + d.name + ' · ' + volume + ' мл ' + UI.num(abv, 1) + '%');
  }

  function bind() {
    UI.on(UI.qs('#drink'), 'change', function () {
      // Выбрали другой напиток — это заготовка следующей порции, уже добавленное не трогаем.
      syncDrinkFields();
    });
    UI.on(UI.qs('#add-drink'), 'click', function () { applyForm(false); });
    // «Когда»: по умолчанию «сейчас», время открывается по кнопке.
    var whenBtn = UI.qs('#when-other');
    if (whenBtn) {
      UI.on(whenBtn, 'click', function () {
        var inp = UI.qs('#when');
        var label = UI.qs('#when-now-label');
        if (inp.hidden) {
          inp.hidden = false;
          inp.value = UI.msToTimeInput(Date.now());
          if (label) label.textContent = 'Время:';
          whenBtn.textContent = 'сейчас';
          try { inp.focus({ preventScroll: true }); } catch (e) {}
        } else {
          inp.hidden = true;
          if (label) label.textContent = 'Сейчас';
          whenBtn.textContent = 'другое время';
        }
        if (formEntries.length) applyForm(true);
      });
    }
    // Поменяли объём, крепость или время после расчёта — последняя позиция обновляется сама, без нажатий.
    ['#when', '#volume', '#abv', '#day'].forEach(function (sel) {
      var el = UI.qs(sel);
      if (!el) return;
      UI.on(el, 'input', function () { if (formEntries.length) applyForm(true); });
      UI.on(el, 'change', function () { if (formEntries.length) applyForm(true); });
    });
    // «Рассчитать точнее» под результатом: раскрывает блок с ростом/возрастом/крепостью и ведёт к нему.
    var moreBtn = UI.qs('#more-precise');
    if (moreBtn) {
      UI.on(moreBtn, 'click', function () {
        var box = UI.qs('#precise');
        if (!box) return;
        box.open = true;
        box.scrollIntoView({ behavior: 'smooth', block: 'center' });
        var first = box.querySelector('input');
        if (first) setTimeout(function () { try { first.focus({ preventScroll: true }); } catch (e) {} }, 400);
      });
    }
    UI.on(UI.qs('#reset-list'), 'click', function () {
      state.entries = [];
      formEntries = [];
      formDrinkId = null;
      lastAddSig = '';
      recalc();
    });
    UI.on(UI.qs('#from-diary'), 'click', function () {
      var from = S.todayStart() - 86400000;
      var list = S.entriesBetween(from, Date.now() + 60000);
      if (!list.length) { UI.toast('В дневнике пока нет записей', 'warn'); return; }
      formEntries = [];   // список из дневника форма не создавала — следующая форма добавится сверху
      formDrinkId = null;
      lastAddSig = '';
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

