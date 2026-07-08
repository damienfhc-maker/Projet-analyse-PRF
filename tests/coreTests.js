/* ============================================================
 * coreTests.js — Tests unitaires des moteurs core
 *
 * Les classeurs Excel de test sont générés EN MÉMOIRE via SheetJS
 * puis passés dans la chaîne réelle de production :
 * parser.parseBuffer → normalizer → matcher → comparator → index.
 * ============================================================ */
"use strict";

/** Fabrique un classeur .xlsx en mémoire et retourne son ArrayBuffer. */
function makeWorkbook(aoa, sheetName) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName || 'Feuil1');
  return XLSX.write(wb, { type: 'array' });
}

/** Feuille ACTUEL de référence (colonnes A-G = labels, H = value). */
function aoaActuel() {
  return [
    [null, null, null, null, null, null, null, 'Valeur'],
    ['Coût matière', null, null, null, null, null, null, 12.5],
    ['Coût machine', null, null, null, null, null, null, 8.2],
    ['Marge matière', null, null, null, null, null, null, 3],
    ['Coût ajustage', null, null, null, null, null, null, 10],
    ['Coût retouche', null, null, null, null, null, null, '7,5']
  ];
}

/** Feuille PROPOSER : certaines valeurs modifiées, certaines supprimées, une ligne ajoutée. */
function aoaProposer() {
  return [
    [null, null, null, null, null, null, null, 'Valeur'],
    ['Coût matière', null, null, null, null, null, null, 12],
    ['Coût machine', null, null, null, null, null, null, 8],
    ['Marge matière', null, null, null, null, null, null, 3.5],
    ['Coût finition', null, null, null, null, null, null, 6],
    ['Coût retouche', null, null, null, null, null, null, 3]
  ];
}

/** Chaîne complète : buffer → parse → normalisation. */
function normalizedFromAoa(aoa, fileName) {
  const parsed = PRF.parser.parseBuffer(makeWorkbook(aoa), fileName);
  return PRF.normalizer.normalizeFile({ name: fileName, size: 1000, sheets: parsed.sheets });
}

/** Prépare le store complet avec la paire de test et lance la comparaison. */
function setupStore() {
  PRF.store.reset();
  PRF.store.state.files.push(normalizedFromAoa(aoaActuel(), 'STRR-00339 - ACTUEL.xlsx'));
  PRF.store.state.files.push(normalizedFromAoa(aoaProposer(), 'STRR-00339 - PROPOSER.xlsx'));
  PRF.store.rebuildDatasets();
  return PRF.comparator.compareAll();
}

// ============================================================

describe('Parser — lecture unique et validation stricte (§4, §14)', function () {

  it('parse un classeur xlsx généré en mémoire', function () {
    const parsed = PRF.parser.parseBuffer(makeWorkbook(aoaActuel()), 'test.xlsx');
    assertEqual(parsed.sheets.length, 1, 'nombre de feuilles');
    assertTrue(parsed.sheets[0].rows.length >= 8, 'lignes brutes présentes');
  });

  it('rejette un contenu à signature binaire inconnue', function () {
    assertThrows(function () {
      PRF.parser.parseBuffer(new Uint8Array([1, 2, 3, 4, 5]), 'faux.xlsx');
    });
  });

  it('valide les extensions autorisées', function () {
    assertTrue(PRF.parser.validateFile({ name: 'a.xlsx', size: 10 }).ok);
    assertTrue(PRF.parser.validateFile({ name: 'a.csv', size: 10 }).ok);
    assertTrue(!PRF.parser.validateFile({ name: 'a.exe', size: 10 }).ok);
    assertTrue(!PRF.parser.validateFile({ name: 'a.xlsx', size: 0 }).ok, 'fichier vide rejeté');
  });
});

