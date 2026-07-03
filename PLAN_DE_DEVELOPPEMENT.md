# 🗺️ PLAN DE DÉVELOPPEMENT — Application web locale de comparaison Excel

> Référence unique : [`CAHIER_DES_CHARGES.md`](./CAHIER_DES_CHARGES.md)
> Statut : **en attente de validation — aucun code ne sera produit avant validation de ce plan.**

---

## 0. Décisions d'interprétation (à valider)

Le cahier des charges (CDC) laisse quelques points ouverts. Voici les interprétations retenues, choisies pour respecter à la lettre les principes fondamentaux (offline-first, data-driven, comparison-first) :

| # | Point du CDC | Interprétation retenue | Justification |
|---|--------------|------------------------|---------------|
| D1 | §3.1 « React (recommandé) ou Vue.js » | **JavaScript Vanilla (ES2022, modules natifs)** — pas de framework | Le développement est confié à un profil Vanilla JS ; le CDC *recommande* React mais ne l'impose pas. Vanilla = zéro dépendance de build, offline-first absolu, démarrage par simple ouverture de `index.html` ou serveur statique local. |
| D2 | §3.1 « TypeScript fortement recommandé » | **JSDoc typé + `// @ts-check`** vérifié par `tsc --noEmit` en CI locale | Sûreté de typage équivalente sans étape de transpilation — le code livré reste du JS pur exécutable tel quel (offline-first). |
| D3 | §3.1 « Backend local optionnel mais conseillé » | **Application 100 % client-side** + mini serveur statique Node.js fourni (`npm start`) pour contourner les restrictions `file://` | Tout le traitement (parsing, matching, comparaison, export) tient dans le navigateur avec SheetJS. Un backend Express n'apporterait rien au périmètre actuel et l'architecture en modules découplés (§15) permet de l'ajouter plus tard. |
| D4 | §10.2 Export PDF offline | **pdfmake** (ou jsPDF + autotable) **vendorisé localement** dans `vendor/` — aucun CDN | Respect strict du §2.1 et §14 : aucune dépendance Internet à l'exécution. |
| D5 | §11.2 « Virtualized table (React Window / TanStack Table) » | **Virtualisation maison** (fenêtrage par `scrollTop`, ~60 lignes DOM rendues) | Ces librairies sont liées à React ; l'exigence réelle est « UI fluide sur 100 000+ lignes », atteignable en vanilla avec un virtualiseur de ~150 lignes de code, testé unitairement. |
| D6 | §3.1 « Redux / Zustand / Pinia » | **Store maison** (pattern pub/sub, état centralisé immuable) | Même rôle (in-memory store centralisé) sans framework. |
| D7 | §5.2 « fallback fuzzy matching (optionnel) » | Implémenté en **phase 3 en option activable** (similarité de Levenshtein sur le libellé d'opération), désactivé par défaut | Marqué optionnel dans le CDC ; le hook est prévu dès la conception du matching. |
| D8 | §4.1 « .xlsm (optionnel) » | **Supporté en lecture** (SheetJS le lit nativement, les macros sont ignorées) | Coût nul, valeur ajoutée réelle. |
| D9 | Détection ACTUEL / PROPOSER | Détection par **nom de fichier**, puis **contenu de feuille**, puis **choix manuel de l'utilisateur** en dernier recours | Data-driven (§2.2) : on ne fige pas une convention de nommage ; mismatch géré par le module d'erreurs (§13). |
| D10 | §12.1 IndexedDB « option gros fichiers » | Basculement **automatique au-delà d'un seuil** (~50 Mo de dataset normalisé) + activable manuellement | L'utilisateur n'a pas à connaître la technique ; comportement par défaut = RAM comme exigé. |

Toute autre exigence du CDC est reprise **sans écart**.

---

## 1. Architecture cible

### 1.1 Stack

- **Langage** : JavaScript Vanilla ES2022, modules natifs (`<script type="module">`), JSDoc + `@ts-check`
- **Parsing Excel** : SheetJS (`xlsx`) vendorisé dans `vendor/`
- **Export PDF** : pdfmake vendorisé
- **UI** : HTML5 + CSS3 (variables CSS, grid/flex), zéro framework
- **Stockage** : store mémoire maison + IndexedDB (wrapper maison ~100 lignes) + export/import session JSON
- **Outillage dev uniquement** (jamais requis à l'exécution) : Node.js pour serveur statique, tests (node:test), `tsc --noEmit`, ESLint

### 1.2 Arborescence prévisionnelle

```
/
├── index.html
├── css/
│   ├── main.css
│   └── table.css
├── vendor/                    # librairies vendorisées (offline)
│   ├── xlsx.full.min.js
│   └── pdfmake/
├── src/
│   ├── core/                  # logique pure, sans DOM (testable)
│   │   ├── parser.js          # lecture XLSX → JSON brut
│   │   ├── normalizer.js      # JSON brut → modèle normalisé + exclusions
│   │   ├── matcher.js         # matching STRR / type / OP
│   │   ├── comparator.js      # calcul des deltas (3 niveaux)
│   │   ├── fieldRegistry.js   # détection dynamique colonnes + groupes
│   │   └── sessionModel.js    # structure session (§12.2)
│   ├── state/
│   │   ├── store.js           # store centralisé pub/sub
│   │   ├── history.js         # pile undo/redo
│   │   └── persistence.js     # RAM / IndexedDB / session JSON
│   ├── ui/
│   │   ├── dashboard.js       # import, liste STRR, statuts, bouton Comparer
│   │   ├── fieldSelector.js   # écran sélection champs + profils
│   │   ├── comparisonTable.js # tableau virtualisé éditable
│   │   ├── virtualScroller.js # virtualisation maison
│   │   └── components/        # toasts, modales, dropzone…
│   ├── export/
│   │   ├── exportXlsx.js
│   │   └── exportPdf.js
│   └── errors/
│       └── errorHandler.js    # messages UI clairs + logs techniques (§13)
├── tests/                     # tests unitaires core (node:test)
├── fixtures/                  # fichiers Excel de test (ACTUEL/PROPOSER)
├── server.js                  # mini serveur statique local (npm start)
└── package.json               # scripts dev uniquement
```

### 1.3 Flux de données (conforme §3.2)

```
Excel Files → parser → normalizer → store ← matcher ← comparator
                                      ↓
                          UI (dashboard / sélection / tableau)
                                      ↓
                          exportXlsx / exportPdf
```

Le dossier `src/core/` est **100 % pur** (aucun accès DOM) : c'est lui qui porte les critères de validation §16 et il est intégralement testé unitairement. L'extensibilité §15 (futur backend, PostgreSQL…) est garantie par cette séparation core / state / ui.

### 1.4 Modèle de données normalisé (conforme §4.4, §6.2, §12.2)

```js
// Ligne normalisée (§4.4)
{ strr_id, type, section, operation, fields: { [colName]: value } }

// Résultat de comparaison (§6.2)
{ strr_id, section, operation, field, actual, proposed, delta,
  status: 'modified'|'added'|'removed'|'unchanged',
  locked, includedInExport }

// Session (§12.2)
{ files: [], comparisons: [], userConfig: {}, excludedItems: [] }
```

---

## 2. Phases de développement

### Phase 0 — Socle projet *(0,5 j)*
- Structure de répertoires, `index.html`, CSS de base, vendorisation SheetJS + pdfmake
- `server.js` statique, `package.json` (scripts `start`, `test`, `typecheck`, `lint`)
- Store pub/sub minimal + `errorHandler` squelette
- Jeux de fixtures Excel `STRR-00339 ACTUEL / PROPOSER` (+ cas tordus : OP manquants, colonnes `% Rubrique` / `% Total`, sections multiples)

**Sortie** : page qui se lance offline, tests exécutables.

### Phase 1 — Import & normalisation *(CDC §4)* *(2 j)*
- Dropzone drag & drop + sélection multiple, validation immédiate (extension, taille, lisibilité)
- `parser.js` : lecture complète via SheetJS (`.xls`, `.xlsx`, `.xlsm`), extraction des feuilles pertinentes — **parsing unique**, résultat mis en cache (§11.2)
- `normalizer.js` : conversion en modèle normalisé §4.4 ; détection data-driven des sections (`Travail Machine`, `Travail M.O.`…), des codes OP et du couple STRR-ID / type (stratégie D9)
- **Exclusion dès le parsing** des lignes/colonnes `% Rubrique` et `% Total` (§4.5)
- Gestion d'erreurs §13 : fichier illisible, structure inconnue, STRR manquant

**Sortie** : import multi-fichiers → datasets normalisés visibles en console/état, tests unitaires parsing + normalisation + exclusions.

### Phase 2 — Dashboard *(CDC §8.1)* *(1 j)*
- Liste des STRR détectés avec statut ACTUEL / PROPOSER (✔ complet, ⚠ mismatch)
- Résolution manuelle des mismatchs (D9), bouton « Comparer » actif quand ≥ 1 paire complète
- Indexation `Map<STRR_ID, Dataset>` (§11.2)

**Sortie** : dashboard fonctionnel du drop des fichiers jusqu'au déclenchement de la comparaison.

### Phase 3 — Moteur de matching *(CDC §5)* *(2 j)*
- Matching principal : (STRR ID, type)
- Matching ligne : par code OP, **fallback par ordre** si OP absent, hook fuzzy optionnel (D7)
- Différences structurelles : OP supprimé ❌ / ajouté ➕ / commun → comparaison directe
- Tests exhaustifs : OP désordonnés, doublons, sections asymétriques

**Sortie** : `matcher.js` pur, testé, produisant les paires de lignes + statuts added/removed.

### Phase 4 — Moteur de comparaison *(CDC §6)* *(1,5 j)*
- `DELTA = PROPOSER − ACTUEL` par champ sélectionné, typage number/string
- Agrégation aux 3 niveaux : ligne OP → section → global STRR
- Format de sortie standard §6.2 ; isolation mémoire par STRR (§9.3)

**Sortie** : `comparator.js` pur, testé, résultats aux 3 niveaux.

### Phase 5 — Sélection dynamique des champs & profils *(CDC §7)* *(1,5 j)*
- `fieldRegistry.js` : liste automatique des colonnes détectées, groupes (« Coûts », « Marges ») configurables data-driven
- Écran de sélection : checkboxes par champ, groupes filtrables, **prévisualisation live** (§8.2)
- Profils de comparaison : sauvegarde/rechargement local (« Analyse coût », « Analyse marge »)

**Sortie** : la comparaison ne porte que sur les champs cochés ; profils persistants.

### Phase 6 — Tableau de comparaison *(CDC §8.3, §11)* *(3 j)*
- Structure `| STRR | Section | OP | Champ | ACTUEL | PROPOSER | DELTA |`
- `virtualScroller.js` : rendu fenêtré, objectif **100 000+ lignes fluides** (D5)
- Tri multi-colonnes, filtre texte par colonne, recherche globale, toggle de colonnes visibles
- Color coding vert (amélioration) / rouge (dégradation) — sens du delta configurable par champ (un coût qui baisse = vert)

**Sortie** : tableau lisible et fluide sur les fixtures volumineuses (benchmark inclus).

### Phase 7 — Édition & suppression intelligente *(CDC §8.4, §8.5)* *(2,5 j)*
- Inline editing avec validation automatique de type (number/string), recalcul immédiat du delta
- Pile **undo/redo** centralisée (`history.js`) couvrant éditions et suppressions
- **Lock** de comparaison individuelle (ligne verrouillée = non éditable)
- Suppression logique : ligne OP, section complète, STRR complet — les données sont marquées, jamais détruites
- Checkbox « inclure dans export » par élément

**Sortie** : cycle complet éditer → annuler → rétablir → verrouiller → supprimer/restaurer.

### Phase 8 — Multi-comparaisons *(CDC §9)* *(1 j)*
- Blocs indépendants par STRR avec toggle ✔ inclure / ❌ exclure
- Datasets strictement isolés en mémoire ; navigation entre STRR

**Sortie** : plusieurs STRR comparés en parallèle, inclusion/exclusion respectée partout.

### Phase 9 — Export *(CDC §10)* *(2,5 j)*
- **XLSX** : feuille 1 synthèse (deltas globaux par STRR), feuilles 2+ détail par STRR, structure fidèle à l'UI (tri, colonnes visibles)
- **PDF** : couverture, résumé global, tableaux détaillés, pagination automatique, version imprimable
- **Export filtré strict** (§10.3) : suppressions utilisateur, STRR exclus et champs décochés absents de l'export
- Tests de non-régression : ce qui est masqué/supprimé n'apparaît jamais

**Sortie** : exports XLSX et PDF conformes, générés 100 % offline.

### Phase 10 — Stockage, performance, robustesse *(CDC §11–§14)* *(2 j)*
- `persistence.js` : RAM par défaut, IndexedDB au-delà du seuil (D10), **export/import session JSON** (§12.2)
- Benchmarks : parsing < 3 s sur fichier cible, scroll/tri/filtre fluides sur 100 000 lignes ; optimisations si nécessaire (Web Worker pour le parsing en réserve)
- Passe complète gestion d'erreurs §13 (messages UI + logs techniques) et sécurité §14 (aucun appel réseau — vérifié par test, validation stricte des fichiers, lecteur sandboxé)

**Sortie** : session sauvegardable/restaurable, budgets de performance tenus.

### Phase 11 — Recette finale *(CDC §16)* *(1 j)*
- Déroulé de la check-list des 10 critères de validation §16 sur les fixtures réelles
- Corrections finales, `README.md` (installation, lancement offline, guide d'usage)

**Sortie** : ✅ les 10 critères §16 validés et documentés.

---

## 3. Récapitulatif & jalons

| Phase | Contenu | CDC | Durée est. |
|-------|---------|-----|-----------|
| 0 | Socle projet | §2, §3 | 0,5 j |
| 1 | Import & normalisation | §4 | 2 j |
| 2 | Dashboard | §8.1 | 1 j |
| 3 | Matching | §5 | 2 j |
| 4 | Comparaison | §6, §9.3 | 1,5 j |
| 5 | Sélection champs & profils | §7 | 1,5 j |
| 6 | Tableau virtualisé | §8.3, §11 | 3 j |
| 7 | Édition & suppression | §8.4, §8.5 | 2,5 j |
| 8 | Multi-STRR | §9 | 1 j |
| 9 | Export XLSX / PDF | §10 | 2,5 j |
| 10 | Stockage / perf / erreurs / sécurité | §11–§14 | 2 j |
| 11 | Recette finale | §16 | 1 j |
| | **Total** | | **≈ 20,5 j** |

**Jalons de démo intermédiaires** : fin de phase 2 (import → dashboard), fin de phase 6 (première comparaison visuelle complète), fin de phase 9 (chaîne complète import → export).

Chaque phase se termine par : tests unitaires du core au vert, `tsc --noEmit` et lint propres, démo fonctionnelle sur les fixtures.

---

*Plan soumis à validation. Le développement (phase 0) ne démarrera qu'après accord explicite — en particulier sur les décisions D1 à D10.*
