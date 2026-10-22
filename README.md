# A²-Med — recherche dans les recommandations SPILF

https://phyrise.github.io/a2med/

Application web (PWA) de recherche documentaire : on écrit une question ou des mots-clés, l'app affiche directement la page
du PDF ou la diapo la plus pertinente des recommandations, puis les suivantes. Aucune réponse n'est rédigée automatiquement :
le médecin lit le document original.

- Fonctionne **hors ligne** une fois installée : au premier lancement, l'app télécharge le modèle de recherche, l'index et les
  PDF (environ 420 Mo, Wi-Fi conseillé), puis tout reste sur le téléphone. Les mises à jour ne téléchargent que les fichiers
  modifiés (vérifiés par SHA-256).
- Recherche : EmbeddingGemma 300M (Q4, 512 dimensions) exécuté dans le navigateur + BM25, fusion RRF, résultats par page.
  Depuis la 0.7, l'index TC_i8 : chaque passage est encodé avec le titre de son document, la fin des passages longs a ses
  propres vecteurs, vecteurs en int8.
- iPhone : ouvrir dans Safari puis « Partager → Sur l'écran d'accueil », et lancer l'app depuis l'icône.
- Prototype de recherche, pas un dispositif médical : vérifiez toujours la page affichée.

## Contenu du dépôt
- `site/` : ce que publie GitHub Pages, tel quel (`.github/workflows/pages.yml`).
  - l'app (`index.html`, `*.js`, `style.css`, `vendor/pdfjs`), Transformers.js et ONNX Runtime Web (`lib/`) ;
  - `data/manifest.json` : la version des données annoncée ; `data/pack-NNN/files/` : ses fichiers. Le fichier du modèle
    (188 Mo) est découpé en morceaux de 45 Mio (`.part1`…), recollés et vérifiés par l'app.
- Documents : recommandations SPILF et sociétés associées, librement redistribuables.

## Mettre à jour (sur le Mac, dossier `AA-Med`)
Depuis la 0.7, l'app vient de `webapp_rc_0.7/`.
1. Nouveau pack prêt dans `mobile_final_004/pack-NNN/` : `python3 webapp_rc_0.7/announce_pack.py pack-NNN`
2. Après une modification de l'app : `python3 webapp_rc_0.7/stamp_shell.py`
3. `python3 webapp_rc_0.7/build_github.py github_a2med` (reconstruit `site/`), puis commit et push.
Les téléphones voient la mise à jour au retour dans l'app (ou Réglages → Données et mises à jour → Vérifier maintenant).