describe('Normalizer — structure simplifiée A-G labels + H value (§4.4, §4.5)', function () {

  const norm = normalizedFromAoa(aoaActuel(), 'STRR-00339 - ACTUEL.xlsx');
  const sheet = norm.sheets[0];

  it('détecte STRR et type depuis le nom de fichier', function () {
    assertEqual(sheet.strrId, 'STRR-00339');
    assertEqual(sheet.type, 'ACTUEL');
  });

  it('extrait labels (A-G) et valeur (H) uniquement', function () {
    assertTrue(sheet.records.length >= 4, 'au moins 4 lignes');
    assertTrue(sheet.records.every(function (r) { return r.label && r.value !== undefined; }));
  });

  it('convertit les valeurs numériques (format FR 7,5 → 7.5)', function () {
    const retouche = sheet.records.find(function (r) { return r.label.indexOf('retouche') >= 0; });
    assertTrue(retouche, 'ligne trouvée');
    assertClose(retouche.value, 7.5, '7,5 FR converti');
  });

  it('coerce les valeurs correctement', function () {
    assertClose(PRF.normalizer.coerceValue('1 234,56'), 1234.56);
    assertClose(PRF.normalizer.coerceValue('12,5'), 12.5);
    assertEqual(PRF.normalizer.coerceValue('  texte  '), 'texte');
    assertEqual(PRF.normalizer.coerceValue(''), null);
  });

  it('normalise les identifiants STRR', function () {
    assertEqual(PRF.normalizer.normalizeStrrId('strr 339'), 'STRR-00339');
    assertEqual(PRF.normalizer.detectType('fichier PROPOSER final.xlsx'), 'PROPOSER');
  });

  it('accepte les identifiants génériques AAA-XXXXX (préfixe libre)', function () {
    assertEqual(PRF.normalizer.normalizeStrrId('ABC-00042 - ACTUEL.xlsx'), 'ABC-00042');
    assertEqual(PRF.normalizer.normalizeStrrId('abc-42'), 'ABC-00042', 'complété à 5 chiffres');
    assertEqual(PRF.normalizer.normalizeStrrId('XYZW_123456 - PROPOSER'), 'XYZW-123456', '6 chiffres conservés');
    assertEqual(PRF.normalizer.normalizeStrrId('PROD 00007'), 'PROD-00007', 'séparateur espace');
  });

  it('rejette les faux identifiants', function () {
    assertEqual(PRF.normalizer.normalizeStrrId('OP 10'), null, 'OP réservé');
    assertEqual(PRF.normalizer.normalizeStrrId('Feuil1'), null, 'pas de séparateur');
    assertEqual(PRF.normalizer.normalizeStrrId('Rev-1'), null, 'moins de 2 chiffres');
  });
});

describe('Normalizer — structures Excel atypiques (robustesse import)', function () {

  it('détecte en-tête dans le bloc titre (avant ligne 100)', function () {
    const rows = [];
    for (let i = 0; i < 5; i++) rows.push(['']);
    rows.push([null, null, null, null, null, null, null, 'Valeur']);
    rows.push(['Coût matière', null, null, null, null, null, null, 5]);
    const res = PRF.normalizer.normalizeSheet(rows);
    assertTrue(!res.error, 'en-tête détecté : ' + (res.error || ''));
    assertEqual(res.records.length, 1);
  });

  it('feuille vide ou sans structure → raison d\'échec explicite', function () {
    assertTrue(!!PRF.normalizer.normalizeSheet([]).error, 'feuille vide');
    assertTrue(!!PRF.normalizer.normalizeSheet([['titre seul']]).error, 'pas d\'en-tête');
  });

  it('structure simplifiée : A-G = labels, H = valeur uniquement', function () {
    const N = null;
    const res = PRF.normalizer.normalizeSheet([
      [N, N, N, N, N, N, N, 'Valeur'],
      ['Coût matière', N, N, N, N, N, N, 12.5],
      ['Coût machine', N, N, N, N, N, N, 8.2],
      ['Coût MO', N, N, N, N, N, N, 3],
      ['Coût total', N, N, N, N, N, N, 23.7]
    ]);
    assertTrue(!res.error, 'feuille exploitable : ' + (res.error || ''));
    assertEqual(res.records.length, 4);
    assertEqual(res.records[0].label, 'Coût matière', 'label de A-G');
    assertClose(res.records[0].value, 12.5, 'valeur de H');
  });

  it('ignore les colonnes I-J', function () {
    const N = null;
    const res = PRF.normalizer.normalizeSheet([
      [N, N, N, N, N, N, N, 'Valeur', 'Ignoré', 'Aussi ignoré'],
      ['Coût matière', N, N, N, N, N, N, 12.5, 999, 888],
      ['Coût machine', N, N, N, N, N, N, 8.2, 777, 666]
    ]);
    assertTrue(!res.error);
    assertEqual(res.records.length, 2);
    assertEqual(res.records[0].value, 12.5, 'I-J ignorées');
  });

  it('convertit les nombres en format FR (7,5 → 7.5)', function () {
    const N = null;
    const res = PRF.normalizer.normalizeSheet([
      [N, N, N, N, N, N, N, 'Valeur'],
      ['Coût', N, N, N, N, N, N, '12,5'],
      ['Autre', N, N, N, N, N, N, '7,25']
    ]);
    assertTrue(!res.error);
    assertClose(res.records[0].value, 12.5);
    assertClose(res.records[1].value, 7.25);
  });
});

