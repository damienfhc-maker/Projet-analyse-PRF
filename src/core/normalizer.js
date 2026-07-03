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

  /** Identifiant STRR : « STRR-00339 », « strr 339 »… */
  const STRR_RE = /STRR[\s_-]*(\d{1,6})/i;

  /** Code opération : « OP10 », « op 20 », « OP-30 »… */
  const OP_RE = /(?:^|[\s(])OP[\s_-]*(\d{1,4})\b/i;

  /** Nombre au format FR ou EN : « 12,5 », « 1 234.56 », « -8 ». */
  const NUM_RE = /^-?\d{1,3}(?:[  ]?\d{3})*(?:[.,]\d+)?$|^-?\d+(?:[.,]\d+)?$/;

  let seq = 0; // générateur d'identifiants de fichiers

  /**
   * Normalise un identifiant STRR sur 5 chiffres : « STRR-00339 ».
   * @param {string} raw
   * @returns {string|null}
   */
  function normalizeStrrId(raw) {
    const m = STRR_RE.exec(String(raw || ''));
    if (!m) return null;
    return 'STRR-' + m[1].padStart(5, '0');
  }

  /**
   * Détecte l'identifiant STRR dans un texte libre (nom de fichier,
   * nom de feuille, cellule d'en-tête).
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
    if (NUM_RE.test(s)) {
      // « 1 234,56 » → 1234.56 (espaces fines et insécables incluses)
      return parseFloat(s.replace(/[  ]/g, '').replace(',', '.'));
    }
    return s;
  }

  /** Une cellule est-elle vide après coercition ? */
  function isEmpty(v) { return v === null || v === undefined || String(v).trim() === ''; }

  /**
   * Détecte la ligne d'en-tête d'une feuille : parmi les 30 premières
   * lignes, celle qui contient le plus de cellules texte distinctes
   * (au moins 2) et qui est suivie d'au moins une ligne de données.
   * @param {any[][]} rows
   * @returns {number} index de la ligne d'en-tête (-1 si introuvable)
   */
  function detectHeaderRow(rows) {
    let best = -1, bestScore = 0;
    const limit = Math.min(rows.length - 1, 30);
    for (let i = 0; i <= limit; i++) {
      const row = rows[i] || [];
      const seen = new Set();
      let score = 0;
      for (let c = 0; c < row.length; c++) {
        const v = row[c];
        if (typeof v === 'string' && v.trim() !== '' && !seen.has(v.trim().toLowerCase())) {
          seen.add(v.trim().toLowerCase());
          score++;
        }
      }
      if (score >= 2 && score > bestScore && i < rows.length - 1) {
        best = i; bestScore = score;
      }
    }
    return best;
  }

  /**
   * Normalise une feuille brute en enregistrements + colonnes détectées.
   * @param {any[][]} rows  Cellules brutes (header:1)
   * @returns {{records:Array, columns:string[]}|null} null si la feuille
   *          ne contient aucune donnée exploitable (feuille non pertinente).
   */
  function normalizeSheet(rows) {
    const headerIdx = detectHeaderRow(rows);
    if (headerIdx < 0) return null;

    const header = rows[headerIdx];

    // --- Cartographie des colonnes -------------------------------------
    // labelCol : première colonne texte (libellés / désignations)
    // opCol    : colonne dédiée aux codes OP si elle existe
    // fieldCols: colonnes de données, HORS exclusions §4.5
    let labelCol = -1, opCol = -1;
    const fieldCols = []; // { index, name }
    const usedNames = new Set();

    for (let c = 0; c < header.length; c++) {
      const raw = header[c];
      if (isEmpty(raw)) continue;
      const name = String(raw).trim();
      if (EXCLUDE_RE.test(name)) continue;              // exclusion colonne dès parsing
      if (opCol < 0 && /^(op|op[ée]ration|code\s*op)s?\b/i.test(name) && !/travail/i.test(name)) {
        opCol = c; continue;
      }
      if (labelCol < 0) { labelCol = c; continue; }     // 1re colonne conservée = libellés
      // Dédoublonnage des noms de colonnes identiques (« Coût », « Coût (2) »)
      let unique = name, k = 2;
      while (usedNames.has(unique.toLowerCase())) unique = name + ' (' + (k++) + ')';
      usedNames.add(unique.toLowerCase());
      fieldCols.push({ index: c, name: unique });
    }
    if (labelCol < 0 || fieldCols.length === 0) return null;

    // --- Parcours des lignes de données --------------------------------
    const records = [];
    let currentSection = null;
    let order = 0;

    for (let r = headerIdx + 1; r < rows.length; r++) {
      const row = rows[r] || [];

      const rawLabel = row[labelCol];
      const label = isEmpty(rawLabel) ? null : String(rawLabel).trim();

      // Exclusion ligne « % Rubrique » / « % Total » dès le parsing (§4.5)
      if (label && EXCLUDE_RE.test(label)) continue;

      // Valeurs de champs (colonnes exclues déjà hors périmètre)
      const fields = {};
      let hasFieldValue = false;
      for (let i = 0; i < fieldCols.length; i++) {
        const v = coerceValue(row[fieldCols[i].index]);
        if (v !== null) { fields[fieldCols[i].name] = v; hasFieldValue = true; }
      }

      // Code OP : colonne dédiée prioritaire, sinon détection dans le libellé
      const operation = (opCol >= 0 ? normalizeOp(row[opCol]) : null) || normalizeOp(label);

      if (!label && !hasFieldValue && !operation) continue; // ligne vide

      // Ligne de titre de section : libellé seul, sans valeur ni OP
      if (label && !hasFieldValue && !operation) {
        currentSection = label;
        continue;
      }

      records.push({
        section: currentSection,
        operation: operation,
        label: label || (operation || 'Ligne ' + (r + 1)),
        order: order++,
        fields: fields
      });
    }

    return records.length ? { records: records, columns: fieldCols.map(function (f) { return f.name; }) } : null;
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

    parsed.sheets.forEach(function (rawSheet) {
      const norm = normalizeSheet(rawSheet.rows);
      if (!norm) {
        PRF.errors.log('info', 'Feuille ignorée (aucune donnée exploitable) : ' +
          parsed.name + ' / ' + rawSheet.name);
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
      throw new Error('Structure Excel inconnue : aucune feuille exploitable dans « ' + parsed.name + ' ». ' +
        'Vérifiez que le fichier contient une ligne d\'en-tête et des lignes de données.');
    }

    return { id: 'f' + (++seq) + '-' + Date.now(), name: parsed.name, size: parsed.size, sheets: sheets };
  }

  return {
    normalizeFile, normalizeSheet, detectStrrId, detectType,
    normalizeOp, coerceValue, detectHeaderRow, EXCLUDE_RE, normalizeStrrId
  };
})();
