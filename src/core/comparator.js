/* ============================================================
 * comparator.js — Moteur de comparaison simplifié (single value per row)
 *
 * Pour chaque paire de lignes :
 *     DELTA = PROPOSER − ACTUEL
 *
 * Sortie standard :
 *   { id, strrId, label, actual, proposed, delta, status,
 *     locked, included, deleted }
 *
 * Module pur (aucun accès DOM).
 * ============================================================ */
"use strict";

window.PRF = window.PRF || {};

PRF.comparator = (function () {

  /**
   * Identifiant déterministe d'une ligne de comparaison.
   */
  function rowId(strrId, label, order, level) {
    return strrId + '¦' + label + '¦' + order + '¦' + level;
  }

  /**
   * Compare une paire (ACTUEL/PROPOSER) : calcule delta et statut.
   */
  function compareLine(strrId, pair) {
    const aRec = pair.actual;
    const pRec = pair.proposed;
    const actual = aRec ? aRec.value : null;
    const proposed = pRec ? pRec.value : null;

    const aNum = typeof actual === 'number';
    const pNum = typeof proposed === 'number';

    // DELTA = PROPOSER − ACTUAL. Absent côtés = 0 (impact sur total)
    let delta = null;
    if (aNum || pNum) {
      delta = (pNum ? proposed : 0) - (aNum ? actual : 0);
    }

    // Statut de la ligne
    let status;
    if (pair.status === 'added') status = 'added';
    else if (pair.status === 'removed') status = 'removed';
    else if (delta !== null) status = Math.abs(delta) > 1e-9 ? 'modified' : 'unchanged';
    else status = String(actual) === String(proposed) ? 'unchanged' : 'modified';

    // Niveau hiérarchique (défaut: 1 si absent)
    const level = (aRec ? aRec.level : pRec.level) || 1;

    return {
      id: rowId(strrId, pair.label, pair.order, level),
      strrId: strrId,
      label: pair.label,
      order: pair.order,
      level: level,
      parentPath: (aRec ? aRec.parentPath : pRec.parentPath) || null,
      actual: actual,
      proposed: proposed,
      delta: delta,
      status: status,
      locked: false,
      included: true,
      deleted: false,
      collapsed: false,
      sk: (strrId + ' ' + pair.label).toLowerCase()
    };
  }

  /**
   * Recalcule delta et statut après édition inline.
   */
  function recompute(row) {
    const aNum = typeof row.actual === 'number';
    const pNum = typeof row.proposed === 'number';
    if ((aNum || row.actual === null) && (pNum || row.proposed === null) && (aNum || pNum)) {
      row.delta = (pNum ? row.proposed : 0) - (aNum ? row.actual : 0);
    } else {
      row.delta = null;
    }
    if (row.status !== 'added' && row.status !== 'removed') {
      if (row.delta !== null) row.status = Math.abs(row.delta) > 1e-9 ? 'modified' : 'unchanged';
      else row.status = String(row.actual) === String(row.proposed) ? 'unchanged' : 'modified';
    }
  }

  /**
   * Compare tous les datasets appariés.
   *
   * @returns {{rows:Array, missing:Array}}
   */
  function compareAll() {
    const st = PRF.store.state;
    const fuzzy = st.userConfig.fuzzyMatching;
    const rows = [];
    const missing = [];
    const t0 = performance.now();

    st.datasets.forEach(function (ds, strrId) {
      if (!ds.ACTUEL || !ds.PROPOSER) {
        missing.push({ strrId: strrId, missing: !ds.ACTUEL ? 'ACTUEL' : 'PROPOSER' });
        return;
      }
      const pairs = PRF.matcher.matchRecords(ds.ACTUEL.records, ds.PROPOSER.records, { fuzzy: fuzzy });
      pairs.forEach(function (pair) {
        const row = compareLine(strrId, pair);
        rows.push(row);
      });
    });

    // Ré-application de l'état utilisateur persistant
    rows.forEach(function (row) {
      const us = st.userState.get(row.id);
      if (!us) return;
      if ('actual' in us) { row.actual = us.actual; }
      if ('proposed' in us) { row.proposed = us.proposed; }
      if ('actual' in us || 'proposed' in us) recompute(row);
      if ('locked' in us) row.locked = us.locked;
      if ('deleted' in us) row.deleted = us.deleted;
      if ('included' in us) row.included = us.included;
    });

    // Suppressions structurelles (STRR entiers seulement)
    st.deletedStructures.forEach(function (d) {
      if (d.kind === 'strr') {
        rows.forEach(function (row) {
          if (row.strrId === d.strrId) row.deleted = true;
        });
      }
    });

    st.rows = rows;
    PRF.searchIndex.build(rows);
    PRF.errors.log('info', 'Comparaison calculée : ' + rows.length + ' lignes en ' +
      Math.round(performance.now() - t0) + ' ms');
    return { rows: rows, missing: missing };
  }

  return { compareAll, compareLine, recompute, rowId };
})();
