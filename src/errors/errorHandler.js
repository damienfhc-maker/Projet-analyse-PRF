/* ============================================================
 * errorHandler.js — Gestion centralisée des erreurs (CDC §13)
 *
 * Deux canaux distincts :
 *   - message UI clair pour l'utilisateur (toast) ;
 *   - log technique détaillé conservé en mémoire + console.
 *
 * Aucun envoi externe : tout reste local (CDC §14).
 * ============================================================ */
"use strict";

/** Espace de noms global de l'application (pas de modules ES en file://). */
window.PRF = window.PRF || {};

PRF.errors = (function () {

  /** Journal technique en mémoire (borné pour maîtriser la RAM). */
  const logs = [];
  const MAX_LOGS = 500;

  /**
   * Enregistre une entrée technique dans le journal.
   * @param {'info'|'warn'|'error'} level
   * @param {string} message  Message technique
   * @param {*} [details]     Contexte additionnel (objet, erreur…)
   */
  function log(level, message, details) {
    const entry = {
      ts: new Date().toISOString(),
      level,
      message,
      details: details === undefined ? null : safeDetails(details)
    };
    logs.push(entry);
    if (logs.length > MAX_LOGS) logs.shift();
    // Console : trace technique complète pour le diagnostic local.
    const fn = level === 'error' ? console.error : (level === 'warn' ? console.warn : console.info);
    fn('[PRF]', message, details !== undefined ? details : '');
  }

  /** Rend les détails sérialisables sans risquer d'exception. */
  function safeDetails(d) {
    if (d instanceof Error) return { name: d.name, message: d.message, stack: d.stack };
    try { JSON.stringify(d); return d; } catch (_) { return String(d); }
  }

  /**
   * Erreur destinée à l'utilisateur : message UI clair + log technique.
   * @param {string} userMessage  Message affiché (français, actionnable)
   * @param {*} [technical]       Détail technique journalisé
   */
  function userError(userMessage, technical) {
    log('error', userMessage, technical);
    // PRF.ui peut ne pas être encore chargé (erreur très précoce).
    if (PRF.ui && PRF.ui.toast) PRF.ui.toast(userMessage, 'error');
    else alert(userMessage);
  }

  /** Avertissement non bloquant destiné à l'utilisateur. */
  function userWarn(userMessage, technical) {
    log('warn', userMessage, technical);
    if (PRF.ui && PRF.ui.toast) PRF.ui.toast(userMessage, 'warn');
  }

  /** @returns {Array} copie du journal technique. */
  function getLogs() { return logs.slice(); }

  // Filet de sécurité global : toute exception non interceptée est
  // journalisée et signalée sans casser silencieusement l'application.
  window.addEventListener('error', function (e) {
    log('error', 'Exception non interceptée : ' + e.message, e.error || e);
  });
  window.addEventListener('unhandledrejection', function (e) {
    log('error', 'Promesse rejetée non interceptée', e.reason);
  });

  return { log, userError, userWarn, getLogs };
})();
