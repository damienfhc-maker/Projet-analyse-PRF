/* ============================================================
 * app.js — Amorçage et navigation de l'application
 *
 * - Routage entre les trois vues (dashboard / champs / tableau).
 * - Raccourcis clavier globaux (Ctrl+Z / Ctrl+Y).
 * - Export / import de session JSON (§12.1).
 * - Restauration de l'autosave IndexedDB au démarrage.
 * - Vérification des librairies vendorisées (offline strict, §2.1).
 * ============================================================ */
"use strict";

window.PRF = window.PRF || {};

PRF.app = (function () {

  const VIEWS = ['dashboard', 'fields', 'table'];
  let currentView = 'dashboard';

  /**
   * Affiche une vue et met à jour la navigation.
   * @param {'dashboard'|'fields'|'table'} name
   */
  function showView(name) {
    currentView = name;
    VIEWS.forEach(function (v) {
      document.getElementById('view-' + v).hidden = v !== name;
    });
    document.querySelectorAll('.nav-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.view === name);
    });
    updateNav();
  }

  /**
   * Active/désactive les boutons de navigation selon l'état :
   * « Sélection des champs » dès qu'une paire STRR complète existe,
   * « Comparaison » dès qu'une comparaison a été calculée.
   */
  function updateNav() {
    const st = PRF.store.state;
    let hasComplete = false;
    st.datasets.forEach(function (ds) { if (ds.ACTUEL && ds.PROPOSER) hasComplete = true; });
    const bDash = document.querySelector('[data-view="dashboard"]');
    const bFields = document.querySelector('[data-view="fields"]');
    const bTable = document.querySelector('[data-view="table"]');
    bFields.disabled = !hasComplete;
    bTable.disabled = st.rows.length === 0;
    // Étapes accomplies : coche verte sur le stepper
    bDash.classList.toggle('done', hasComplete);
    bFields.classList.toggle('done', st.rows.length > 0);
  }

  /** Vérifie la présence des librairies vendorisées (mode dégradé sinon). */
  function checkVendors() {
    const missing = [];
    if (typeof XLSX === 'undefined') missing.push('SheetJS (vendor/xlsx.full.min.js)');
    if (typeof jspdf === 'undefined') missing.push('jsPDF (vendor/jspdf.umd.min.js)');
    if (missing.length) {
      PRF.errors.userError('Librairies locales manquantes : ' + missing.join(', ') +
        '. Vérifiez que le dossier vendor/ est complet.');
      return false;
    }
    return true;
  }

  /** Raccourcis clavier globaux (hors champs de saisie). */
  function initShortcuts() {
    document.addEventListener('keydown', function (e) {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        PRF.history.undo();
      } else if ((e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault();
        PRF.history.redo();
      }
    });
  }

  /** Boutons session (export / import JSON, §12.1). */
  function initSession() {
    const input = document.getElementById('session-file-input');
    document.getElementById('btn-session-save').addEventListener('click', function () {
      PRF.persistence.exportSessionFile();
    });
    document.getElementById('btn-session-load').addEventListener('click', function () {
      input.click();
    });
    input.addEventListener('change', async function () {
      const file = input.files[0];
      input.value = '';
      if (!file) return;
      try {
        const hadComparison = await PRF.persistence.importSessionFile(file);
        afterSessionRestore(hadComparison);
        PRF.ui.toast('Session chargée.', 'success');
      } catch (e) {
        PRF.errors.userError('Chargement de session impossible : ' + e.message, e);
      }
    });
  }

  /** Recalcule et navigue après restauration d'une session. */
  function afterSessionRestore(hadComparison) {
    if (hadComparison && PRF.store.state.fieldConfig.selected.size) {
      PRF.comparator.compareAll();
      PRF.store.emit('comparison:done');
      showView('table');
    } else {
      showView('dashboard');
    }
  }

  /** Propose la restauration de l'autosave IndexedDB au démarrage. */
  async function offerAutosaveRestore() {
    const session = await PRF.persistence.loadAutosave();
    if (!session || !session.files || !session.files.length) return;
    const ok = await PRF.ui.confirm('Session précédente détectée',
      'Une session automatiquement sauvegardée le ' +
      new Date(session.savedAt).toLocaleString('fr-FR') +
      ' (' + session.files.length + ' fichier(s)) a été trouvée. La restaurer ?');
    if (!ok) { PRF.persistence.clearAutosave(); return; }
    try {
      const hadComparison = PRF.persistence.applySession(session);
      afterSessionRestore(hadComparison);
      PRF.ui.toast('Session restaurée depuis la sauvegarde automatique.', 'success');
    } catch (e) {
      PRF.errors.userError('Restauration impossible : ' + e.message, e);
    }
  }

  /** Point d'entrée. */
  function boot() {
    if (!checkVendors()) return;

    // Navigation principale
    document.querySelectorAll('.nav-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!btn.disabled) showView(btn.dataset.view);
      });
    });

    PRF.dashboard.init();
    PRF.fieldSelector.init();
    PRF.comparisonTable.init();
    PRF.store.on('comparison:done', updateNav);
    initShortcuts();
    initSession();
    PRF.persistence.initAutosave();

    showView('dashboard');
    offerAutosaveRestore();
    PRF.errors.log('info', 'Application démarrée (mode 100 % local, aucune dépendance réseau).');
  }

  document.addEventListener('DOMContentLoaded', boot);

  return { showView, updateNav };
})();
