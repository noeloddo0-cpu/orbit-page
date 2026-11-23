# Journal des versions d’Orbit

Les notes sont orientées usage. Les données personnelles ne sont jamais incluses dans ce fichier.

## 1.0.34 — 23 novembre 2026

### Fiche jeu complète et accessible

- La fiche jeu distingue désormais une **vue lecture** et une **vue édition** : type, note, critique, note personnelle, tags, plateformes possédées, possession numérique ou physique, format, boutique, dates d’achat, de début et de fin, et temps importé.
- Tous les champs sont enregistrés dans `library.json`, relus après rechargement et reflétés immédiatement dans **Ma fiche Orbit Play**.
- Le bouton **Enregistrer** reste explicite ; **Ctrl+Entrée** enregistre au clavier. Un brouillon et un indicateur signalent les modifications non enregistrées, et la fermeture demande confirmation avant de les perdre.
- Le panneau piège le focus, rend le fond `inert` et se ferme avec **Échap** sans laisser le focus derrière lui.
- Si le pont HTTP n’est plus joignable, la fiche passe en **lecture seule** et se reconnecte automatiquement ; le mode fichier local reste éditable.
- Les fiches migrées restent lisibles grâce au miroir `meta.playDetails`. Le marqueur `detailsVersion=2` évite de ressusciter une ancienne valeur effacée volontairement.
- Les statuts historiques ne sont pas migrés en masse et **Neutre** reste réservé à un choix explicite.
- L’ouverture et la fermeture rapides de plusieurs fiches ne laissent ni écran noir ni tuile fantôme : les animations sont finalisées une seule fois, avec un filet de sécurité.

### Qualité

- **39 tests sur 39** réussis, dont la persistance complète après redémarrage, l’effacement volontaire, les validations, le miroir `playDetails`, `PUT /api/state` et le renommage sans perte.
- Validation navigateur : enregistrement au clavier, rechargement, renommage aller-retour, focus piégé, garde des modifications, lecture seule après arrêt du pont, reconnexion automatique et cinq ouvertures/fermetures rapides.
- Rendu vérifié sur les thèmes **Papier**, **OLED** et **Chambre noire** : libellés lisibles, champs contrastés et aucun débordement horizontal.
- Lint : 0 erreur (3 avertissements préexistants dans `launcher.js`) ; formatage vérifié.

## 1.0.33 — 23 novembre 2026

### Centre de santé des données

- Nouveau panneau **Réglages → Santé et diagnostic** enrichi : résumé lisible, anomalies groupées, examen détaillé et filtres.
- Les anomalies détectées restent visibles sans être modifiées : sessions orphelines, métadonnées orphelines, jeux sans jaquette, films sans affiche et doublons probables.
- Chaque correction est d’abord **prévisualisée**, puis appliquée avec un journal d’annulation. Une session peut être rattachée à un jeu, une métadonnée rattachée ou archivée, un jeu ou une application classé.
- Les anomalies sans correction sûre restent dans **Examiner** ; rien n’est supprimé automatiquement.
- Les anomalies peuvent être ignorées avec une justification, puis réactivées. Le rapport et les exports **JSON** et **CSV** contiennent les mêmes compteurs.
- Badges discrets sur les tuiles (**Sans jaquette**, **Type inconnu**) et dans le gestionnaire de sessions (**Session orpheline**).

### Actions de masse et vues sauvegardées

- Nouveau mode **Sélectionner** dans la bibliothèque : cases à cocher, plage avec **Maj+clic**, **Ctrl+A** pour tout sélectionner dans le filtre, **Suppr** pour ouvrir la confirmation et **Échap** pour quitter.
- Barre d’actions pour changer en une fois le statut, la complétion, le type, les tags, les plateformes ou le favori de plusieurs jeux.
- Suppression multiple avec confirmation explicite, corbeille Orbit et annulation de 10 secondes. Les sessions et les fiches restent conservées ; une restauration remet les jeux et les favoris à l’identique.
- Filtre par type (**Jeux**, **Applications**, **Tout**) sans changer l’affichage par défaut de la bibliothèque.
- **Vues sauvegardées** : enregistrer la recherche, les filtres, le tri et le type affiché, appliquer une vue en un clic ou la supprimer avec confirmation.
- Chips de filtres actifs avec retrait individuel, compteur **X résultats sur Y**, et restauration du dernier filtre, tri et recherche après redémarrage.
- Les préférences sont enregistrées côté serveur et en local ; les vues restent disponibles après redémarrage.

