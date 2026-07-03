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

  /**
   * Une colonne contient-elle majoritairement du texte non numérique
   * dans la zone de données ? (sert à identifier la colonne des
   * libellés quand son en-tête est vide — cas fréquent).
   * @param {any[][]} rows
   * @param {number} headerIdx
   * @param {number} col
   */
  function isMostlyText(rows, headerIdx, col) {
    let text = 0, other = 0;
    const limit = Math.min(rows.length, headerIdx + 1 + 200);
    for (let r = headerIdx + 1; r < limit; r++) {
      const v = (rows[r] || [])[col];
      if (isEmpty(v)) continue;
      if (typeof v === 'string' && !NUM_RE.test(v.trim())) text++;
      else other++;
    }
    return text > 0 && text >= other;
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

    const header = rows[headerIdx] || [];
    const width = dataWidth(rows, headerIdx);

    // --- Cartographie des colonnes -------------------------------------
    // labelCol : colonne des libellés / désignations
    // opCol    : colonne dédiée aux codes OP si elle existe
    // fieldCols: colonnes de données, HORS exclusions §4.5
    let labelCol = -1, opCol = -1;
    const fieldCols = []; // { index, name }
    const usedNames = new Set();
    const unnamed = []; // colonnes sans en-tête mais potentiellement porteuses de données

    function addField(index, name) {
      let unique = name, k = 2;
      // Dédoublonnage des noms de colonnes identiques (« Coût », « Coût (2) »)
      while (usedNames.has(unique.toLowerCase())) unique = name + ' (' + (k++) + ')';
      usedNames.add(unique.toLowerCase());
      fieldCols.push({ index: index, name: unique });
    }

    // Passe 1 : colonnes titrées. La colonne des libellés est reconnue
    // par son intitulé, sinon la première colonne titrée fait foi.
    let firstNamed = -1;
    for (let c = 0; c < width; c++) {
      const raw = header[c];
      if (isEmpty(raw)) { unnamed.push(c); continue; }
      const name = String(raw).trim();
      if (EXCLUDE_RE.test(name)) continue;              // exclusion colonne dès parsing
      if (opCol < 0 && /^(op|op[ée]ration|code\s*op)s?\b/i.test(name) && !/travail/i.test(name)) {
        opCol = c; continue;
      }
      if (labelCol < 0 &&
        /d[ée]sign|libell|description|rubrique|intitul|d[ée]tail|poste|nom\b/i.test(name)) {
        labelCol = c; continue;
      }
      if (firstNamed < 0) { firstNamed = c; continue; } // candidat libellé par défaut
      addField(c, name);
    }

    // Passe 2 : colonnes SANS en-tête. Cas fréquents : colonne des
    // libellés non titrée, ou colonnes de valeurs sans titre.
    for (let i = 0; i < unnamed.length; i++) {
      const c = unnamed[i];
      if (labelCol < 0 && isMostlyText(rows, headerIdx, c)) { labelCol = c; continue; }
      // Colonne de données anonyme : nommée par sa lettre Excel
      let hasData = false;
      const scanLimit = Math.min(rows.length, headerIdx + 1 + 200);
      for (let r = headerIdx + 1; r < scanLimit; r++) {
        if (!isEmpty((rows[r] || [])[c])) { hasData = true; break; }
      }
      if (hasData) addField(c, 'Colonne ' + excelColName(c));
    }

    // La première colonne titrée sert de libellé si rien de mieux ;
    // sinon elle redevient une colonne de données.
    if (labelCol < 0 && firstNamed >= 0) { labelCol = firstNamed; firstNamed = -1; }
    if (firstNamed >= 0) {
      addField(firstNamed, String(header[firstNamed]).trim());
      fieldCols.sort(function (a, b) { return a.index - b.index; });
    }

    if (labelCol < 0 && opCol >= 0) { labelCol = opCol; } // feuille pilotée uniquement par OP
    if (labelCol < 0) {
      return { error: 'aucune colonne de libellés identifiable (en-tête ligne ' + (headerIdx + 1) + ')' };
    }
    if (fieldCols.length === 0) {
      return { error: 'aucune colonne de données exploitable (en-tête ligne ' + (headerIdx + 1) + ')' };
    }

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
