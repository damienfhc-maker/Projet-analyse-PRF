📄 CAHIER DES CHARGES COMPLET – APPLICATION WEB LOCALE DE COMPARAISON EXCEL
1. CONTEXTE ET FINALITÉ DU PRODUIT

L’application est une solution web locale (offline-first) destinée à comparer des fichiers Excel structurés représentant des versions différentes d’un même référentiel métier.

Elle permet de comparer automatiquement des fichiers de type :

STRR-00339 - ACTUEL
STRR-00339 - PROPOSER

L’objectif est de produire un diff structuré, éditable et exportable, sans perte de données et avec une forte capacité d’adaptation aux variations de structure Excel.

2. PRINCIPES FONDAMENTAUX
2.1 Offline-first
Aucune dépendance Internet
Tout le traitement se fait localement (machine utilisateur ou serveur local)
2.2 Data-driven
L’application s’adapte à la structure réelle des fichiers Excel
Aucune structure figée imposée
2.3 Comparison-first
Le cœur du système est un moteur de comparaison intelligent
Toute fonctionnalité découle de ce moteur
3. ARCHITECTURE GLOBALE
3.1 Architecture recommandée
Frontend (UI)
React (recommandé) ou Vue.js
TypeScript fortement recommandé
Backend local (optionnel mais conseillé)
Node.js + Express
Parsing Excel
SheetJS (xlsx)
XLSX-populate (optionnel pour écriture avancée)
Stockage temporaire
In-memory store (Redux / Zustand / Pinia)
Option cache local IndexedDB pour gros fichiers
3.2 Schéma global
[ Excel Files ]
      ↓
[ Parser XLSX ]
      ↓
[ Normalisation Data Engine ]
      ↓
[ Matching Engine (STRR ID) ]
      ↓
[ Comparison Engine ]
      ↓
[ UI Editable Table ]
      ↓
[ Export Engine (XLSX / PDF) ]
4. MODULE D’IMPORT DES FICHIERS
4.1 Formats supportés
.xls
.xlsx
.xlsm (optionnel)
4.2 Upload
Drag & Drop
Sélection multiple
Validation immédiate
4.3 Parsing initial

À l’import :

Lecture complète du fichier
Extraction des feuilles pertinentes
Conversion en structure JSON normalisée
4.4 Normalisation des données

Chaque ligne devient :

{
  "strr_id": "STRR-00339",
  "type": "ACTUEL | PROPOSER",
  "section": "Travail Machine",
  "operation": "OP10",
  "fields": {
    "Matière": 12.5,
    "Travail Machine": 8.2
  }
}
4.5 Règles d’exclusion obligatoires

Ignorer totalement :

% Rubrique
% Total

👉 suppression dès parsing (pas seulement UI)

5. MOTEUR DE MATCHING (CORE LOGIC)
5.1 Matching principal

Les fichiers sont appariés via :

STRR ID (ex: STRR-00339)
Type (ACTUEL / PROPOSER)
5.2 Matching secondaire (niveau ligne)

Pour les sections :

Travail Machine
Travail M.O.

Le matching se fait par :

OP code (OP10, OP20, etc.)
ordre si OP absent
fallback fuzzy matching (optionnel)
5.3 Gestion des différences structurelles

Cas possibles :

OP présent dans ACTUEL mais absent PROPOSER → ❌ suppression
OP absent ACTUEL mais présent PROPOSER → ➕ ajout
OP identique → comparaison directe
6. MOTEUR DE COMPARAISON
6.1 Logique

Pour chaque champ sélectionné :

DELTA = PROPOSER - ACTUEL
6.2 Sortie standard
{
  "strr_id": "STRR-00339",
  "field": "Matière",
  "actual": 10,
  "proposed": 12,
  "delta": 2
}
6.3 Gestion multi-niveaux

Comparaison possible à 3 niveaux :

Global STRR
Section (Travail Machine / M.O.)
OP line
7. SÉLECTION DYNAMIQUE DES CHAMPS
7.1 UI de configuration

Avant comparaison :

Liste automatique des colonnes détectées
Checkbox par champ
Groupes de champs

Ex :

Groupe “Coûts”
Matière
Travail Machine
Travail M.O.
Groupe “Marges”
Marge matière
Marge sur travail
7.2 Profils de comparaison
Sauvegarde locale des configurations
Rechargement rapide
Exemple :
“Analyse coût”
“Analyse marge”
8. INTERFACE UTILISATEUR
8.1 Dashboard principal
Import fichiers
Liste STRR détectés
Statut ACTUEL / PROPOSER
Bouton “Comparer”
8.2 Écran de sélection
Colonnes détectées dynamiquement
Groupes filtrables
Prévisualisation live
8.3 Tableau de comparaison
Structure :

