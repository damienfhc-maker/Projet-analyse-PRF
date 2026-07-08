/* ============================================================
 * comparisonTable.js — Tableau de comparaison (CDC §8.3–§8.5, §9, §11)
 *
 * Structure : | STRR | Section | OP | Libellé | Champ | ACTUEL | PROPOSER | DELTA | Statut | Actions |
 *
 * - Corps virtualisé (PRF.VirtualScroller) : fluide à 100 000+ lignes.
 * - Tri multi-colonnes (clic = tri, Maj+clic = critère additionnel).
 * - Filtre texte par colonne + recherche globale sur l'index mémoire.
 * - Color coding : vert = amélioration, rouge = dégradation, selon le
 *   sens configuré par champ (§8.3).
 * - Toggle de visibilité des colonnes.
 * - Mode édition : double-clic sur ACTUEL / PROPOSER, validation de
 *   type automatique, pile undo/redo, verrouillage par ligne (§8.4).
 * - Suppression intelligente : ligne OP, section complète, STRR
 *   complet — logique (jamais destructive) + case « inclure dans
 *   export » (§8.5).
 * - Multi-STRR : chips d'inclusion/exclusion par STRR (§9.2).
 * - Niveaux OP / Section / Global STRR (§6.3).
 * ============================================================ */
"use strict";

window.PRF = window.PRF || {};

