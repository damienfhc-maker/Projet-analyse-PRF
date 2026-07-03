/* ============================================================
 * fieldRegistry.js — Sélection dynamique des champs (CDC §7)
 *
 * - Détection automatique des colonnes présentes dans les fichiers
 *   importés (data-driven, aucune liste figée).
 * - Groupes de champs construits par heuristique sur les intitulés
 *   (« Coûts », « Marges », « Autres »).
 * - Sens de l'amélioration par champ : pour un coût, une baisse est
 *   une amélioration (vert) ; pour une marge, c'est une hausse.
 *   L'utilisateur peut inverser chaque champ dans l'UI.
 * - Profils de comparaison persistés en localStorage (§7.2).
 *
 * Module pur hors localStorage (testable).
 * ============================================================ */
"use strict";

window.PRF = window.PRF || {};

PRF.fieldRegistry = (function () {

  const PROFILES_KEY = 'prf.profiles.v1';

  /** Intitulés relevant du groupe « Marges » (amélioration = hausse). */
  const MARGIN_RE = /marge|gain|profit|b[ée]n[ée]fice/i;
  /** Intitulés relevant du groupe « Coûts » (amélioration = baisse). */
  const COST_RE = /mati[eè]re|travail|machine|m\.?\s?o\b|co[uû]t|prix|montant|heure|temps|charge/i;

  /**
   * Union ordonnée des colonnes détectées sur tous les fichiers
   * importés (l'ordre d'apparition d'origine est préservé).
   * @param {Array} files  store.state.files
   * @returns {string[]}
   */
  function collectColumns(files) {
    const seen = new Set();
    const out = [];
    files.forEach(function (file) {
      file.sheets.forEach(function (sheet) {
        sheet.columns.forEach(function (col) {
          const key = col.toLowerCase();
          if (!seen.has(key)) { seen.add(key); out.push(col); }
        });
      });
    });
    return out;
  }

  /**
   * Groupes par défaut construits sur les intitulés détectés.
   * @param {string[]} columns
   * @returns {{[group:string]: string[]}}
   */
  function defaultGroups(columns) {
    const groups = { 'Coûts': [], 'Marges': [], 'Autres': [] };
    columns.forEach(function (col) {
      if (MARGIN_RE.test(col)) groups['Marges'].push(col);
      else if (COST_RE.test(col)) groups['Coûts'].push(col);
      else groups['Autres'].push(col);
    });
    // Les groupes vides ne sont pas proposés
    Object.keys(groups).forEach(function (g) { if (!groups[g].length) delete groups[g]; });
    return groups;
  }

  /**
   * Sens de l'amélioration par défaut pour chaque colonne.
   * @param {string[]} columns
   * @returns {{[col:string]: 'lower'|'higher'}}
   */
  function defaultDirections(columns) {
    const dirs = {};
    columns.forEach(function (col) {
      dirs[col] = MARGIN_RE.test(col) ? 'higher' : 'lower';
    });
    return dirs;
  }

  /**
   * (Ré)initialise la configuration des champs dans le store après un
   * import : toutes les colonnes cochées par défaut, groupes et sens
   * recalculés, en préservant les choix utilisateur existants.
   */
  function refreshFieldConfig() {
    const st = PRF.store.state;
    const cols = st.columns;
    const fc = st.fieldConfig;
    const hadSelection = fc.selected.size > 0;

    fc.groups = defaultGroups(cols);
    const defDirs = defaultDirections(cols);
    cols.forEach(function (col) {
      if (!(col in fc.directions)) fc.directions[col] = defDirs[col];
      if (!hadSelection) fc.selected.add(col); // tout coché par défaut
    });
    // Purge des colonnes disparues (fichiers retirés)
    const colSet = new Set(cols);
    Array.from(fc.selected).forEach(function (c) { if (!colSet.has(c)) fc.selected.delete(c); });
    PRF.store.emit('fields:changed');
  }

  // ---------- Profils de comparaison (CDC §7.2) ----------------------

  /** @returns {{[name:string]: {selected:string[], directions:Object}}} */
  function readProfiles() {
    try { return JSON.parse(localStorage.getItem(PROFILES_KEY)) || {}; }
    catch (_) { return {}; }
  }

  function writeProfiles(profiles) {
    try { localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles)); }
    catch (e) { PRF.errors.userWarn('Impossible de sauvegarder les profils (stockage local indisponible).', e); }
  }

  /** Liste triée des noms de profils sauvegardés. */
  function listProfiles() { return Object.keys(readProfiles()).sort(); }

  /**
   * Sauvegarde la sélection courante sous un nom de profil.
   * Ex. « Analyse coût », « Analyse marge » (§7.2).
   * @param {string} name
   */
  function saveProfile(name) {
    const fc = PRF.store.state.fieldConfig;
    const profiles = readProfiles();
    profiles[name] = {
      selected: Array.from(fc.selected),
      directions: Object.assign({}, fc.directions),
      fuzzy: PRF.store.state.userConfig.fuzzyMatching
    };
    writeProfiles(profiles);
    PRF.errors.log('info', 'Profil sauvegardé : ' + name);
  }

  /**
   * Recharge un profil : ne coche que les colonnes du profil encore
   * présentes dans les fichiers importés.
   * @param {string} name
   * @returns {boolean} succès
   */
  function loadProfile(name) {
    const profiles = readProfiles();
    const p = profiles[name];
    if (!p) return false;
    const st = PRF.store.state;
    const colSet = new Set(st.columns);
    st.fieldConfig.selected = new Set(p.selected.filter(function (c) { return colSet.has(c); }));
    Object.keys(p.directions || {}).forEach(function (c) {
      if (colSet.has(c)) st.fieldConfig.directions[c] = p.directions[c];
    });
    if (typeof p.fuzzy === 'boolean') st.userConfig.fuzzyMatching = p.fuzzy;
    PRF.store.emit('fields:changed');
    return true;
  }

  /** Supprime un profil sauvegardé. */
  function deleteProfile(name) {
    const profiles = readProfiles();
    delete profiles[name];
    writeProfiles(profiles);
  }

  /**
   * Une valeur de delta est-elle une amélioration pour ce champ ?
   * @param {string} field
   * @param {number} delta
   * @returns {boolean|null} null si delta nul / non significatif
   */
  function isImprovement(field, delta) {
    if (typeof delta !== 'number' || Math.abs(delta) < 1e-9) return null;
    const dir = PRF.store.state.fieldConfig.directions[field] || 'lower';
    return dir === 'lower' ? delta < 0 : delta > 0;
  }

  return {
    collectColumns, defaultGroups, defaultDirections, refreshFieldConfig,
    listProfiles, saveProfile, loadProfile, deleteProfile, isImprovement
  };
})();
