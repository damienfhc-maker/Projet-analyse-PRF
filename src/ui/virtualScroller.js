/* ============================================================
 * virtualScroller.js — Virtualisation de liste (CDC §11.2)
 *
 * Rend fluide l'affichage de 100 000+ lignes : seules les lignes
 * visibles (+ marge d'overscan) existent dans le DOM, positionnées
 * en absolu dans un conteneur défilant dont la hauteur totale est
 * simulée par un espaceur.
 *
 * Les nœuds DOM de lignes sont recyclés (pool) : zéro création de
 * nœud pendant le défilement, rendu piloté par requestAnimationFrame.
 * ============================================================ */
"use strict";

window.PRF = window.PRF || {};

/**
 * @constructor
 * @param {HTMLElement} viewport  Conteneur défilant (.ct-body)
 * @param {{rowHeight:number, overscan?:number,
 *          renderRow:(node:HTMLElement, viewIndex:number)=>void}} opts
 */
PRF.VirtualScroller = function (viewport, opts) {
  const rowHeight = opts.rowHeight;
  const overscan = opts.overscan || 10;
  const renderRow = opts.renderRow;

  let count = 0;          // nombre total de lignes virtuelles
  let pool = [];          // nœuds DOM recyclés
  let rafPending = false; // un rendu est-il déjà planifié ?

  // Espaceur : donne au conteneur sa hauteur défilable totale.
  const spacer = document.createElement('div');
  spacer.className = 'ct-spacer';
  viewport.appendChild(spacer);

  /** Planifie un rendu au prochain frame (dédoublonné). */
  function schedule() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () { rafPending = false; render(); });
  }

  /** Rend la fenêtre visible courante. */
  function render() {
    const scrollTop = viewport.scrollTop;
    const height = viewport.clientHeight;
    const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const visible = Math.ceil(height / rowHeight) + overscan * 2;
    const last = Math.min(count, first + visible);
    const needed = last - first;

    // Ajuste la taille du pool de nœuds recyclés
    while (pool.length < needed) {
      const node = document.createElement('div');
      node.className = 'ct-row';
      viewport.appendChild(node);
      pool.push(node);
    }
    for (let i = needed; i < pool.length; i++) pool[i].style.display = 'none';

    // Rendu des lignes visibles (les nœuds sont réutilisés en place)
    for (let i = 0; i < needed; i++) {
      const node = pool[i];
      node.style.display = '';
      node.style.transform = 'translateY(' + ((first + i) * rowHeight) + 'px)';
      renderRow(node, first + i);
    }
  }

  viewport.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);

  return {
    /**
     * Définit le nombre de lignes et déclenche un rendu.
     * @param {number} n
     * @param {boolean} [resetScroll]  revient en haut de liste
     */
    setCount: function (n, resetScroll) {
      count = n;
      spacer.style.height = (n * rowHeight) + 'px';
      if (resetScroll) viewport.scrollTop = 0;
      schedule();
    },
    /** Redessine la fenêtre courante (après édition, tri, etc.). */
    refresh: schedule
  };
};
