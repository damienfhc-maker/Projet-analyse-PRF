/* ============================================================
 * searchIndex.js — Index de recherche en mémoire (CDC §11.2)
 *
 * Toutes les recherches de l'application s'exécutent sur cette base
 * JavaScript indexée en mémoire — jamais sur les fichiers Excel, qui
 * ne sont lus qu'une seule fois à l'import.
 *
 * Double stratégie :
 *   1. Index inversé token → indices de lignes, construit une seule
 *      fois par comparaison : intersection très rapide pour les
 *      recherches par mots entiers.
 *   2. Repli : balayage linéaire sur les clés précalculées (row.sk,
 *      minuscules) pour les recherches par sous-chaînes — O(n) sur
 *      des chaînes courtes déjà en cache CPU, fluide à 100 000 lignes.
 *
 * Module pur (aucun accès DOM).
 * ============================================================ */
"use strict";

window.PRF = window.PRF || {};

PRF.searchIndex = (function () {

  /** Lignes indexées (référence vers store.state.rows). */
  let rows = [];
  /** Index inversé : token (mot entier) → tableau trié d'indices. */
  let tokenIndex = new Map();

  const TOKEN_SPLIT = /[^a-z0-9à-öø-ÿ]+/;

  /**
   * (Re)construit l'index à partir des lignes de comparaison.
   * Chaque ligne doit porter sa clé précalculée `sk` (minuscules).
   * @param {Array} newRows
   */
  function build(newRows) {
    const t0 = performance.now();
    rows = newRows;
    tokenIndex = new Map();
    for (let i = 0; i < rows.length; i++) {
      const tokens = rows[i].sk.split(TOKEN_SPLIT);
      for (let t = 0; t < tokens.length; t++) {
        const tok = tokens[t];
        if (!tok) continue;
        let arr = tokenIndex.get(tok);
        if (!arr) { arr = []; tokenIndex.set(tok, arr); }
        // Les indices arrivent croissants : pas de doublon consécutif
        if (arr[arr.length - 1] !== i) arr.push(i);
      }
    }
    PRF.errors.log('info', 'Index de recherche construit : ' + rows.length + ' lignes, ' +
      tokenIndex.size + ' tokens, ' + Math.round(performance.now() - t0) + ' ms');
  }

  /** Intersection de deux tableaux d'indices triés (fusion linéaire). */
  function intersect(a, b) {
    const out = [];
    let i = 0, j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { out.push(a[i]); i++; j++; }
      else if (a[i] < b[j]) i++;
      else j++;
    }
    return out;
  }

  /**
   * Recherche globale.
   * @param {string} text  Requête utilisateur
   * @returns {Set<number>|null} indices des lignes correspondantes,
   *          ou null si la requête est vide (= aucune restriction).
   */
  function query(text) {
    const q = String(text || '').trim().toLowerCase();
    if (!q) return null;
    const terms = q.split(/\s+/).filter(Boolean);

    // Chemin rapide : tous les termes existent comme tokens entiers
    if (terms.every(function (t) { return tokenIndex.has(t); })) {
      let result = tokenIndex.get(terms[0]);
      for (let k = 1; k < terms.length && result.length; k++) {
        result = intersect(result, tokenIndex.get(terms[k]));
      }
      return new Set(result);
    }

    // Repli sous-chaînes : chaque terme doit apparaître dans la clé
    const out = new Set();
    for (let i = 0; i < rows.length; i++) {
      const sk = rows[i].sk;
      let ok = true;
      for (let k = 0; k < terms.length; k++) {
        if (sk.indexOf(terms[k]) === -1) { ok = false; break; }
      }
      if (ok) out.add(i);
    }
    return out;
  }

  return { build, query };
})();
