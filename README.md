# 📊 Comparateur Excel STRR — ACTUEL / PROPOSER

Application web **100 % locale** de comparaison de fichiers Excel représentant
des versions différentes d'un même référentiel métier (ex. `STRR-00339 - ACTUEL`
vs `STRR-00339 - PROPOSER`).

Référence fonctionnelle : [`CAHIER_DES_CHARGES.md`](./CAHIER_DES_CHARGES.md) ·
Plan de développement : [`PLAN_DE_DEVELOPPEMENT.md`](./PLAN_DE_DEVELOPPEMENT.md)

## 🚀 Lancement

**Double-cliquer sur `index.html`.** C'est tout.

- Aucune installation, aucun serveur, aucun framework, aucun accès Internet.
- Fonctionne en `file://` dans tout navigateur moderne (Chrome, Edge, Firefox).
- Les librairies (SheetJS, jsPDF) sont vendorisées dans `vendor/`.

## 🧭 Parcours utilisateur

1. **Import & fichiers** — glisser-déposer les fichiers `.xls` / `.xlsx` /
   `.xlsm` / `.csv` (sélection multiple). Chaque fichier est **lu une seule
   fois** puis indexé en mémoire. Les référentiels et types (ACTUEL / PROPOSER)
   sont détectés automatiquement ; les cas ambigus se résolvent d'un clic.
   Les identifiants acceptent tout préfixe alphabétique : `STRR-00339`,
   `ABC-00042`, `PROD 00007`…
   Les colonnes et lignes `% Rubrique` / `% Total` sont supprimées dès le parsing.
   La structure est analysée par **contenu** : les colonnes texte de gauche
   (ex. colonnes 1 à 7) forment la zone de titres — cellules fusionnées et
   hiérarchie par profondeur de colonne comprises — et les colonnes
   majoritairement numériques (ex. colonnes 8 à 10) sont les valeurs comparées.
2. **Sélection des champs** — colonnes détectées dynamiquement, groupées
   (Coûts / Marges / Autres), profils sauvegardables (« Analyse coût »…),
   prévisualisation live, sens d'amélioration réglable par champ.
3. **Comparaison** — tableau virtualisé (fluide à 100 000+ lignes),
   **groupé par article** par défaut : une ligne-titre porte le nom de
   l'article, suivie d'une ligne par champ (Champ | ACTUEL | PROPOSER |
   DELTA | Statut) ; une vue à plat triable colonne par colonne reste
   disponible d'un clic. Autres fonctionnalités :
   - `DELTA = PROPOSER − ACTUEL`, color coding vert (amélioration) / rouge (dégradation) ;
   - niveaux OP / Section / STRR global ;
   - tri multi-colonnes (Maj+clic), filtres par colonne, recherche globale indexée ;
   - édition inline (double-clic), undo/redo (Ctrl+Z / Ctrl+Y), verrouillage de ligne ;
   - suppression logique (ligne, section, STRR) et case « inclure dans export » ;
   - inclusion/exclusion par STRR (multi-comparaisons isolées).
4. **Exports** — Excel multi-feuilles (synthèse + détail par STRR) et rapport
   PDF paginé (couverture, résumé, détail), tous deux **groupés par article** :
   ligne-titre fusionnée au nom de l'article, puis une ligne par champ
   (A = champ, B = ACTUEL, C = PROPOSER, D = DELTA). L'export respecte
   strictement les suppressions, exclusions et champs décochés.

Les sessions sont autosauvegardées en IndexedDB (restauration proposée au
démarrage) et exportables/importables en JSON via la barre supérieure.

## 🏗 Architecture

JavaScript Vanilla (ES2022, scripts classiques, espace de noms global `PRF`),
zéro dépendance d'exécution hors `vendor/`.

```
index.html            Point d'entrée (double-clic)
css/                  Styles (main + tableau virtualisé)
vendor/               SheetJS, jsPDF, jsPDF-autotable (vendorisés)
src/
  core/               Moteurs purs, sans DOM (testés unitairement)
    parser.js         Lecture UNIQUE des fichiers + validation stricte
    normalizer.js     Normalisation data-driven + exclusions %Rubrique/%Total
    matcher.js        Matching STRR / OP / libellé / ordre (+fuzzy optionnel)
    comparator.js     Deltas + agrégation OP / Section / Global
    fieldRegistry.js  Champs dynamiques, groupes, profils, sens d'amélioration
    searchIndex.js    Index de recherche inversé en mémoire
  state/
    store.js          Store centralisé pub/sub, Map<STRR_ID, Dataset>
    history.js        Pile undo/redo
    persistence.js    Session JSON + autosave IndexedDB
  ui/
    dashboard.js      Import, liste fichiers/STRR, statuts
    fieldSelector.js  Sélection des champs + prévisualisation live
    comparisonTable.js Tableau éditable complet
    virtualScroller.js Virtualisation (≈ 37 nœuds DOM pour 100 000 lignes)
    components.js     Toasts, modales, utilitaires
  errors/
    errorHandler.js   Messages UI clairs + journal technique
  app.js              Amorçage, navigation, raccourcis, session
tests/
  tests.html          Suite de tests : ouvrir dans le navigateur
```

## ✅ Tests

Ouvrir **`tests/tests.html`** dans le navigateur : 30 tests unitaires couvrent
parser, normalisation, exclusions, matching (OP / ordre / fuzzy), deltas,
agrégations, index de recherche, undo/redo et sessions.

## ⚡ Performances mesurées (Chromium, jeu de 100 000 lignes de comparaison)

| Étape | Mesure |
|---|---|
| Parsing + normalisation (8 fichiers, 20 000 lignes Excel) | ≈ 0,8 s |
| Calcul de la comparaison (100 000 lignes) | ≈ 0,17 s |
| Recherche globale indexée | ≈ 8 ms |
| Défilement du tableau | fluide, 37 nœuds DOM |

## 🔒 Sécurité (local only)

Aucun upload, aucun appel réseau, validation stricte des fichiers importés
(extension + signature binaire), traitement intégral dans le navigateur.
