/* ============================================================
 * components.js — Composants UI transverses et utilitaires
 * (toasts, modales, formatage, téléchargements, debounce)
 * ============================================================ */
"use strict";

window.PRF = window.PRF || {};

PRF.ui = (function () {

  // ---------- Toasts (messages UI clairs, CDC §13) ----------------------

  /**
   * Affiche un message temporaire non bloquant.
   * @param {string} message
   * @param {'info'|'success'|'warn'|'error'} [type]
   */
  function toast(message, type) {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = 'toast toast-' + (type || 'info');
    el.textContent = message;
    container.appendChild(el);
    setTimeout(function () { el.remove(); }, type === 'error' ? 8000 : 4000);
  }

  // ---------- Modales ----------------------------------------------------

  /**
   * Modale générique. Retourne une promesse résolue avec la valeur du
   * bouton cliqué (ou null si annulation).
   * @param {{title:string, body:string|HTMLElement, input?:{placeholder?:string, value?:string},
   *          buttons:Array<{label:string, value:*, primary?:boolean}>}} opts
   * @returns {Promise<{value:*, inputValue:string|null}|null>}
   */
  function modal(opts) {
    return new Promise(function (resolve) {
      const root = document.getElementById('modal-root');
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      const box = document.createElement('div');
      box.className = 'modal';

      const h = document.createElement('h3');
      h.textContent = opts.title;
      box.appendChild(h);

      if (opts.body) {
        if (typeof opts.body === 'string') {
          const p = document.createElement('p');
          p.textContent = opts.body;
          box.appendChild(p);
        } else box.appendChild(opts.body);
      }

      let input = null;
      if (opts.input) {
        input = document.createElement('input');
        input.type = 'text';
        input.placeholder = opts.input.placeholder || '';
        input.value = opts.input.value || '';
        box.appendChild(input);
      }

      const actions = document.createElement('div');
      actions.className = 'modal-actions';
      opts.buttons.forEach(function (btn) {
        const b = document.createElement('button');
        b.className = 'btn' + (btn.primary ? ' btn-primary' : '');
        b.textContent = btn.label;
        b.addEventListener('click', function () {
          close({ value: btn.value, inputValue: input ? input.value : null });
        });
        actions.appendChild(b);
      });
      box.appendChild(actions);
      overlay.appendChild(box);

      function close(result) {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
        resolve(result);
      }
      function onKey(e) {
        if (e.key === 'Escape') close(null);
        if (e.key === 'Enter' && input) {
          const primary = opts.buttons.find(function (b) { return b.primary; });
          if (primary) close({ value: primary.value, inputValue: input.value });
        }
      }
      overlay.addEventListener('click', function (e) { if (e.target === overlay) close(null); });
      document.addEventListener('keydown', onKey);
      root.appendChild(overlay);
      if (input) input.focus();
    });
  }

  /** Confirmation simple oui/non. @returns {Promise<boolean>} */
  function confirm(title, body) {
    return modal({
      title: title, body: body,
      buttons: [{ label: 'Annuler', value: false }, { label: 'Confirmer', value: true, primary: true }]
    }).then(function (r) { return !!(r && r.value); });
  }

  /** Saisie d'un texte. @returns {Promise<string|null>} */
  function prompt(title, placeholder, value) {
    return modal({
      title: title, input: { placeholder: placeholder, value: value },
      buttons: [{ label: 'Annuler', value: false }, { label: 'OK', value: true, primary: true }]
    }).then(function (r) {
      return r && r.value && r.inputValue && r.inputValue.trim() ? r.inputValue.trim() : null;
    });
  }

  // ---------- Formatage ---------------------------------------------------

  const numFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

  /** Formate un nombre au format français (1 234,56). */
  function formatNumber(v) {
    if (v === null || v === undefined) return '';
    if (typeof v !== 'number') return String(v);
    return numFmt.format(v);
  }

  /** Formate une taille en octets lisible. */
  function formatBytes(n) {
    if (n < 1024) return n + ' o';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' Ko';
    return (n / (1024 * 1024)).toFixed(1) + ' Mo';
  }

  /** Horodatage compact pour noms de fichiers : 2026-07-03_14h05. */
  function dateStamp() {
    const d = new Date();
    function p(x) { return String(x).padStart(2, '0'); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      '_' + p(d.getHours()) + 'h' + p(d.getMinutes());
  }

  /** Échappe une chaîne pour insertion sûre dans du HTML. */
  function escapeHtml(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ---------- Divers -------------------------------------------------------

  /** Debounce standard (regroupe les rafales d'événements). */
  function debounce(fn, delay) {
    let timer = null;
    return function () {
      const args = arguments, self = this;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { timer = null; fn.apply(self, args); }, delay);
    };
  }

  /** Télécharge un Blob sous un nom de fichier (100 % local). */
  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  return {
    toast, modal, confirm, prompt,
    formatNumber, formatBytes, dateStamp, escapeHtml,
    debounce, downloadBlob
  };
})();
