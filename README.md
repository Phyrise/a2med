# A²-Med — recherche dans les recommandations SPILF, SFAR et SRLF

https://phyrise.github.io/a2med/

Application web (PWA) de recherche documentaire : on écrit une question ou des mots-clés, l'app affiche directement la page
du PDF ou la diapo la plus pertinente des recommandations, puis les suivantes. Aucune réponse n'est rédigée automatiquement :
le médecin lit le document original.

- Fonctionne **hors ligne** une fois installée : au premier lancement, l'app télécharge le modèle de recherche, l'index et les
  PDF (environ 410 Mo, Wi-Fi conseillé), puis tout reste sur le téléphone. Les mises à jour ne téléchargent que les fichiers
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
- 0.8.5 : boutons de précision allégés. Durée et 1re intention sont retirés (ils écrivaient seulement leur mot ; taper
  « durée » marche comme avant). Les détails du patient viennent d'abord (Allergie · Grossesse · Enfant · Rein), puis
  Posologie · Prophylaxie · Alternative. Mêmes données, même recherche.
- 0.8.6 : app allégée, mêmes résultats (736/736 top 5 identiques sur le banc d'essai). Les modes d'essai et l'ancien index
  de la 0.6 sont retirés ; les tables de polices CJK de pdf.js aussi, aucun des 119 PDF n'en a besoin. Données pack-007 :
  le même corpus sans l'ancien index (408 Mo pour une installation neuve, rien à retélécharger pour une mise à jour).
- 0.9.0 : choix des sources. En plus de l'infectiologie (SPILF, toujours installée), Réglages → Données propose en option
  les recommandations de la SFAR (anesthésie-réanimation, 205 documents, 255 Mo) et de la SRLF (réanimation, 59 documents,
  48 Mo). Sous la question, une puce par source choisit où chercher ; une source non installée a sa puce grisée. Chaque
  résultat porte l'étiquette de sa source. La date affichée est celle du dernier contrôle complet des sites des sociétés
  (la plus ancienne des sources installées). SPILF seule : mêmes résultats que la 0.8.6 (736/736) ; rien à retélécharger
  pour une mise à jour, sauf l'app.
- 0.9.1 : deux recommandations SRLF de plus (61 documents) : le consensus d'experts sur l'encéphalopathie aiguë en
  réanimation (2025) et la conférence de consensus SRLF-GFRUP sur l'épuration extra-rénale (2025). Ce sont des articles en
  anglais d'Annals of Intensive Care, sous licence CC BY 4.0, vers lesquels les fiches SRLF renvoient. Mise à jour : 12,5 Mo
  pour un téléphone qui a SRLF. Si l'app est mise à jour avant ses données, la recherche marche sans la source concernée
  (puce grisée « à mettre à jour ») au lieu de s'arrêter. SPILF : mêmes premiers résultats (736/736).
- iPhone : ouvrir dans Safari puis « Partager → Sur l'écran d'accueil », et lancer l'app depuis l'icône.
- Prototype de recherche, pas un dispositif médical : vérifiez toujours la page affichée.

## Contenu du dépôt
- `site/` : ce que publie GitHub Pages, tel quel (`.github/workflows/pages.yml`).
  - l'app (`index.html`, `*.js`, `style.css`, `vendor/pdfjs`), Transformers.js et ONNX Runtime Web (`lib/`) ;
  - `data/manifest.json` : la version des données annoncée ; `data/pack-NNN/files/` : ses fichiers, avec `sfar/` et `srlf/`
    pour les sources en option (0.9). Le fichier du modèle
    (188 Mo) est découpé en morceaux de 45 Mio (`.part1`…), recollés et vérifiés par l'app.
- Documents : recommandations SPILF et sociétés associées, librement redistribuables ; depuis la 0.9, en option,
  recommandations SFAR et SRLF (dont, depuis la 0.9.1, deux articles d'Annals of Intensive Care sous licence CC BY 4.0 :
  Sonneville et al. 2025, doi:10.1186/s13613-025-01436-0 ; conférence de consensus SRLF-GFRUP 2025,
  doi:10.1186/s13613-025-01517-0).

## Mettre à jour (dépôt `a2med`, à côté de cette copie)
Depuis la 0.8.6, l'app et ses données viennent du dépôt `a2med` (son `README.md` décrit tout, de A à Z).
1. Nouvelle release des données : `pipeline/refresh.py changes/<date>.json --base releases/pack-NNN --out releases/pack-MMM`
2. Après une modification de l'app : `python3 publish/stamp_shell.py`
3. `python3 publish/build_site.py releases/pack-MMM ../github_a2med --source releases/sfar-001 --source releases/srlf-002`
   (reconstruit `site/`), puis commit et push.
Les téléphones voient la mise à jour au retour dans l'app (ou Réglages → Données et mises à jour → Vérifier maintenant).
