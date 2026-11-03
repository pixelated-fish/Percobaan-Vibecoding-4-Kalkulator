/**
 * engine.js — inti perhitungan kalkulator.
 *
 * Bagian ini tidak menyentuh DOM sama sekali, sehingga logikanya bisa diuji
 * terpisah (lihat test/engine.test.js).
 *
 * Alur: teks ekspresi -> tokenizer -> parser (AST) -> evaluator -> angka.
 */
(function (global) {
  'use strict';

  /** Galat khusus kalkulator: pesannya sudah ramah untuk ditampilkan ke pengguna. */
  class CalcError extends Error {
    constructor(message) {
      super(message);
      this.name = 'CalcError';
    }
  }

  // Fungsi yang dikenali, semuanya butuh satu argumen di dalam tanda kurung.
  const FUNCTIONS = new Set([
    'sin', 'cos', 'tan',
    'asin', 'acos', 'atan',
    'sqrt', 'ln', 'log', 'abs', 'exp'
  ]);

  // Konstanta yang bisa dipakai langsung di dalam ekspresi.
  const CONSTANTS = { pi: Math.PI, 'π': Math.PI, e: Math.E };

  // Simbol tampilan yang tetap boleh diketik, dipetakan ke operator ASCII.
  const UNICODE_OPERATORS = { '×': '*', '·': '*', '÷': '/', '−': '-', '–': '-' };

  // Batas nilai yang dianggap nol saat memeriksa hasil trigonometri.
  const NEAR_ZERO = 1e-12;

  function isDigit(char) {
    return char >= '0' && char <= '9';
  }

  function isLetter(char) {
    return (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || char === '_';
  }

  function isExponentStart(source, index) {
    const next = source[index + 1];
    if (isDigit(next)) return true;
    return (next === '+' || next === '-') && isDigit(source[index + 2]);
  }

  /* ------------------------------------------------------------------ *
   * 1. Tokenizer — memecah teks menjadi token
   * ------------------------------------------------------------------ */

  function tokenize(source) {
    const tokens = [];
    let index = 0;

    while (index < source.length) {
      const char = source[index];

      // Spasi hanya pemisah, tidak berpengaruh ke hasil.
      if (char === ' ' || char === '\t' || char === '\n' || char === '\u00a0') {
        index += 1;
        continue;
      }

      // Angka: 12, 3.14, .5, 2e3 (notasi ilmiah hasil perhitungan sebelumnya).
      if (isDigit(char) || char === '.') {
        const start = index;
        let dotCount = 0;
        while (index < source.length && (isDigit(source[index]) || source[index] === '.')) {
          if (source[index] === '.') {
            dotCount += 1;
            if (dotCount > 1) {
              throw new CalcError('Format angka tidak valid: ada dua titik desimal');
            }
          }
          index += 1;
        }
        if ((source[index] === 'e' || source[index] === 'E') && isExponentStart(source, index)) {
          index += 1;
          if (source[index] === '+' || source[index] === '-') index += 1;
          while (index < source.length && isDigit(source[index])) index += 1;
        }
        const raw = source.slice(start, index);
        const value = Number(raw);
        if (!Number.isFinite(value)) {
          throw new CalcError('Angka "' + raw + '" tidak valid');
        }
        tokens.push({ type: 'number', value: value, raw: raw });
        continue;
      }

      if (char === 'π') {
        tokens.push({ type: 'constant', value: Math.PI, raw: 'π' });
        index += 1;
        continue;
      }

      // Nama: fungsi, konstanta, atau "mod"/"ans".
      if (isLetter(char)) {
        const start = index;
        while (index < source.length && isLetter(source[index])) index += 1;
        const name = source.slice(start, index).toLowerCase();
        if (name === 'mod') {
          tokens.push({ type: 'operator', value: 'mod', raw: name });
        } else if (name === 'ans') {
          tokens.push({ type: 'answer' });
        } else if (FUNCTIONS.has(name)) {
          tokens.push({ type: 'function', value: name, raw: name });
        } else if (Object.prototype.hasOwnProperty.call(CONSTANTS, name)) {
          tokens.push({ type: 'constant', value: CONSTANTS[name], raw: name });
        } else {
          throw new CalcError('Nama "' + name + '" tidak dikenal');
        }
        continue;
      }

      if (char === '+' || char === '-' || char === '*' || char === '/' ||
          char === '^' || char === '!' || char === '%') {
        tokens.push({ type: 'operator', value: char, raw: char });
        index += 1;
        continue;
      }

      if (Object.prototype.hasOwnProperty.call(UNICODE_OPERATORS, char)) {
        tokens.push({ type: 'operator', value: UNICODE_OPERATORS[char], raw: char });
        index += 1;
        continue;
      }

      if (char === '(' || char === ')') {
        tokens.push({ type: 'paren', value: char });
        index += 1;
        continue;
      }

      throw new CalcError('Karakter "' + char + '" tidak dikenal');
    }

    tokens.push({ type: 'end' });
    return tokens;
  }

  /* ------------------------------------------------------------------ *
   * 2. Parser — membangun pohon ekspresi dengan urutan prioritas yang benar
   *
   *    ekspresi   := suku (('+' | '-') suku)*
   *    suku       := uner (('*' | '/' | 'mod') uner | uner)*   <- perkalian implisit
   *    uner       := ('+' | '-') uner | pangkat
   *    pangkat    := postfix ('^' uner)?                       <- pangkat kanan-asosiatif
   *    postfix    := primer ('!' | '%')*
   *    primer     := angka | konstanta | 'Ans' | fungsi '(' ekspresi ')' | '(' ekspresi ')'
   * ------------------------------------------------------------------ */

  function startsPrimary(token) {
    if (!token) return false;
    if (token.type === 'number' || token.type === 'constant' ||
        token.type === 'answer' || token.type === 'function') return true;
    return token.type === 'paren' && token.value === '(';
  }

  /**
   * Perkalian implisit hanya untuk "2(3)", "2π", "3sin(30)", "2Ans".
   * Dua angka yang berdampingan seperti "5 5" justru dianggap salah ketik.
   */
  function canStartImplicitProduct(token) {
    return startsPrimary(token) && token.type !== 'number';
  }

  class Parser {
    constructor(tokens) {
      this.tokens = tokens;
      this.index = 0;
    }

    peek() {
      return this.tokens[this.index];
    }

    advance() {
      const token = this.tokens[this.index];
      this.index += 1;
      return token;
    }

    parse() {
      const node = this.parseAdditive();
      const token = this.peek();
      if (token.type === 'end') return node;
      if (token.type === 'paren') throw new CalcError('Tanda kurung tidak seimbang');
      throw new CalcError('Ekspresi belum lengkap atau ada operator berlebih');
    }

    parseAdditive() {
      let node = this.parseMultiplicative();
      for (;;) {
        const token = this.peek();
        if (token.type !== 'operator' || (token.value !== '+' && token.value !== '-')) break;
        this.advance();
        node = {
          type: 'binary',
          operator: token.value,
          left: node,
          right: this.parseMultiplicative()
        };
      }
      return node;
    }

    parseMultiplicative() {
      let node = this.parseUnary();
      for (;;) {
        const token = this.peek();
        if (token.type === 'operator' &&
            (token.value === '*' || token.value === '/' || token.value === 'mod')) {
          this.advance();
          node = {
            type: 'binary',
            operator: token.value,
            left: node,
            right: this.parseUnary()
          };
          continue;
        }
        // "2π", "3sin(30)", "2(3+4)" => perkalian implisit.
        if (canStartImplicitProduct(token)) {
          node = {
            type: 'binary',
            operator: '*',
            left: node,
            right: this.parseUnary()
          };
          continue;
        }
        break;
      }
      return node;
    }

    parseUnary() {
      const token = this.peek();
      if (token.type === 'operator' && (token.value === '+' || token.value === '-')) {
        this.advance();
        const operand = this.parseUnary();
        if (token.value === '-') return { type: 'unary', operand: operand };
        return operand;
      }
      return this.parsePower();
    }

    parsePower() {
      const base = this.parsePostfix();
      const token = this.peek();
      if (token.type === 'operator' && token.value === '^') {
        this.advance();
        return { type: 'binary', operator: '^', left: base, right: this.parseUnary() };
      }
      return base;
    }

    parsePostfix() {
      let node = this.parsePrimary();
      for (;;) {
        const token = this.peek();
        if (token.type === 'operator' && (token.value === '!' || token.value === '%')) {
          this.advance();
          node = { type: 'postfix', operator: token.value, operand: node };
          continue;
        }
        break;
      }
      return node;
    }

    parsePrimary() {
      const token = this.advance();

      if (token.type === 'number' || token.type === 'constant') {
        return { type: 'number', value: token.value };
      }

      if (token.type === 'answer') {
        return { type: 'answer' };
      }

      if (token.type === 'function') {
        const open = this.advance();
        if (!(open.type === 'paren' && open.value === '(')) {
          throw new CalcError('Fungsi ' + token.value + ' harus diikuti "(", contoh: ' + token.value + '(30)');
        }
        const argument = this.parseAdditive();
        const close = this.advance();
        if (!(close && close.type === 'paren' && close.value === ')')) {
          throw new CalcError('Tanda kurung tutup ")" tidak ditemukan');
        }
        return { type: 'function', name: token.value, argument: argument };
      }

      if (token.type === 'paren' && token.value === '(') {
        const inner = this.parseAdditive();
        const close = this.advance();
        if (!(close && close.type === 'paren' && close.value === ')')) {
          throw new CalcError('Tanda kurung tutup ")" tidak ditemukan');
        }
        return inner;
      }

      if (token.type === 'end') {
        throw new CalcError('Ekspresi belum lengkap');
      }

      if (token.type === 'paren' && token.value === ')') {
        throw new CalcError('Isi kurung tidak boleh kosong');
      }

      throw new CalcError('Tanda "' + (token.raw || token.value) + '" tidak lengkap');
    }
  }

  /* ------------------------------------------------------------------ *
   * 3. Evaluator — menghitung nilai pohon ekspresi
   * ------------------------------------------------------------------ */

  function toRadians(value, angleMode) {
    return angleMode === 'deg' ? (value * Math.PI) / 180 : value;
  }

  function fromRadians(value, angleMode) {
    return angleMode === 'deg' ? (value * 180) / Math.PI : value;
  }

  /** Sisa galat pembulatan (mis. sin 180° = 1.2e-16) dirapikan menjadi 0. */
  function snapToZero(value) {
    return Math.abs(value) < NEAR_ZERO ? 0 : value;
  }

  function power(base, exponent) {
    if (base < 0 && !Number.isInteger(exponent)) {
      throw new CalcError('Bilangan negatif hanya bisa dipangkatkan dengan eksponen bulat');
    }
    if (base === 0 && exponent < 0) {
      throw new CalcError('Tidak bisa membagi dengan nol');
    }
    return Math.pow(base, exponent);
  }

  function factorial(value) {
    if (!Number.isInteger(value) || value < 0) {
      throw new CalcError('Faktorial hanya untuk bilangan bulat 0 atau lebih');
    }
    if (value > 170) {
      throw new CalcError('Faktorial terlalu besar (maksimal 170)');
    }
    let result = 1;
    for (let i = 2; i <= value; i += 1) result *= i;
    return result;
  }

  function applyFunction(name, value, context) {
    switch (name) {
      case 'sqrt':
        if (value < 0) throw new CalcError('Akar kuadrat bilangan negatif tidak terdefinisi');
        return Math.sqrt(value);

      case 'sin':
        return snapToZero(Math.sin(toRadians(value, context.angleMode)));
      case 'cos':
        return snapToZero(Math.cos(toRadians(value, context.angleMode)));
      case 'tan': {
        const radians = toRadians(value, context.angleMode);
        if (Math.abs(Math.cos(radians)) < NEAR_ZERO) {
          throw new CalcError('tan tidak terdefinisi pada 90° + k·180°');
        }
        return snapToZero(Math.tan(radians));
      }

      case 'asin':
        if (value < -1 || value > 1) throw new CalcError('asin hanya menerima nilai -1 sampai 1');
        return fromRadians(Math.asin(value), context.angleMode);
      case 'acos':
        if (value < -1 || value > 1) throw new CalcError('acos hanya menerima nilai -1 sampai 1');
        return fromRadians(Math.acos(value), context.angleMode);
      case 'atan':
        return fromRadians(Math.atan(value), context.angleMode);

      case 'ln':
        if (value <= 0) throw new CalcError('Logaritma hanya untuk bilangan positif');
        return Math.log(value);
      case 'log':
        if (value <= 0) throw new CalcError('Logaritma hanya untuk bilangan positif');
        return Math.log10(value);

      case 'abs':
        return Math.abs(value);
      case 'exp':
        return Math.exp(value);

      default:
        throw new CalcError('Fungsi "' + name + '" tidak dikenal');
    }
  }

  function evaluateNode(node, context) {
    switch (node.type) {
      case 'number':
        return node.value;

      case 'answer':
        return context.answer;

      case 'unary':
        return -evaluateNode(node.operand, context);

      case 'binary': {
        const left = evaluateNode(node.left, context);
        const right = evaluateNode(node.right, context);
        switch (node.operator) {
          case '+': return left + right;
          case '-': return left - right;
          case '*': return left * right;
          case '/':
            if (right === 0) throw new CalcError('Tidak bisa membagi dengan nol');
            return left / right;
          case 'mod':
            if (right === 0) throw new CalcError('Tidak bisa melakukan mod dengan nol');
            return left % right;
          case '^':
            return power(left, right);
          default:
            throw new CalcError('Operator tidak dikenal');
        }
      }

      case 'postfix': {
        const value = evaluateNode(node.operand, context);
        if (node.operator === '!') return factorial(value);
        if (node.operator === '%') return value / 100;
        throw new CalcError('Operator tidak dikenal');
      }

      case 'function':
        return applyFunction(node.name, evaluateNode(node.argument, context), context);

      default:
        throw new CalcError('Ekspresi tidak valid');
    }
  }

  /* ------------------------------------------------------------------ *
   * 4. API publik
   * ------------------------------------------------------------------ */

  /**
   * Menghitung ekspresi dan mengembalikan angka.
   * @param {string} expression
   * @param {{ angleMode?: 'deg'|'rad', answer?: number }} [options]
   * @returns {number}
   */
  function evaluate(expression, options) {
    const settings = options || {};
    const angleMode = settings.angleMode === 'rad' ? 'rad' : 'deg';
    const answer = typeof settings.answer === 'number' && Number.isFinite(settings.answer)
      ? settings.answer
      : 0;

    const tokens = tokenize(String(expression));
    if (tokens.length === 1) throw new CalcError('Ekspresi masih kosong');

    const tree = new Parser(tokens).parse();
    const value = evaluateNode(tree, { angleMode: angleMode, answer: answer });

    if (Number.isNaN(value)) throw new CalcError('Hasil tidak terdefinisi');
    if (!Number.isFinite(value)) throw new CalcError('Hasil terlalu besar');
    return value;
  }

  /** Versi evaluate() yang tidak melempar galat. */
  function tryEvaluate(expression, options) {
    try {
      return { ok: true, value: evaluate(expression, options) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Terjadi kesalahan' };
    }
  }

  /** Melengkapi tanda kurung yang belum ditutup supaya pratinjau tetap bisa dihitung. */
  function balanceParentheses(expression) {
    const text = String(expression);
    let depth = 0;
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] === '(') depth += 1;
      else if (text[i] === ')') depth -= 1;
    }
    return depth > 0 ? text + ')'.repeat(depth) : text;
  }

  /**
   * Mengubah angka menjadi teks yang rapi: membuang sisa galat floating point
   * (0.1 + 0.2 -> "0.3") dan memakai notasi ilmiah untuk angka ekstrem.
   */
  function formatNumber(value) {
    if (typeof value !== 'number' || Number.isNaN(value)) return 'NaN';
    if (!Number.isFinite(value)) return value > 0 ? '∞' : '-∞';
    if (value === 0) return '0';

    const rounded = Number(value.toPrecision(15));
    if (rounded === 0) return '0';

    const magnitude = Math.abs(rounded);
    if (magnitude >= 1e15 || magnitude < 1e-9) {
      return rounded
        .toExponential(14)
        .replace(/(\.\d*?)0+e/, '$1e')
        .replace(/\.e/, 'e')
        .replace('e+', 'e');
    }
    return String(rounded);
  }

  /** Versi ekspresi untuk ditampilkan: × ÷ − √ π. */
  function prettyExpression(expression) {
    return String(expression)
      .replace(/sqrt\(/gi, '√(')
      .replace(/\bpi\b/gi, 'π')
      .replace(/\*/g, '×')
      .replace(/\//g, '÷')
      .replace(/-/g, '−');
  }

  const api = {
    CalcError: CalcError,
    evaluate: evaluate,
    tryEvaluate: tryEvaluate,
    balanceParentheses: balanceParentheses,
    formatNumber: formatNumber,
    prettyExpression: prettyExpression
  };

  global.CalcEngine = api;

  // Dukungan opsional bila file ini dipakai dari Node.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
