# 🔍 Analyse UX du projet & améliorations implémentées

> Audit réalisé sur l'application de comparaison Excel STRR, suivi de
> l'implémentation des quatre axes demandés. Contrainte structurante :
> l'application est **100 % locale sans réseau** (CDC §2.1, §14) —
> l'« intelligence » de personnalisation est donc une **intelligence
> embarquée** : heuristiques comportementales et suivi d'usage stockés
> en `localStorage` sur le poste, aucun service externe.

---

## Audit initial

| Écran | Constat |
|---|---|
| Import | Textes techniques (« indexé en mémoire », « signature binaire ») ; réglages référentiel/version affichés même quand la détection a réussi. |
| Sélection des champs | Barre de profils, « fuzzy matching (fallback) » et sens d'amélioration exposés en permanence alors que ~90 % des usages se limitent à cocher/décocher et lancer. |
| Tableau | 8 commandes permanentes dans la barre d'outils, ligne de filtres toujours visible, 5 boutons d'action par ligne : densité élevée, action principale (exporter) noyée. |
| Transverse | Aucune mémoire des habitudes : niveau de détail, colonnes, format d'export préféré à reconfigurer à chaque session. |

---

## Axe 1 — Divulgation progressive (Progressive Disclosure)

**Principe appliqué : chaque écran ne montre que son action principale ;
tout le reste arrive à la demande.**

| Écran | Avant | Après |
|---|---|---|
| Import | Réglages référentiel/version toujours affichés | Badges simples quand la détection a réussi ; réglages visibles uniquement si la détection a échoué, ou via le lien « modifier » |
| Sélection des champs | Profils + fuzzy + sens d'amélioration permanents | Cases à cocher + « Lancer la comparaison » seuls ; tout le reste derrière **⚙ Options avancées** (état retenu pour les habitués) |
| Tableau | 8 commandes + filtres permanents | Recherche, Annuler/Rétablir, Exports seuls ; niveau de détail, regroupement, lignes supprimées, filtres par colonne et choix des colonnes regroupés dans le menu **👁 Affichage ▾** |
| Lignes du tableau | 5 boutons d'action toujours visibles | Actions révélées au **survol** de la ligne (les états actifs — verrou posé, case export décochée — restent visibles) |

## Axe 2 — Reformulation des textes

Le jargon technique a été remplacé par des verbes d'action, complété
d'infobulles contextuelles (`title`) sur chaque commande :

| Avant (jargon) | Après |
|---|---|
| « Fuzzy matching des libellés (fallback) » | « Tolérer les petites différences d'orthographe entre les deux fichiers » + infobulle expliquant le cas d'usage |
| « Recherche globale (index mémoire)… » | « Rechercher un article, un champ, une opération… » |
| « Niveau OP (détail) / Section (agrégé) / STRR (global) » | « Détail par opération / Totaux par section / Totaux par référentiel » |
| « 💾 Session / 📂 Charger » | « 💾 Sauvegarder / 📂 Reprendre » + infobulles décrivant le résultat |
| « fichiers indexés en mémoire » | « prêt pour la comparaison » ; « Vos fichiers restent sur votre ordinateur : rien n'est envoyé sur Internet. » |
| « Suppression logique », « mismatch ACTUEL/PROPOSER » | « Supprimé — rien n'est perdu, cliquez ↩ Annuler » ; « il manque sa version ACTUEL/PROPOSER » |
| Boutons « Charger / Enregistrer » (profils) | « Appliquer / Mémoriser… » |

## Axe 3 — Personnalisation du parcours (usage retenu localement)

Module `src/state/usage.js` : compteurs d'actions + préférences,
persistés en `localStorage` (purge synchrone à la fermeture de page pour
ne rien perdre). Effets :

- **Boutons d'export réordonnés** : le format le plus utilisé (Excel ou
  PDF) passe en première position.
- **Préférences d'affichage retrouvées** d'une session à l'autre :
  niveau de détail, regroupement par article, colonnes visibles,
  filtres par colonne.
- **Profils de champs triés par fréquence d'utilisation** : le profil
  favori est en tête de liste.
- **Panneau « Options avancées »** : rouvert automatiquement pour les
  utilisateurs qui s'en servent.

## Axe 4 — Automatisation des tâches répétitives (macros locales)

- **Macro « ⚡ Relancer comme la dernière fois »** : chaque comparaison
  mémorise sa configuration (champs cochés, sens d'amélioration,
  tolérance d'orthographe). Au prochain import, un seul clic ré-applique
  tout et affiche directement le tableau — l'étape 2 est sautée.
- **Suggestion d'export apprise** : dès que l'utilisateur a exporté
  deux fois, chaque nouvelle comparaison propose son format favori en
  un clic (« 💡 Vous exportez souvent en Excel — exporter maintenant »),
  avec possibilité d'ignorer pour la session.

---

## Vérifications exécutées

- 40/40 tests unitaires (dont le module d'usage) ;
- parcours e2e complet piloté dans Chromium sans erreur JavaScript ;
- scénario deux sessions : la macro ⚡ apparaît après rechargement,
  relance l'analyse avec le niveau de détail retenu, et la suggestion
  d'export s'affiche après deux exports ;
- benchmark 100 000 lignes inchangé (comparaison ≈ 0,19 s, défilement
  fluide à ~38 nœuds DOM).
