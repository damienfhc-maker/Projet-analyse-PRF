/* ============================================================
 * usage.js — Intelligence locale d'usage (personnalisation + macros)
 *
 * Retient les habitudes de l'utilisateur pour adapter l'interface,
 * SANS aucun service externe (offline strict, CDC §14) : tout est
 * stocké en localStorage sur le poste.
 *
 *  - compteurs d'actions        → réorganisation dynamique des boutons
 *    (ex. l'export le plus utilisé passe en premier) ;
 *  - préférences d'affichage    → niveau, regroupement, colonnes et
 *    filtres retrouvés d'une session à l'autre ;
 *  - « dernière analyse »       → macro ⚡ un clic : re-sélectionne les
 *    mêmes champs et relance la comparaison ;
 *  - suggestions contextuelles  → si l'utilisateur exporte presque
 *    toujours après une comparaison, l'export lui est proposé.
 * ============================================================ */
"use strict";

window.PRF = window.PRF || {};

PRF.usage = (function () {

  const KEY = 'prf.usage.v1';

  /** Données persistées : compteurs, préférences, dernière analyse. */
  let data = { counts: {}, prefs: {}, lastRun: null };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw && typeof raw === 'object') {
      data.counts = raw.counts || {};
      data.prefs = raw.prefs || {};
      data.lastRun = raw.lastRun || null;
    }
  } catch (_) { /* stockage vide ou corrompu : on repart de zéro */ }

  /** Écriture différée : regroupe les rafales de mises à jour. */
  let timer = null;
  function write() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); }
    catch (e) { PRF.errors.log('warn', 'Suivi d\'usage non persistable', e); }
  }
  function persist() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () { timer = null; write(); }, 300);
  }
  // Purge synchrone à la fermeture : aucune habitude enregistrée juste
  // avant de quitter la page ne doit être perdue.
  window.addEventListener('pagehide', function () {
    if (timer) { clearTimeout(timer); timer = null; write(); }
  });

  /**
   * Comptabilise une action utilisateur (ex. 'export:xlsx',
   * 'profile:Analyse coût', 'quickRun').
   * @param {string} action
   */
  function record(action) {
    data.counts[action] = (data.counts[action] || 0) + 1;
    persist();
  }

  /** @returns {number} nombre d'utilisations d'une action. */
  function count(action) { return data.counts[action] || 0; }

  /**
   * Trie des identifiants du plus utilisé au moins utilisé.
   * @param {string[]} ids
   * @param {string} prefix  préfixe de compteur (ex. 'export:')
   */
  function sortByUsage(ids, prefix) {
    return ids.slice().sort(function (a, b) {
      return count(prefix + b) - count(prefix + a);
    });
  }

  // ---------- Préférences d'affichage --------------------------------

  /** Mémorise une préférence durable (niveau, colonnes, filtres…). */
  function setPref(key, value) { data.prefs[key] = value; persist(); }

  /** @returns {*} préférence enregistrée, ou la valeur par défaut. */
  function getPref(key, def) {
    return key in data.prefs ? data.prefs[key] : def;
  }

  // ---------- Macro « dernière analyse » ------------------------------

  /**
   * Enregistre la configuration de la dernière comparaison lancée
   * (sélection de champs, sens d'amélioration, tolérance d'orthographe).
   * @param {{selected:string[], directions:Object, fuzzy:boolean}} run
   */
  function setLastRun(run) { data.lastRun = run; persist(); }

  /** @returns {Object|null} configuration de la dernière analyse. */
  function getLastRun() { return data.lastRun; }

  return { record, count, sortByUsage, setPref, getPref, setLastRun, getLastRun };
})();
