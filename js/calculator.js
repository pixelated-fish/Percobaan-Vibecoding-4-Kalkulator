/**
 * calculator.js — penghubung antara antarmuka dan engine perhitungan.
 *
 * Semua yang berhubungan dengan tampilan, tombol, keyboard, riwayat, dan tema
 * ada di sini. Rumus tidak dihitung di file ini; semuanya didelegasikan ke
 * CalcEngine.evaluate().
 */
(function (global) {
  'use strict';

  const engine = global.CalcEngine;
  if (!engine) {
    console.error('engine.js harus dimuat sebelum calculator.js');
    return;
  }

  const STORAGE = {
    history: 'kalkulator.history.v1',
    angle: 'kalkulator.angle.v1',
    theme: 'kalkulator.theme.v1'
  };

  const HISTORY_LIMIT = 30;
  const LITERAL_KEYS = new Set(['pi', 'e', 'mod', 'ans']);
  const FUNCTIONS = new Set([
    'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
    'sqrt', 'ln', 'log', 'abs', 'exp'
  ]);
  // Operator yang boleh diganti bila pengguna menekan operator lain.
  const REPLACEABLE_OPERATORS = new Set(['+', '-', '*', '/', '^']);

  /* ---------------------------- penyimpanan ---------------------------- */

  function readStore(key) {
    try {
      return global.localStorage.getItem(key);
    } catch (error) {
      return null; // localStorage bisa diblokir (mode privat)
    }
  }

  function writeStore(key, value) {
    try {
      global.localStorage.setItem(key, value);
    } catch (error) {
      /* gagal menyimpan bukan alasan untuk menghentikan kalkulator */
    }
  }

  function loadHistory() {
    const raw = readStore(STORAGE.history);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item) => item && typeof item.expression === 'string' && typeof item.result === 'string')
        .slice(0, HISTORY_LIMIT);
    } catch (error) {
      return [];
    }
  }

  function loadAngleMode() {
    return readStore(STORAGE.angle) === 'rad' ? 'rad' : 'deg';
  }

  function loadTheme() {
    const saved = readStore(STORAGE.theme);
    if (saved === 'light' || saved === 'dark') return saved;
    try {
      if (global.matchMedia && global.matchMedia('(prefers-color-scheme: light)').matches) {
        return 'light';
      }
    } catch (error) {
      /* abaikan */
    }
    return 'dark';
  }

  /* ------------------------------- state ------------------------------- */

  const state = {
    expr: '',
    justEvaluated: false,
    lastExpression: '',
    lastValue: null,
    error: '',
    angleMode: loadAngleMode(),
    history: loadHistory(),
    theme: loadTheme()
  };

  let dom = null;

  /* --------------------------- helper ekspresi -------------------------- */

  function isDigitChar(char) {
    return char >= '0' && char <= '9';
  }

  function evaluationOptions() {
    return {
      angleMode: state.angleMode,
      answer: state.lastValue === null ? 0 : state.lastValue
    };
  }

  function append(text) {
    state.expr += text;
    state.error = '';
  }

  /** Setelah "=", mengetik angka akan memulai perhitungan baru. */
  function beginFresh() {
    if (state.justEvaluated) {
      state.expr = '';
      state.justEvaluated = false;
      state.lastExpression = '';
    }
    state.error = '';
  }

  function insertDigit(digit) {
    beginFresh();
    if (state.expr.slice(-1) === ')') return 'Tutup kurung dulu, atau tekan operator';

    const trailingNumber = state.expr.match(/(\d+\.?\d*|\.\d+)$/);
    // "0" tunggal diganti angka baru, supaya tidak menjadi "05".
    if (trailingNumber && trailingNumber[0] === '0') {
      state.expr = state.expr.slice(0, -1) + digit;
      state.error = '';
      return null;
    }
    append(digit);
    return null;
  }

  function insertDot() {
    beginFresh();
    const trailingNumber = state.expr.match(/(\d+\.?\d*|\.\d+)$/);
    if (!trailingNumber) {
      append('0.');
      return null;
    }
    if (trailingNumber[0].indexOf('.') !== -1) return 'Angka ini sudah punya titik desimal';
    append('.');
    return null;
  }

  function insertOperator(operator) {
    // Belum ada apa pun di layar: hanya minus yang masuk akal (bilangan negatif).
    if (state.expr === '') {
      if (operator === '-') {
        append('-');
        return null;
      }
      if (state.lastValue === null) return null;
      append(formatFromLast());
      append(operator);
      return null;
    }

    // Melanjutkan perhitungan dari hasil terakhir: "5 =" lalu "+" menjadi "5+".
    if (state.justEvaluated) {
      state.expr = formatFromLast();
      state.justEvaluated = false;
      state.error = '';
      append(operator);
      return null;
    }

    // Minus dipakai sebagai tanda negatif setelah operator atau kurung buka.
    if (operator === '-') {
      if (state.expr.slice(-1) === '-') return 'Sudah ada tanda minus di sini';
      append('-');
      return null;
    }

    if (state.expr.slice(-1) === '(') return 'Isi angka di dalam kurung dulu';

    // Ganti operator terakhir alih-alih menumpuknya.
    if (state.expr.slice(-3) === 'mod') {
      state.expr = state.expr.slice(0, -3);
    } else if (REPLACEABLE_OPERATORS.has(state.expr.slice(-1))) {
      state.expr = state.expr.slice(0, -1);
    }
    append(operator);
    return null;
  }

  function formatFromLast() {
    return state.lastValue === null ? '0' : engine.formatNumber(state.lastValue);
  }

  function insertFunction(name) {
    if (!FUNCTIONS.has(name)) return null;
    beginFresh();
    append(name + '(');
    return null;
  }

  function insertLiteral(literal) {
    beginFresh();
    append(literal);
    return null;
  }

  function insertSquare() {
    if (state.justEvaluated) {
      state.expr = formatFromLast() + '^2';
      state.justEvaluated = false;
      state.error = '';
      return null;
    }
    const tail = state.expr.slice(-1);
    if (state.expr === '' || tail === '(' || REPLACEABLE_OPERATORS.has(tail) ||
        tail === '^' || state.expr.slice(-3) === 'mod') {
      return 'Pilih angka dulu sebelum menekan x²';
    }
    append('^2');
    return null;
  }

  /** Tombol ± : membalik tanda angka terakhir. */
  function toggleSign() {
    if (state.expr === '') {
      if (state.lastValue === null) return null;
      append('-' + formatFromLast());
      return null;
    }

    if (state.justEvaluated) {
      state.expr = formatFromLast();
      state.justEvaluated = false;
      state.lastExpression = '';
      state.error = '';
    }

    const match = state.expr.match(/(\d+\.?\d*(?:e[+-]?\d+)?)$/i);
    if (!match) return 'Letakkan ± tepat setelah angka';

    const start = match.index;
    const before = state.expr.slice(0, start);
    const isNegativeHere = before.slice(-1) === '-' &&
      (before.length === 1 ||
        REPLACEABLE_OPERATORS.has(before.slice(-2, -1)) ||
        before.slice(-2, -1) === '(' ||
        before.slice(0, -1).slice(-3) === 'mod');

    if (isNegativeHere) {
      state.expr = before.slice(0, -1) + state.expr.slice(start);
    } else {
      state.expr = before + '-' + state.expr.slice(start);
    }
    state.error = '';
    return null;
  }

  function backspace() {
    state.error = '';
    if (state.justEvaluated) {
      state.expr = '';
      state.lastExpression = '';
      state.justEvaluated = false;
      return;
    }
    if (state.expr === '') return;

    const functionMatch = state.expr.match(/(asin|acos|atan|sqrt|sin|cos|tan|ln|log|abs|exp)\($/);
    if (functionMatch) {
      state.expr = state.expr.slice(0, -functionMatch[0].length);
      return;
    }
    if (state.expr.slice(-3) === 'mod') {
      state.expr = state.expr.slice(0, -3);
      return;
    }
    state.expr = state.expr.slice(0, -1);
  }

  function clearAll() {
    state.expr = '';
    state.error = '';
    state.justEvaluated = false;
    state.lastExpression = '';
  }

  function previewResult() {
    if (state.justEvaluated) {
      return { ok: true, text: state.lastValue === null ? '0' : engine.formatNumber(state.lastValue) };
    }
    const expression = state.expr.trim();
    if (expression === '') return { ok: true, text: '0' };

    const candidate = engine.balanceParentheses(expression);
    const result = engine.tryEvaluate(candidate, evaluationOptions());
    if (!result.ok) return { ok: false, text: '' };
    return { ok: true, text: engine.formatNumber(result.value) };
  }

  function equals() {
    // Tekan "=" dua kali berturut-turut tidak menghitung ulang apa pun.
    if (state.justEvaluated) return;

    const expression = state.expr.trim();
    if (expression === '') return;

    const candidate = engine.balanceParentheses(expression);
    const result = engine.tryEvaluate(candidate, evaluationOptions());

    if (!result.ok) {
      state.error = result.error;
      render();
      return;
    }

    const text = engine.formatNumber(result.value);
    state.lastExpression = candidate;
    state.lastValue = Number(text);
    state.justEvaluated = true;
    state.error = '';
    state.expr = text;

    addHistory(candidate, text);
    render();
  }

  function addHistory(expression, result) {
    state.history.unshift({ expression: expression, result: result });
    if (state.history.length > HISTORY_LIMIT) state.history.length = HISTORY_LIMIT;
    writeStore(STORAGE.history, JSON.stringify(state.history));
  }

  /* ------------------------------- render ------------------------------- */

  function render() {
    if (!dom) return;

    const expressionText = state.justEvaluated
      ? engine.prettyExpression(state.lastExpression) + ' ='
      : engine.prettyExpression(state.expr);

    dom.expression.textContent = expressionText;
    dom.expression.scrollLeft = dom.expression.scrollWidth;

    const preview = previewResult();
    const resultText = state.error ? '—' : preview.text;
    dom.result.textContent = resultText;
    dom.result.classList.toggle('is-long', resultText.length > 13 && resultText.length <= 20);
    dom.result.classList.toggle('is-short', resultText.length > 20);
    dom.result.classList.toggle('is-empty', !state.justEvaluated && state.expr === '' && !state.error);

    dom.error.textContent = state.error;
    dom.error.hidden = !state.error;

    renderHistory();
  }

  function renderHistory() {
    if (!dom) return;
    const list = dom.historyList;
    list.textContent = '';

    dom.historyEmpty.hidden = state.history.length > 0;

    state.history.forEach((item, index) => {
      const listItem = document.createElement('li');
      listItem.className = 'history__item';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'history__button';
      button.dataset.historyIndex = String(index);
      button.title = 'Gunakan hasil ini';
      button.setAttribute('aria-label', 'Gunakan hasil ' + item.result + ' dari ' + item.expression);

      const expression = document.createElement('span');
      expression.className = 'history__expression';
      expression.textContent = engine.prettyExpression(item.expression);

      const result = document.createElement('span');
      result.className = 'history__result';
      result.textContent = '= ' + item.result;

      button.append(expression, result);
      listItem.appendChild(button);
      list.appendChild(listItem);
    });
  }

  function renderTheme() {
    const dark = state.theme === 'dark';
    document.documentElement.dataset.theme = state.theme;
    dom.themeButton.textContent = dark ? '☀' : '🌙';
    dom.themeButton.title = dark ? 'Ganti ke tema terang' : 'Ganti ke tema gelap';
    dom.themeButton.setAttribute('aria-label', dom.themeButton.title);
  }

  function renderAngleMode() {
    const deg = state.angleMode === 'deg';
    dom.angleButton.textContent = deg ? 'DEG' : 'RAD';
    dom.angleButton.title = 'Mode sudut: ' + (deg ? 'derajat' : 'radian') + ' (klik untuk ganti)';
    dom.angleButton.setAttribute('aria-label', dom.angleButton.title);
    dom.angleButton.classList.toggle('is-rad', !deg);
  }

  /* ------------------------------- aksi -------------------------------- */

  function pressKey(key) {
    let message = null;

    if (key === '^2') {
      message = insertSquare();
    } else if (key.length > 1 && key.slice(-1) === '(') {
      message = insertFunction(key.slice(0, -1));
    } else if (LITERAL_KEYS.has(key)) {
      message = insertLiteral(key);
    } else if (isDigitChar(key)) {
      message = insertDigit(key);
    } else if (key === '.') {
      message = insertDot();
    } else if (key === '(') {
      if (state.justEvaluated) {
        state.expr = formatFromLast();
        state.justEvaluated = false;
      }
      append('(');
    } else if (key === ')') {
      message = closeParenthesis();
    } else if (key === '%' || key === '!') {
      message = appendPostfix(key);
    } else {
      message = insertOperator(key);
    }

    if (message) state.error = message;
    render();
  }

  function closeParenthesis() {
    const opened = (state.expr.match(/\(/g) || []).length;
    const closed = (state.expr.match(/\)/g) || []).length;
    if (opened <= closed) return 'Tidak ada kurung yang perlu ditutup';
    const tail = state.expr.slice(-1);
    if (tail === '(' || REPLACEABLE_OPERATORS.has(tail) || tail === '^') {
      return 'Lengkapi isi kurung dulu';
    }
    state.expr += ')';
    state.error = '';
    return null;
  }

  function appendPostfix(symbol) {
    const tail = state.expr.slice(-1);
    if (state.expr === '' || tail === '(' || REPLACEABLE_OPERATORS.has(tail) || tail === '^') {
      return 'Pilih angka dulu sebelum menekan ' + symbol;
    }
    if (state.justEvaluated) {
      state.expr = formatFromLast();
      state.justEvaluated = false;
      state.lastExpression = '';
    }
    state.expr += symbol;
    state.error = '';
    return null;
  }

  function toggleAngleMode() {
    state.angleMode = state.angleMode === 'deg' ? 'rad' : 'deg';
    writeStore(STORAGE.angle, state.angleMode);
    renderAngleMode();
    render();
  }

  function toggleTheme() {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    writeStore(STORAGE.theme, state.theme);
    renderTheme();
  }

  function clearHistory() {
    state.history = [];
    writeStore(STORAGE.history, JSON.stringify(state.history));
    renderHistory();
  }

  function useHistoryEntry(index) {
    const item = state.history[index];
    if (!item) return;
    state.expr = item.result;
    state.justEvaluated = false;
    state.lastExpression = '';
    state.error = '';
    render();
  }

  /* --------------------------- event binding --------------------------- */

  const KEYBOARD_ACTIONS = {
    Enter: 'equals',
    '=': 'equals',
    Backspace: 'backspace',
    Delete: 'clear',
    Escape: 'clear',
    '+': '+',
    '-': '-',
    '*': '*',
    x: '*',
    X: '*',
    '/': '/',
    ':': '/',
    '^': '^',
    '%': '%',
    '!': '!',
    '(': '(',
    ')': ')',
    '.': '.',
    ',': '.',
    mod: 'mod'
  };

  function handleKeydown(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const key = event.key;
    if (!key) return;

    let action = KEYBOARD_ACTIONS[key];
    if (!action && /^[0-9]$/.test(key)) action = key;
    if (!action && key.toLowerCase() === 'p') action = 'pi';
    if (!action) return;

    event.preventDefault();

    if (action === 'equals') {
      equals();
      render();
    } else if (action === 'backspace') {
      backspace();
      render();
    } else if (action === 'clear') {
      clearAll();
      render();
    } else {
      pressKey(action);
    }
  }

  function handleKeypadClick(event) {
    const button = event.target.closest('button.key');
    if (!button) return;

    const action = button.dataset.action;
    if (action === 'equals') {
      equals();
      render();
      return;
    }
    if (action === 'backspace') {
      backspace();
      render();
      return;
    }
    if (action === 'clear') {
      clearAll();
      render();
      return;
    }
    if (action === 'ans') {
      pressKey('ans');
      return;
    }
    if (action === 'sign') {
      const message = toggleSign();
      if (message) state.error = message;
      render();
      return;
    }
    if (button.dataset.key) {
      pressKey(button.dataset.key);
    }
  }

  /* ----------------------------- inisialisasi -------------------------- */

  function init() {
    dom = {
      expression: document.getElementById('display-expression'),
      result: document.getElementById('display-result'),
      error: document.getElementById('display-error'),
      keypad: document.getElementById('keypad'),
      angleButton: document.getElementById('angle-toggle'),
      themeButton: document.getElementById('theme-toggle'),
      historyList: document.getElementById('history-list'),
      historyEmpty: document.getElementById('history-empty'),
      clearHistoryButton: document.getElementById('clear-history')
    };

    if (!dom.keypad) {
      console.error('Struktur HTML kalkulator tidak lengkap');
      return;
    }

    dom.keypad.addEventListener('click', handleKeypadClick);
    dom.angleButton.addEventListener('click', toggleAngleMode);
    dom.themeButton.addEventListener('click', toggleTheme);
    dom.clearHistoryButton.addEventListener('click', clearHistory);

    dom.historyList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-history-index]');
      if (!button) return;
      useHistoryEntry(Number(button.dataset.historyIndex));
    });

    document.addEventListener('keydown', handleKeydown);

    renderTheme();
    renderAngleMode();
    render();
  }

  // Objek kecil untuk keperluan pengujian manual di konsol browser.
  global.Calculator = {
    state: state,
    pressKey: pressKey,
    equals: equals,
    backspace: backspace,
    clearAll: clearAll,
    toggleAngleMode: toggleAngleMode,
    render: render
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
