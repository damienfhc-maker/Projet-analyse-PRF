/* ============================================================
 * normalizer.js — Normalisation simplifiée (colonnes A-G labels + H valeur)
 *
 * Transforme les feuilles brutes (tableaux de cellules) en
 * enregistrements normalisés :
 *   { label, value, order }
 *
 * Modèle simplifié :
 * - Colonnes A-G (indices 0-6) : labels, concaténés avec séparateur
 * - Colonne H (indice 7) : la seule valeur à comparer
 * - Colonnes I-J et au-delà : ignorées
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


  /**
   * Normalise une feuille brute en enregistrements hiérarchiques.
   * Hiérarchie : colonnes A-G (0-6) = niveaux de profondeur, colonne H (7) = valeur.
   * Chaque ligne détecte son niveau (première colonne remplie) et son parent.
   * @param {any[][]} rows  Cellules brutes
   * @returns {{records:Array}|{error:string}}
   */
  function normalizeSheet(rows) {
    const headerIdx = detectHeaderRow(rows);
    if (headerIdx < 0) {
      return { error: 'aucune ligne d\'en-tête détectée dans les 100 premières lignes' };
    }

    const records = [];
    let order = 0;
    const hierarchyStack = []; // pile des groupes ouverts à chaque niveau

    for (let r = headerIdx + 1; r < rows.length; r++) {
      const row = rows[r] || [];

      // Déterminer le niveau de profondeur (première colonne A-G remplie)
      let level = 0;
      let label = null;
      for (let c = 0; c < 7; c++) {
        const v = row[c];
        if (!isEmpty(v)) {
          const coerced = coerceValue(v);
          if (typeof coerced === 'string') {
            level = c + 1; // niveau 1-7 (colonne A-G)
            label = coerced;
            break;
          }
        }
      }

      // Colonne H (indice 7) : la seule valeur à comparer
      const value = coerceValue(row[7]);

      // Ignorer les lignes vides (pas de label ET pas de valeur)
      if (!label && value === null) continue;

      // Construire le chemin hiérarchique (parent path)
      // Nettoyer la pile : supprimer les niveaux >= au niveau courant
      while (hierarchyStack.length >= level) {
        hierarchyStack.pop();
      }
      hierarchyStack[level - 1] = label;

      // Créer le record avec propriétés hiérarchiques
      records.push({
        label: label || 'Ligne ' + (r + 1),
        value: value,
        level: level,
        parentPath: hierarchyStack.slice(0, level - 1).join(' › ') || null,
        order: order++,
        collapsed: false // pour l'UI
      });
    }

    if (!records.length) {
      return { error: 'aucune ligne de données sous l\'en-tête (ligne ' + (headerIdx + 1) + ')' };
    }

    return { records: records };
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
        records: norm.records
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
