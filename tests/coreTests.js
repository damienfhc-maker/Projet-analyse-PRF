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

/** Feuille ACTUEL de référence (avec pièges : % Rubrique, % Total, nombre FR). */
function aoaActuel() {
  return [
    ['STRR-00339 - ACTUEL'],
    ['Désignation', 'OP', 'Matière', 'Travail Machine', '% Rubrique', 'Marge matière'],
    ['Travail Machine'],
    ['Perçage', 'OP10', 12.5, 8.2, 0.15, 3],
    ['Fraisage', 'OP20', 10, '7,5', 0.2, 2],
    ['% Total', null, 22.5, 15.7, null, null],
    ['Travail M.O.'],
    ['Contrôle', 'OP30', 5, 2, null, 1],
    ['Réglage manuel', null, 4, 1, null, 0.5]
  ];
}

/** Feuille PROPOSER : OP10 modifié, OP20 supprimé, OP40 ajouté, libellé sans OP variant. */
function aoaProposer() {
  return [
    ['STRR-00339 - PROPOSER'],
    ['Désignation', 'OP', 'Matière', 'Travail Machine', '% Rubrique', 'Marge matière'],
    ['Travail Machine'],
    ['Perçage', 'OP10', 12, 8, 0.15, 3.5],
    ['Ébavurage', 'OP40', 6, 3, null, 1],
    ['Travail M.O.'],
    ['Contrôle', 'OP30', 5, 2, null, 1],
    ['Réglage manu.', null, 3, 1, null, 0.5]
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
  PRF.fieldRegistry.refreshFieldConfig();
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

describe('Normalizer — structure data-driven et exclusions (§4.4, §4.5)', function () {

  const norm = normalizedFromAoa(aoaActuel(), 'STRR-00339 - ACTUEL.xlsx');
  const sheet = norm.sheets[0];

  it('détecte STRR et type depuis le nom de fichier', function () {
    assertEqual(sheet.strrId, 'STRR-00339');
    assertEqual(sheet.type, 'ACTUEL');
  });

  it('exclut la colonne « % Rubrique » dès le parsing', function () {
    assertTrue(sheet.columns.indexOf('% Rubrique') === -1, 'colonne exclue');
    assertEqual(sheet.columns, ['Matière', 'Travail Machine', 'Marge matière']);
  });

  it('exclut la ligne « % Total » dès le parsing', function () {
    assertTrue(sheet.records.every(function (r) { return !/%\s*total/i.test(r.label); }));
    assertEqual(sheet.records.length, 4, '4 lignes de données');
  });

  it('détecte les sections dynamiquement', function () {
    assertEqual(sheet.records[0].section, 'Travail Machine');
    assertEqual(sheet.records[3].section, 'Travail M.O.');
  });

  it('normalise les codes OP et les nombres au format FR', function () {
    assertEqual(sheet.records[0].operation, 'OP10');
    assertClose(sheet.records[1].fields['Travail Machine'], 7.5, '« 7,5 » converti');
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

  it('rejette les faux identifiants (codes OP, noms techniques)', function () {
    assertEqual(PRF.normalizer.normalizeStrrId('OP 10'), null, 'OP réservé aux opérations');
    assertEqual(PRF.normalizer.normalizeStrrId('Feuil1'), null, 'pas de séparateur');
    assertEqual(PRF.normalizer.normalizeStrrId('Rev-1'), null, 'moins de 2 chiffres');
    assertEqual(PRF.normalizer.normalizeStrrId('Données-1'), null, 'accents + 1 chiffre');
  });
});

describe('Normalizer — structures Excel atypiques (robustesse import)', function () {

  it('colonne des libellés SANS en-tête (cas fréquent)', function () {
    const res = PRF.normalizer.normalizeSheet([
      ['STRR-00339 - ACTUEL'],
      [null, 'OP', 'Matière'],
      ['S1'],
      ['Perçage', 'OP10', 5]
    ]);
    assertTrue(!res.error, 'feuille exploitable : ' + (res.error || ''));
    assertEqual(res.records.length, 1);
    assertEqual(res.records[0].label, 'Perçage');
    assertEqual(res.records[0].section, 'S1');
    assertClose(res.records[0].fields['Matière'], 5);
  });

  it('en-tête au-delà de la ligne 30 (bloc de titre volumineux)', function () {
    const rows = [];
    for (let i = 0; i < 39; i++) rows.push([]);
    rows.push(['Désignation', 'OP', 'Matière']);
    rows.push(['Perçage', 'OP10', 5]);
    const res = PRF.normalizer.normalizeSheet(rows);
    assertTrue(!res.error, 'en-tête profond détecté : ' + (res.error || ''));
    assertEqual(res.records.length, 1);
  });

  it('colonne de données sans en-tête → nommée par sa lettre Excel', function () {
    const res = PRF.normalizer.normalizeSheet([
      ['Désignation', 'OP', 'Matière', null],
      ['S1'],
      ['Perçage', 'OP10', 5, 7]
    ]);
    assertTrue(!res.error);
    assertEqual(res.columns, ['Matière', 'Colonne D']);
    assertClose(res.records[0].fields['Colonne D'], 7);
  });

  it('feuille vide ou sans structure → raison d\'échec explicite', function () {
    assertTrue(!!PRF.normalizer.normalizeSheet([]).error, 'feuille vide');
    assertTrue(!!PRF.normalizer.normalizeSheet([['titre seul'], ['x']]).error, 'pas d\'en-tête');
  });

  it('structure réelle : titres hiérarchiques cols 1-7 (fusion), valeurs cols 8-10', function () {
    const N = null;
    const res = PRF.normalizer.normalizeSheet([
      // En-tête : seules les colonnes de valeurs sont titrées
      [N, N, N, N, N, N, N, 'Coût matière', 'Coût machine', 'Coût MO'],
      // Titre profondeur 1 (cellule fusionnée sur la ligne)
      ['Article A', N, N, N, N, N, N, N, N, N],
      // Titre profondeur 2
      [N, 'Sous-groupe 1', N, N, N, N, N, N, N, N],
      // Lignes de données : titre en colonne 3, valeurs en 8-10
      [N, N, 'Perçage OP10', N, N, N, N, 12.5, 8.2, 3],
      [N, N, 'Fraisage OP20', N, N, N, N, 10, '7,5', 2],
      // Ligne exclue §4.5 même en profondeur
      [N, N, '% Total', N, N, N, N, 22.5, 15.7, 5],
      // Nouveau titre profondeur 1 : remplace toute la hiérarchie
      ['Article B', N, N, N, N, N, N, N, N, N],
      [N, N, 'Contrôle', N, N, N, N, 5, 2, 1]
    ]);
    assertTrue(!res.error, 'feuille exploitable : ' + (res.error || ''));
    assertEqual(res.columns, ['Coût matière', 'Coût machine', 'Coût MO'],
      'valeurs = colonnes 8-10 uniquement');
    assertEqual(res.records.length, 3, '% Total exclu');
    assertEqual(res.records[0].section, 'Article A › Sous-groupe 1', 'hiérarchie par profondeur');
    assertEqual(res.records[0].operation, 'OP10', 'OP extrait du titre');
    assertClose(res.records[1].fields['Coût machine'], 7.5, 'nombre FR en zone de valeurs');
    assertEqual(res.records[2].section, 'Article B', 'nouveau titre remplace la hiérarchie');
  });

  it('les colonnes de titres contenant quelques nombres restent des titres', function () {
    const N = null;
    const res = PRF.normalizer.normalizeSheet([
      ['Désignation', 'Réf', 'Valeur'],
      ['Groupe', N, N],
      ['Pièce usinée', 'A-12', 10],
      ['Pièce brute', 'B-34', 20]
    ]);
    assertTrue(!res.error);
    assertEqual(res.columns, ['Valeur'], 'Réf (texte) n\'est pas une colonne de valeurs');
    assertEqual(res.records[0].label, 'Pièce usinée');
  });
});

describe('Matcher — appariement OP / libellé / ordre (§5)', function () {

  const A = normalizedFromAoa(aoaActuel(), 'a - ACTUEL.xlsx').sheets[0].records;
  const P = normalizedFromAoa(aoaProposer(), 'a - PROPOSER.xlsx').sheets[0].records;
  const pairs = PRF.matcher.matchRecords(A, P);

  function find(op, status) {
    return pairs.find(function (p) { return p.op === op && (!status || p.status === status); });
  }

  it('apparie les lignes par code OP', function () {
    assertTrue(!!find('OP10', 'matched'), 'OP10 apparié');
    assertTrue(!!find('OP30', 'matched'), 'OP30 apparié');
  });

  it('marque en suppression les OP présents seulement dans ACTUEL (§5.3)', function () {
    assertTrue(!!find('OP20', 'removed'), 'OP20 supprimé');
  });

  it('marque en ajout les OP présents seulement dans PROPOSER (§5.3)', function () {
    assertTrue(!!find('OP40', 'added'), 'OP40 ajouté');
  });

  it('apparie par ordre les lignes sans OP (§5.2)', function () {
    const reglage = pairs.find(function (p) { return p.label === 'Réglage manuel'; });
    assertEqual(reglage.status, 'matched', 'fallback ordre');
    assertEqual(reglage.proposed.label, 'Réglage manu.');
  });

  it('fuzzy matching optionnel (Levenshtein)', function () {
    assertEqual(PRF.matcher.levenshtein('machine', 'machnie'), 2);
    assertTrue(PRF.matcher.fuzzyMatchScore('Réglage manuel', 'Réglage manu.') < 0.35);
  });
});

describe('Comparator — deltas et agrégation multi-niveaux (§6)', function () {

  const result = setupStore();
  const rows = result.rows;

  function row(op, field) {
    return rows.find(function (r) { return r.op === op && r.field === field; });
  }

  it('DELTA = PROPOSER − ACTUEL (§6.1)', function () {
    assertClose(row('OP10', 'Matière').delta, -0.5);
    assertEqual(row('OP10', 'Matière').status, 'modified');
  });

  it('ajouts et suppressions portent l\'impact complet', function () {
    assertClose(row('OP40', 'Matière').delta, 6, 'ajout');
    assertClose(row('OP20', 'Matière').delta, -10, 'suppression');
    assertEqual(row('OP40', 'Matière').status, 'added');
    assertEqual(row('OP20', 'Matière').status, 'removed');
  });

  it('lignes inchangées détectées', function () {
    assertEqual(row('OP30', 'Matière').status, 'unchanged');
  });

  it('agrégation au niveau global STRR (§6.3)', function () {
    const matRows = rows.filter(function (r) { return r.field === 'Matière'; });
    const agg = PRF.comparator.aggregate(matRows, 'global');
    assertEqual(agg.length, 1);
    assertClose(agg[0].actual, 31.5);
    assertClose(agg[0].proposed, 26);
    assertClose(agg[0].delta, -5.5);
  });

  it('agrégation au niveau section (§6.3)', function () {
    const matRows = rows.filter(function (r) { return r.field === 'Matière'; });
    const agg = PRF.comparator.aggregate(matRows, 'section');
    assertEqual(agg.length, 2, 'deux sections');
    const tm = agg.find(function (a) { return a.section === 'Travail Machine'; });
    assertClose(tm.delta, -4.5, 'OP10 −0,5 + OP20 −10 + OP40 +6');
  });

  it('recompute après édition inline', function () {
    const r = row('OP10', 'Matière');
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

  it('recherche par token entier (index inversé)', function () {
    const set = PRF.searchIndex.query('op10');
    assertTrue(set.size > 0, 'résultats trouvés');
    set.forEach(function (i) {
      assertEqual(PRF.store.state.rows[i].op, 'OP10');
    });
  });

  it('recherche par sous-chaîne (repli balayage)', function () {
    const set = PRF.searchIndex.query('perç');
    assertTrue(set.size > 0);
  });

  it('requête vide = aucune restriction', function () {
    assertEqual(PRF.searchIndex.query(''), null);
  });

  it('termes multiples = intersection', function () {
    const set = PRF.searchIndex.query('op10 matière');
    // Tous les termes doivent apparaître dans chaque ligne retournée
    // (« Marge matière » contient aussi le terme « matière » : inclus).
    set.forEach(function (i) {
      const r = PRF.store.state.rows[i];
      assertTrue(r.op === 'OP10' && r.sk.indexOf('matière') >= 0);
    });
    // La ligne exacte OP10 / Matière fait partie du résultat
    const hasExact = Array.from(set).some(function (i) {
      const r = PRF.store.state.rows[i];
      return r.op === 'OP10' && r.field === 'Matière';
    });
    assertTrue(hasExact, 'ligne OP10/Matière présente');
  });
});

describe('FieldRegistry — groupes, sens d\'amélioration (§7)', function () {

  it('groupes heuristiques Coûts / Marges / Autres', function () {
    const g = PRF.fieldRegistry.defaultGroups(['Matière', 'Marge matière', 'Commentaire']);
    assertEqual(g['Coûts'], ['Matière']);
    assertEqual(g['Marges'], ['Marge matière']);
    assertEqual(g['Autres'], ['Commentaire']);
  });

  it('color coding : baisse d\'un coût = amélioration', function () {
    setupStore();
    assertEqual(PRF.fieldRegistry.isImprovement('Matière', -2), true);
    assertEqual(PRF.fieldRegistry.isImprovement('Matière', 2), false);
    assertEqual(PRF.fieldRegistry.isImprovement('Marge matière', 2), true);
    assertEqual(PRF.fieldRegistry.isImprovement('Matière', 0), null);
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
    PRF.usage.setLastRun({ selected: ['Matière'], directions: {}, fuzzy: false });
    assertEqual(PRF.usage.getLastRun().selected, ['Matière']);
  });
});

describe('Persistence — session JSON aller-retour (§12)', function () {

  it('sérialise puis restaure une session à l\'identique', function () {
    setupStore();
    const st = PRF.store.state;
    // Simule une édition + une suppression utilisateur
    const target = st.rows.find(function (r) { return r.op === 'OP10' && r.field === 'Matière'; });
    PRF.store.getUserState(target.id).proposed = 99;
    PRF.store.getUserState(target.id).deleted = false;
    const other = st.rows.find(function (r) { return r.op === 'OP30' && r.field === 'Matière'; });
    PRF.store.getUserState(other.id).deleted = true;

    const session = JSON.parse(JSON.stringify(PRF.persistence.serializeSession()));
    PRF.store.reset();
    assertEqual(PRF.store.state.rows.length, 0, 'store vidé');

    PRF.persistence.applySession(session);
    PRF.comparator.compareAll();

    const restored = PRF.store.state.rows.find(function (r) {
      return r.op === 'OP10' && r.field === 'Matière';
    });
    assertClose(restored.proposed, 99, 'édition restaurée');
    assertClose(restored.delta, 99 - 12.5, 'delta recalculé');
    const restoredDel = PRF.store.state.rows.find(function (r) {
      return r.op === 'OP30' && r.field === 'Matière';
    });
    assertTrue(restoredDel.deleted, 'suppression logique restaurée');
    assertTrue(session.excludedItems.some(function (e) { return e.kind === 'row'; }),
      'excludedItems renseigné (§12.2)');
  });

  it('rejette une session invalide', function () {
    assertThrows(function () { PRF.persistence.applySession({ version: 99 }); });
  });
});

// ============================================================
TestRunner.render();
