/* ============================================================
 * matcher.js — Moteur de matching simplifié (label-based only)
 *
 * Apparie les lignes ACTUEL / PROPOSER par label exacte ou fuzzy.
 *
 * Résultat : paires avec status 'matched', 'added', ou 'removed'.
 *
 * Module pur (aucun accès DOM).
 * ============================================================ */
"use strict";

window.PRF = window.PRF || {};

PRF.matcher = (function () {

  /**
   * Normalise un libellé pour comparaison : minuscules, accents
   * supprimés, espaces multiples réduits.
   * @param {string|null} s
   * @returns {string}
   */
  function normLabel(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Distance de Levenshtein itérative (deux lignes — O(min) mémoire).
   * @param {string} a
   * @param {string} b
   * @returns {number}
   */
  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = new Array(b.length + 1);
    let curr = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      curr[0] = i;
      const ca = a.charCodeAt(i - 1);
      for (let j = 1; j <= b.length; j++) {
        const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
        curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      }
      const tmp = prev; prev = curr; curr = tmp;
    }
    return prev[b.length];
  }

  /**
   * Similarité fuzzy : deux libellés matchent si la distance relative
   * est ≤ 0.35 (seuil prudent : privilégie la robustesse aux faux positifs).
   */
  function fuzzyMatchScore(a, b) {
    const la = normLabel(a), lb = normLabel(b);
    if (!la || !lb) return 1;
    return levenshtein(la, lb) / Math.max(la.length, lb.length);
  }
  const FUZZY_THRESHOLD = 0.35;

  /**
   * Apparie les enregistrements ACTUEL / PROPOSER d'un STRR par label.
   *
   * @param {Array} actuelRecs    Enregistrements normalisés ACTUEL {label, value, order}
   * @param {Array} proposerRecs  Enregistrements normalisés PROPOSER {label, value, order}
   * @param {{fuzzy?:boolean}} [options]
   * @returns {Array<{label:string, order:number, actual:Object|null, proposed:Object|null, status:string}>}
   */
  function matchRecords(actuelRecs, proposerRecs, options) {
    const fuzzy = !!(options && options.fuzzy);
    const A = actuelRecs || [];
    const P = proposerRecs || [];
    const pairs = [];
    const matchedP = new Set();

    // --- Passe 1 : par libellé exact ou normalisé --
    const pByLabel = new Map();
    P.forEach(function (rec, j) {
      const key = normLabel(rec.label);
      if (!pByLabel.has(key)) pByLabel.set(key, []);
      pByLabel.get(key).push(j);
    });

    A.forEach(function (rec) {
      const queue = pByLabel.get(normLabel(rec.label));
      let j = -1;
      if (queue && queue.length) {
        j = queue.shift();
        matchedP.add(j);
      }

      // --- Passe 2 : fuzzy matching optionnel
      if (j < 0 && fuzzy) {
        let bestJ = -1, bestScore = FUZZY_THRESHOLD;
        for (let k = 0; k < P.length; k++) {
          if (matchedP.has(k)) continue;
          const score = fuzzyMatchScore(rec.label, P[k].label);
          if (score < bestScore) { bestScore = score; bestJ = k; }
        }
        if (bestJ >= 0) { j = bestJ; matchedP.add(bestJ); }
      }

      // --- Passe 3 : par ordre (fallback)
      if (j < 0) {
        for (let k = 0; k < P.length; k++) {
          if (matchedP.has(k)) continue;
          j = k;
          matchedP.add(k);
          break;
        }
      }

      // Construction de la paire
      if (j >= 0) {
        pairs.push({
          label: rec.label,
          order: rec.order,
          actual: rec,
          proposed: P[j],
          status: 'matched'
        });
      } else {
        // Présent ACTUEL, absent PROPOSER → suppression
        pairs.push({
          label: rec.label,
          order: rec.order,
          actual: rec,
          proposed: null,
          status: 'removed'
        });
      }
    });

    // Lignes ajoutées (PROPOSER sans ACTUEL)
    P.forEach(function (rec, j) {
      if (matchedP.has(j)) return;
      pairs.push({
        label: rec.label,
        order: 100000 + rec.order,
        actual: null,
        proposed: rec,
        status: 'added'
      });
    });

    // Tri stable par ordre
    pairs.sort(function (x, y) { return x.order - y.order; });

    return pairs;
  }

  return { matchRecords, normLabel, levenshtein, fuzzyMatchScore };
})();
