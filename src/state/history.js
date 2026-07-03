/* ============================================================
 * history.js — Pile Undo/Redo (CDC §8.4)
 *
 * Modèle "commande" : chaque action utilisateur réversible est
 * poussée sous forme { label, redo(), undo() }. L'action est
 * appliquée par l'appelant AVANT le push (convention) ; undo()
 * la défait, redo() la ré-applique.
 *
 * Profondeur bornée pour maîtriser la mémoire sur les longues
 * sessions d'édition.
 * ============================================================ */
"use strict";

window.PRF = window.PRF || {};

PRF.history = (function () {

  const undoStack = [];
  const redoStack = [];
  const MAX_DEPTH = 500;

  /**
   * Enregistre une commande déjà appliquée.
   * @param {{label:string, redo:Function, undo:Function}} cmd
   */
  function push(cmd) {
    undoStack.push(cmd);
    if (undoStack.length > MAX_DEPTH) undoStack.shift();
    redoStack.length = 0; // toute nouvelle action invalide le redo
    PRF.store.emit('history:changed');
  }

  /** Annule la dernière commande. @returns {boolean} succès */
  function undo() {
    const cmd = undoStack.pop();
    if (!cmd) return false;
    try { cmd.undo(); }
    catch (e) { PRF.errors.log('error', 'Échec undo : ' + cmd.label, e); }
    redoStack.push(cmd);
    PRF.store.emit('history:changed');
    return true;
  }

  /** Rétablit la dernière commande annulée. @returns {boolean} succès */
  function redo() {
    const cmd = redoStack.pop();
    if (!cmd) return false;
    try { cmd.redo(); }
    catch (e) { PRF.errors.log('error', 'Échec redo : ' + cmd.label, e); }
    undoStack.push(cmd);
    PRF.store.emit('history:changed');
    return true;
  }

  function canUndo() { return undoStack.length > 0; }
  function canRedo() { return redoStack.length > 0; }

  /** Vide l'historique (changement de comparaison, chargement session). */
  function clear() {
    undoStack.length = 0;
    redoStack.length = 0;
    PRF.store.emit('history:changed');
  }

  return { push, undo, redo, canUndo, canRedo, clear };
})();
