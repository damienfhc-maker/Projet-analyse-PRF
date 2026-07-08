/* ============================================================
 * exportXlsx.js — Export Excel
 *
 * Génère un fichier Excel simple avec les lignes de comparaison.
 * Tout est généré localement via SheetJS vendorisé (aucun réseau).
 * ============================================================ */
"use strict";

window.PRF = window.PRF || {};

PRF.exportXlsx = (function () {

  /** Libellés français des statuts, partagés avec l'export PDF. */
  const STATUS_FR = {
    added: 'Ajout', removed: 'Suppression',
    modified: 'Modifié', unchanged: 'Inchangé'
  };

  /** Nettoie un nom de feuille Excel (31 caractères max, sans \ / ? * [ ] :). */
  function sheetName(name) {
    return String(name).replace(/[\\/?*[\]:]/g, '-').slice(0, 31);
  }

  /**
   * Lance l'export Excel à partir de la vue courante du tableau.
   */
  function run() {
    const view = PRF.comparisonTable.getExportView();
    if (!view.detailRows.length) {
      PRF.errors.userWarn('Aucune ligne à exporter : vérifiez les filtres, suppressions et exclusions.');
      return;
    }
    const t0 = performance.now();
    const wb = XLSX.utils.book_new();

    // Feuille : Détail complet
    const aoa = [['STRR', 'Indication', 'ACTUEL', 'PROPOSER', 'DELTA', 'Statut']];

    view.detailRows.forEach(function (r) {
      aoa.push([
        r.strrId || '',
        r.label || '',
        r.actual !== null && r.actual !== undefined ? r.actual : '',
        r.proposed !== null && r.proposed !== undefined ? r.proposed : '',
        r.delta !== null && r.delta !== undefined ? r.delta : '',
        STATUS_FR[r.status] || r.status || ''
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [
      { wch: 15 },  // STRR
      { wch: 35 },  // Indication
      { wch: 13 },  // ACTUEL
      { wch: 13 },  // PROPOSER
      { wch: 13 },  // DELTA
      { wch: 12 }   // Statut
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Comparaison');

    const fileName = 'comparaison_STRR_' + PRF.ui.dateStamp() + '.xlsx';
    XLSX.writeFile(wb, fileName);
    PRF.errors.log('info', 'Export Excel généré en ' + Math.round(performance.now() - t0) + ' ms : ' + fileName);
    PRF.ui.toast('Export Excel généré : ' + fileName, 'success');
  }

  return { run, STATUS_FR };
})();
