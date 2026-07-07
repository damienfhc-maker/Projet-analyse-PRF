/* ============================================================
 * fieldSelector.js — Écran de sélection des champs (CDC §7, §8.2)
 *
 * - Colonnes détectées dynamiquement, présentées par groupes
 *   filtrables avec case à cocher par champ (§7.1).
 * - Sens de l'amélioration réglable par champ (⬇ mieux / ⬆ mieux),
 *   utilisé par le color coding et les exports.
 * - Profils de comparaison sauvegardés localement (§7.2).
 * - Prévisualisation live des premières lignes de comparaison (§8.2).
 * ============================================================ */
"use strict";

window.PRF = window.PRF || {};

PRF.fieldSelector = (function () {

  const PREVIEW_LIMIT = 50;
  let els = null;
  let filterText = '';
  let advancedOpen = false; // options avancées repliées par défaut (divulgation progressive)

  function init() {
    els = {
      groups: document.getElementById('field-groups'),
      filter: document.getElementById('field-filter'),
      fuzzy: document.getElementById('chk-fuzzy'),
      all: document.getElementById('btn-fields-all'),
      none: document.getElementById('btn-fields-none'),
      preview: document.getElementById('field-preview'),
      advancedBtn: document.getElementById('btn-advanced'),
      advancedPanel: document.getElementById('advanced-panel'),
      profileSelect: document.getElementById('profile-select'),
      profileLoad: document.getElementById('btn-profile-load'),
      profileSave: document.getElementById('btn-profile-save'),
      profileDelete: document.getElementById('btn-profile-delete'),
      back: document.getElementById('btn-back-dashboard'),
      run: document.getElementById('btn-run-compare')
    };

    // Divulgation progressive : le panneau avancé (profils, tolérance
    // d'orthographe, sens d'amélioration) ne s'ouvre qu'à la demande —
    // l'état est retenu pour les utilisateurs qui s'en servent souvent.
    advancedOpen = PRF.usage.getPref('fields.advanced', false);
    applyAdvancedVisibility();
    els.advancedBtn.addEventListener('click', function () {
      advancedOpen = !advancedOpen;
      PRF.usage.setPref('fields.advanced', advancedOpen);
      applyAdvancedVisibility();
      renderGroups(); // les boutons de sens d'amélioration suivent le mode
    });

    els.filter.addEventListener('input', PRF.ui.debounce(function () {
      filterText = els.filter.value.trim().toLowerCase();
      renderGroups();
    }, 150));

    els.fuzzy.addEventListener('change', function () {
      PRF.store.state.userConfig.fuzzyMatching = els.fuzzy.checked;
      schedulePreview();
    });

    els.all.addEventListener('click', function () { setAll(true); });
    els.none.addEventListener('click', function () { setAll(false); });

    // --- Profils (§7.2) ---------------------------------------------------
    els.profileSave.addEventListener('click', async function () {
      const name = await PRF.ui.prompt('Enregistrer le profil de comparaison',
        'ex : Analyse coût, Analyse marge…');
      if (!name) return;
      PRF.fieldRegistry.saveProfile(name);
      renderProfiles(name);
      PRF.ui.toast('Profil « ' + name + ' » enregistré.', 'success');
    });
    els.profileLoad.addEventListener('click', function () {
      const name = els.profileSelect.value;
      if (!name) return;
      if (PRF.fieldRegistry.loadProfile(name)) {
        PRF.usage.record('profile:' + name); // le profil favori remonte en tête de liste
        render();
        PRF.ui.toast('Profil « ' + name + ' » appliqué.', 'success');
      }
    });
    els.profileDelete.addEventListener('click', async function () {
      const name = els.profileSelect.value;
      if (!name) return;
      if (await PRF.ui.confirm('Supprimer le profil', 'Supprimer définitivement « ' + name + ' » ?')) {
        PRF.fieldRegistry.deleteProfile(name);
        renderProfiles();
      }
    });

    els.back.addEventListener('click', function () { PRF.app.showView('dashboard'); });
    els.run.addEventListener('click', runComparison);

    PRF.store.on('fields:changed', render);
    render();
  }

  /** Affiche ou replie le panneau d'options avancées. */
  function applyAdvancedVisibility() {
    els.advancedPanel.hidden = !advancedOpen;
    els.advancedBtn.classList.toggle('btn-primary', advancedOpen);
  }

  /** Coche/décoche tous les champs visibles. */
  function setAll(checked) {
    const fc = PRF.store.state.fieldConfig;
    PRF.store.state.columns.forEach(function (col) {
      if (checked) fc.selected.add(col); else fc.selected.delete(col);
    });
    render();
  }

  // ---------- Rendu ---------------------------------------------------------

  function render() {
    if (!els) return;
    els.fuzzy.checked = PRF.store.state.userConfig.fuzzyMatching;
    renderGroups();
    renderProfiles(els.profileSelect.value);
    schedulePreview();
  }

  function renderGroups() {
    const fc = PRF.store.state.fieldConfig;
    const esc = PRF.ui.escapeHtml;
    const groupNames = Object.keys(fc.groups);

    if (!groupNames.length) {
      els.groups.innerHTML = '<p class="hint">Aucune colonne détectée : importez d\'abord des fichiers.</p>';
      return;
    }

    els.groups.innerHTML = groupNames.map(function (gName) {
      const cols = fc.groups[gName].filter(function (col) {
        return !filterText ||
          col.toLowerCase().indexOf(filterText) >= 0 ||
          gName.toLowerCase().indexOf(filterText) >= 0;
      });
      if (!cols.length) return '';
      const checkedCount = cols.filter(function (c) { return fc.selected.has(c); }).length;
      return '<div class="field-group">' +
        '<h3><label class="chk"><input type="checkbox" data-group="' + esc(gName) + '"' +
          (checkedCount === cols.length ? ' checked' : '') + '> ' + esc(gName) + '</label>' +
        '<span class="grp-count">' + checkedCount + '/' + cols.length + '</span></h3>' +
        cols.map(function (col) {
          const dir = fc.directions[col] || 'lower';
          // Le réglage du sens d'amélioration est une option avancée :
          // il n'apparaît que si le panneau avancé est ouvert.
          const dirBtn = advancedOpen
            ? '<button class="dir-toggle" data-dir="' + esc(col) + '" ' +
              'title="Cliquez pour inverser : indique si une hausse ou une baisse de « ' + esc(col) +
              ' » est une bonne nouvelle (colorée en vert)">' +
              (dir === 'lower' ? '⬇ = mieux' : '⬆ = mieux') + '</button>'
            : '';
          return '<div class="field-row">' +
            '<label class="chk"><input type="checkbox" data-field="' + esc(col) + '"' +
              (fc.selected.has(col) ? ' checked' : '') + '> ' + esc(col) + '</label>' +
            dirBtn +
            '</div>';
        }).join('') +
        '</div>';
    }).join('');

    // Cases champ
    els.groups.querySelectorAll('[data-field]').forEach(function (chk) {
      chk.addEventListener('change', function () {
        const fc2 = PRF.store.state.fieldConfig;
        if (chk.checked) fc2.selected.add(chk.dataset.field);
        else fc2.selected.delete(chk.dataset.field);
        renderGroups();
        schedulePreview();
      });
    });
    // Cases groupe (coche/décoche tout le groupe)
    els.groups.querySelectorAll('[data-group]').forEach(function (chk) {
      chk.addEventListener('change', function () {
        const fc2 = PRF.store.state.fieldConfig;
        fc2.groups[chk.dataset.group].forEach(function (col) {
          if (chk.checked) fc2.selected.add(col); else fc2.selected.delete(col);
        });
        renderGroups();
        schedulePreview();
      });
    });
    // Inversion du sens d'amélioration
    els.groups.querySelectorAll('[data-dir]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const dirs = PRF.store.state.fieldConfig.directions;
        const col = btn.dataset.dir;
        dirs[col] = dirs[col] === 'lower' ? 'higher' : 'lower';
        renderGroups();
        schedulePreview();
      });
    });
  }

  function renderProfiles(selectName) {
    // Personnalisation : les profils les plus utilisés en tête de liste
    const names = PRF.usage.sortByUsage(PRF.fieldRegistry.listProfiles(), 'profile:');
    els.profileSelect.innerHTML =
      '<option value="">— profil —</option>' +
      names.map(function (n) {
        return '<option' + (n === selectName ? ' selected' : '') + '>' + PRF.ui.escapeHtml(n) + '</option>';
      }).join('');
  }

  // ---------- Prévisualisation live (§8.2) -----------------------------------

  const schedulePreview = PRF.ui.debounce(renderPreview, 200);

  /**
   * Calcule un aperçu limité aux PREVIEW_LIMIT premières lignes du
   * premier STRR complet et inclus — sans recalculer la comparaison
   * globale (performance).
   */
  function renderPreview() {
    const st = PRF.store.state;
    const esc = PRF.ui.escapeHtml;
    const fmt = PRF.ui.formatNumber;

    let target = null, targetId = null;
    st.datasets.forEach(function (ds, strrId) {
      if (!target && ds.included && ds.ACTUEL && ds.PROPOSER) { target = ds; targetId = strrId; }
    });
    if (!target) {
      els.preview.innerHTML = '<p class="hint" style="padding:10px">Aucun STRR complet à prévisualiser.</p>';
      return;
    }
    if (!st.fieldConfig.selected.size) {
      els.preview.innerHTML = '<p class="hint" style="padding:10px">Cochez au moins un champ pour prévisualiser.</p>';
      return;
    }

    const pairs = PRF.matcher.matchRecords(target.ACTUEL.records, target.PROPOSER.records,
      { fuzzy: st.userConfig.fuzzyMatching });
    const rows = [];
    outer:
    for (let i = 0; i < pairs.length; i++) {
      for (const field of st.fieldConfig.selected) {
        const row = PRF.comparator.compareField(targetId, pairs[i], field);
        if (row) {
          rows.push(row);
          if (rows.length >= PREVIEW_LIMIT) break outer;
        }
      }
    }

    els.preview.innerHTML = '<table><thead><tr>' +
      '<th>STRR</th><th>Section</th><th>OP</th><th>Champ</th>' +
      '<th>ACTUEL</th><th>PROPOSER</th><th>DELTA</th><th>Statut</th>' +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        const better = PRF.fieldRegistry.isImprovement(r.field, r.delta);
        const cls = better === true ? 'delta-good' : (better === false ? 'delta-bad' : 'delta-zero');
        return '<tr><td>' + esc(r.strrId) + '</td><td>' + esc(r.section || '') + '</td>' +
          '<td>' + esc(r.op || '') + '</td><td>' + esc(r.field) + '</td>' +
          '<td>' + esc(fmt(r.actual)) + '</td><td>' + esc(fmt(r.proposed)) + '</td>' +
          '<td class="' + cls + '">' + esc(fmt(r.delta)) + '</td>' +
          '<td>' + esc(PRF.exportXlsx.STATUS_FR[r.status] || r.status) + '</td></tr>';
      }).join('') +
      '</tbody></table>';
  }

  // ---------- Lancement de la comparaison -------------------------------------

  function runComparison() {
    const st = PRF.store.state;
    if (!st.fieldConfig.selected.size) {
      PRF.errors.userWarn('Sélectionnez au moins un champ à comparer.');
      return;
    }
    const result = PRF.comparator.compareAll();
    result.missing.forEach(function (m) {
      PRF.errors.userWarn('Référentiel ' + m.strrId + ' ignoré : il manque sa version ' + m.missing + '.');
    });
    if (!result.rows.length) {
      PRF.errors.userError('Aucune ligne de comparaison produite. Vérifiez les fichiers importés et les champs sélectionnés.');
      return;
    }
    // Macro « dernière analyse » : la configuration est mémorisée pour
    // pouvoir être relancée en un clic depuis le dashboard (⚡)
    PRF.usage.setLastRun({
      selected: Array.from(st.fieldConfig.selected),
      directions: Object.assign({}, st.fieldConfig.directions),
      fuzzy: st.userConfig.fuzzyMatching
    });
    PRF.usage.record('compare');
    PRF.history.clear();
    PRF.store.emit('comparison:done');
    PRF.app.showView('table');
  }

  return { init };
})();
