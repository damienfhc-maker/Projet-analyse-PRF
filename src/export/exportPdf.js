/* ============================================================
 * exportPdf.js — Export PDF
 *
 * Rapport structuré et imprimable :
 *   - page de couverture (titre, date, fichiers sources, périmètre) ;
 *   - tableaux détaillés par STRR ;
 *   - pagination automatique avec numéros de page.
 *
 * Généré 100 % localement via jsPDF + autotable vendorisés.
 * ============================================================ */
"use strict";

window.PRF = window.PRF || {};

PRF.exportPdf = (function () {

  /** Marges du document (mm). */
  const MARGIN = 14;

  /** Formate un nombre pour le PDF (format FR, 2 décimales maximum). */
  function fmt(v) {
    if (v === null || v === undefined) return '';
    if (typeof v !== 'number') return String(v);
    return PRF.ui.formatNumber(v);
  }

  /**
   * Pied de page : pagination automatique « Page X / Y » (§10.2).
   * Utilise le placeholder totalPages de jsPDF.
   */
  function addFooters(doc) {
    const total = doc.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text('Page ' + i + ' / ' + total,
        doc.internal.pageSize.getWidth() - MARGIN, doc.internal.pageSize.getHeight() - 7,
        { align: 'right' });
      doc.text('Rapport de comparaison STRR — généré localement le ' + new Date().toLocaleDateString('fr-FR'),
        MARGIN, doc.internal.pageSize.getHeight() - 7);
    }
  }

  /**
   * Applique le color coding vert/rouge à la colonne DELTA d'une table.
   */
  function colorizeDelta(data, deltaColIndex) {
    if (data.section !== 'body' || data.column.index !== deltaColIndex) return;
    const raw = data.cell.raw;
    if (raw === '' || raw === null || raw === undefined) return;
    const num = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/[  ]/g, '').replace(',', '.'));
    if (!isFinite(num)) return;
    // Heuristique : delta positif = amélioration (vert), négatif = détérioration (rouge)
    if (num > 1e-9) { data.cell.styles.textColor = [21, 128, 61]; data.cell.styles.fontStyle = 'bold'; }
    else if (num < -1e-9) { data.cell.styles.textColor = [185, 28, 28]; data.cell.styles.fontStyle = 'bold'; }
  }

  /** Lance la génération du rapport PDF. */
  function run() {
    const view = PRF.comparisonTable.getExportView();
    if (!view.detailRows.length) {
      PRF.errors.userWarn('Aucune ligne à exporter : vérifiez les filtres, suppressions et exclusions.');
      return;
    }
    const t0 = performance.now();
    const doc = new jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const st = PRF.store.state;

    // ---- Couverture -----------------------------------------------------
    doc.setFontSize(24);
    doc.setTextColor(16, 24, 39);
    doc.text('Rapport de comparaison STRR', pageW / 2, 60, { align: 'center' });
    doc.setFontSize(14);
    doc.setTextColor(80);
    doc.text('ACTUEL / PROPOSER', pageW / 2, 72, { align: 'center' });
    doc.setFontSize(11);
    doc.text('Généré le ' + new Date().toLocaleString('fr-FR'), pageW / 2, 86, { align: 'center' });

    const strrIds = Array.from(new Set(view.detailRows.map(function (r) { return r.strrId; })));
    const covLines = [
      'Fichiers sources : ' + (st.files.map(function (f) { return f.name; }).join(', ') || '—'),
      'STRR inclus : ' + strrIds.join(', '),
      'Lignes de comparaison exportées : ' + view.detailRows.length
    ];
    doc.setFontSize(10);
    doc.setTextColor(60);
    let y = 110;
    covLines.forEach(function (line) {
      const wrapped = doc.splitTextToSize(line, pageW - 2 * MARGIN - 20);
      doc.text(wrapped, MARGIN + 10, y);
      y += wrapped.length * 5 + 3;
    });

    // ---- Détail par STRR ------------------------------------------------
    const byStrr = new Map();
    view.detailRows.forEach(function (r) {
      let arr = byStrr.get(r.strrId);
      if (!arr) { arr = []; byStrr.set(r.strrId, arr); }
      arr.push(r);
    });

    byStrr.forEach(function (rows, strrId) {
      doc.addPage();
      doc.setFontSize(15);
      doc.setTextColor(16, 24, 39);
      doc.text('Détail ' + strrId, MARGIN, 18);
      doc.setFontSize(9);
      doc.setTextColor(110);
      doc.text(rows.length + ' ligne(s) de comparaison', MARGIN, 24);

      const body = rows.map(function (r) {
        return [
          r.label || '',
          fmt(r.actual),
          fmt(r.proposed),
          fmt(r.delta),
          PRF.exportXlsx.STATUS_FR[r.status] || r.status || ''
        ];
      });

      doc.autoTable({
        startY: 28,
        margin: { left: MARGIN, right: MARGIN },
        head: [['Indication', 'ACTUEL', 'PROPOSER', 'DELTA', 'Statut']],
        body: body,
        styles: { fontSize: 8, cellPadding: 1.4, overflow: 'ellipsize' },
        headStyles: { fillColor: [37, 99, 235] },
        columnStyles: {
          1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }
        },
        didParseCell: function (data) {
          colorizeDelta(data, 3);
        }
      });
    });

    addFooters(doc);
    const fileName = 'rapport_comparaison_' + PRF.ui.dateStamp() + '.pdf';
    doc.save(fileName);
    PRF.errors.log('info', 'Export PDF généré en ' + Math.round(performance.now() - t0) + ' ms : ' + fileName);
    PRF.ui.toast('Rapport PDF généré : ' + fileName, 'success');
  }

  return { run };
})();
