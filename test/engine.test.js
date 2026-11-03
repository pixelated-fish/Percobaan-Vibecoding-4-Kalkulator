/**
 * engine.test.js — rangkaian uji untuk js/engine.js.
 *
 * Ditulis tanpa dependensi (tidak memakai Node/Python), sehingga bisa
 * dijalankan dengan membuka test/tests.html di browser mana pun.
 */
(function (global) {
  'use strict';

  const engine = global.CalcEngine;
  if (!engine) throw new Error('engine.js harus dimuat sebelum engine.test.js');

  const evaluate = engine.evaluate;
  const formatNumber = engine.formatNumber;
  const prettyExpression = engine.prettyExpression;
  const balanceParentheses = engine.balanceParentheses;

  /* --------------------------- alat bantu uji --------------------------- */

  function fail(message) {
    throw new Error(message);
  }

  function assertEqual(actual, expected, label) {
    if (!Object.is(actual, expected)) {
      fail((label || 'nilai') + ': diharapkan ' + JSON.stringify(expected) +
        ', didapat ' + JSON.stringify(actual));
    }
  }

  function assertClose(actual, expected, tolerance, label) {
    const limit = tolerance === undefined ? 1e-9 : tolerance;
    if (typeof actual !== 'number' || Number.isNaN(actual)) {
      fail((label || 'nilai') + ': diharapkan angka ' + expected + ', didapat ' + actual);
    }
    if (Math.abs(actual - expected) > limit) {
      fail((label || 'nilai') + ': diharapkan ' + expected + ' (±' + limit + '), didapat ' + actual);
    }
  }

  function assertThrows(fn, fragment, label) {
    try {
      fn();
    } catch (error) {
      const message = String(error && error.message);
      if (fragment && message.indexOf(fragment) === -1) {
        fail((label || 'galat') + ': pesan "' + message + '" tidak memuat "' + fragment + '"');
      }
      if (error.name !== 'CalcError') {
        fail((label || 'galat') + ': tipe galat seharusnya CalcError, didapat ' + error.name);
      }
      return;
    }
    fail((label || 'galat') + ': seharusnya melempar galat, tetapi berhasil');
  }

  const results = [];

  function test(name, fn) {
    try {
      fn();
      results.push({ name: name, passed: true });
    } catch (error) {
      results.push({ name: name, passed: false, message: error.message });
    }
  }

  function calc(expression, options) {
    return evaluate(expression, options);
  }

  /* ------------------------------- tes -------------------------------- */

  test('Operasi dasar: tambah, kurang, kali, bagi', function () {
    assertEqual(calc('2+3'), 5);
    assertEqual(calc('10-4'), 6);
    assertEqual(calc('6*7'), 42);
    assertEqual(calc('8/2'), 4);
    assertEqual(calc('7.5+2.5'), 10);
    assertEqual(calc('0.1+0.2'), 0.30000000000000004);
    assertEqual(formatNumber(calc('0.1+0.2')), '0.3', 'pembulatan 0.1+0.2');
  });

  test('Prioritas operator dan asosiatif kiri', function () {
    assertEqual(calc('2+3*4'), 14);
    assertEqual(calc('(2+3)*4'), 20);
    assertEqual(calc('10-2-3'), 5);
    assertEqual(calc('100/5/2'), 10);
    assertEqual(calc('100/5*2'), 40);
    assertEqual(calc('2+3*4-6/2'), 11);
  });

  test('Perpangkatan', function () {
    assertEqual(calc('2^10'), 1024);
    assertEqual(calc('9^0.5'), 3);
    assertEqual(calc('(-2)^3'), -8);
    assertEqual(calc('2^-2'), 0.25);
    assertEqual(calc('10^0'), 1);
  });

  test('Perpangkatan berantai dihitung kanan-asosiatif', function () {
    assertEqual(calc('2^3^2'), 512, '2^(3^2)');
    assertEqual(calc('2^3^2'), Math.pow(2, 9));
  });

  test('Tanda minus uner', function () {
    assertEqual(calc('-5+3'), -2);
    assertEqual(calc('-(2+3)'), -5);
    assertEqual(calc('5*-2'), -10);
    assertEqual(calc('--5'), 5);
    assertEqual(calc('-2^2'), -4, 'minus di luar pangkat');
    assertEqual(calc('(-2)^2'), 4, 'minus di dalam kurung');
  });

  test('Perkalian implisit', function () {
    assertEqual(calc('2(3+4)'), 14);
    assertEqual(calc('(1+1)(2+2)'), 8);
    assertClose(calc('3sin(30)'), 1.5, 1e-12, '3·sin 30');
    assertEqual(formatNumber(calc('3sin(30)')), '1.5');
    assertEqual(calc('2pi'), Math.PI * 2);
    assertEqual(calc('2e3'), 2000, 'notasi ilmiah, bukan e dikali 3');
    assertEqual(calc('4sqrt(9)'), 12);
  });

  test('Tanda kurung: kelengkapan dan galat', function () {
    assertEqual(calc('((2+3)*(4-1))'), 15);
    assertThrows(function () { calc('(1+2'); }, 'kurung tutup', 'kurung belum ditutup');
    assertThrows(function () { calc('1+2)'); }, 'kurung', 'kurung berlebih');
    assertThrows(function () { calc('()'); }, 'kosong', 'kurung kosong');
    assertThrows(function () { calc('( )'); }, 'kosong', 'kurung berisi spasi');
  });

  test('Ekspresi tidak lengkap ditolak', function () {
    assertThrows(function () { calc(''); }, 'kosong');
    assertThrows(function () { calc('5+'); }, 'belum lengkap');
    assertThrows(function () { calc('*5'); });
    assertThrows(function () { calc('5 5'); }, 'belum lengkap');
    assertThrows(function () { calc('(('); });
  });

  test('Trigonometri mode derajat (default)', function () {
    assertClose(calc('sin(30)'), 0.5, 1e-12, 'sin 30');
    assertClose(calc('cos(60)'), 0.5, 1e-12, 'cos 60');
    assertClose(calc('tan(45)'), 1, 1e-12, 'tan 45');
    assertEqual(calc('sin(0)'), 0);
    assertEqual(calc('sin(180)'), 0, 'sisa galat sin 180 dirapikan');
    assertEqual(calc('sin(360)'), 0);
    assertEqual(calc('cos(90)'), 0, 'sisa galat cos 90 dirapikan');
    assertClose(calc('sin(90)'), 1, 1e-12, 'sin 90');
    assertClose(calc('cos(0)'), 1, 1e-12, 'cos 0');
    assertClose(calc('sin(30)+cos(60)'), 1, 1e-12, 'kombinasi trig');
  });

  test('Trigonometri mode radian', function () {
    const rad = { angleMode: 'rad' };
    assertClose(calc('sin(pi/2)', rad), 1, 1e-12, 'sin(pi/2)');
    assertClose(calc('cos(pi)', rad), -1, 1e-12, 'cos(pi)');
    assertClose(calc('tan(pi/4)', rad), 1, 1e-12, 'tan(pi/4)');
    assertEqual(calc('sin(pi)', rad), 0, 'sisa galat sin(pi) dirapikan');
  });

  test('tan pada 90 derajat ditolak', function () {
    assertThrows(function () { calc('tan(90)'); }, 'tidak terdefinisi');
    assertThrows(function () { calc('tan(270)'); }, 'tidak terdefinisi');
    assertThrows(function () { calc('tan(-90)'); }, 'tidak terdefinisi');
  });

  test('Trigonometri invers', function () {
    assertClose(calc('asin(0.5)'), 30, 1e-12, 'asin 0.5');
    assertClose(calc('acos(0.5)'), 60, 1e-12, 'acos 0.5');
    assertClose(calc('atan(1)'), 45, 1e-12, 'atan 1');
    assertClose(calc('asin(1)'), 90, 1e-12, 'asin 1');
    assertThrows(function () { calc('asin(2)'); }, 'asin', 'di luar domain');
    assertThrows(function () { calc('acos(-3)'); }, 'acos', 'di luar domain');
  });

  test('Akar kuadrat dan kuadrat', function () {
    assertEqual(calc('sqrt(16)'), 4);
    assertEqual(calc('sqrt(0)'), 0);
    assertEqual(calc('sqrt(9)+1'), 4);
    assertClose(calc('sqrt(2)'), Math.SQRT2, 1e-15, 'akar 2');
    assertEqual(calc('7^2'), 49);
    assertClose(calc('sqrt(3)^2'), 3, 1e-12, 'akar 3 dikuadratkan');
    assertEqual(formatNumber(calc('sqrt(3)^2')), '3');
    assertThrows(function () { calc('sqrt(-9)'); }, 'negatif');
    assertThrows(function () { calc('sqrt(-1)+2'); }, 'negatif');
  });

  test('Logaritma dan eksponensial', function () {
    assertEqual(formatNumber(calc('log(1000)')), '3');
    assertEqual(formatNumber(calc('log(1)')), '0');
    assertClose(calc('ln(e)'), 1, 1e-12, 'ln(e)');
    assertClose(calc('exp(0)'), 1, 1e-12, 'exp(0)');
    assertClose(calc('exp(1)'), Math.E, 1e-12, 'exp(1)');
    assertThrows(function () { calc('log(0)'); }, 'positif');
    assertThrows(function () { calc('ln(-1)'); }, 'positif');
  });

  test('Nilai absolut', function () {
    assertEqual(calc('abs(-7)'), 7);
    assertEqual(calc('abs(7)'), 7);
    assertEqual(calc('abs(-7)*2'), 14);
  });

  test('Persen sebagai pembagi seratus', function () {
    assertEqual(calc('50%'), 0.5);
    assertEqual(calc('200*10%'), 20);
    assertEqual(calc('50%+50%'), 1);
    assertEqual(formatNumber(calc('10%')), '0.1');
  });

  test('Faktorial', function () {
    assertEqual(calc('5!'), 120);
    assertEqual(calc('0!'), 1);
    assertEqual(calc('3!+1'), 7);
    assertEqual(calc('3!^2'), 36);
    assertThrows(function () { calc('(-1)!'); }, 'bulat');
    assertThrows(function () { calc('3.5!'); }, 'bulat');
    assertThrows(function () { calc('171!'); }, 'terlalu besar');
  });

  test('Modulo', function () {
    assertEqual(calc('10mod3'), 1);
    assertEqual(calc('10 mod 3'), 1);
    assertEqual(calc('2+10mod3'), 3, 'mod setara perkalian');
    assertEqual(calc('10mod3*2'), 2);
    assertThrows(function () { calc('7mod0'); }, 'nol');
  });

  test('Pembagian dengan nol ditolak', function () {
    assertThrows(function () { calc('1/0'); }, 'membagi dengan nol');
    assertThrows(function () { calc('1/(2-2)'); }, 'membagi dengan nol');
    assertThrows(function () { calc('0^-1'); }, 'membagi dengan nol');
  });

  test('Pangkat dengan eksponen pecahan dari basis negatif ditolak', function () {
    assertThrows(function () { calc('(-8)^(1/3)'); }, 'bulat');
  });

  test('Hasil tak hingga ditolak', function () {
    assertThrows(function () { calc('10^400'); }, 'terlalu besar');
    assertThrows(function () { calc('exp(1000)'); }, 'terlalu besar');
  });

  test('Ans memakai hasil sebelumnya', function () {
    assertEqual(calc('ans*2', { answer: 21 }), 42);
    assertEqual(calc('ans+1', { answer: 9 }), 10);
    assertEqual(calc('ans', { answer: 0 }), 0);
    assertEqual(calc('ans', undefined), 0, 'default Ans = 0');
    assertEqual(calc('2ans', { answer: 7 }), 14, 'perkalian implisit dengan Ans');
  });

  test('Nama dan karakter tak dikenal ditolak', function () {
    assertThrows(function () { calc('foo(2)'); }, 'tidak dikenal');
    assertThrows(function () { calc('5 & 3'); }, 'tidak dikenal');
    assertThrows(function () { calc('2..5'); }, 'titik desimal');
    assertThrows(function () { calc('sin 30'); }, 'harus diikuti');
  });

  test('Simbol tampilan diterima sebagai masukan', function () {
    assertEqual(calc('6×7'), 42);
    assertEqual(calc('8÷2'), 4);
    assertEqual(calc('10−4'), 6);
  });

  test('Format angka merapikan hasil', function () {
    assertEqual(formatNumber(2), '2');
    assertEqual(formatNumber(-0), '0');
    assertEqual(formatNumber(0), '0');
    assertEqual(formatNumber(0.30000000000000004), '0.3');
    assertEqual(formatNumber(1 / 3), '0.333333333333333');
    assertEqual(formatNumber(1234.5), '1234.5');
    assertEqual(formatNumber(1e21), '1e21');
    assertEqual(formatNumber(1e-12), '1e-12');
    assertEqual(formatNumber(1.5e20), '1.5e20');
    assertEqual(formatNumber(calc('2^100')), '1.26765060022823e30', 'notasi ilmiah tetap presisi');
    assertEqual(formatNumber(NaN), 'NaN');
    assertEqual(formatNumber(Infinity), '∞');
  });

  test('Ekspresi cantik untuk layar', function () {
    assertEqual(prettyExpression('2*3-4/2'), '2×3−4÷2');
    assertEqual(prettyExpression('sqrt(9)'), '√(9)');
    assertEqual(prettyExpression('pi'), 'π');
    assertEqual(prettyExpression('2*(3+4)'), '2×(3+4)');
  });

  test('Kelengkapan tanda kurung untuk pratinjau', function () {
    assertEqual(balanceParentheses('sin(30'), 'sin(30)');
    assertEqual(balanceParentheses('(1+(2'), '(1+(2))');
    assertEqual(balanceParentheses('(1+2)'), '(1+2)');
    assertEqual(balanceParentheses('1+2'), '1+2');
  });

  test('tryEvaluate tidak pernah melempar galat', function () {
    const good = engine.tryEvaluate('2+2');
    assertEqual(good.ok, true);
    assertEqual(good.value, 4);

    const bad = engine.tryEvaluate('2+');
    assertEqual(bad.ok, false);
    if (typeof bad.error !== 'string' || bad.error.length === 0) {
      fail('tryEvaluate harus mengembalikan pesan galat');
    }
  });

  test('Contoh perhitungan gabungan', function () {
    assertClose(calc('sqrt(3^2+4^2)'), 5, 1e-12, 'hipotenusa 3-4-5');
    assertClose(calc('sin(30)^2+cos(30)^2'), 1, 1e-12, 'identitas trigonometri');
    assertClose(calc('(2+3)!'), 120, 1e-12, 'faktorial dari ekspresi');
    assertClose(calc('log(100)+ln(e)+sqrt(16)'), 7, 1e-12, 'gabungan fungsi');
  });

  /* ------------------------------ laporan ------------------------------ */

  const failed = results.filter(function (item) { return !item.passed; });
  const report = {
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    failures: failed,
    results: results
  };

  global.EngineTestReport = report;

  function render(target) {
    const summary = document.getElementById('summary');
    const list = document.getElementById('results');

    if (summary) {
      summary.textContent = report.failed === 0
        ? '✅ Semua ' + report.total + ' kelompok uji lulus (' + report.passed + '/' + report.total + ')'
        : '❌ ' + report.failed + ' dari ' + report.total + ' kelompok uji gagal';
      summary.classList.toggle('is-bad', report.failed > 0);
    }

    if (list) {
      list.textContent = '';
      report.results.forEach(function (item) {
        const row = document.createElement('li');
        row.className = 'test ' + (item.passed ? 'test--pass' : 'test--fail');
        const mark = document.createElement('span');
        mark.className = 'test__mark';
        mark.textContent = item.passed ? '✓' : '✕';
        const name = document.createElement('span');
        name.className = 'test__name';
        name.textContent = item.name;
        row.append(mark, name);
        if (!item.passed) {
          const detail = document.createElement('p');
          detail.className = 'test__detail';
          detail.textContent = item.message;
          row.appendChild(detail);
        }
        list.appendChild(row);
      });
    }

    return report;
  }

  global.runEngineTests = function () { return report; };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { render(); });
    } else {
      render();
    }
    if (global.console && console.table) console.table(report.results);
  }
})(typeof window !== 'undefined' ? window : globalThis);