### Qualité

- 37 tests sur 37 réussis, dont 50 jeux modifiés puis annulés à l’identique, 3 suppressions restaurées avec favoris, l’expiration de l’annulation après 10 secondes et le rechargement des vues.
- Lint : 0 erreur (3 avertissements préexistants dans `launcher.js`) ; formatage vérifié.

## 1.0.32 — 23 novembre 2026

### Sauvegardes et restauration

- Chaque nouvelle sauvegarde contient un `backup-manifest.json` avec la date, la raison, la version, les compteurs (jeux, sessions, films, séries) et l’empreinte SHA-256 de chaque fichier.
- La sauvegarde est relue et vérifiée après écriture. Le résultat est affiché dans **Réglages → Données et sauvegardes**.
- Les fichiers abîmés sont copiés en `.corrupt-<horodatage>` avant toute restauration automatique. Le message de l’application correspond désormais à ce qui se passe réellement.
- Les dix sauvegardes automatiques et les cinq sauvegardes manuelles les plus récentes sont conservées séparément. Une sauvegarde manuelle n’est plus supprimée par la rotation automatique.
- `psn-reference.json` est inclus dans les sauvegardes. `config.json`, `discord-env-path.txt`, `tmdb-api-key.txt` et `.env` restent exclus.
- L’import et la restauration passent par un dossier de préparation. En cas d’échec, Orbit remet en place la sauvegarde créée juste avant l’opération.
- Les jaquettes identiques sont partagées entre sauvegardes par lien physique lorsque c’est possible, ce qui réduit la taille des nouvelles sauvegardes.

### Sessions

- Nouvelle API `/api/v1/sessions` : créer, modifier, supprimer, découper et fusionner des sessions, avec révision optimiste.
- Une session supprimée reste supprimée après redémarrage et après un ancien `PUT /api/state` ; une annulation de 10 secondes est proposée.
- La fiche jeu affiche **Voir toutes les sessions** : tableau complet, source, note, durée, modification, découpage, fusion et suppression.
- Les chevauchements et les sessions de plus de 24 heures demandent une confirmation explicite.
- Les tests couvrent la création, l’édition, la suppression persistante, le découpage, la fusion et les conflits de révision.

### Identifiants stables des jeux (v2, appliqué)

- Nouveau format `library.json` version 2 : chaque jeu possède un identifiant stable, un nom modifiable, un type, son statut, son temps de jeu, ses notes et ses dates. Les champs historiques (`n`, `s`, `c`, `m`, `t`) restent en miroir pour ne pas casser les thèmes ni les anciens clients.
- Les sessions stockent désormais `gameId` et `gameNameSnapshot` ; les favoris utilisent les identifiants des jeux ; `meta.json` est réindexé par `gameId` avec une table d’alias SHA-1 et les métadonnées orphelines conservées dans `_orphans`.
- La fiche liée au nom courant du jeu est prioritaire. Les fiches en doublon récupérées par leur titre sont fusionnées sans écraser la fiche principale et conservées dans `_archived`. Le titre historique est gardé dans `previousTitles` lors d’un renommage.
- Les jaquettes sont référencées explicitement par `meta.artwork` : un renommage ne perd ni la jaquette, ni les métadonnées, ni les sessions, ni le favori.
- Nouvelles routes `PATCH` / `DELETE` / `POST .../restore` et favori par identifiant. `PUT /api/state` en v2 est additif : un client en retard ne supprime plus de jeu, de session ou de favori, et ne ressuscite pas un jeu supprimé.
- L’interface propose **Renommer** dans la fiche, une suppression avec annulation de 10 secondes et des favoris par identifiant.
- `scripts/migrate-v2.mjs` : dry-run par défaut, sauvegarde vérifiée avant écriture, rapport des correspondances et orphelins, relecture après écriture, retour arrière `--rollback`.
- Validation effectuée sur une copie isolée des données réelles : 273 jeux, 198 sessions, 2 favoris, 619 jaquettes, 16 sessions orphelines signalées sans suppression. Sur les 23 métadonnées sans jeu courant, 4 fiches en doublon ont été rattachées puis archivées dans `_archived` et 19 restent dans `_orphans` ; aucune n’est supprimée.
- Migration appliquée aux données réelles le 23 novembre 2026 après sauvegarde vérifiée `2026-11-23T00-44-14-486Z`. Contrôle après migration : 273 jeux et 198 sessions conservés, aucun champ de jeu modifié, aucun horaire de session modifié, 277 alias, 19 métadonnées orphelines et 4 doublons archivés. Un retour arrière reste possible avec `node scripts/migrate-v2.mjs --rollback latest` (dossier de données réel par défaut).

