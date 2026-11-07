// Дневник: записи, статистика за неделю, график и экспорт.
(function (global) {
  'use strict';
  var E = global.AL.Engine;
  var UI = global.AL.UI;
  var S = global.AL.Store;

  function drinkName(e) {
    var d = UI.drinkById(e.drinkId);
    return d ? d.name : (e.name || 'Напиток');
  }

  function renderStats() {
    var ws = global.AL.Advice.weeklyStats(7);
    var cfg = global.AL_CONFIG.thresholds;
    var std = UI.standard();
    var stat = function (k, v, hint) {
      return '<div class="stat"><div class="k">' + k + '</div><div class="v">' + v + '</div>' +
             (hint ? '<div class="small muted" style="margin-top:4px">' + hint + '</div>' : '') + '</div>';
    };
    UI.qs('#stats').innerHTML =
      stat('Стандартных доз', UI.num(ws.totalDrinks, 1),
           'ориентир до ' + cfg.lowRiskWeekly + ' в неделю · доза ' +
           (E.STANDARDS[std] || E.STANDARDS.ru).grams + ' г') +
      stat('Дней без алкоголя', ws.dryDays + ' из ' + ws.days) +
      stat('Часов выше порога', UI.num(ws.hoursAbove, 1),
           'порог 0,16 мг/л ≈ 0,32 ‰') +
      stat('Самый плотный день', ws.maxDay && ws.maxDay.grams > 0
           ? UI.num(ws.maxDay.drinks, 1) + ' дозы' : '—',
           ws.maxDay && ws.maxDay.grams > 0 ? ws.maxDay.label : '') +
      stat('Всего спирта', UI.num(ws.totalGrams, 0) + ' г');

    global.AL.Charts.bars(UI.qs('#chart-days'), ws.perDay, { cap: cfg.lowRiskDaily });
  }

  function renderAdvice() {
    var list = global.AL.Advice.build(null, null, null);
    UI.qs('#advice').innerHTML = list.map(function (a) {
      return '<div class="advice-item ' + a.level + '"><h3>' + a.title + '</h3><p>' + a.text + '</p></div>';
    }).join('');
  }

  function renderTable() {
    var box = UI.qs('#entries');
    var list = S.get().entries.slice().reverse();
    var std = UI.standard();
    if (!list.length) {
      box.innerHTML = '<p class="small muted" style="padding:12px">Записей пока нет. Добавьте первую — ' +
        'графики и статистика появятся сразу.</p>';
      UI.qs('#entries-note').textContent = '';
      return;
    }
    box.innerHTML = '<table><thead><tr>' +
      '<th>Дата и время</th><th>Напиток</th><th class="num">Объём</th><th class="num">Крепость</th>' +
      '<th class="num">Спирт</th><th class="num">Дозы</th><th></th></tr></thead><tbody>' +
      list.map(function (e) {
        return '<tr><td class="nowrap">' + UI.fmtDateTime(e.tMs) + '</td>' +
          '<td>' + drinkName(e) + (e.note ? '<div class="tiny muted">' + e.note + '</div>' : '') + '</td>' +
          '<td class="num">' + (e.volumeMl ? e.volumeMl + ' мл' : '—') + '</td>' +
          '<td class="num">' + (e.abv ? UI.num(e.abv, 1) + '%' : '—') + '</td>' +
          '<td class="num">' + UI.num(e.grams, 1) + ' г</td>' +
          '<td class="num">' + UI.num(E.toStandardDrinks(e.grams, std), 1) + '</td>' +
          '<td class="num"><button class="icon-btn" data-eid="' + e.id + '">×</button></td></tr>';
      }).join('') + '</tbody></table>';

    UI.qsa('[data-eid]', box).forEach(function (b) {
      UI.on(b, 'click', function () {
        S.removeEntry(b.getAttribute('data-eid'));
        refresh();
        UI.toast('Запись удалена');
      });
    });
    UI.qs('#entries-note').textContent = 'Всего записей: ' + list.length +
      '. Экспорт в CSV открывается в Excel и Google Sheets.';
  }

  function exportCSV() {
    var rows = [['Дата', 'Время', 'Напиток', 'Объём, мл', 'Крепость, %', 'Спирт, г', 'Стандартные дозы', 'Заметка']];
    var std = UI.standard();
    S.get().entries.forEach(function (e) {
      rows.push([
        UI.fmtDate(e.tMs), UI.fmtTime(e.tMs), drinkName(e),
        e.volumeMl || '', e.abv ? UI.num(e.abv, 1) : '',
        UI.num(e.grams, 1),
        UI.num(E.toStandardDrinks(e.grams, std), 2),
        (e.note || '').replace(/;/g, ',')
      ]);
    });
    var csv = '\ufeff' + rows.map(function (r) { return r.join(';'); }).join('\r\n');
    UI.download('trezvometr-dnevnik-' + UI.fmtDate(Date.now()).replace(/\./g, '-') + '.csv', csv, 'text/csv');
  }

  function addEntry() {
    var d = UI.drinkById(UI.qs('#drink').value) || { id: 'custom', name: 'Напиток', abv: 40, ml: 50 };
    var count = Math.max(1, Number(UI.qs('#count').value) || 1);
    var volume = Number(UI.qs('#volume').value) || d.ml;
    var abv = Number(UI.qs('#abv').value) || d.abv;
    var dayOffset = Number(UI.qs('#day').value) || 0;
    var tMs = UI.timeToMs(UI.qs('#when').value || UI.msToTimeInput(Date.now()), dayOffset);
    var note = (UI.qs('#note').value || '').trim();
    for (var i = 0; i < count; i++) {
      S.addEntry({ tMs: tMs, volumeMl: volume, abv: abv, drinkId: d.id, name: d.name, note: note });
    }
    UI.qs('#note').value = '';
    refresh();
    UI.toast('Записано: ' + d.name + ' · ' + count + ' × ' + volume + ' мл');
  }

  function refresh() {
    renderStats();
    renderTable();
    renderAdvice();
  }

  function bind() {
    UI.on(UI.qs('#drink'), 'change', function () {
      var d = UI.drinkById(UI.qs('#drink').value);
      if (!d) return;
      UI.qs('#volume').value = d.ml;
      UI.qs('#abv').value = d.abv;
    });
    UI.on(UI.qs('#add-entry'), 'click', addEntry);
    UI.on(UI.qs('#export-csv'), 'click', exportCSV);
  }

  function init() {
    UI.init();
    UI.fillDrinks(UI.qs('#drink'));
    UI.qs('#when').value = UI.msToTimeInput(Date.now());
    var d = UI.drinkById(UI.qs('#drink').value);
    if (d) { UI.qs('#volume').value = d.ml; UI.qs('#abv').value = d.abv; }
    bind();
    refresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
