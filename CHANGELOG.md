# Journal des versions d’Orbit

Les notes sont orientées usage. Les données personnelles ne sont jamais incluses dans ce fichier.

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
