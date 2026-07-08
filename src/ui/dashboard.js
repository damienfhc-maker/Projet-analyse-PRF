/* ============================================================
 * dashboard.js — Dashboard principal (CDC §8.1)
 *
 * - Import des fichiers : drag & drop + sélection multiple, avec
 *   validation immédiate (§4.2) ; chaque fichier n'est lu qu'une
 *   seule fois (PRF.parser) puis indexé en mémoire.
 * - Liste des fichiers importés avec résolution manuelle des
 *   STRR / types non détectés (mismatch, CDC §13).
 * - Liste des STRR détectés avec statut ACTUEL / PROPOSER et
 *   inclusion/exclusion par STRR (§9.2).
 * - Bouton « Comparer » actif dès qu'une paire complète existe.
 * ============================================================ */
"use strict";

window.PRF = window.PRF || {};

PRF.dashboard = (function () {

  let els = null; // cache des éléments DOM

  /** Feuilles dont l'utilisateur a demandé la modification manuelle
   *  (divulgation progressive : réglages masqués quand tout est détecté). */
  const editingSheets = new Set();

  function init() {
    els = {
      dropzone: document.getElementById('dropzone'),
      fileInput: document.getElementById('file-input'),
      browse: document.getElementById('btn-browse'),
      progress: document.getElementById('import-progress'),
      fileList: document.getElementById('file-list'),
      strrList: document.getElementById('strr-list'),
      compare: document.getElementById('btn-compare')
    };

    // --- Drag & drop (§4.2) --------------------------------------------
    ['dragenter', 'dragover'].forEach(function (evt) {
      els.dropzone.addEventListener(evt, function (e) {
        e.preventDefault();
        els.dropzone.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach(function (evt) {
      els.dropzone.addEventListener(evt, function (e) {
        e.preventDefault();
        els.dropzone.classList.remove('dragover');
      });
    });
    els.dropzone.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files.length) importFiles(e.dataTransfer.files);
    });

    // --- Sélection multiple ----------------------------------------------
    els.browse.addEventListener('click', function (e) { e.stopPropagation(); els.fileInput.click(); });
    els.dropzone.addEventListener('click', function () { els.fileInput.click(); });
    els.dropzone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.fileInput.click(); }
    });
    els.fileInput.addEventListener('change', function () {
      if (els.fileInput.files.length) importFiles(els.fileInput.files);
      els.fileInput.value = ''; // permet de réimporter le même fichier
    });

    els.compare.addEventListener('click', function () {
      const result = PRF.comparator.compareAll();
      if (!result.rows.length) {
        PRF.errors.userError('Aucune ligne de comparaison produite. Vérifiez les fichiers importés.');
        return;
      }
      PRF.usage.record('compare');
      PRF.usage.setLastRun({ fuzzy: !!PRF.store.state.userConfig.fuzzyMatching });
      PRF.history.clear();
      PRF.store.emit('comparison:done');
      PRF.app.showView('table');
    });

    PRF.store.on('datasets:changed', render);
    render();
  }

  /**
   * Importe une liste de fichiers : validation → lecture UNIQUE →
   * parsing → normalisation → indexation mémoire. Les erreurs d'un
   * fichier n'interrompent pas les autres (§13).
   * @param {FileList|File[]} fileList
   */
  async function importFiles(fileList) {
    const files = Array.from(fileList);
    els.progress.hidden = false;
    let imported = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      els.progress.textContent = 'Import ' + (i + 1) + ' / ' + files.length + ' : ' + file.name + '…';
      try {
        const parsed = await PRF.parser.parseFile(file);      // lecture unique
        const normalized = PRF.normalizer.normalizeFile(parsed); // exclusions §4.5 appliquées ici
        PRF.store.state.files.push(normalized);
        imported++;
      } catch (e) {
        PRF.errors.userError(e.message, e);
      }
    }

    els.progress.hidden = true;
    if (imported) {
      PRF.store.rebuildDatasets();
      PRF.ui.toast(imported + ' fichier(s) importé(s) — prêt pour la comparaison.', 'success');
    }
  }

  /** Retire un fichier importé (et réindexe). */
  function removeFile(fileId) {
    const st = PRF.store.state;
    const idx = st.files.findIndex(function (f) { return f.id === fileId; });
    if (idx < 0) return;
    st.files.splice(idx, 1);
    PRF.store.rebuildDatasets();
  }

  /** Ré-affecte manuellement STRR ou type d'une feuille (mismatch §13). */
  function reassignSheet(fileId, sheetIdx, prop, value) {
    const file = PRF.store.state.files.find(function (f) { return f.id === fileId; });
    if (!file || !file.sheets[sheetIdx]) return;
    if (prop === 'strrId') {
      const norm = PRF.normalizer.normalizeStrrId(value);
      if (!norm) {
        PRF.errors.userWarn('Identifiant de référentiel invalide : « ' + value +
          ' ». Format attendu : lettres + chiffres (ex. STRR-00339, ABC-00042).');
        render();
        return;
      }
      file.sheets[sheetIdx].strrId = norm;
    } else {
      file.sheets[sheetIdx].type = value || null;
    }
    PRF.store.rebuildDatasets();
  }

  // ---------- Rendu -------------------------------------------------------

  function render() {
    renderFiles();
    renderStrrList();
  }

  function renderFiles() {
    const st = PRF.store.state;
    const esc = PRF.ui.escapeHtml;
    if (!st.files.length) {
      els.fileList.className = 'file-list empty';
      els.fileList.textContent = 'Aucun fichier importé.';
      return;
    }
    els.fileList.className = 'file-list';
    els.fileList.innerHTML = st.files.map(function (file) {
      const sheetsHtml = file.sheets.map(function (sheet, si) {
        const strrOk = !!sheet.strrId;
        const typeOk = !!sheet.type;
        const editKey = file.id + '¦' + si;
        const editing = editingSheets.has(editKey) || !strrOk || !typeOk;

        // Divulgation progressive : quand tout est bien détecté, la
        // carte reste simple (badges) ; les réglages n'apparaissent que
        // si la détection a échoué ou sur clic « modifier ».
        const summary = '<strong>' + esc(sheet.strrId || '?') + '</strong> ' +
          '<span class="badge badge-ok">' + esc(sheet.type || '?') + '</span> ' +
          '<button class="linklike" data-editsheet="' + editKey +
            '" title="Corriger le référentiel ou la version détectés">modifier</button>';

        const controls =
          'Référentiel : ' +
          '<input type="text" placeholder="ex : STRR-00339, ABC-00042" value="' + esc(sheet.strrId || '') +
            '" data-file="' + file.id + '" data-sheet="' + si + '" data-prop="strrId"' +
            ' title="Identifiant du référentiel : des lettres, un tiret, des chiffres"> ' +
          '<select data-file="' + file.id + '" data-sheet="' + si + '" data-prop="type"' +
            ' title="Ce fichier est-il la version actuelle ou la version proposée ?"' +
            (typeOk ? '' : ' class="badge-warn"') + '>' +
            '<option value=""' + (!sheet.type ? ' selected' : '') + '>— version ? —</option>' +
            '<option value="ACTUEL"' + (sheet.type === 'ACTUEL' ? ' selected' : '') + '>ACTUEL</option>' +
            '<option value="PROPOSER"' + (sheet.type === 'PROPOSER' ? ' selected' : '') + '>PROPOSER</option>' +
          '</select>' +
          (strrOk && typeOk ? '' : ' <span class="badge badge-warn">à compléter</span>');

        return '<div class="fmeta">📄 ' + esc(sheet.sheetName) + ' — ' +
          sheet.records.length + ' ligne(s) — ' +
          (editing ? controls : summary);
      }).join('');
      return '<div class="file-card">' +
        '<span class="fname">🗂 ' + esc(file.name) + '</span>' +
        '<span class="fmeta">' + PRF.ui.formatBytes(file.size) + '</span>' +
        '<div style="flex-basis:100%">' + sheetsHtml + '</div>' +
        '<span class="spacer"></span>' +
        '<button class="btn btn-ghost btn-danger" data-remove="' + file.id + '">Retirer</button>' +
        '</div>';
    }).join('');

    // Délégation d'événements sur la liste (pas de handler par carte)
    els.fileList.querySelectorAll('[data-remove]').forEach(function (btn) {
      btn.addEventListener('click', function () { removeFile(btn.dataset.remove); });
    });
    els.fileList.querySelectorAll('select[data-prop], input[data-prop]').forEach(function (ctl) {
      ctl.addEventListener('change', function () {
        reassignSheet(ctl.dataset.file, Number(ctl.dataset.sheet), ctl.dataset.prop, ctl.value);
      });
    });
    els.fileList.querySelectorAll('[data-editsheet]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        editingSheets.add(btn.dataset.editsheet);
        renderFiles();
      });
    });
  }

  function renderStrrList() {
    const st = PRF.store.state;
    const esc = PRF.ui.escapeHtml;

    if (!st.datasets.size) {
      els.strrList.className = 'strr-list empty';
      els.strrList.textContent = 'Importez des fichiers pour détecter les référentiels (STRR-00339, ABC-00042…).';
      els.compare.disabled = true;
      document.getElementById('btn-quick-run').hidden = true;
      PRF.app.updateNav();
      return;
    }

    els.strrList.className = 'strr-list';
    let completeCount = 0;
    const cards = [];

    // Ordre stable : tri alphabétique des STRR
    Array.from(st.datasets.keys()).sort().forEach(function (strrId) {
      const ds = st.datasets.get(strrId);
      const complete = !!(ds.ACTUEL && ds.PROPOSER);
      if (complete) completeCount++;
      function sideBadge(side) {
        const d = ds[side];
        return d
          ? '<span class="badge badge-ok" title="' + esc(d.fileName) + ' / ' + esc(d.sheetName) + '">' +
            side + ' ✔ (' + d.records.length + ' l.)</span>'
          : '<span class="badge badge-missing">' + side + ' manquant</span>';
      }
      cards.push('<div class="strr-card' + (ds.included ? '' : ' excluded') + '">' +
        '<span class="strr-id">' + esc(strrId) + '</span>' +
        sideBadge('ACTUEL') + sideBadge('PROPOSER') +
        (complete ? '' : '<span class="badge badge-warn" title="Il manque une des deux versions : importez le fichier manquant, ou corrigez la version détectée via « modifier » ci-dessus.">⚠ incomplet</span>') +
        '<span class="spacer"></span>' +
        '<label class="chk"><input type="checkbox" data-include="' + esc(strrId) + '"' +
          (ds.included ? ' checked' : '') + '> inclure</label>' +
        '</div>');
    });
    els.strrList.innerHTML = cards.join('');

    els.strrList.querySelectorAll('[data-include]').forEach(function (chk) {
      chk.addEventListener('change', function () {
        const ds = st.datasets.get(chk.dataset.include);
        if (ds) { ds.included = chk.checked; renderStrrList(); PRF.store.emit('rows:changed'); }
      });
    });

    els.compare.disabled = completeCount === 0;
    // Macro ⚡ : proposée dès qu'une analyse précédente est mémorisée
    // et qu'une paire complète est prête (automatisation locale)
    const quick = document.getElementById('btn-quick-run');
    quick.hidden = !(completeCount > 0 && PRF.usage.getLastRun());
    PRF.app.updateNav();
  }

  return { init, importFiles };
})();
