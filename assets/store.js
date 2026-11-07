// Хранилище: всё лежит в localStorage, никуда не отправляется.
// Схема версионирована — при расширении добавляем миграции, старые данные не теряются.
(function (global) {
  'use strict';

  var KEY = 'trezvometr.data';
  var VERSION = 1;

  function blank() {
    return {
      version: VERSION,
      createdAt: Date.now(),
      profile: {
        sex: 'male',
        age: 35,
        heightCm: 175,
        weightKg: 75,
        // 0 = взять из config.js
        eliminationRate: 0,
        model: '',
        peakMinutes: 0,
        units: '',
        standard: '',
        // калибровка по реальному алкотестеру
        calibrated: false,
        calibrations: [],
        // окно сна для рекомендаций
        sleepFrom: '23:30',
        sleepTo: '07:00',
        goal: 'health'
      },
      entries: [],   // [{id, tMs, grams, volumeMl, abv, drinkId, name, note}]
      readings: [],  // [{id, tMs, valueGL, source:'manual'|'device', note}]
      settings: {
        ageOk: false,
        onboarded: false,
        notifications: false,
        // напоминания: [{id, kind:'stop'|'check', hhmm:'22:30', tMs, fired}]
        reminders: []
      }
    };
  }

  // Цепочка миграций: {версия_от: функция(data) -> data}
  var MIGRATIONS = {};

  function uid() {
    return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function read() {
    var raw = null;
    try { raw = global.localStorage.getItem(KEY); } catch (e) { raw = null; }
    if (!raw) return blank();
    var data;
    try { data = JSON.parse(raw); } catch (e) { return blank(); }
    if (!data || typeof data !== 'object') return blank();
    while (data.version < VERSION && MIGRATIONS[data.version]) {
      data = MIGRATIONS[data.version](data);
      data.version += 1;
    }
    var base = blank();
    // мягкое слияние: недостающие поля берём из заготовки (обновление сайта не ломает данные)
    data.profile = Object.assign({}, base.profile, data.profile || {});
    data.settings = Object.assign({}, base.settings, data.settings || {});
    data.entries = Array.isArray(data.entries) ? data.entries : [];
    data.readings = Array.isArray(data.readings) ? data.readings : [];
    data.version = VERSION;
    return data;
  }

  function write(data) {
    try {
      global.localStorage.setItem(KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      return false; // приватный режим или переполнение — интерфейс покажет предупреждение
    }
  }

  var state = null;

  function get() {
    if (!state) state = read();
    return state;
  }

  function save() {
    return write(get());
  }

  function patchProfile(patch) {
    var d = get();
    Object.assign(d.profile, patch || {});
    save();
    return d.profile;
  }

  function patchSettings(patch) {
    var d = get();
    Object.assign(d.settings, patch || {});
    save();
    return d.settings;
  }

  // Запись о напитке. Принимает {drinkId, volumeMl, abv, tMs, note} или {grams, ...}
  function addEntry(entry) {
    var E = global.AL.Engine;
    var e = entry || {};
    var gramsValue = Number(e.grams);
    if (!isFinite(gramsValue)) gramsValue = E.grams(e.volumeMl, e.abv);
    var item = {
      id: e.id || uid(),
      tMs: Number(e.tMs) || Date.now(),
      grams: Math.round(gramsValue * 100) / 100,
      volumeMl: Number(e.volumeMl) || 0,
      abv: Number(e.abv) || 0,
      drinkId: e.drinkId || 'custom',
      name: e.name || 'Напиток',
      note: e.note || ''
    };
    var d = get();
    d.entries.push(item);
    d.entries.sort(function (a, b) { return a.tMs - b.tMs; });
    save();
    return item;
  }

  function removeEntry(id) {
    var d = get();
    d.entries = d.entries.filter(function (e) { return e.id !== id; });
    save();
  }

  function clearEntries() {
    var d = get();
    d.entries = [];
    save();
  }

  function entriesSince(ms) {
    return get().entries.filter(function (e) { return e.tMs >= ms; });
  }

  function entriesBetween(fromMs, toMs) {
    return get().entries.filter(function (e) { return e.tMs >= fromMs && e.tMs <= toMs; });
  }

  function todayStart() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  // Замер алкотестера — для калибровки скорости выведения и истории
  function addReading(reading) {
    var r = reading || {};
    var item = {
      id: uid(),
      tMs: Number(r.tMs) || Date.now(),
      valueGL: Number(r.valueGL) || 0,
      source: r.source === 'device' ? 'device' : 'manual',
      note: r.note || ''
    };
    var d = get();
    d.readings.push(item);
    d.readings.sort(function (a, b) { return a.tMs - b.tMs; });
    save();
    return item;
  }

  // ---------- напоминания ----------
  function addReminder(reminder) {
    var r = reminder || {};
    var item = {
      id: uid(),
      kind: r.kind === 'check' ? 'check' : 'stop',
      hhmm: String(r.hhmm || '22:30'),
      tMs: Number(r.tMs) || 0,
      fired: false
    };
    var d = get();
    d.settings.reminders = (d.settings.reminders || []).concat([item]);
    save();
    return item;
  }

  function removeReminder(id) {
    var d = get();
    d.settings.reminders = (d.settings.reminders || []).filter(function (r) { return r.id !== id; });
    save();
  }

  function listReminders() {
    return (get().settings.reminders || []).slice();
  }

  function markReminderFired(id) {
    var d = get();
    (d.settings.reminders || []).forEach(function (r) { if (r.id === id) r.fired = true; });
    save();
  }

  function exportJSON() {
    return JSON.stringify(get(), null, 2);
  }
  function importJSON(text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { return { ok: false, error: 'Файл не похож на JSON.' }; }
    if (!data || typeof data !== 'object' || !data.profile) {
      return { ok: false, error: 'В файле нет профиля — это не наша резервная копия.' };
    }
    var clean = blank();
    clean.profile = Object.assign({}, clean.profile, data.profile || {});
    clean.settings = Object.assign({}, clean.settings, data.settings || {});
    clean.entries = Array.isArray(data.entries) ? data.entries.filter(function (e) {
      return e && isFinite(Number(e.tMs)) && isFinite(Number(e.grams));
    }) : [];
    clean.readings = Array.isArray(data.readings) ? data.readings : [];
    state = clean;
    save();
    return { ok: true, entries: clean.entries.length };
  }

  function wipe() {
    state = blank();
    save();
    return state;
  }

  global.AL = global.AL || {};
  global.AL.Store = {
    KEY: KEY,
    VERSION: VERSION,
    blank: blank,
    get: get,
    save: save,
    patchProfile: patchProfile,
    patchSettings: patchSettings,
    addEntry: addEntry,
    removeEntry: removeEntry,
    clearEntries: clearEntries,
    entriesSince: entriesSince,
    entriesBetween: entriesBetween,
    todayStart: todayStart,
    addReading: addReading,
    addReminder: addReminder,
    removeReminder: removeReminder,
    listReminders: listReminders,
    markReminderFired: markReminderFired,
    exportJSON: exportJSON,
    importJSON: importJSON,
    wipe: wipe,
    uid: uid,
    clone: clone
  };
})(window);