describe('Matcher — appariement par label / ordre (§5)', function () {

  const A = normalizedFromAoa(aoaActuel(), 'a - ACTUEL.xlsx').sheets[0].records;
  const P = normalizedFromAoa(aoaProposer(), 'a - PROPOSER.xlsx').sheets[0].records;
  const pairs = PRF.matcher.matchRecords(A, P);

  function find(label, status) {
    return pairs.find(function (p) { return p.label === label && (!status || p.status === status); });
  }

  it('apparie les lignes par label exact', function () {
    assertTrue(!!find('Coût matière', 'matched'), 'label exact apparié');
    assertTrue(!!find('Coût retouche', 'matched'), 'autre label apparié');
  });

  it('marque en suppression les labels présents seulement dans ACTUEL', function () {
    assertTrue(!!find('Coût ajustage', 'removed'), 'présent en ACTUEL, absent en PROPOSER');
  });

  it('marque en ajout les labels présents seulement dans PROPOSER', function () {
    assertTrue(!!find('Coût finition', 'added'), 'absent en ACTUEL, présent en PROPOSER');
  });

  it('fuzzy matching optionnel pour rapprocher labels similaires', function () {
    assertEqual(PRF.matcher.levenshtein('machine', 'machnie'), 2);
    assertTrue(PRF.matcher.fuzzyMatchScore('Coût machine', 'Coût machne') < 0.3);
  });
});

describe('Comparator — deltas et statuts (§6)', function () {

  const result = setupStore();
  const rows = result.rows;

  function row(label) {
    return rows.find(function (r) { return r.label === label; });
  }

  it('DELTA = PROPOSER − ACTUEL', function () {
    assertClose(row('Coût matière').delta, -0.5);
    assertEqual(row('Coût matière').status, 'modified');
  });

  it('ajouts et suppressions portent l\'impact complet', function () {
    assertClose(row('Coût finition').delta, 6, 'ajout');
    assertClose(row('Coût ajustage').delta, -10, 'suppression');
    assertEqual(row('Coût finition').status, 'added');
    assertEqual(row('Coût ajustage').status, 'removed');
  });

  it('lignes inchangées détectées', function () {
    assertEqual(row('Marge matière').status, 'modified', 'ou unchanged si identique');
  });

  it('recompute après édition inline', function () {
    const r = row('Coût matière');
    const prev = r.proposed;
    r.proposed = 20;
    PRF.comparator.recompute(r);
    assertClose(r.delta, 7.5);
    r.proposed = prev;
    PRF.comparator.recompute(r);
  });
});

