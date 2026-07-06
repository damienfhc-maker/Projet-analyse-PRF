/* ============================================================
 * normalizer.js — Normalisation data-driven (CDC §2.2, §4.4, §4.5)
 *
 * Transforme les feuilles brutes (tableaux de cellules) en
 * enregistrements normalisés :
 *   { section, operation, label, order, fields: { colonne: valeur } }
 *
 * Aucune structure figée : l'en-tête, la colonne des libellés, la
 * colonne OP et les sections sont détectés dynamiquement.
 *
 * Règle d'exclusion obligatoire (CDC §4.5) : les colonnes ET les
 * lignes « % Rubrique » / « % Total » sont supprimées ICI, dès le
 * parsing — elles n'existent plus nulle part en aval.
 *
 * Module pur (aucun accès DOM).
 * ============================================================ */
"use strict";

window.PRF = window.PRF || {};

PRF.normalizer = (function () {

  /** Motif d'exclusion obligatoire (CDC §4.5). */
  const EXCLUDE_RE = /%\s*(rubrique|total)/i;

  /**
   * Identifiant de référentiel : préfixe alphabétique quelconque, un
   * séparateur (tiret, underscore ou espace), puis au moins 2 chiffres —
   * « STRR-00339 », « ABC-00042 », « strr 339 »…
   * Le séparateur et le minimum de 2 chiffres sont obligatoires pour ne
   * pas confondre avec des noms techniques (« Feuil1 », « Rev-1 »…) ;
   * le préfixe « OP » est réservé aux codes opération (§5.2).
   */
  const REF_RE = /\b([A-Z]{2,10})[\s_-]+(\d{2,8})\b/i;

  /** Code opération : « OP10 », « op 20 », « OP-30 »… */
  const OP_RE = /(?:^|[\s(])OP[\s_-]*(\d{1,4})\b/i;

  /** Nombre au format FR ou EN : « 12,5 », « 1 234.56 », « -8 ». */
  const NUM_RE = /^-?\d{1,3}(?:[  ]?\d{3})*(?:[.,]\d+)?$|^-?\d+(?:[.,]\d+)?$/;

  let seq = 0; // générateur d'identifiants de fichiers

  /**
   * Normalise un identifiant de référentiel : préfixe en majuscules,
   * tiret, chiffres complétés à 5 positions minimum.
   * « strr 339 » → « STRR-00339 », « abc-42 » → « ABC-00042 ».
   * @param {string} raw
   * @returns {string|null}
   */
  function normalizeStrrId(raw) {
    const m = REF_RE.exec(String(raw || ''));
    if (!m) return null;
    const prefix = m[1].toUpperCase();
    if (prefix === 'OP') return null; // code opération, pas un référentiel
    const digits = m[2].length >= 5 ? m[2] : m[2].padStart(5, '0');
    return prefix + '-' + digits;
  }

  /**
   * Détecte l'identifiant de référentiel dans un texte libre (nom de
   * fichier, nom de feuille, cellule d'en-tête).
   */
  function detectStrrId(text) { return normalizeStrrId(text); }

  /**
   * Détecte le type de version dans un texte libre.
   * @returns {'ACTUEL'|'PROPOSER'|null}
   */
  function detectType(text) {
    const s = String(text || '');
    if (/PROPOS/i.test(s)) return 'PROPOSER';
    if (/ACTUEL/i.test(s)) return 'ACTUEL';
    return null;
  }

  /**
   * Normalise un code OP : « op 10 » → « OP10 ».
   * @param {*} v
   * @returns {string|null}
   */
  function normalizeOp(v) {
    if (v === null || v === undefined) return null;
    const m = OP_RE.exec(String(v));
    return m ? 'OP' + m[1] : null;
  }

  /**
   * Coercition de valeur de cellule : les nombres restent des nombres,
   * les chaînes numériques (format FR inclus) deviennent des nombres,
   * les dates deviennent des ISO strings, le reste est trimé.
   * @param {*} v
   */
  function coerceValue(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'boolean') return v;
    const s = String(v).trim();
    if (s === '') return null;
    if (/^[-–—]+$/.test(s) || /^n\/?a$/i.test(s)) return null; // cellules « vides » usuelles
    if (NUM_RE.test(s)) {
      // « 1 234,56 » → 1234.56 (espaces fines et insécables incluses)
      return parseFloat(s.replace(/[  ]/g, '').replace(',', '.'));
    }
    return s;
  }

  /** Une cellule est-elle vide après coercition ? */
  function isEmpty(v) { return v === null || v === undefined || String(v).trim() === ''; }

  /**
   * Détecte la ligne d'en-tête d'une feuille : parmi les 100 premières
   * lignes, celle qui contient le plus de cellules texte distinctes
   * (au moins 2) et qui est suivie d'au moins une ligne de données.
   * Repli : première ligne contenant au moins 2 cellules non vides,
   * quel que soit leur type (en-têtes numériques, dates…).
   * @param {any[][]} rows
   * @returns {number} index de la ligne d'en-tête (-1 si introuvable)
   */
  function detectHeaderRow(rows) {
    let best = -1, bestScore = 0, fallback = -1;
    const limit = Math.min(rows.length - 1, 100);
    for (let i = 0; i <= limit; i++) {
      const row = rows[i] || [];
      const seen = new Set();
      let strScore = 0, filled = 0;
      for (let c = 0; c < row.length; c++) {
        const v = row[c];
        if (v === null || v === undefined || String(v).trim() === '') continue;
        filled++;
        if (typeof v === 'string' && !seen.has(v.trim().toLowerCase())) {
          seen.add(v.trim().toLowerCase());
          strScore++;
        }
      }
      if (i < rows.length - 1) {
        if (strScore >= 2 && strScore > bestScore) { best = i; bestScore = strScore; }
        if (fallback < 0 && filled >= 2) fallback = i;
      }
    }
    return best >= 0 ? best : fallback;
  }

  /** Nom de colonne au format Excel : 0 → A, 1 → B, 26 → AA… */
  function excelColName(c) {
    let name = '';
    c++;
    while (c > 0) {
      const r = (c - 1) % 26;
      name = String.fromCharCode(65 + r) + name;
      c = Math.floor((c - 1) / 26);
    }
    return name;
  }

  /** Cellule contenant UNIQUEMENT un code OP (« OP10 », « op 20 »…). */
  const PURE_OP_RE = /^\s*OP[\s_-]*\d{1,4}\s*$/i;

  /**
   * Statistiques de contenu par colonne sur la zone de données
   * (échantillon de 500 lignes) : nombres, textes, codes OP purs.
   * Sert à classer chaque colonne en zone de titres / colonne OP /
   * colonne de valeurs, sans aucune position figée (data-driven §2.2) —
   * structure réelle type : colonnes 1 à 7 = titres (cellules
   * fusionnées, hiérarchie), colonnes suivantes = valeurs à comparer.
   * @param {any[][]} rows
   * @param {number} headerIdx
   * @param {number} width
   * @returns {Array<{num:number, text:number, op:number}>}
   */
  function classifyColumns(rows, headerIdx, width) {
    const stats = [];
    for (let c = 0; c < width; c++) stats.push({ num: 0, text: 0, op: 0 });
    const limit = Math.min(rows.length, headerIdx + 1 + 500);
    for (let r = headerIdx + 1; r < limit; r++) {
      const row = rows[r] || [];
      for (let c = 0; c < width; c++) {
        if (isEmpty(row[c])) continue;
        const v = coerceValue(row[c]);
        if (v === null) continue;
        if (typeof v === 'number') stats[c].num++;
        else {
          stats[c].text++;
          if (PURE_OP_RE.test(String(v))) stats[c].op++;
        }
      }
    }
    return stats;
  }

  /**
   * Largeur réelle de la zone de données (certaines feuilles ont des
   * colonnes de données SANS cellule d'en-tête : elles doivent quand
   * même être détectées).
   * @param {any[][]} rows
   * @param {number} headerIdx
   */
  function dataWidth(rows, headerIdx) {
    let width = (rows[headerIdx] || []).length;
    const limit = Math.min(rows.length, headerIdx + 1 + 200);
    for (let r = headerIdx + 1; r < limit; r++) {
      const row = rows[r] || [];
      for (let c = row.length - 1; c >= width; c--) {
        if (!isEmpty(row[c])) { width = c + 1; break; }
      }
    }
    return width;
  }

  /**
   * Normalise une feuille brute en enregistrements + colonnes détectées.
   * @param {any[][]} rows  Cellules brutes (header:1)
   * @returns {{records:Array, columns:string[]}|{error:string}} objet
   *          {error} si la feuille n'est pas exploitable, avec la raison
   *          précise (diagnostic affiché à l'utilisateur, CDC §13).
   */
  function normalizeSheet(rows) {
    const headerIdx = detectHeaderRow(rows);
    if (headerIdx < 0) {
      return { error: 'aucune ligne d\'en-tête détectée dans les 100 premières lignes' };
    }

    const width = dataWidth(rows, headerIdx);
    const stats = classifyColumns(rows, headerIdx, width);

    /**
     * Nom d'une colonne : cellule d'en-tête, complétée par les deux
     * lignes au-dessus (en-têtes multi-lignes / cellules fusionnées).
     */
    function headerName(c) {
      const parts = [];
      for (let r = Math.max(0, headerIdx - 2); r <= headerIdx; r++) {
        const v = (rows[r] || [])[c];
        if (!isEmpty(v) && typeof v !== 'number') parts.push(String(v).trim());
      }
      return parts.join(' ').trim();
    }

    // --- Colonne OP : en-tête explicite, sinon contenu (codes OP purs) --
    let opCol = -1;
    for (let c = 0; c < width && opCol < 0; c++) {
      const name = headerName(c);
      if (name && /^(op|op[ée]ration|code\s*op)s?\b/i.test(name) && !/travail/i.test(name)) opCol = c;
    }
    if (opCol < 0) {
      for (let c = 0; c < width && opCol < 0; c++) {
        const s = stats[c];
        if (s.num === 0 && s.text >= 2 && s.op / s.text >= 0.5) opCol = c;
      }
    }

    // --- Colonnes de valeurs : contenu majoritairement numérique --------
    // Aucune position figée : dans la structure réelle type, ce sont les
    // colonnes 8, 9 et 10, mais c'est le CONTENU qui décide (§2.2).
    const fieldCols = []; // { index, name }
    const usedNames = new Set();
    for (let c = 0; c < width; c++) {
      if (c === opCol) continue;
      const s = stats[c];
      if (s.num === 0 || s.num < s.text) continue; // pas une colonne de valeurs
      let name = headerName(c);
      if (name && EXCLUDE_RE.test(name)) continue;  // exclusion §4.5 dès le parsing
      if (!name) name = 'Colonne ' + excelColName(c);
      let unique = name, k = 2;
      // Dédoublonnage des noms de colonnes identiques (« Coût », « Coût (2) »)
      while (usedNames.has(unique.toLowerCase())) unique = name + ' (' + (k++) + ')';
      usedNames.add(unique.toLowerCase());
      fieldCols.push({ index: c, name: unique });
    }
    if (!fieldCols.length) {
      return { error: 'aucune colonne de valeurs numériques détectée (en-tête ligne ' + (headerIdx + 1) + ')' };
    }

    // --- Zone de titres : toutes les colonnes texte restantes -----------
    // Le titre d'une ligne peut se trouver dans n'importe laquelle de ces
    // colonnes (cellules fusionnées) : sa position — la profondeur —
    // matérialise la hiérarchie des sections.
    const valueSet = new Set(fieldCols.map(function (f) { return f.index; }));
    const labelCols = [];
    for (let c = 0; c < width; c++) {
      if (c === opCol || valueSet.has(c)) continue;
      if (stats[c].text > 0) labelCols.push(c);
    }
    if (!labelCols.length && opCol < 0) {
      return { error: 'aucune colonne de libellés identifiable (en-tête ligne ' + (headerIdx + 1) + ')' };
    }

    // --- Parcours des lignes : hiérarchie par profondeur de titre -------
    const records = [];
    const sectionStack = []; // [{depth, label}] titres actifs, du plus large au plus fin
    let order = 0;

    for (let r = headerIdx + 1; r < rows.length; r++) {
      const row = rows[r] || [];

      // Titre de la ligne : première cellule texte de la zone de titres
      let label = null, depth = -1;
      for (let i = 0; i < labelCols.length; i++) {
        const v = row[labelCols[i]];
        if (isEmpty(v)) continue;
        if (typeof coerceValue(v) === 'number') continue; // les titres sont textuels
        label = String(v).trim();
        depth = i;
        break;
      }

      // Exclusion ligne « % Rubrique » / « % Total » dès le parsing (§4.5)
      if (label && EXCLUDE_RE.test(label)) continue;

      // Code OP : colonne dédiée prioritaire, sinon détection dans le titre
      const operation = (opCol >= 0 ? normalizeOp(row[opCol]) : null) || normalizeOp(label);

      const fields = {};
      let hasFieldValue = false;
      for (let i = 0; i < fieldCols.length; i++) {
        const v = coerceValue(row[fieldCols[i].index]);
        if (v !== null) { fields[fieldCols[i].name] = v; hasFieldValue = true; }
      }

      if (!label && !hasFieldValue && !operation) continue; // ligne vide

      // Ligne de titre pur (sans valeur ni OP) : entre dans la hiérarchie.
      // Un titre remplace tous les titres actifs de profondeur ≥ la sienne.
      if (label && !hasFieldValue && !operation) {
        while (sectionStack.length && sectionStack[sectionStack.length - 1].depth >= depth) {
          sectionStack.pop();
        }
        sectionStack.push({ depth: depth, label: label });
        continue;
      }

      // Ligne de données : rattachée au chemin de titres actif
      records.push({
        section: sectionStack.length
          ? sectionStack.map(function (s) { return s.label; }).join(' › ')
          : null,
        operation: operation,
        label: label || (operation || 'Ligne ' + (r + 1)),
        order: order++,
        fields: fields
      });
    }

    if (!records.length) {
      return { error: 'aucune ligne de données sous l\'en-tête (ligne ' + (headerIdx + 1) + ')' };
    }
    return { records: records, columns: fieldCols.map(function (f) { return f.name; }) };
  }

  /**
   * Cherche STRR/type dans le contenu des premières lignes d'une feuille
   * (utile quand ni le nom de fichier ni le nom de feuille ne les portent).
   * @param {any[][]} rows
   */
  function scanSheetMeta(rows) {
    let strrId = null, type = null;
    const limit = Math.min(rows.length, 15);
    for (let r = 0; r < limit && (!strrId || !type); r++) {
      const row = rows[r] || [];
      for (let c = 0; c < row.length && (!strrId || !type); c++) {
        if (typeof row[c] !== 'string') continue;
        if (!strrId) strrId = detectStrrId(row[c]);
        if (!type) type = detectType(row[c]);
      }
    }
    return { strrId: strrId, type: type };
  }

  /**
   * Normalise un fichier parsé complet (CDC §4.3–§4.5).
   * Stratégie de détection STRR/type, dans l'ordre (interprétation D9) :
   * nom de feuille → contenu de feuille → nom de fichier. Ce qui reste
   * indéterminé est résolu manuellement au dashboard.
   *
   * @param {{name:string, size:number, sheets:Array<{name:string, rows:any[][]}>}} parsed
   * @returns {{id:string, name:string, size:number, sheets:Array}}
   */
  function normalizeFile(parsed) {
    const fileStrr = detectStrrId(parsed.name);
    const fileType = detectType(parsed.name);
    const sheets = [];

    const reasons = [];

    parsed.sheets.forEach(function (rawSheet) {
      const norm = normalizeSheet(rawSheet.rows);
      if (norm.error) {
        reasons.push('feuille « ' + rawSheet.name + ' » : ' + norm.error);
        // Journal technique : aperçu des premières lignes pour diagnostic
        PRF.errors.log('warn', 'Feuille non exploitable : ' + parsed.name + ' / ' + rawSheet.name +
          ' — ' + norm.error, {
            apercu: rawSheet.rows.slice(0, 10).map(function (r) { return (r || []).slice(0, 12); })
          });
        return; // extraction des feuilles pertinentes uniquement (§4.3)
      }
      const meta = scanSheetMeta(rawSheet.rows);
      sheets.push({
        sheetName: rawSheet.name,
        strrId: detectStrrId(rawSheet.name) || meta.strrId || fileStrr,
        type: detectType(rawSheet.name) || meta.type || fileType,
        records: norm.records,
        columns: norm.columns
      });
    });

    if (!sheets.length) {
      throw new Error('Structure Excel inconnue dans « ' + parsed.name + ' » — ' +
        reasons.join(' ; ') + '. Détail technique dans la console (F12).');
    }

    return { id: 'f' + (++seq) + '-' + Date.now(), name: parsed.name, size: parsed.size, sheets: sheets };
  }

  return {
    normalizeFile, normalizeSheet, detectStrrId, detectType,
    normalizeOp, coerceValue, detectHeaderRow, EXCLUDE_RE, normalizeStrrId
  };
})();