PRF.comparisonTable = (function () {

  const ROW_H = 30;

  /** Définition des colonnes du tableau (structure hiérarchique). */
  const COLUMNS = [
    { key: 'strr', label: 'STRR', w: 110, get: function (r) { return r.strrId; } },
    { key: 'label', label: 'Indication', w: 250, get: function (r) { return r.label || ''; } },
    { key: 'actual', label: 'ACTUEL', w: 110, num: true, editable: true, get: function (r) { return r.actual; } },
    { key: 'proposed', label: 'PROPOSER', w: 110, num: true, editable: true, get: function (r) { return r.proposed; } },
    { key: 'delta', label: 'DELTA', w: 110, num: true, get: function (r) { return r.delta; } },
    { key: 'status', label: 'Statut', w: 95, get: function (r) { return r.status; } },
    { key: 'actions', label: 'Actions', w: 130 }
  ];

  // ---------- État de la vue ------------------------------------------------

  let els = null;
  let scroller = null;
  let viewRows = [];                 // lignes actuellement affichées
  let sortSpec = [];                 // [{key, dir}] tri multi-colonnes
  let colFilters = {};               // {key: texte minuscule}
  let searchText = '';
  let visibleCols = new Set(COLUMNS.map(function (c) { return c.key; }));
  let editing = null;                // {row, key, node} édition en cours

  // ---------- Initialisation --------------------------------------------------

  function init() {
    els = {
      root: document.getElementById('comparison-table'),
      search: document.getElementById('global-search'),
      undo: document.getElementById('btn-undo'),
      redo: document.getElementById('btn-redo'),
      exportGroup: document.getElementById('export-group'),
      exportXlsx: document.getElementById('btn-export-xlsx'),
      exportPdf: document.getElementById('btn-export-pdf'),
      exportSuggest: document.getElementById('export-suggest'),
      chips: document.getElementById('strr-context-bar'),
      stats: document.getElementById('table-stats')
    };

    // Structure interne : en-tête + ligne de filtres + corps virtualisé
    els.root.innerHTML =
      '<div class="ct-head"><div class="ct-head-inner"></div></div>' +
      '<div class="ct-filters"><div class="ct-filters-inner"></div></div>' +
      '<div class="ct-body"></div>';
    els.head = els.root.querySelector('.ct-head');
    els.headInner = els.root.querySelector('.ct-head-inner');
    els.filtersBar = els.root.querySelector('.ct-filters');
    els.filtersInner = els.root.querySelector('.ct-filters-inner');
    els.body = els.root.querySelector('.ct-body');

    scroller = PRF.VirtualScroller(els.body, { rowHeight: ROW_H, renderRow: renderRow });

    // Synchronisation du défilement horizontal en-tête / corps
    els.body.addEventListener('scroll', function () {
      els.head.scrollLeft = els.body.scrollLeft;
      els.filtersBar.scrollLeft = els.body.scrollLeft;
    }, { passive: true });

    // --- Barre d'outils -------------------------------------------------
    els.search.addEventListener('input', PRF.ui.debounce(function () {
      searchText = els.search.value;
      rebuild(true);
    }, 150));

    els.undo.addEventListener('click', function () { PRF.history.undo(); });
    els.redo.addEventListener('click', function () { PRF.history.redo(); });

    els.exportXlsx.addEventListener('click', function () {
      PRF.usage.record('export:xlsx');
      hideExportSuggestion();
      PRF.exportXlsx.run();
      orderExportButtons();
    });
    els.exportPdf.addEventListener('click', function () {
      PRF.usage.record('export:pdf');
      hideExportSuggestion();
      PRF.exportPdf.run();
      orderExportButtons();
    });
    orderExportButtons();

    // --- Interactions du corps (délégation d'événements : un seul
    //     handler quel que soit le nombre de lignes rendues) -----------
    els.body.addEventListener('click', onBodyClick);
    els.body.addEventListener('dblclick', onBodyDblClick);

    // --- Abonnements store ------------------------------------------------
    PRF.store.on('comparison:done', function () {
      sortSpec = [];
      colFilters = {};
      searchText = '';
      if (els) els.search.value = '';
      fullRender();
      maybeSuggestExport();
    });
    PRF.store.on('rows:changed', function () { rebuild(false); });
    PRF.store.on('history:changed', updateHistoryButtons);
  }

  /**
   * Place l'export le plus utilisé en premier (personnalisation par
   * l'usage : l'action favorite est toujours la plus accessible).
   */
  function orderExportButtons() {
    if (PRF.usage.count('export:pdf') > PRF.usage.count('export:xlsx')) {
      els.exportGroup.insertBefore(els.exportPdf, els.exportXlsx);
    } else {
      els.exportGroup.insertBefore(els.exportXlsx, els.exportPdf);
    }
  }

  // ---------- Suggestion automatique d'export (raccourci intelligent) ----

  let suggestDismissed = false;

  /**
   * Si l'utilisateur exporte presque systématiquement après une
   * comparaison (≥ 2 exports enregistrés), l'export favori lui est
   * proposé en un clic dès que le tableau s'affiche.
   */
  function maybeSuggestExport() {
    if (suggestDismissed) return;
    const nx = PRF.usage.count('export:xlsx');
    const np = PRF.usage.count('export:pdf');
    if (nx + np < 2) { hideExportSuggestion(); return; }
    const fav = np > nx ? 'pdf' : 'xlsx';
    const label = fav === 'pdf' ? 'PDF' : 'Excel';
    els.exportSuggest.hidden = false;
    els.exportSuggest.innerHTML =
      '💡 Vous exportez souvent en ' + label + ' — ' +
      '<button class="linklike" id="suggest-go">exporter maintenant</button> ' +
      '<button class="linklike dim" id="suggest-no" title="Ne plus proposer pendant cette session">ignorer</button>';
    document.getElementById('suggest-go').addEventListener('click', function () {
      PRF.usage.record('export:' + fav);
      hideExportSuggestion();
      (fav === 'pdf' ? PRF.exportPdf : PRF.exportXlsx).run();
    });
    document.getElementById('suggest-no').addEventListener('click', function () {
      suggestDismissed = true;
      hideExportSuggestion();
    });
  }

  function hideExportSuggestion() {
    if (els && els.exportSuggest) els.exportSuggest.hidden = true;
  }

  // ---------- Construction de la vue -------------------------------------------

  /**
   * Pipeline complet : recherche indexée → filtres → niveau → tri.
   * @param {boolean} resetScroll  revenir en haut de liste
   */
  function rebuild(resetScroll) {
    const st = PRF.store.state;
    const detail = st.rows;

    // 1. Recherche globale sur l'index mémoire (§11.2)
    const searchSet = PRF.searchIndex.query(searchText);

    // 2. Filtres par colonne (précompilés hors boucle)
    const activeFilters = [];
    COLUMNS.forEach(function (c) {
      if (c.get && colFilters[c.key]) activeFilters.push({ col: c, text: colFilters[c.key] });
    });

    const filtered = [];
    for (let i = 0; i < detail.length; i++) {
      const r = detail[i];
      const ds = st.datasets.get(r.strrId);
      if (ds && !ds.included) continue;                         // exclusion STRR
      if (r.deleted) continue;                                  // suppression logique
      if (searchSet && !searchSet.has(i)) continue;
      let ok = true;
      for (let f = 0; f < activeFilters.length; f++) {
        const v = activeFilters[f].col.get(r);
        const s = typeof v === 'number' ? String(v) : String(v || '').toLowerCase();
        if (s.indexOf(activeFilters[f].text) === -1) { ok = false; break; }
      }
      if (ok) filtered.push(r);
    }

    // 3. Modèle hiérarchique : pré-calculer hasChildren et filtered state
    buildHierarchicalView(filtered);

    // 4. Tri multi-colonnes + ordre naturel en critère final
    sortRows(viewRows);

    // 5. Appliquer les états collapsed pour filtrer la vue
    applyCollapsedFilter();

    scroller.setCount(viewRows.length, !!resetScroll);
    renderStats(detail.length);
    renderChips();
    updateHistoryButtons();
  }

  /**
   * Construit la vue hiérarchique : marque les rows avec hasChildren
   * en fonction du niveau et du parentPath.
   */
  function buildHierarchicalView(rows) {
    viewRows = rows;

    // Marquer les rows qui ont des enfants
    const childrenByParent = new Map();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const parentPath = r.parentPath;
      if (parentPath) {
        if (!childrenByParent.has(parentPath)) {
          childrenByParent.set(parentPath, []);
        }
        childrenByParent.get(parentPath).push(i);
      }
    }

    // Ajouter hasChildren et collapsed properties
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const label = r.label;
      r.hasChildren = childrenByParent.has(label) && childrenByParent.get(label).length > 0;
      if (!('collapsed' in r)) r.collapsed = false;
    }
  }

  /**
   * Filtre viewRows en cachant les enfants des groupes collapsed.
   */
  function applyCollapsedFilter() {
    const out = [];
    const collapsedParents = new Set();

    for (let i = 0; i < viewRows.length; i++) {
      const r = viewRows[i];

      // Vérifier si ce row est un enfant d'un groupe collapsed
      if (r.parentPath && collapsedParents.has(r.parentPath)) {
        continue; // skip cet enfant
      }

      out.push(r);

      // Si ce row est un groupe collapsed, ajouter à l'ensemble
      if (r.hasChildren && r.collapsed) {
        collapsedParents.add(r.label);
      }
    }

    viewRows = out;
  }

  /** Comparaison de deux valeurs de cellule (nulls en fin de liste). */
  function cmpVal(a, b) {
    if (a === null || a === undefined || a === '') return (b === null || b === undefined || b === '') ? 0 : 1;
    if (b === null || b === undefined || b === '') return -1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    const sa = String(a).toLowerCase(), sb = String(b).toLowerCase();
    return sa < sb ? -1 : (sa > sb ? 1 : 0);
  }

  function sortRows(rows) {
    const spec = sortSpec.map(function (s) {
      return { get: COLUMNS.find(function (c) { return c.key === s.key; }).get, dir: s.dir };
    });
    rows.sort(function (x, y) {
      for (let i = 0; i < spec.length; i++) {
        const d = cmpVal(spec[i].get(x), spec[i].get(y)) * spec[i].dir;
        if (d !== 0) return d;
      }
      // Ordre naturel : STRR puis ordre d'apparition dans le fichier
      let d = cmpVal(x.strrId, y.strrId);
      if (d !== 0) return d;
      return (x.order || 0) - (y.order || 0);
    });
  }

  // ---------- Rendu -----------------------------------------------------------

  /** Redessine entièrement en-tête + filtres + corps. */
  function fullRender() {
    renderHeader();
    rebuild(true);
  }

  function activeCols() {
    return COLUMNS.filter(function (c) {
      return visibleCols.has(c.key);
    });
  }

  function renderHeader() {
    const esc = PRF.ui.escapeHtml;
    const cols = activeCols();

    els.headInner.innerHTML = cols.map(function (c) {
      const s = sortSpec.findIndex(function (x) { return x.key === c.key; });
      const ind = s >= 0 ? '<span class="sort-ind">' + (sortSpec[s].dir > 0 ? '▲' : '▼') +
        (sortSpec.length > 1 ? (s + 1) : '') + '</span>' : '';
      return '<div class="ct-col" data-sort="' + c.key + '" style="width:' + c.w + 'px" ' +
        'title="Clic : trier — Maj+clic : tri multi-colonnes">' + esc(c.label) + ind + '</div>';
    }).join('');

    els.filtersInner.innerHTML = cols.map(function (c) {
      if (!c.get) return '<div class="ct-filter-cell" style="width:' + c.w + 'px"></div>';
      return '<div class="ct-filter-cell" style="width:' + c.w + 'px">' +
        '<input type="text" placeholder="filtre…" data-filter="' + c.key + '" value="' +
        esc(colFilters[c.key] || '') + '"></div>';
    }).join('');

    // Tri : clic simple = colonne unique, Maj+clic = critère additionnel
    els.headInner.querySelectorAll('[data-sort]').forEach(function (cell) {
      cell.addEventListener('click', function (e) {
        const key = cell.dataset.sort;
        if (key === 'actions') return;
        const existing = sortSpec.find(function (s) { return s.key === key; });
        if (!e.shiftKey) {
          sortSpec = existing && existing.dir === 1 ? [{ key: key, dir: -1 }]
            : (existing && existing.dir === -1 ? [] : [{ key: key, dir: 1 }]);
        } else {
          if (!existing) sortSpec.push({ key: key, dir: 1 });
          else if (existing.dir === 1) existing.dir = -1;
          else sortSpec.splice(sortSpec.indexOf(existing), 1);
        }
        renderHeader();
        rebuild(false);
      });
    });

    // Filtres par colonne (debounce commun)
    els.filtersInner.querySelectorAll('[data-filter]').forEach(function (input) {
      input.addEventListener('input', PRF.ui.debounce(function () {
        const v = input.value.trim().toLowerCase();
        if (v) colFilters[input.dataset.filter] = v;
        else delete colFilters[input.dataset.filter];
        rebuild(true);
      }, 150));
    });
  }

  function renderColToggleMenu() {
    const esc = PRF.ui.escapeHtml;
    els.colToggleMenu.innerHTML = COLUMNS.filter(function (c) { return c.key !== 'actions'; })
      .map(function (c) {
        return '<label class="chk"><input type="checkbox" data-col="' + c.key + '"' +
          (visibleCols.has(c.key) ? ' checked' : '') + '> ' + esc(c.label) + '</label>';
      }).join('');
    els.colToggleMenu.querySelectorAll('[data-col]').forEach(function (chk) {
      chk.addEventListener('change', function () {
        if (chk.checked) visibleCols.add(chk.dataset.col);
        else visibleCols.delete(chk.dataset.col);
        PRF.usage.setPref('table.columns', Array.from(visibleCols)); // retenu pour les prochaines sessions
        renderHeader();
        scroller.refresh();
      });
    });
  }

  /**
   * Rendu d'une ligne virtuelle (appelé par le scroller, doit rester
   * très rapide : construction d'une chaîne HTML puis innerHTML).
   * Gère l'indentation hiérarchique et les boutons expand/collapse.
   * @param {HTMLElement} node
   * @param {number} idx  index dans viewRows
   */
  function renderRow(node, idx) {
    const r = viewRows[idx];
    if (!r) { node.innerHTML = ''; return; }
    const esc = PRF.ui.escapeHtml;
    const fmt = PRF.ui.formatNumber;

    const cols = activeCols();
    let html = '';

    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (c.key === 'actions') {
        html += '<div class="ct-cell actions" style="width:' + c.w + 'px">' +
          '<button class="row-act' + (r.locked ? ' active' : '') + '" data-act="lock" title="' +
            (r.locked ? 'Déverrouiller la comparaison' : 'Verrouiller la comparaison (bloque l\'édition)') + '">' +
            (r.locked ? '🔒' : '🔓') + '</button>' +
          '<input type="checkbox" data-act="include" title="Inclure dans l\'export"' +
            (r.included ? ' checked' : '') + '>' +
          '<button class="row-act" data-act="del" title="' +
            (r.deleted ? 'Restaurer la ligne' : 'Supprimer la ligne (logique)') + '">' +
            (r.deleted ? '↺' : '🗑') + '</button>' +
          '<button class="row-act" data-act="delstrr" title="Supprimer le STRR complet">✖</button>' +
          '</div>';
        continue;
      }

      let cls = 'ct-cell' + (c.num ? ' num' : '');
      let content;

      // Colonne label : ajouter indentation et bouton expand/collapse
      if (c.key === 'label') {
        const indent = (r.level || 1) - 1;
        const paddingLeft = indent * 20 + 5;
        const hasChildren = r.hasChildren;
        const expandBtn = hasChildren ?
          '<button class="expand-btn ' + (r.collapsed ? 'collapsed' : '') + '" data-act="expand" title="' +
            (r.collapsed ? 'Afficher les enfants' : 'Masquer les enfants') + '">' +
            (r.collapsed ? '▶' : '▼') + '</button>' :
          '<span class="expand-spacer"></span>';

        content = '<div class="label-container" style="padding-left:' + paddingLeft + 'px">' +
          expandBtn +
          '<span class="label-text">' + esc(r.label || '') + '</span>' +
          '</div>';
        cls += ' label-cell';
      } else {
        const v = c.get(r);
        if (c.key === 'delta') {
          // Heuristique simple : delta positif = amélioration (vert), négatif = détérioration (rouge)
          if (typeof v === 'number' && Math.abs(v) > 1e-9) {
            cls += v > 0 ? ' delta-good' : ' delta-bad';
          } else {
            cls += ' delta-zero';
          }
          content = typeof v === 'number' && v > 0 ? '+' + fmt(v) : esc(fmt(v));
        } else if (c.key === 'status') {
          const lbl = PRF.exportXlsx.STATUS_FR[v] || v;
          content = '<span class="st-badge st-' + esc(v) + '">' + esc(lbl) + '</span>';
        } else if (c.num) {
          content = esc(fmt(v));
        } else {
          content = esc(v);
        }
      }

      const editable = c.editable && !r.locked && !r.deleted && c.key !== 'label';
      html += '<div class="' + cls + (editable ? ' editable' : '') + '" data-cell="' + c.key +
        '" style="width:' + c.w + 'px">' + content + '</div>';
    }

    node.innerHTML = html;
    node.dataset.idx = idx;

    // Classes CSS pour le style
    let rowClass = 'ct-row';
    if (r.deleted) rowClass += ' deleted';
    if (r.locked) rowClass += ' locked';
    if (r.level === 1) rowClass += ' level-1'; // séparateur visuel pour groupe principal
    if (r.collapsed) rowClass += ' collapsed';
    if (r.hasChildren) rowClass += ' has-children';

    node.className = rowClass;
    node.dataset.idx = idx;
  }

  function renderStats(totalDetail) {
    const counts = { added: 0, removed: 0, modified: 0, unchanged: 0 };
    let dataRows = 0;
    for (let i = 0; i < viewRows.length; i++) {
      const r = viewRows[i];
      dataRows++;
      if (counts[r.status] !== undefined) counts[r.status]++;
    }
    els.stats.textContent =
      dataRows + ' ligne(s) affichée(s) sur ' + totalDetail + ' — ' +
      '➕ ' + counts.added + ' ajout(s), ❌ ' + counts.removed + ' suppression(s), ' +
      '✎ ' + counts.modified + ' modifié(s), = ' + counts.unchanged + ' inchangé(s)';
  }

  /** Chips d'inclusion/exclusion par STRR (§9.2). */
  function renderChips() {
    const st = PRF.store.state;
    const esc = PRF.ui.escapeHtml;
    const chips = [];
    Array.from(st.datasets.keys()).sort().forEach(function (strrId) {
      const ds = st.datasets.get(strrId);
      if (!ds.ACTUEL || !ds.PROPOSER) return;
      chips.push('<span class="strr-chip ' + (ds.included ? 'on' : 'off') + '" data-chip="' +
        esc(strrId) + '">' + (ds.included ? '✔' : '❌') + ' ' + esc(strrId) + '</span>');
    });
    els.chips.innerHTML = chips.join('');
    els.chips.querySelectorAll('[data-chip]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        const ds = st.datasets.get(chip.dataset.chip);
        ds.included = !ds.included;
        rebuild(false);
        PRF.store.emit('datasets:changed'); // synchronise le dashboard
      });
    });
  }

  function updateHistoryButtons() {
    if (!els) return;
    els.undo.disabled = !PRF.history.canUndo();
    els.redo.disabled = !PRF.history.canRedo();
  }

  // ---------- Interactions ------------------------------------------------------

  /** Retrouve la ligne visée par un événement du corps. */
  function rowFromEvent(e) {
    const rowNode = e.target.closest('.ct-row');
    if (!rowNode || rowNode.dataset.idx === undefined) return null;
    return { row: viewRows[Number(rowNode.dataset.idx)], node: rowNode };
  }

  function onBodyClick(e) {
    const hit = rowFromEvent(e);
    if (!hit || !hit.row) return;
    const act = e.target.dataset.act;
    if (!act) return;
    const row = hit.row;
    if (act === 'expand') {
      row.collapsed = !row.collapsed;
      rebuild(false); // reconstruire la vue avec les collapsed updates
    } else if (act === 'lock') toggleLock(row);
    else if (act === 'include') toggleInclude(row, e.target.checked);
    else if (act === 'del') deleteRows([row], !row.deleted, 'ligne');
    else if (act === 'delstrr') {
      const st = PRF.store.state;
      const targets = st.rows.filter(function (r) { return r.strrId === row.strrId && !r.deleted; });
      if (targets.length) {
        deleteRows(targets, true, 'STRR ' + row.strrId, { kind: 'strr', strrId: row.strrId });
      }
    }
  }

  function onBodyDblClick(e) {
    const hit = rowFromEvent(e);
    if (!hit || !hit.row) return;
    const cell = e.target.closest('[data-cell]');
    if (!cell) return;
    const colKey = cell.dataset.cell;
    const col = COLUMNS.find(function (c) { return c.key === colKey; });
    if (!col || !col.editable) return;
    const row = hit.row;
    if (row.locked || row.deleted) return;
    startEdit(row, colKey, cell);
  }

  // ---------- Édition inline (§8.4) ----------------------------------------------

  /**
   * Ouvre l'éditeur inline dans la cellule. La validation de type est
   * automatique : si la ligne porte des valeurs numériques, seule une
   * saisie numérique (format FR ou EN) ou vide est acceptée.
   */
  function startEdit(row, key, cellNode) {
    if (editing) commitEdit(true); // une seule édition à la fois

    const current = row[key];
    const counterpart = key === 'actual' ? row.proposed : row.actual;
    const numeric = typeof current === 'number' ||
      (current === null && typeof counterpart === 'number');

    const input = document.createElement('input');
    input.className = 'cell-editor';
    input.value = current === null || current === undefined ? '' : String(current);
    cellNode.textContent = '';
    cellNode.appendChild(input);
    input.focus();
    input.select();

    editing = { row: row, key: key, node: cellNode, input: input, numeric: numeric };

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commitEdit(false); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
      e.stopPropagation(); // n'active pas les raccourcis globaux pendant l'édition
    });
    input.addEventListener('blur', function () { commitEdit(false); });
    input.addEventListener('input', function () {
      // Feedback immédiat de validité (validation automatique de type)
      input.classList.toggle('invalid', parseEditValue(input.value, numeric) === undefined);
    });
  }

  /**
   * @returns {*} valeur typée, ou undefined si saisie invalide.
   *          Chaîne vide → null (valeur absente).
   */
  function parseEditValue(text, numeric) {
    const s = String(text).trim();
    if (s === '') return null;
    if (!numeric) return s;
    const n = parseFloat(s.replace(/[  ]/g, '').replace(',', '.'));
    return isFinite(n) && /^-?[\d\s  .,]+$/.test(s) ? n : undefined;
  }

  function cancelEdit() {
    if (!editing) return;
    const ed = editing;
    editing = null;
    scroller.refresh(); // restaure l'affichage de la cellule
    void ed;
  }

  /** @param {boolean} silent  true = commit implicite (nouvelle édition) */
  function commitEdit(silent) {
    if (!editing) return;
    const ed = editing;
    editing = null;
    const value = parseEditValue(ed.input.value, ed.numeric);
    if (value === undefined) {
      if (!silent) PRF.errors.userWarn('Saisie invalide : une valeur numérique est attendue pour ce champ.');
      scroller.refresh();
      return;
    }
    if (value === ed.row[ed.key] ||
      (typeof value === 'number' && typeof ed.row[ed.key] === 'number' &&
        Math.abs(value - ed.row[ed.key]) < 1e-12)) {
      scroller.refresh();
      return; // aucune modification réelle
    }
    applyEdit(ed.row, ed.key, value);
  }

  /** Applique une édition + commande undo/redo + persistance userState. */
  function applyEdit(row, key, value) {
    const prevValue = row[key];
    const us = PRF.store.getUserState(row.id);
    const hadPrev = key in us;
    const prevUs = us[key];

    function apply(v, restoreUs) {
      row[key] = v;
      if (restoreUs === 'remove') delete us[key];
      else us[key] = v;
      PRF.comparator.recompute(row);
      PRF.store.emit('rows:changed');
    }

    apply(value);
    PRF.history.push({
      label: 'Édition ' + key + ' (' + row.id + ')',
      redo: function () { apply(value); },
      undo: function () {
        row[key] = prevValue;
        if (hadPrev) us[key] = prevUs; else delete us[key];
        PRF.comparator.recompute(row);
        PRF.store.emit('rows:changed');
      }
    });
  }

  // ---------- Verrou / inclusion / suppression (§8.4, §8.5) -----------------------

  function toggleLock(row) {
    const prev = row.locked;
    function set(v) {
      row.locked = v;
      PRF.store.getUserState(row.id).locked = v;
      PRF.store.emit('rows:changed');
    }
    set(!prev);
    PRF.history.push({
      label: 'Verrou (' + row.id + ')',
      redo: function () { set(!prev); },
      undo: function () { set(prev); }
    });
  }

  function toggleInclude(row, checked) {
    const prev = row.included;
    function set(v) {
      row.included = v;
      PRF.store.getUserState(row.id).included = v;
      PRF.store.emit('rows:changed');
    }
    set(checked);
    PRF.history.push({
      label: 'Inclusion export (' + row.id + ')',
      redo: function () { set(checked); },
      undo: function () { set(prev); }
    });
  }

  /**
   * Suppression / restauration logique d'un lot de lignes (undoable).
   * @param {Array} rows
   * @param {boolean} deleted  true = supprimer, false = restaurer
   * @param {string} what  libellé pour l'historique et le toast
   * @param {Object} [structure]  {kind, strrId, section} pour §12.2
   */
  function deleteRows(rows, deleted, what, structure) {
    const prevStates = rows.map(function (r) { return r.deleted; });
    const st = PRF.store.state;

    function apply(del) {
      rows.forEach(function (r) {
        r.deleted = del;
        PRF.store.getUserState(r.id).deleted = del;
      });
      if (structure) {
        if (del) st.deletedStructures.push(structure);
        else {
          const i = st.deletedStructures.indexOf(structure);
          if (i >= 0) st.deletedStructures.splice(i, 1);
        }
      }
      PRF.store.emit('rows:changed');
    }
    function revert() {
      rows.forEach(function (r, i) {
        r.deleted = prevStates[i];
        PRF.store.getUserState(r.id).deleted = prevStates[i];
      });
      if (structure) {
        const i = st.deletedStructures.indexOf(structure);
        if (i >= 0) st.deletedStructures.splice(i, 1);
      }
      PRF.store.emit('rows:changed');
    }

    apply(deleted);
    PRF.history.push({
      label: (deleted ? 'Suppression ' : 'Restauration ') + what,
      redo: function () { apply(deleted); },
      undo: revert
    });
    PRF.ui.toast((deleted ? 'Supprimé : ' : 'Restauré : ') + what +
      ' (' + rows.length + ' ligne(s)) — rien n\'est perdu, cliquez ↩ Annuler pour revenir en arrière.', 'info');
  }

  // ---------- Vue d'export (partagée XLSX / PDF) ---------------------------

  /**
   * Lignes détaillées destinées à l'export : filtres, recherche et tri
   * courants appliqués, MAIS suppressions logiques, lignes décochées et
   * STRR exclus toujours écartés — quel que soit l'état d'affichage.
   */
  function getExportView() {
    const st = PRF.store.state;
    const searchSet = PRF.searchIndex.query(searchText);
    const activeFilters = [];
    COLUMNS.forEach(function (c) {
      if (c.get && colFilters[c.key]) activeFilters.push({ col: c, text: colFilters[c.key] });
    });

    const out = [];
    for (let i = 0; i < st.rows.length; i++) {
      const r = st.rows[i];
      const ds = st.datasets.get(r.strrId);
      if (ds && !ds.included) continue;   // exclusion STRR
      if (r.deleted) continue;            // suppression utilisateur
      if (!r.included) continue;          // case « inclure dans export »
      if (searchSet && !searchSet.has(i)) continue;
      let ok = true;
      for (let f = 0; f < activeFilters.length; f++) {
        const v = activeFilters[f].col.get(r);
        const s = typeof v === 'number' ? String(v) : String(v || '').toLowerCase();
        if (s.indexOf(activeFilters[f].text) === -1) { ok = false; break; }
      }
      if (ok) out.push(r);
    }
    sortRows(out);
    return { detailRows: out, visibleColumns: new Set(visibleCols) };
  }

  return { init, getExportView, rebuild };
})();
