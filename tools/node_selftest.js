// Проверка формул без браузера: node tools/node_selftest.js
// Загружает настоящие assets/*.js в песочницу vm с заглушками DOM и localStorage.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const assets = path.join(__dirname, '..', 'assets');
const store = new Map();

const sandbox = {
  console,
  setTimeout,
  setInterval,
  clearTimeout,
  Blob: class {},
  URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
  FileReader: class {},
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  },
  document: {
    readyState: 'complete',
    title: '',
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    createElement: () => ({ classList: { add() {} }, style: {}, setAttribute() {}, appendChild() {}, removeChild() {} }),
    body: { appendChild() {}, classList: { add() {}, remove() {} } },
    addEventListener() {}
  },
  navigator: {}
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const f of ['config.js', 'engine.js', 'store.js', 'ui.js', 'advice.js', 'charts.js']) {
  const code = fs.readFileSync(path.join(assets, f), 'utf8');
  vm.runInContext(code, sandbox, { filename: f });
}

const AL = sandbox.AL;
const E = AL.Engine;
const S = AL.Store;
let passed = 0;
const fails = [];

function close(a, b, tol) { return Math.abs(Number(a) - Number(b)) <= (tol === undefined ? 0.01 : tol); }
function eq(name, actual, expected, tol) {
  if (close(actual, expected, tol)) { passed++; return; }
  fails.push(name + ' → ожидали ' + expected + ', получили ' + (typeof actual === 'number' ? actual.toFixed(4) : actual));
}
function ok(name, cond) {
  if (cond) { passed++; return; }
  fails.push(name);
}

// 1. Граммы спирта
eq('500 мл пива 4,5% = 17,75 г', E.grams(500, 4.5), 17.75);
eq('200 мл водки 40% = 63,12 г', E.grams(200, 40), 63.12);
eq('150 мл вина 13% = 15,39 г', E.grams(150, 13), 15.39);

// 2. Объём распределения
eq('Видмарк, мужчина 75 кг = 51 л', E.distributionVolume({ sex: 'male', weightKg: 75 }, 'widmark'), 51);
eq('Видмарк, женщина 60 кг = 33 л', E.distributionVolume({ sex: 'female', weightKg: 60 }, 'widmark'), 33);
eq('Watson TBW муж 175/75/35', E.watsonTBW({ sex: 'male', heightCm: 175, weightKg: 75, age: 35 }), 43.13, 0.05);
eq('Watson TBW жен 165/60/35', E.watsonTBW({ sex: 'female', heightCm: 165, weightKg: 60, age: 35 }), 30.34, 0.05);

// 3. Концентрация и кривая
const man75 = { sex: 'male', weightKg: 75, heightCm: 175, age: 35 };
eq('40 г у мужчины 75 кг = 0,784 ‰', E.bacFromGrams(40, man75, 'widmark'), 0.784, 0.002);
const t0 = Date.now() - 3600000;
const opts = { model: 'widmark', rate: 0.15, peakMinutes: 40 };
const sum = E.summary([{ tMs: t0, grams: 40 }], man75, opts);
eq('Пик = доза / Vd', sum.peakGL, 40 / 51, 0.002);
eq('Пик через 40 мин', sum.peakMin, 40, 1);
eq('Ноль ≈ 354 мин', sum.zeroMin, 354, 6);
eq('Порог 0,30 ‰ ≈ 234 мин', sum.legalMin, 234, 4);

// 3b. Количество выпитого должно удлинять выведение, а не оставаться прежним
const oneShot = E.summary([{ tMs: t0, grams: E.grams(50, 40) }], man75, opts);
const manyShots = [];
for (let i = 0; i < 20; i++) manyShots.push({ tMs: t0, grams: E.grams(50, 40) });
const s20 = E.summary(manyShots, man75, opts);
eq('20 стопок: сумма спирта', s20.totalGrams, 315.6, 0.2);
eq('20 стопок: пик в 20 раз выше одной', s20.peakGL / oneShot.peakGL, 20, 0.2);
eq('20 стопок: ноль ≈ 2516 мин, а не 2 ч 44 мин', s20.zeroMin, 2516, 6);
ok('20 стопок: выведение дольше, чем у одной', s20.zeroMin > oneShot.zeroMin * 10);
eq('20 стопок: порог прибора ≈ 2396 мин', s20.legalMin, 2396, 6);
eq('20 стопок: сейчас в крови ≈ 6,14 ‰', s20.nowGL, 315.6 / 51 - 0.15 * (20 / 60), 0.03);
const s20pts = E.series(manyShots, man75, opts, 15);
ok('Серия по минутам доходит до нуля', s20pts[s20pts.length - 1].gL === 0 && s20pts.length > 150);

// 4. Сумма напитков
const sum2 = E.summary([{ tMs: t0, grams: 20 }, { tMs: t0 + 1800000, grams: 20 }], man75, opts);
eq('Суммарные граммы', sum2.totalGrams, 40);
ok('Две дозы дают пик ниже, чем 40 г сразу', sum2.peakGL < sum.peakGL);
ok('Пик при двух дозах наступает позже 40 минут', sum2.peakMin > 40);

