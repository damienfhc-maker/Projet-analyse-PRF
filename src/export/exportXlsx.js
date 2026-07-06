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

    // ---- Feuilles 2+ : détail par STRR, GROUPÉ PAR ARTICLE -------------
    // Mise en page : ligne-titre = nom de l'article (colonne A), puis
    // une ligne par champ : A = champ, B = ACTUEL, C = PROPOSER,
    // D = DELTA, E = statut.
    const byStrr = new Map();
    view.detailRows.forEach(function (r) {
      let arr = byStrr.get(r.strrId);
      if (!arr) { arr = []; byStrr.set(r.strrId, arr); }
      arr.push(r);
    });

    byStrr.forEach(function (rows, strrId) {
      const aoa = [['Article / Champ', 'ACTUEL', 'PROPOSER', 'DELTA', 'Statut']];
      const merges = [];

      /** Ligne-titre fusionnée sur toute la largeur. */
      function pushTitle(text) {
        merges.push({ s: { r: aoa.length, c: 0 }, e: { r: aoa.length, c: 4 } });
        aoa.push([text, null, null, null, null]);
      }

      // Les lignes arrivent triées : les articles sont contigus
      let lastKey = null;
      rows.forEach(function (r) {
        const key = (r.section || '') + '¦' + (r.op || '') + '¦' + r.label;
        if (key !== lastKey) {
          lastKey = key;
          const hasOp = r.op && r.label.toUpperCase().indexOf(r.op.toUpperCase()) >= 0;
          pushTitle(r.label + (r.op && !hasOp ? ' · ' + r.op : '') +
            (r.section ? '  —  ' + r.section : ''));
        }
        aoa.push([r.field, r.actual, r.proposed, r.delta, STATUS_FR[r.status] || r.status]);
      });

      // Bloc de totaux par champ en pied de feuille (lecture rapide)
      const totals = PRF.comparator.aggregate(rows, 'global');
      if (totals.length) {
        pushTitle('TOTAL ' + strrId);
        totals.forEach(function (g) {
          aoa.push([g.field, g.actual, g.proposed, g.delta, 'Total']);
        });
      }

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!merges'] = merges;
      ws['!cols'] = [{ wch: 42 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(wb, ws, sheetName(strrId));
    });

    const fileName = 'comparaison_STRR_' + PRF.ui.dateStamp() + '.xlsx';
    XLSX.writeFile(wb, fileName);
    PRF.errors.log('info', 'Export Excel généré en ' + Math.round(performance.now() - t0) + ' ms : ' + fileName);
    PRF.ui.toast('Export Excel généré : ' + fileName, 'success');
  }

  return { run, STATUS_FR };
})();
