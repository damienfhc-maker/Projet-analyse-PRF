/* ============================================================
 * store.js — Store centralisé en mémoire (CDC §3.1, §11.2, §12)
 *
 * Rôle équivalent à Redux/Zustand, en vanilla : un état unique,
 * des événements pub/sub pour notifier l'UI. Les mutations sont
 * effectuées en place (priorité performance sur gros volumes),
 * chaque mutation étant suivie d'un emit() explicite.
 *
 * Indexation obligatoire (CDC §11.2) :
 *   - state.datasets : Map<STRR_ID, Dataset>
 *   - state.rows     : base à plat des lignes de comparaison,
 *                      indexée par PRF.searchIndex pour la recherche.
 * ============================================================ */
"use strict";

window.PRF = window.PRF || {};

PRF.store = (function () {

  /**
   * État applicatif unique (modèle simplifié).
   *
   * files : métadonnées + données normalisées par fichier importé.
   *   { id, name, size, sheets: [{ sheetName, strrId, type, records }] }
   *
   * datasets : Map<strrId, { ACTUEL: {records, fileName, sheetName}|null,
   *                          PROPOSER: {...}|null, included: boolean }>
   *
   * rows : lignes de comparaison à plat, produites par PRF.comparator.
   *
   * userState : Map<rowId, {actual?, proposed?, locked?, deleted?, included?}>
   */
  const state = {
    files: [],
    datasets: new Map(),
    rows: [],
    userState: new Map(),
    userConfig: { fuzzyMatching: false, autosave: true },
    deletedStructures: []
  };

  /** Table événement -> liste d'abonnés. */
  const listeners = new Map();

  /**
   * Abonne un callback à un événement du store.
   * @param {string} evt
   * @param {Function} cb
   * @returns {Function} fonction de désabonnement
   */
  function on(evt, cb) {
    if (!listeners.has(evt)) listeners.set(evt, []);
    listeners.get(evt).push(cb);
    return function off() {
      const arr = listeners.get(evt);
      const i = arr.indexOf(cb);
      if (i >= 0) arr.splice(i, 1);
    };
  }

  /**
   * Émet un événement vers tous les abonnés.
   * @param {string} evt
   * @param {*} [payload]
   */
  function emit(evt, payload) {
    const arr = listeners.get(evt);
    if (!arr) return;
    // Copie défensive : un abonné peut se désabonner pendant l'itération.
    arr.slice().forEach(function (cb) {
      try { cb(payload); }
      catch (e) { PRF.errors.log('error', 'Abonné en erreur sur ' + evt, e); }
    });
  }

  /**
   * Reconstruit l'index Map<STRR_ID, Dataset> à partir des fichiers
   * importés (CDC §11.2). Conserve les inclusions existantes.
   */
  function rebuildDatasets() {
    const prev = state.datasets;
    const next = new Map();
    state.files.forEach(function (file) {
      file.sheets.forEach(function (sheet) {
        if (!sheet.strrId || !sheet.type) return; // affectation incomplète : résolue au dashboard
        let ds = next.get(sheet.strrId);
        if (!ds) {
          const old = prev.get(sheet.strrId);
          ds = { ACTUEL: null, PROPOSER: null, included: old ? old.included : true };
          next.set(sheet.strrId, ds);
        }
        if (ds[sheet.type]) {
          PRF.errors.userWarn(
            'Doublon détecté : ' + sheet.strrId + ' / ' + sheet.type +
            ' présent dans plusieurs fichiers — le dernier importé est utilisé.');
        }
        ds[sheet.type] = { records: sheet.records, fileName: file.name, sheetName: sheet.sheetName };
      });
    });
    state.datasets = next;
    emit('datasets:changed');
  }

  /**
   * Retourne l'état utilisateur d'une ligne (créé à la demande).
   * @param {string} rowId
   */
  function getUserState(rowId) {
    let us = state.userState.get(rowId);
    if (!us) { us = {}; state.userState.set(rowId, us); }
    return us;
  }

  /** Réinitialise complètement le store (nouvelle session). */
  function reset() {
    state.files = [];
    state.datasets = new Map();
    state.rows = [];
    state.userState = new Map();
    state.deletedStructures = [];
    emit('datasets:changed');
    emit('comparison:done');
  }

  return { state, on, emit, rebuildDatasets, getUserState, reset };
})();
