/* ============================================================
 * exportXlsx.js — Export Excel (CDC §10.1, §10.3)
 *
 * Multi-feuilles :
 *   - Feuille 1 « Synthèse » : agrégats globaux par STRR et par champ ;
 *   - Feuilles suivantes : détail par STRR, structure fidèle à l'UI
 *     (tri courant, colonnes visibles).
 *
 * Export filtré strict (§10.3) : les lignes supprimées, les lignes
 * décochées « inclure dans export », les STRR exclus et les champs
 * décochés n'apparaissent JAMAIS dans le fichier produit.
 *
 * Tout est généré localement via SheetJS vendorisé (aucun réseau).
 * ============================================================ */
"use strict";

window.PRF = window.PRF || {};

PRF.exportXlsx = (function () {

  /** Libellés français des statuts, partagés avec l'export PDF. */
  const STATUS_FR = {
    added: 'Ajout', removed: 'Suppression',
    modified: 'Modifié', unchanged: 'Inchangé', agg: 'Total'
  };

  /** Nettoie un nom de feuille Excel (31 caractères max, sans \ / ? * [ ] :). */
  function sheetName(name) {
    return String(name).replace(/[\\/?*[\]:]/g, '-').slice(0, 31);
  }

  /** Colonnes exportables et leur extraction, alignées sur l'UI. */
  const COLS = [
    { key: 'section', label: 'Section', get: function (r) { return r.section || ''; } },
    { key: 'op', label: 'OP', get: function (r) { return r.op || ''; } },
    { key: 'label', label: 'Libellé', get: function (r) { return r.label || ''; } },
    { key: 'field', label: 'Champ', get: function (r) { return r.field; } },
    { key: 'actual', label: 'ACTUEL', get: function (r) { return r.actual; } },
    { key: 'proposed', label: 'PROPOSER', get: function (r) { return r.proposed; } },
    { key: 'delta', label: 'DELTA', get: function (r) { return r.delta; } },
    { key: 'status', label: 'Statut', get: function (r) { return STATUS_FR[r.status] || r.status; } }
  ];

  /**
   * Lance l'export Excel à partir de la vue courante du tableau.
   * La vue fournit les lignes détaillées déjà filtrées/triées et la
   * visibilité des colonnes (structure fidèle UI, §10.1).
   */
  function run() {
    const view = PRF.comparisonTable.getExportView();
    if (!view.detailRows.length) {
      PRF.errors.userWarn('Aucune ligne à exporter : vérifiez les filtres, suppressions et exclusions.');
      return;
    }
    const t0 = performance.now();
    const wb = XLSX.utils.book_new();

    // ---- Feuille 1 : Synthèse (agrégats globaux par STRR) -------------
    const globals = PRF.comparator.aggregate(view.detailRows, 'global');
    globals.sort(function (a, b) {
      return a.strrId === b.strrId ? (a.field < b.field ? -1 : 1) : (a.strrId < b.strrId ? -1 : 1);
    });
    const synth = [['STRR', 'Champ', 'ACTUEL', 'PROPOSER', 'DELTA', 'Lignes']];
    globals.forEach(function (g) {
      synth.push([g.strrId, g.field, g.actual, g.proposed, g.delta, g.count]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(synth), 'Synthèse');

    // ---- Feuilles 2+ : détail par STRR ---------------------------------
    // Colonnes exportées = colonnes visibles dans l'UI (toggle respecté).
    const cols = COLS.filter(function (c) { return view.visibleColumns.has(c.key); });
    const byStrr = new Map();
    view.detailRows.forEach(function (r) {
      let arr = byStrr.get(r.strrId);
      if (!arr) { arr = []; byStrr.set(r.strrId, arr); }
      arr.push(r);
    });

    byStrr.forEach(function (rows, strrId) {
      const aoa = [cols.map(function (c) { return c.label; })];
      rows.forEach(function (r) {
        aoa.push(cols.map(function (c) { return c.get(r); }));
      });
      // Ligne de totaux par champ en pied de feuille (lecture rapide)
      const totals = PRF.comparator.aggregate(rows, 'global');
      totals.forEach(function (g) {
        aoa.push(cols.map(function (c) {
          if (c.key === 'label') return 'TOTAL';
          if (c.key === 'field') return g.field;
          if (c.key === 'actual') return g.actual;
          if (c.key === 'proposed') return g.proposed;
          if (c.key === 'delta') return g.delta;
          if (c.key === 'status') return 'Total';
          return '';
        }));
      });
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      // Largeurs de colonnes raisonnables pour l'ouverture dans Excel
      ws['!cols'] = cols.map(function (c) {
        return { wch: c.key === 'label' || c.key === 'field' ? 26 : 14 };
      });
      XLSX.utils.book_append_sheet(wb, ws, sheetName(strrId));
    });

    const fileName = 'comparaison_STRR_' + PRF.ui.dateStamp() + '.xlsx';
    XLSX.writeFile(wb, fileName);
    PRF.errors.log('info', 'Export Excel généré en ' + Math.round(performance.now() - t0) + ' ms : ' + fileName);
    PRF.ui.toast('Export Excel généré : ' + fileName, 'success');
  }

  return { run, STATUS_FR };
})();
