/* ============================================================
 * parser.js — Lecture des fichiers Excel/CSV (CDC §4.1–§4.3, §11.2, §14)
 *
 * Garanties :
 *   - LECTURE UNIQUE : chaque fichier est lu une seule fois via
 *     FileReader ; seul le résultat parsé (tableaux JS) est conservé,
 *     l'objet File n'est jamais relu ensuite.
 *   - Validation stricte avant parsing : extension + signature binaire
 *     (sandbox file reader, CDC §14).
 *   - Aucun accès réseau : SheetJS vendorisé, traitement 100 % local.
 *
 * Module pur (aucun accès DOM) — testable dans tests/tests.html.
 * ============================================================ */
"use strict";

window.PRF = window.PRF || {};

PRF.parser = (function () {

  /** Extensions autorisées (CDC §4.1 + CSV exigé par les consignes). */
  const ALLOWED_EXT = /\.(xlsx|xls|xlsm|csv)$/i;

  /** Taille maximale acceptée (garde-fou mémoire : 200 Mo). */
  const MAX_SIZE = 200 * 1024 * 1024;

  /**
   * Valide un fichier avant toute lecture (validation immédiate, CDC §4.2).
   * @param {File} file
   * @returns {{ok:boolean, reason?:string}}
   */
  function validateFile(file) {
    if (!ALLOWED_EXT.test(file.name)) {
      return { ok: false, reason: 'Format non supporté : « ' + file.name + ' ». Formats acceptés : .xls, .xlsx, .xlsm, .csv.' };
    }
    if (file.size === 0) return { ok: false, reason: 'Le fichier « ' + file.name + ' » est vide.' };
    if (file.size > MAX_SIZE) {
      return { ok: false, reason: 'Le fichier « ' + file.name + ' » dépasse la taille maximale supportée (200 Mo).' };
    }
    return { ok: true };
  }

  /**
   * Vérifie la signature binaire du contenu (défense en profondeur :
   * un .xlsx renommé depuis un autre format est rejeté proprement).
   * @param {Uint8Array} bytes
   * @param {string} name
   * @returns {boolean}
   */
  function checkSignature(bytes, name) {
    if (/\.csv$/i.test(name)) return true; // texte brut : pas de signature
    if (bytes.length < 4) return false;
    // ZIP « PK.. » : conteneurs .xlsx / .xlsm
    if (bytes[0] === 0x50 && bytes[1] === 0x4B) return true;
    // CFB « D0 CF 11 E0 » : ancien format .xls
    if (bytes[0] === 0xD0 && bytes[1] === 0xCF && bytes[2] === 0x11 && bytes[3] === 0xE0) return true;
    return false;
  }

  /**
   * Lit le contenu binaire d'un File — UNIQUE point de lecture disque
   * de toute l'application.
   * @param {File} file
   * @returns {Promise<ArrayBuffer>}
   */
  function readOnce(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error('Lecture impossible : ' + file.name)); };
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * Parse un ArrayBuffer déjà lu (utilisé aussi par les tests, qui
   * fabriquent des classeurs en mémoire sans fichier disque).
   * @param {ArrayBuffer|Uint8Array} buffer
   * @param {string} fileName
   * @returns {{name:string, sheets:Array<{name:string, rows:any[][]}>}}
   */
  function parseBuffer(buffer, fileName) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (!checkSignature(bytes, fileName)) {
      throw new Error('Le contenu de « ' + fileName + ' » ne correspond pas à un fichier Excel valide (signature binaire inconnue).');
    }
    let wb;
    try {
      // cellDates:true → les dates deviennent des objets Date exploitables.
      wb = XLSX.read(bytes, { type: 'array', cellDates: true });
    } catch (e) {
      throw new Error('Structure Excel illisible pour « ' + fileName + ' » : ' + e.message);
    }
    if (!wb.SheetNames.length) throw new Error('Aucune feuille trouvée dans « ' + fileName + ' ».');

    // Conversion de chaque feuille en tableau de tableaux (AoA), une
    // seule fois : c'est cette structure JS qui est ensuite indexée en
    // mémoire — le classeur SheetJS est libéré après cette boucle.
    const sheets = wb.SheetNames.map(function (name) {
      const ws = wb.Sheets[name];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
      return { name: name, rows: rows };
    }).filter(function (s) { return s.rows.length > 0; });

    if (!sheets.length) throw new Error('Toutes les feuilles de « ' + fileName + ' » sont vides.');
    return { name: fileName, sheets: sheets };
  }

  /**
   * Chaîne complète : validation → lecture unique → parsing.
   * @param {File} file
   * @returns {Promise<{name:string, size:number, sheets:Array}>}
   */
  async function parseFile(file) {
    const v = validateFile(file);
    if (!v.ok) throw new Error(v.reason);
    const t0 = performance.now();
    const buffer = await readOnce(file);
    const parsed = parseBuffer(buffer, file.name);
    PRF.errors.log('info', 'Fichier parsé en ' + Math.round(performance.now() - t0) + ' ms : ' +
      file.name + ' (' + parsed.sheets.length + ' feuille(s))');
    return { name: file.name, size: file.size, sheets: parsed.sheets };
  }

  return { parseFile, parseBuffer, validateFile };
})();
