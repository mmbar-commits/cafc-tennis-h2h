# CAFC Tennis — Head 2 Head Historique (2023–2026)

Outil web autonome permettant d'afficher un **Head 2 Head complet** entre deux joueurs de la **Ligue CAFC Tennis** sur l'ensemble des résultats historiques (Hiver 2023 à Printemps/Été 2026 + Tournoi 02.2024).

## Utilisation immédiate

L'application finale est 100 % autonome dans un seul fichier HTML sans serveur ni build requis :

- Ouvrez directement [`index.html`](./index.html) dans n'importe quel navigateur moderne (fonctionne également hors ligne).

## Données & Audit de fiabilité

- **Source** : Google Drive `02 - CAFC Tennis / 02 - Ligues et Tournois / 02 - Ligue CAFC Tennis / 05 - Résultats Ligue CAFC Tennis` (`154` PDF `Matchs.pdf` + `154` PDF `Classification.pdf` sur **13 saisons complètes**) et `99 - Autres Tournois / 01 - Tournoi 02.2024` (`2` PDF `Matchs.pdf`).
- **Volume** : **4 898 matchs joués**, **252 joueurs actifs**, **3 148 confrontations uniques**.
- **Audit croisé** : `1 614` lignes joueur-saison vérifiées contre les classements officiels (`J`, `Diff. Sets`, `Diff. Jeux`) → **0 écart**.

### Gestion des homonymes et identités

Chaque joueur est identifié de manière unique par son couple **(Nom, Numéro de téléphone)** :

- **Homonymes actifs strictement séparés** (badge `HOMONYME` + téléphone partiellement masqué + division/période) :
  - **Saad Bennani** (2 joueurs : `+212 6 •• •• 46 47` Div. Étoile vs `+212 6 •• •• 07 24` Div. 6–9)
  - **Simo Zizi** (3 joueurs : `+212 6 •• •• 73 56` Div. Étoile, `+212 6 •• •• 88 03` Div. 1–2, `+212 6 •• •• 89 80` Div. 2–3)
- **13 téléphones familiaux partagés** (parents/enfants) conservés strictement distincts.
- **8 mises à jour de numéro** d'un même adhérent (validées contre les registres Adhérents CAFC) et **6 variantes orthographiques** au numéro identique réconciliées et tracées dans l'onglet *Annuaire & Homonymes*.

## Fonctionnalités

- **Recherche instantanée & désambiguïsation** : recherche insensible aux accents par nom ou chiffres du numéro de téléphone, priorisation des adversaires déjà affrontés, inversion rapide et tirage de rivalité aléatoire.
- **Tableau de bord H2H complet** : score global, série en cours, dernier match, filtres par compétition (*Tout / Ligue / Tournoi 02.24*) et par période, export **« Copier résumé WhatsApp »**.
- **Statistiques & graphiques SVG** : comparaison *H2H Direct / Carrière* (sets, jeux, 2 sets secs, 3 sets, Super Tie-Breaks `1–0`, Tie-Breaks `7–6`, bulles `6–0`), courbe d'évolution du H2H et trajectoire des divisions sur les 13 saisons.
- **Historique complet & Adversaires communs** : chaque match avec H2H cumulé, plus comparaison indirecte sur les adversaires communs.
- **Explorateurs dédiés** : onglets *Grandes Rivalités* et *Annuaire & Homonymes*.

## Mettre à jour les données (nouvelle saison)

Prérequis : `python3`, `pdftotext` (`poppler-utils`), CLI `gdrive` authentifiée (pour l'étape de téléchargement) et `node` + `chromium` (pour les tests UI).

```bash
# 1. Scanner les dossiers de saisons sur Google Drive
python3 scripts/scan_seasons.py

# 2. Télécharger les PDF Matchs & Classifications dans pdfs/
python3 scripts/download_all.py

# 3. Extraire les matchs/classements et vérifier les PDF
python3 scripts/parse_pdfs.py

# 4. Construire le jeu de données canonique (avec audit 0 écart)
python3 scripts/build_dataset.py

# 5. Générer index.html autonome
python3 scripts/build_app.py

# 6. Vérification automatisée dans Chromium (optionnel)
node scripts/test_ui.mjs
```
