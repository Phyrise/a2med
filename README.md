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
- Depuis la 0.8 :
  - toucher Allergie, Posologie, Grossesse… ouvre un petit panneau de précisions (choix fréquents, ou texte libre) ;
  - la recherche part avec la flèche ;
  - le modèle tourne dans un fil à part, si bien que l'écran ne se fige plus au démarrage ni pendant une recherche.
- 0.8.1 : corrige un blocage de l'onglet dans le panneau, qui survenait avec une précision à trait d'union (« Bêta-lactamines »,
  « Nouveau-né »…) ou avec « l'enfant », « d'allergie » tapés dans la question.
- 0.8.2 à 0.8.4 : l'app marche sur iPhone (essayée sur un iPhone 12 en iOS 17.4.1 ; attendu à partir d'iOS 16.4).
  - 0.8.2 : le modèle (197 Mo) est enregistré en morceaux de 45 Mo au plus, recollés et vérifiés (SHA-256) par l'app. Safari
    sur iPhone refusait le fichier entier avec « Internal error ».
  - 0.8.3 : la mémoire du moteur de recherche (ONNX Runtime Web) est plafonnée à 512 Mo au lieu de 4 Go, que Safari sur iPhone
    refusait de réserver (« RangeError: Out of memory »).
  - 0.8.4 : ONNX Runtime Web 1.23.2 au lieu de 1.31-dev : les versions récentes ne démarrent pas sur Safari 17.0 à 17.4
    (« Can't create a session », onnxruntime issue 33426). Mêmes résultats : 736/736 top 5 identiques sur le banc d'essai.
- iPhone : ouvrir dans Safari puis « Partager → Sur l'écran d'accueil », et lancer l'app depuis l'icône.
- Prototype de recherche, pas un dispositif médical : vérifiez toujours la page affichée.

## Contenu du dépôt
- `site/` : ce que publie GitHub Pages, tel quel (`.github/workflows/pages.yml`).
  - l'app (`index.html`, `*.js`, `style.css`, `vendor/pdfjs`), Transformers.js et ONNX Runtime Web (`lib/`) ;
  - `data/manifest.json` : la version des données annoncée ; `data/pack-NNN/files/` : ses fichiers. Le fichier du modèle
    (188 Mo) est découpé en morceaux de 45 Mio (`.part1`…), recollés et vérifiés par l'app.
- Documents : recommandations SPILF et sociétés associées, librement redistribuables.

## Mettre à jour (sur le Mac, dossier `AA-Med`)
Depuis la 0.8, l'app vient de `webapp_proto_003_precisions/` (la 0.7 venait de `webapp_rc_0.7/`).
1. Nouveau pack prêt dans `mobile_final_004/pack-NNN/` : `python3 webapp_proto_003_precisions/announce_pack.py pack-NNN`
2. Après une modification de l'app : `python3 webapp_proto_003_precisions/stamp_shell.py`
3. `python3 webapp_proto_003_precisions/build_github.py github_a2med` (reconstruit `site/`), puis commit et push.
Les téléphones voient la mise à jour au retour dans l'app (ou Réglages → Données et mises à jour → Vérifier maintenant).
