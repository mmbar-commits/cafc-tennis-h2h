# Ligue CAFC Tennis Simple — Head 2 Head (2023–2026)

Outil web autonome permettant d'afficher un **Head 2 Head complet** entre deux joueurs de la **Ligue CAFC Tennis en simple** sur l'ensemble des 13 saisons historiques (Hiver 2023 à Printemps/Été 2026).

## Utilisation immédiate

L'application finale est 100 % autonome dans un seul fichier HTML sans serveur ni build requis :

- En ligne via GitHub Pages : https://mmbar-commits.github.io/cafc-tennis-h2h/
- Ou en ouvrant directement [`index.html`](./index.html) dans n'importe quel navigateur moderne.

## Données & Audit de fiabilité

- **Source** : Archives Mehdi Barouti (`13` saisons complètes de Ligue CAFC Tennis en simple, Hiver 2023 – Printemps/Été 2026).
- **Volume** : **4 875 matchs joués**, **252 joueurs actifs**, **3 138 confrontations uniques**.
- **Super Tie-Breaks** : **759 scores exacts** de Super Tie-Breaks reconstitués (sur 766 Super Tie-Breaks disputés, comptabilisés `1–0` au classement officiel de la Ligue).
- **Audit croisé** : `1 614` lignes joueur-saison vérifiées contre les classements officiels (`J`, `Diff. Sets`, `Diff. Jeux`) → **0 écart**.

### Gestion des homonymes

Chaque joueur est identifié de manière unique par son couple **(Nom, Numéro de téléphone actif partiellement masqué)** :

- **Homonymes actifs strictement séparés** (badge `HOMONYME` + dernier numéro actif partiellement masqué + division/période) :
  - **Saad Bennani** (2 joueurs : `+212 6 •• •• 46 47` Div. Étoile vs `+212 6 •• •• 07 24` Div. 6–9)
  - **Simo Zizi** (3 joueurs : `+212 6 •• •• 73 56` Div. Étoile, `+212 6 •• •• 88 03` Div. 1–2, `+212 6 •• •• 89 80` Div. 2–3)

## Fonctionnalités

- **Recherche instantanée & désambiguïsation** : recherche insensible aux accents par nom ou chiffres du numéro de téléphone, priorisation des adversaires déjà affrontés, inversion rapide et tirage de rivalité aléatoire.
- **Tableau de bord H2H complet** : score global, série en cours, dernier match, filtre par période.
- **Statistiques & graphiques SVG** : comparaison *H2H Direct / Carrière* (sets, jeux, 2 sets secs, 3 sets, Super Tie-Breaks, Tie-Breaks `7–6`, bulles `6–0`), courbe d'évolution du H2H et trajectoire des divisions sur les 13 saisons.
- **Historique complet & Adversaires communs** : chaque match avec scores exacts des Super Tie-Breaks et H2H cumulé, plus comparaison indirecte sur les adversaires communs.
- **Explorateurs dédiés** : onglets *Grandes Rivalités* et *Annuaire & Homonymes* (table de données défilable avec colonne *Première saison*).

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