describe('SearchIndex — recherches sur base indexée en mémoire (§11.2)', function () {

  setupStore();

  it('recherche par texte du label', function () {
    const set = PRF.searchIndex.query('coût matière');
    assertTrue(set.size > 0, 'résultats trouvés');
    set.forEach(function (i) {
      const r = PRF.store.state.rows[i];
      assertTrue(r.sk.indexOf('coût') >= 0);
    });
  });

  it('recherche par sous-chaîne', function () {
    const set = PRF.searchIndex.query('matière');
    assertTrue(set.size > 0, 'trouve tous les labels contenant "matière"');
  });

  it('requête vide = aucune restriction', function () {
    assertEqual(PRF.searchIndex.query(''), null);
  });

  it('termes multiples = intersection', function () {
    const set = PRF.searchIndex.query('coût machine');
    set.forEach(function (i) {
      const r = PRF.store.state.rows[i];
      assertTrue(r.sk.indexOf('coût') >= 0 && r.sk.indexOf('machine') >= 0);
    });
  });
});


describe('History — pile undo/redo (§8.4)', function () {

  it('undo/redo ré-applique et défait les commandes', function () {
    PRF.history.clear();
    let value = 0;
    function set(v) { return function () { value = v; }; }
    value = 1;
    PRF.history.push({ label: 't1', redo: set(1), undo: set(0) });
    value = 2;
    PRF.history.push({ label: 't2', redo: set(2), undo: set(1) });
    PRF.history.undo();
    assertEqual(value, 1);
    PRF.history.undo();
    assertEqual(value, 0);
    assertTrue(!PRF.history.canUndo());
    PRF.history.redo();
    assertEqual(value, 1);
    PRF.history.redo();
    assertEqual(value, 2);
    assertTrue(!PRF.history.canRedo());
  });
});

describe('Usage — personnalisation et macros locales', function () {

  it('comptabilise les actions et trie par fréquence d\'usage', function () {
    PRF.usage.record('test:pdf');
    PRF.usage.record('test:pdf');
    PRF.usage.record('test:xlsx');
    assertTrue(PRF.usage.count('test:pdf') >= 2);
    const sorted = PRF.usage.sortByUsage(['xlsx', 'pdf'], 'test:');
    assertEqual(sorted[0], 'pdf', 'le plus utilisé en premier');
  });

  it('mémorise préférences et dernière analyse', function () {
    PRF.usage.setPref('test.level', 'section');
    assertEqual(PRF.usage.getPref('test.level', 'op'), 'section');
    assertEqual(PRF.usage.getPref('test.inconnu', 'défaut'), 'défaut');
    PRF.usage.setLastRun({ fuzzy: false });
    assertEqual(PRF.usage.getLastRun().fuzzy, false);
  });
});

describe('Persistence — session JSON aller-retour (§12)', function () {

  it('sérialise puis restaure une session à l\'identique', function () {
    setupStore();
    const st = PRF.store.state;
    // Simule une édition + une suppression utilisateur
    const target = st.rows.find(function (r) { return r.label === 'Coût matière'; });
    PRF.store.getUserState(target.id).proposed = 99;
    const other = st.rows.find(function (r) { return r.label === 'Coût machine'; });
    PRF.store.getUserState(other.id).deleted = true;

    const session = JSON.parse(JSON.stringify(PRF.persistence.serializeSession()));
    PRF.store.reset();
    assertEqual(PRF.store.state.rows.length, 0, 'store vidé');

    PRF.persistence.applySession(session);
    PRF.comparator.compareAll();

    const restored = PRF.store.state.rows.find(function (r) {
      return r.label === 'Coût matière';
    });
    assertClose(restored.proposed, 99, 'édition restaurée');
    assertClose(restored.delta, 99 - 12.5, 'delta recalculé');
    const restoredDel = PRF.store.state.rows.find(function (r) {
      return r.label === 'Coût machine';
    });
    assertTrue(restoredDel.deleted, 'suppression logique restaurée');
    assertTrue(session.excludedItems.some(function (e) { return e.kind === 'row'; }),
      'excludedItems renseigné');
  });

  it('rejette une session invalide', function () {
    assertThrows(function () { PRF.persistence.applySession({ version: 99 }); });
  });
});

// ============================================================
TestRunner.render();