// 5. Обратный расчёт
const rev = E.maxNow([], man75, opts, Date.now() + 8 * 3600000, 0);
eq('За 8 ч при 0,00 → 56 г', rev.grams, 56.1, 2);
const revSlow = E.maxNow([], man75, { model: 'widmark', rate: 0.10, peakMinutes: 40 }, Date.now() + 8 * 3600000, 0);
eq('При 0,10 ‰/ч → 37 г', revSlow.grams, 37.4, 2);
ok('За 20 мин запаса нет', E.maxNow([], man75, opts, Date.now() + 20 * 60000, 0).feasible === false);

// 5b. Если к сроку ещё не трезв — пить нельзя (иначе обратный расчёт «дарит» лишние граммы)
const revAfter20 = E.maxNow(manyShots, man75, opts, Date.now() + 8 * 3600000, 0);
eq('После 20 стопок через 8 ч можно 0 г', revAfter20.grams, 0, 0.5);
ok('Причина — к сроку ещё не трезв', revAfter20.reason === 'not-clear');
eq('Остаток к сроку ≈ 4,94 ‰', revAfter20.existingAtTarget, 4.94, 0.05);
const revAfter20Long = E.maxNow(manyShots, man75, opts, Date.now() + 29 * 3600000, 0);
eq('Через 29 ч после 20 стопок тоже 0 г', revAfter20Long.grams, 0, 0.5);
ok('Через 29 ч остаток всё ещё выше нуля', revAfter20Long.existingAtTarget > 1);
const revAfterOne = E.maxNow([{ tMs: t0, grams: 40 }], man75, opts, Date.now() + 8 * 3600000, 0);
eq('После 40 г за 8 ч остаток уже 0 → можно 56 г', revAfterOne.existingAtTarget, 0, 0.001);
eq('После 40 г за 8 ч максимум ≈ 56 г', revAfterOne.grams, 56.1, 2);

// 6. Единицы
eq('0,32 ‰ = 0,16 мг/л', E.toBreath(0.32), 0.16);
eq('0,16 мг/л = 0,32 ‰', E.fromBreath(0.16), 0.32);
eq('0,5 ‰ = 0,05 %', E.toPercent(0.5), 0.05);
eq('0,05 % = 0,5 ‰', E.fromPercent(0.05), 0.5);
eq('10 г = 1 доза РФ', E.toStandardDrinks(10, 'ru'), 1);
eq('10 г = 0,714 дозы США', E.toStandardDrinks(10, 'us'), 0.714, 0.01);
ok('Формат ‰ = "0,78 ‰"', E.format(0.784, 'promille') === '0,78 ‰');
ok('Формат мг/л = "0,160 мг/л"', E.format(0.32, 'breath') === '0,160 мг/л');
ok('Формат % = "0,050 %"', E.format(0.5, 'percent') === '0,050 %');
eq('354 мин = 5 ч 54 мин', E.duration(354).h * 60 + E.duration(354).m, 354);

// 7. Хранилище
S.wipe();
ok('Очистка обнуляет дневник', S.get().entries.length === 0);
const added = S.addEntry({ tMs: Date.now(), volumeMl: 500, abv: 4.5, drinkId: 'beer-light', name: 'Пиво' });
eq('Запись считает граммы сама', added.grams, 17.75);
const backup = S.exportJSON();
S.wipe();
const imp = S.importJSON(backup);
ok('Экспорт/импорт восстанавливает запись', imp.ok && S.get().entries.length === 1);
ok('Импорт отклоняет посторонний JSON', S.importJSON('{"foo":1}').ok === false);
ok('Импорт отклоняет битый JSON', S.importJSON('не json').ok === false);

// 7b. Напоминания
S.get().settings.reminders = [];
const rem = S.addReminder({ kind: 'stop', hhmm: '22:30', tMs: Date.now() + 3600000 });
ok('Напоминание добавлено', S.listReminders().length === 1 && rem.kind === 'stop');
S.markReminderFired(rem.id);
ok('Напоминание помечено сработавшим', S.listReminders()[0].fired === true);
S.removeReminder(rem.id);
ok('Напоминание удалено', S.listReminders().length === 0);

// 8. Статистика и рекомендации
S.wipe();
S.patchProfile({ sex: 'male', weightKg: 75, heightCm: 175, age: 35, eliminationRate: 0.15 });
S.addEntry({ tMs: Date.now() - 3600000, grams: 20, name: 'Тест' });
S.addEntry({ tMs: Date.now() - 3 * 86400000, grams: 30, name: 'Тест' });
const ws = AL.Advice.weeklyStats(7);
ok('Статистика за 7 дней', ws.perDay.length === 7);
eq('Всего 50 г', ws.totalGrams, 50);
eq('5 стандартных доз', ws.totalDrinks, 5);
ok('Есть дни без алкоголя', ws.dryDays >= 5);
ok('Рекомендации формируются', AL.Advice.build(null, null, null).length > 0);
S.wipe();

console.log('Пройдено: ' + passed);
if (fails.length) {
  console.log('Провалено: ' + fails.length);
  fails.forEach((f) => console.log('  FAIL — ' + f));
  process.exit(1);
}
console.log('Все проверки пройдены.');
