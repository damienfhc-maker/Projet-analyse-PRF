/* ============================================================
 * persistence.js — Stockage local (CDC §12)
 *
 * Trois modes, conformes au §12.1 :
 *   - RAM : mode nominal, le store est la source de vérité ;
 *   - IndexedDB : sauvegarde automatique asynchrone (non bloquante)
 *     de la session — indispensable pour les gros fichiers, proposée
 *     à la restauration au démarrage ;
 *   - Export / import de session JSON : fichier téléchargeable,
 *     rechargeable sur n'importe quel poste.
 *
 * Structure de session (§12.2) :
 *   { files, comparisons, userConfig, excludedItems } + état complet
 *   nécessaire à une restauration à l'identique (les fichiers Excel
 *   d'origine ne sont JAMAIS relus : la session contient les données
 *   normalisées).
 * ============================================================ */
"use strict";

window.PRF = window.PRF || {};

PRF.persistence = (function () {

  const SESSION_VERSION = 1;
  const DB_NAME = 'prf-app';
  const DB_STORE = 'sessions';
  const AUTOSAVE_KEY = 'autosave';

  // ---------- Sérialisation --------------------------------------------

  /**
   * Sérialise l'état complet en objet JSON-compatible (§12.2).
   * @returns {Object}
   */
  function serializeSession() {
    const st = PRF.store.state;

    // excludedItems (§12.2) : suppressions logiques + STRR exclus + lignes
    const excludedItems = [];
    st.datasets.forEach(function (ds, strrId) {
      if (!ds.included) excludedItems.push({ kind: 'strr-exclu', strrId: strrId });
    });
    st.deletedStructures.forEach(function (d) { excludedItems.push(d); });
    st.userState.forEach(function (us, rowId) {
      if (us.deleted) excludedItems.push({ kind: 'row', rowId: rowId });
    });

    return {
      version: SESSION_VERSION,
      savedAt: new Date().toISOString(),
      files: st.files,
      comparisons: Array.from(st.datasets.keys()),
      userConfig: st.userConfig,
      excludedItems: excludedItems,
      userState: Array.from(st.userState.entries()),
      deletedStructures: st.deletedStructures,
      datasetsIncluded: Array.from(st.datasets.entries()).map(function (e) {
        return [e[0], e[1].included];
      }),
      hasComparison: st.rows.length > 0
    };
  }

  /**
   * Restaure une session sérialisée dans le store.
   * @param {Object} session
   * @returns {boolean} true si une comparaison était active
   */
  function applySession(session) {
    if (!session || session.version !== SESSION_VERSION || !Array.isArray(session.files)) {
      throw new Error('Fichier de session invalide ou version incompatible.');
    }
    const st = PRF.store.state;
    st.files = session.files;
    st.userConfig = Object.assign({ fuzzyMatching: false, autosave: true }, session.userConfig);
    st.userState = new Map(session.userState || []);
    st.deletedStructures = session.deletedStructures || [];

    PRF.store.rebuildDatasets();

    // Inclusions STRR (après reconstruction de l'index)
    (session.datasetsIncluded || []).forEach(function (e) {
      const ds = st.datasets.get(e[0]);
      if (ds) ds.included = e[1];
    });

    PRF.history.clear();
    PRF.errors.log('info', 'Session restaurée (' + st.files.length + ' fichier(s), sauvée le ' + session.savedAt + ')');
    return !!session.hasComparison;
  }

  // ---------- Export / import fichier JSON ------------------------------

  /** Télécharge la session courante en fichier JSON. */
  function exportSessionFile() {
    const json = JSON.stringify(serializeSession());
    const blob = new Blob([json], { type: 'application/json' });
    PRF.ui.downloadBlob(blob, 'session_comparaison_' + PRF.ui.dateStamp() + '.json');
    PRF.ui.toast('Session exportée (' + PRF.ui.formatBytes(blob.size) + ').', 'success');
  }

  /**
   * Importe un fichier de session JSON.
   * @param {File} file
   * @returns {Promise<boolean>} true si une comparaison était active
   */
  function importSessionFile(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        try { resolve(applySession(JSON.parse(reader.result))); }
        catch (e) { reject(e); }
      };
      reader.onerror = function () { reject(new Error('Lecture du fichier de session impossible.')); };
      reader.readAsText(file);
    });
  }

  // ---------- IndexedDB (autosave asynchrone) ---------------------------

  let dbPromise = null;

  /** Ouvre (ou crée) la base IndexedDB locale. */
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        req.result.createObjectStore(DB_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  /** Sauvegarde automatique (asynchrone, jamais bloquante pour l'UI). */
  function saveAutosave() {
    if (!PRF.store.state.userConfig.autosave) return Promise.resolve();
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put(serializeSession(), AUTOSAVE_KEY);
        tx.oncomplete = resolve;
        tx.onerror = function () { reject(tx.error); };
      });
    }).catch(function (e) {
      // L'autosave ne doit jamais gêner l'utilisateur : simple log.
      PRF.errors.log('warn', 'Autosave IndexedDB indisponible', e);
    });
  }

  /** @returns {Promise<Object|null>} session autosauvée, s'il y en a une. */
  function loadAutosave() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(DB_STORE, 'readonly');
        const req = tx.objectStore(DB_STORE).get(AUTOSAVE_KEY);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    }).catch(function (e) {
      PRF.errors.log('warn', 'Lecture autosave impossible', e);
      return null;
    });
  }

  /** Efface la sauvegarde automatique. */
  function clearAutosave() {
    return openDb().then(function (db) {
      return new Promise(function (resolve) {
        const tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).delete(AUTOSAVE_KEY);
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      });
    }).catch(function () { /* silencieux */ });
  }

  /** Autosave différée : regroupe les rafales de modifications. */
  const scheduleAutosave = (function () {
    let timer = null;
    return function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { timer = null; saveAutosave(); }, 2000);
    };
  })();

  /** Branche l'autosave sur les événements de mutation du store. */
  function initAutosave() {
    ['datasets:changed', 'comparison:done', 'rows:changed', 'fields:changed']
      .forEach(function (evt) { PRF.store.on(evt, scheduleAutosave); });
  }

  return {
    serializeSession, applySession, exportSessionFile, importSessionFile,
    saveAutosave, loadAutosave, clearAutosave, initAutosave
  };
})();