| STRR | Section | OP | Champ | ACTUEL | PROPOSER | DELTA |

Fonctionnalités :
Tri multi-colonnes
Filtre texte
Recherche globale
Color coding :
vert = amélioration
rouge = dégradation
toggle colonnes visibles
8.4 Mode édition
Inline editing cellules
Validation automatique type (number/string)
Undo/Redo stack
Lock comparaison individuelle
8.5 Suppression intelligente
Supprimer :
une ligne OP
une section complète
un STRR complet
Checkbox "inclure dans export"
9. GESTION MULTI-COMPARAISONS
9.1 Support multi STRR

Ex :

STRR-00339
STRR-00650
STRR-00895
9.2 UI multi-context

Chaque STRR est un bloc indépendant :

[ STRR-00339 ] ✔ inclure
[ STRR-00650 ] ❌ exclure
[ STRR-00895 ] ✔ inclure
9.3 Isolation des datasets

Chaque comparaison est indépendante en mémoire.

10. EXPORT
10.1 Excel (.xlsx)
Structure fidèle UI
Multi-feuilles :
Feuille 1 : synthèse
Feuille 2+ : détail STRR
10.2 PDF
Rapport structuré :
couverture
résumé global
tableaux détaillés
pagination automatique
version imprimable
10.3 Export filtré

Respect strict de :

suppressions utilisateur
exclusions STRR
champs décochés
11. PERFORMANCE & OPTIMISATION
11.1 Contraintes
support 100 000+ lignes
parsing rapide (< 3 sec idéal)
UI fluide
11.2 Optimisations obligatoires
Parsing unique (no re-read Excel)
Cache mémoire centralisé
Indexation :
Map<STRR_ID, Dataset>
Virtualized table (React Window / TanStack Table)
12. STOCKAGE LOCAL
12.1 Modes
Mémoire RAM (par défaut)
IndexedDB (option gros fichiers)
Export/import session JSON
12.2 Structure session
{
  "files": [],
  "comparisons": [],
  "userConfig": {},
  "excludedItems": []
}
13. GESTION D’ERREURS
fichier illisible
structure Excel inconnue
STRR manquant
mismatch ACTUEL / PROPOSER

Messages UI clairs + logs techniques

14. SÉCURITÉ (LOCAL ONLY)
aucun upload externe
aucun appel API externe
sandbox file reader
validation stricte des fichiers importés
15. EXTENSIBILITÉ

Architecture pensée pour évoluer vers :

API backend distante
multi-utilisateurs
base de données PostgreSQL
historique comparaisons
audit trail
16. CRITÈRES DE VALIDATION FINALE

Le projet est validé si :

✔ import multi Excel fonctionnel
✔ matching ACTUEL / PROPOSER automatique
✔ exclusion colonnes respectée
✔ OP dynamiques gérées correctement
✔ sélection champs fonctionnelle
✔ tableau éditable complet
✔ suppression logique opérationnelle
✔ export Excel fidèle
✔ export PDF lisible
✔ performance acceptable sur gros fichiers
17. CONSIGNES DE DÉVELOPPEMENT POUR FABLE 5

Consignes spécifiques

Avant toute génération de code :

- Lire intégralement le cahier des charges.
- Construire un plan de développement.
- Développer par modules indépendants.
- Vérifier chaque module avant de passer au suivant.

Pendant le développement :

- Ne jamais produire de code inachevé.
- Ne jamais produire de pseudo-code.
- Ne jamais laisser de TODO.
- Ne jamais générer une fonction sans son intégration complète.
- Réutiliser les fonctions existantes.
- Respecter strictement l'architecture.
- Prioriser les performances.
- Prioriser la maintenabilité.
- Optimiser systématiquement la consommation mémoire.
- Toutes les recherches doivent être effectuées sur la base JavaScript indexée en mémoire.

Lors des corrections :

- Modifier uniquement les fonctions concernées.
- Ne jamais régénérer un fichier complet.
- Fournir uniquement les blocs à remplacer.
- Indiquer précisément leur emplacement.

Avant de considérer le projet terminé :

- Vérifier que tous les critères de recette sont satisfaits.
- Vérifier qu'aucune fonctionnalité du cahier des charges n'a été omise.
- Vérifier que l'application fonctionne entièrement hors ligne.
- Vérifier qu'aucune lecture des fichiers CSV/XLS/XLSX n'est réalisée après l'indexation initiale.
