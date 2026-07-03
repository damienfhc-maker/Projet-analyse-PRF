/* ============================================================
 * comparator.js — Moteur de comparaison (CDC §6)
 *
 * Pour chaque paire de lignes et chaque champ sélectionné :
 *     DELTA = PROPOSER − ACTUEL
 *
 * Sortie standard (§6.2), enrichie pour l'UI :
 *   { id, strrId, section, op, label, field,
 *     actual, proposed, delta, status,
 *     locked, included, deleted, sk }
 *
 * Trois niveaux de lecture (§6.3) : les lignes détaillées sont au
 * niveau OP ; aggregate() produit les vues Section et Global STRR.
 *
 * Isolation des datasets (§9.3) : chaque STRR est comparé
 * indépendamment ; ses lignes portent leur strrId.
 *
 * Module pur (aucun accès DOM).
 * ============================================================ */
"use strict";

window.PRF = window.PRF || {};

PRF.comparator = (function () {

  /**
   * Identifiant déterministe d'une ligne de comparaison : permet de
   * ré-appliquer l'état utilisateur (éditions, verrous, suppressions)
   * après un recalcul ou un rechargement de session.
   */
  function rowId(strrId, pair, field) {
    return strrId + '¦' + (pair.section || '') + '¦' + (pair.op || 'r' + pair.order) +
      '¦' + pair.label + '¦' + field;
  }

  /**
   * Compare une paire (ACTUEL/PROPOSER) sur un champ donné.
   * @returns {Object|null} ligne de comparaison, ou null si le champ
   *          est absent des deux côtés.
   */
  function compareField(strrId, pair, field) {
    const aRec = pair.actual, pRec = pair.proposed;
    const actual = aRec && field in aRec.fields ? aRec.fields[field] : null;
    const proposed = pRec && field in pRec.fields ? pRec.fields[field] : null;
    if (actual === null && proposed === null) return null;

    const aNum = typeof actual === 'number';
    const pNum = typeof proposed === 'number';

    // DELTA = PROPOSER − ACTUAL (§6.1). Pour les ajouts/suppressions,
    // le côté absent vaut 0 : le delta reflète l'impact sur le total.
    let delta = null;
    if (aNum || pNum) {
      if ((aNum || actual === null) && (pNum || proposed === null)) {
        delta = (pNum ? proposed : 0) - (aNum ? actual : 0);
      }
    }

    // Statut de la ligne (§5.3 + comparaison de valeurs)
    let status;
    if (pair.status === 'added') status = 'added';
    else if (pair.status === 'removed') status = 'removed';
    else if (delta !== null) status = Math.abs(delta) > 1e-9 ? 'modified' : 'unchanged';
    else status = String(actual) === String(proposed) ? 'unchanged' : 'modified';

    return {
      id: rowId(strrId, pair, field),
      strrId: strrId,
      section: pair.section,
      op: pair.op,
      label: pair.label,
      order: pair.order,
      field: field,
      actual: actual,
      proposed: proposed,
      delta: delta,
      status: status,
      locked: false,
      included: true,
      deleted: false,
      // Clé de recherche précalculée : base de l'index mémoire (§11.2)
      sk: (strrId + ' ' + (pair.section || '') + ' ' + (pair.op || '') + ' ' +
        pair.label + ' ' + field).toLowerCase()
    };
  }

  /**
   * Recalcule le delta et le statut d'une ligne après édition inline.
   * @param {Object} row  ligne modifiée en place
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
   * Compare tous les datasets appariés et reconstruit la base à plat
   * store.state.rows, en ré-appliquant l'état utilisateur conservé.
   *
   * @returns {{rows:Array, missing:Array<{strrId:string, missing:string}>}}
   *          missing = STRR incomplets (mismatch ACTUEL/PROPOSER, §13)
   */
  function compareAll() {
    const st = PRF.store.state;
    const selected = st.fieldConfig.selected;
    const fuzzy = st.userConfig.fuzzyMatching;
    const rows = [];
    const missing = [];
    const t0 = performance.now();

    st.datasets.forEach(function (ds, strrId) {
      if (!ds.ACTUEL || !ds.PROPOSER) {
        missing.push({ strrId: strrId, missing: !ds.ACTUEL ? 'ACTUEL' : 'PROPOSER' });
        return; // isolation : un STRR incomplet n'empêche pas les autres (§9.3)
      }
      const pairs = PRF.matcher.matchRecords(ds.ACTUEL.records, ds.PROPOSER.records, { fuzzy: fuzzy });
      pairs.forEach(function (pair) {
        selected.forEach(function (field) {
          const row = compareField(strrId, pair, field);
          if (row) rows.push(row);
        });
      });
    });

    // Ré-application de l'état utilisateur persistant (éditions, verrous,
    // suppressions logiques, inclusion export) par identifiant déterministe.
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

    // Suppressions structurelles (section / STRR entiers, §8.5)
    st.deletedStructures.forEach(function (d) {
      rows.forEach(function (row) {
        if (d.kind === 'strr' && row.strrId === d.strrId) row.deleted = true;
        else if (d.kind === 'section' && row.strrId === d.strrId &&
          PRF.matcher.normLabel(row.section) === PRF.matcher.normLabel(d.section)) row.deleted = true;
      });
    });

    st.rows = rows;
    PRF.searchIndex.build(rows);
    PRF.errors.log('info', 'Comparaison calculée : ' + rows.length + ' lignes en ' +
      Math.round(performance.now() - t0) + ' ms');
    return { rows: rows, missing: missing };
  }

  /**
   * Agrégation multi-niveaux (§6.3) : somme les valeurs numériques des
   * lignes détaillées par (STRR, section, champ) ou (STRR, champ).
   *
   * @param {Array} rows   lignes détaillées DÉJÀ filtrées par la vue
   * @param {'section'|'global'} level
   * @returns {Array} lignes synthétiques (agg:true, non éditables)
   */
  function aggregate(rows, level) {
    const map = new Map();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const key = level === 'global'
        ? r.strrId + '¦' + r.field
        : r.strrId + '¦' + (r.section || '') + '¦' + r.field;
      let agg = map.get(key);
      if (!agg) {
        agg = {
          id: 'agg¦' + level + '¦' + key,
          strrId: r.strrId,
          section: level === 'global' ? null : r.section,
          op: null,
          label: level === 'global' ? 'Total STRR' : 'Total section',
          field: r.field,
          actual: 0, proposed: 0, delta: 0,
          hasNum: false, count: 0,
          status: 'agg', agg: true,
          locked: true, included: true, deleted: false,
          sk: (r.strrId + ' ' + (level === 'global' ? '' : (r.section || '')) + ' total ' + r.field).toLowerCase()
        };
        map.set(key, agg);
      }
      agg.count++;
      if (typeof r.actual === 'number') { agg.actual += r.actual; agg.hasNum = true; }
      if (typeof r.proposed === 'number') { agg.proposed += r.proposed; agg.hasNum = true; }
      if (typeof r.delta === 'number') agg.delta += r.delta;
    }
    const out = [];
    map.forEach(function (agg) {
      if (!agg.hasNum) { agg.actual = null; agg.proposed = null; agg.delta = null; }
      out.push(agg);
    });
    return out;
  }

  return { compareAll, compareField, recompute, aggregate, rowId };
})();
