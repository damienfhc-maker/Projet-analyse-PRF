/* ============================================================
 * matcher.js — Moteur de matching (CDC §5, CORE LOGIC)
 *
 * Niveau 1 (fichiers) : appariement par (STRR ID, type) — réalisé par
 * PRF.store.rebuildDatasets() qui construit Map<STRR_ID, Dataset>.
 *
 * Niveau 2 (lignes), par section, dans l'ordre de priorité :
 *   1. code OP (OP10, OP20…)                        [§5.2]
 *   2. libellé normalisé (sans accents ni casse)
 *   3. fuzzy matching optionnel (Levenshtein)        [§5.2 fallback]
 *   4. ordre d'apparition si aucun OP des deux côtés [§5.2]
 *
 * Différences structurelles (§5.3) :
 *   - présent ACTUEL seul   → status 'removed' (❌ suppression)
 *   - présent PROPOSER seul → status 'added'   (➕ ajout)
 *   - apparié               → status 'matched' (comparaison directe)
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
   * Apparie les enregistrements ACTUEL / PROPOSER d'un STRR.
   *
   * @param {Array} actuelRecs    Enregistrements normalisés ACTUEL
   * @param {Array} proposerRecs  Enregistrements normalisés PROPOSER
   * @param {{fuzzy?:boolean}} [options]
   * @returns {Array<{section:string|null, op:string|null, label:string,
   *                  order:number, actual:Object|null, proposed:Object|null,
   *                  status:'matched'|'added'|'removed'}>}
   */
  function matchRecords(actuelRecs, proposerRecs, options) {
    const fuzzy = !!(options && options.fuzzy);

    // Regroupement par section normalisée ('' = hors section / global STRR)
    const bySection = new Map(); // key -> {label, A:[], P:[]}
    function bucket(rec, side) {
      const key = normLabel(rec.section);
      let b = bySection.get(key);
      if (!b) { b = { label: rec.section, A: [], P: [] }; bySection.set(key, b); }
      if (!b.label && rec.section) b.label = rec.section;
      b[side].push(rec);
    }
    (actuelRecs || []).forEach(function (r) { bucket(r, 'A'); });
    (proposerRecs || []).forEach(function (r) { bucket(r, 'P'); });

    const pairs = [];

    bySection.forEach(function (b) {
      const section = b.label || null;
      const A = b.A, P = b.P;
      const matchedP = new Set(); // indices de P déjà appariés
      const pairOf = new Array(A.length).fill(-1); // index P apparié à chaque A

      // --- Passe 1 : par code OP -------------------------------------
      const pByOp = new Map();
      P.forEach(function (rec, j) { if (rec.operation && !pByOp.has(rec.operation)) pByOp.set(rec.operation, j); });
      A.forEach(function (rec, i) {
        if (!rec.operation) return;
        const j = pByOp.get(rec.operation);
        if (j !== undefined && !matchedP.has(j)) { pairOf[i] = j; matchedP.add(j); }
      });

      // --- Passe 2 : par libellé normalisé ---------------------------
      const pByLabel = new Map(); // label -> file d'indices non appariés
      P.forEach(function (rec, j) {
        if (matchedP.has(j)) return;
        const key = normLabel(rec.label);
        if (!pByLabel.has(key)) pByLabel.set(key, []);
        pByLabel.get(key).push(j);
      });
      A.forEach(function (rec, i) {
        if (pairOf[i] >= 0) return;
        const queue = pByLabel.get(normLabel(rec.label));
        while (queue && queue.length) {
          const j = queue.shift();
          if (!matchedP.has(j)) { pairOf[i] = j; matchedP.add(j); break; }
        }
      });

      // --- Passe 3 : fuzzy matching optionnel (§5.2 fallback) --------
      if (fuzzy) {
        A.forEach(function (rec, i) {
          if (pairOf[i] >= 0) return;
          let bestJ = -1, bestScore = FUZZY_THRESHOLD;
          for (let j = 0; j < P.length; j++) {
            if (matchedP.has(j)) continue;
            // Un OP différent des deux côtés = lignes différentes : pas de fuzzy
            if (rec.operation && P[j].operation && rec.operation !== P[j].operation) continue;
            const score = fuzzyMatchScore(rec.label, P[j].label);
            if (score < bestScore) { bestScore = score; bestJ = j; }
          }
          if (bestJ >= 0) { pairOf[i] = bestJ; matchedP.add(bestJ); }
        });
      }

      // --- Passe 4 : par ordre, uniquement pour les lignes SANS OP ---
      // (CDC §5.2 : « ordre si OP absent »)
      const restA = [], restP = [];
      A.forEach(function (rec, i) { if (pairOf[i] < 0 && !rec.operation) restA.push(i); });
      P.forEach(function (rec, j) { if (!matchedP.has(j) && !rec.operation) restP.push(j); });
      const n = Math.min(restA.length, restP.length);
      for (let k = 0; k < n; k++) { pairOf[restA[k]] = restP[k]; matchedP.add(restP[k]); }

      // --- Construction des paires ------------------------------------
      A.forEach(function (rec, i) {
        const j = pairOf[i];
        if (j >= 0) {
          pairs.push({
            section: section, op: rec.operation || P[j].operation || null,
            label: rec.label, order: rec.order,
            actual: rec, proposed: P[j], status: 'matched'
          });
        } else {
          // Présent dans ACTUEL, absent de PROPOSER → suppression (§5.3)
          pairs.push({
            section: section, op: rec.operation, label: rec.label, order: rec.order,
            actual: rec, proposed: null, status: 'removed'
          });
        }
      });
      P.forEach(function (rec, j) {
        if (matchedP.has(j)) return;
        // Absent d'ACTUEL, présent dans PROPOSER → ajout (§5.3)
        pairs.push({
          section: section, op: rec.operation, label: rec.label,
          order: 100000 + rec.order, // les ajouts s'affichent après les lignes existantes
          actual: null, proposed: rec, status: 'added'
        });
      });
    });

    // Ordre stable : section puis ordre d'apparition d'origine
    pairs.sort(function (x, y) {
      const sx = normLabel(x.section), sy = normLabel(y.section);
      if (sx !== sy) return sx < sy ? -1 : 1;
      return x.order - y.order;
    });

    return pairs;
  }

  return { matchRecords, normLabel, levenshtein, fuzzyMatchScore };
})();