### Diagnostic et santé des données

- Journal local JSONL dans `%APPDATA%\orbit\logs`, avec rotation 5 fichiers × 2 Mo.
- Les jetons, clés API, mots de passe et paramètres sensibles sont remplacés par `[redacted]` avant écriture.
- Nouvelles routes locales `GET /api/health` et `GET /api/diagnostics`, en lecture seule.
- Nouveau panneau **Réglages → Santé et diagnostic** : jeux, sessions, films, séries, sessions orphelines, métadonnées orphelines, jaquettes manquantes, films sans affiche, applications classées, doublons probables, heures de jeu et dernière sauvegarde.
- Bouton **Copier le diagnostic** : le rapport ne contient aucun secret.

### Sécurité du pont local

- Un jeton aléatoire est généré à chaque démarrage et injecté dans la page. Toutes les requêtes mutantes (`POST`, `PUT`, `PATCH`, `DELETE`) l’exigent.
- Les requêtes portant une origine inconnue ou un `Sec-Fetch-Site` externe sont refusées.
- Une CSP stricte remplace les scripts inline non identifiés : chaque script reçoit un nonce à la volée, sans `unsafe-eval`.
- Les images importées sont contrôlées par leurs octets magiques (JPEG, PNG, WebP), pas seulement par leur type déclaré.
- Les routes de recherche et les routes cinéma/Steam sont limitées en débit.
- Les secrets gérés par Orbit (jeton Discord, clé TMDB) migrent vers `secrets.json`, chiffré par Windows (`safeStorage`). La migration relit la valeur chiffrée avant de retirer l’ancien fichier en clair.
- Les fenêtres externes sont refusées par défaut ; seuls les domaines utiles et les liens Steam vérifiés sont ouverts dans le navigateur.

### Livraison

- `express` est retiré des dépendances : le pont utilise uniquement `node:http`.
- La page projet `index.html` est en français et décrit les fonctions réelles d’Orbit.
- Ajout de `CHANGELOG.md`, `docs/RELEASE.md` et d’une vérification de qualité dans GitHub Actions.
- Les fenêtres externes sont refusées par défaut ; les liens HTTP(S) sont ouverts dans le navigateur et les liens Steam vérifiés restent autorisés.

### Limites connues

- Le fichier `.env` choisi pour Discord reste géré par l’utilisateur et peut contenir le jeton en clair : Orbit ne le réécrit pas. Les secrets saisis dans Orbit sont, eux, chiffrés par Windows.
- La migration des identifiants stables des jeux est appliquée aux données réelles depuis la 1.0.32. Les sauvegardes antérieures restent lisibles et un retour arrière est documenté dans `docs/RELEASE.md`.
- L’installateur n’est pas signé. Windows SmartScreen peut afficher un avertissement.

## 1.0.31

- Version de référence précédente : bibliothèque, Orbit Play, films et séries, statistiques, thèmes, suivi Discord, import Steam, trophées Steam, mini-mode et sauvegardes.
