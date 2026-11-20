# Ligue CAFC Tennis Simple — Head 2 Head (2023–2026)

Outil web autonome permettant d'explorer les statistiques, classements, rivalités, records et confrontations **Head 2 Head** de la **Ligue CAFC Tennis en simple** sur l'ensemble des **14 saisons** (Hiver 2023 à Automne 2026 en cours, mise à jour au 19.11.2026).

## Utilisation immédiate

L'application finale est 100 % autonome dans un seul fichier HTML sans serveur ni build requis :

- En ligne via GitHub Pages : https://mmbar-commits.github.io/cafc-tennis-h2h/
- Ou en ouvrant directement [`index.html`](./index.html) dans n'importe quel navigateur moderne.

## Données & Audit de fiabilité

- **Source** : Archives Mehdi Barouti (`14` saisons de Ligue CAFC Tennis en simple : 13 saisons clôturées d'Hiver 2023 à Printemps/Été 2026 + Automne 2026 en cours au 19.11.2026).
- **Volume** : **5 250 matchs joués**, **268 joueurs classés** (dont 130 inscrits en Automne 2026), **3 336 confrontations uniques**.
- **Super Tie-Breaks** : **830 scores exacts** de Super Tie-Breaks reconstitués (sur 837 Super Tie-Breaks disputés, soit 99,2 %, comptabilisés `1–0` au classement officiel de la Ligue) + **519 matchs en 3e set complet** (hors STB).
- **Dates de matchs** : **4 592 dates exactes** reconstituées depuis les publications du groupe WhatsApp de la ligue (87,5 % des 5 250 matchs, dont 93,3 % en Automne 2026).
- **Audit croisé** : `1 719` lignes joueur-saison vérifiées contre les classements officiels (`J`, `Diff. Sets`, `Diff. Jeux`) → **0 écart**.

### Gestion des homonymes

Chaque joueur est identifié de manière unique par son couple **(Nom, Numéro de téléphone actif partiellement masqué)** :

- **Homonymes actifs strictement séparés** (badge `HOMONYME` + dernier numéro actif partiellement masqué + division/période) :
  - **Saad Bennani** (2 joueurs : `+212 6 •• •• 46 47` Div. Étoile vs `+212 6 •• •• 07 24` Div. 6–9)
  - **Simo Zizi** (3 joueurs : `+212 6 •• •• 73 56` Div. Étoile, `+212 6 •• •• 88 03` Div. 1–2, `+212 6 •• •• 89 80` Div. 2–3)

## Fonctionnalités

- **Accueil** : vue synthétique de la ligue (KPIs globaux, comparaison Première vs. Dernière saison, graphique d'activité saison par saison avec infobulles au survol, Top 5 Division Étoile en cours, affiches phares et records marquants).
- **Head 2 Head** (Joueur A en vert, Joueur B en orange) : recherche instantanée par nom ou téléphone, badge *Division Actuelle*, statistiques comparatives *H2H Direct / Carrière* (incluant le nombre d'adversaires différents et la comparaison *3e set complet vs. Super Tie-Break*), courbes SVG d'évolution du H2H et des divisions sur 14 saisons, historique complet trié chronologiquement avec dates exactes et scores des Super Tie-Breaks, et comparaison indirecte sur les adversaires communs.
- **Profil Joueur** : fiche individuelle accessible en un clic sur n'importe quel nom de joueur sur le site (statistiques de carrière avec bloc comparatif visuel **3e Set Complet vs. Super Tie-Break**, diversité *adversaires différents*, trajectoire SVG des divisions, parcours saison par saison avec rang de division et rang général, liste complète et filtrable des adversaires affrontés et historique exhaustif des matchs datés et filtrables par 3e set complet / STB).
- **Classement** : classement général et par division pour la saison en cours (*Automne 2026 au 19.11.2026*) ainsi que tous les classements officiels de fin de saison depuis *Hiver 2023*.
- **Grandes Rivalités** : explorateur des affiches récurrentes (le joueur recherché s'affiche toujours à gauche et ses rivaux à droite).
- **Fun Facts & Records** : plus longues séries de victoires et de défaites, classement par nombre d'abandons, plus grandes évolutions de division, Super Tie-Breaks les plus fous, rois du STB, **rois du 3e set complet**, distributeurs de 6–0, champions de division, bêtes noires, marathoniens, plus grand nombre d'adversaires différents, record de victoires et fidèles du Jour 1 (14/14 saisons).
- **Annuaire & Homonymes** : table de données défilable avec colonnes *Première saison*, *Div. Actuelle* et *Adv. diff.*, tris par matchs, victoires, % victoires, adversaires différents, meilleure division, première saison ou nom, et filtres par niveau (*Top Divisions Étoile – Div. 2*, *Divisions Intermédiaires Div. 3 – 7*, *Divisions Progression Div. 8+*, *Inscrits Automne 2026*, *Homonymes*, *50+ matchs*).

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
