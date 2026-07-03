/* ============================================================
 * runner.js — Micro-runner de tests pour le navigateur
 * API : describe(nom, fn) / it(nom, fn) + assertions.
 * Résultats rendus dans la page et exposés sur window.__TEST_RESULTS
 * (exploitable par un pilotage automatisé du navigateur).
 * ============================================================ */
"use strict";

const TestRunner = (function () {

  const suites = [];
  let currentSuite = null;

  function describe(name, fn) {
    currentSuite = { name: name, cases: [] };
    suites.push(currentSuite);
    fn();
    currentSuite = null;
  }

  function it(name, fn) {
    const suite = currentSuite;
    try {
      fn();
      suite.cases.push({ name: name, ok: true });
    } catch (e) {
      suite.cases.push({ name: name, ok: false, error: e.message || String(e) });
    }
  }

  // ---------- Assertions ----------

  function fail(msg) { throw new Error(msg); }

  function assertTrue(cond, msg) {
    if (!cond) fail(msg || 'attendu vrai, obtenu faux');
  }

  function assertEqual(actual, expected, msg) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a !== e) fail((msg || 'valeurs différentes') + ' — attendu ' + e + ', obtenu ' + a);
  }

  function assertClose(actual, expected, msg) {
    if (typeof actual !== 'number' || Math.abs(actual - expected) > 1e-9) {
      fail((msg || 'nombres différents') + ' — attendu ' + expected + ', obtenu ' + actual);
    }
  }

  function assertThrows(fn, msg) {
    try { fn(); } catch (_) { return; }
    fail(msg || 'une exception était attendue');
  }

  // ---------- Rendu ----------

  function render() {
    const results = document.getElementById('results');
    const summary = document.getElementById('summary');
    let pass = 0, failCount = 0;

    results.innerHTML = suites.map(function (s) {
      return '<div class="suite"><h2>' + s.name + '</h2>' +
        s.cases.map(function (c) {
          if (c.ok) { pass++; return '<div class="case pass">' + c.name + '</div>'; }
          failCount++;
          return '<div class="case fail">' + c.name +
            '<span class="detail">' + c.error + '</span></div>';
        }).join('') + '</div>';
    }).join('');

    summary.textContent = pass + ' test(s) réussi(s), ' + failCount + ' échec(s).';
    summary.className = failCount ? 'ko' : 'ok';
    window.__TEST_RESULTS = { pass: pass, fail: failCount, done: true };
  }

  return { describe, it, assertTrue, assertEqual, assertClose, assertThrows, render };
})();

const describe = TestRunner.describe;
const it = TestRunner.it;
const assertTrue = TestRunner.assertTrue;
const assertEqual = TestRunner.assertEqual;
const assertClose = TestRunner.assertClose;
const assertThrows = TestRunner.assertThrows;
