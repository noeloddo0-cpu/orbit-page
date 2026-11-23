# Publier une version d’Orbit

## Copie de référence

La copie de référence est **`Orbit-GitHub`**. Toutes les modifications, les tests et les builds partent de ce dépôt. La copie `discord-bridge` est une archive de lecture seule : elle ne doit plus recevoir de modifications à la main.

## Avant de construire

1. Vérifier que la branche est propre : `git status --short` ne doit rien afficher.
2. Vérifier la version dans `package.json` et `package-lock.json`.
3. Mettre à jour `CHANGELOG.md` avec une entrée datée, en français.
4. Lancer :

   ```powershell
   npm ci
   npm run check
   npm audit --omit=dev
   ```

5. Vérifier que `npm ls express --depth=0` ne montre plus de dépendance directe.
6. Construire depuis un clone propre, pas depuis un dossier de travail modifié :

   ```powershell
   git clone <dépôt> orbit-release
   cd orbit-release
   npm ci
   npm test
   npm run dist:installer
   ```

## Contenu attendu de l’installateur

- `desktop-main.js`, `desktop-preload.cjs`, `bridge.js`, `bibliotheque.html`, `launcher.js`, `launcher.css`.
- `orbit-log.mjs`, `orbit-backup.mjs`, `orbit-secrets.mjs`, `orbit-library.mjs`, `steam-achievements.mjs`, `steam-local.mjs` et les modules cinéma/statistiques.
- Les 13 thèmes enregistrés, leurs polices et licences.
- `THIRD_PARTY.md`, `THIRD-PARTY-NOTICES.md`, `icon.svg`.
- Aucun fichier de données personnel : ni `library.json`, ni `cinema.json`, ni `meta.json`, ni `covers/`, ni `backups/`, ni `.env`, ni `config.json`, ni `tmdb-api-key.txt`, ni `secrets.json`.

## Après le build

1. Noter la taille de l’installateur et calculer son empreinte :

   ```powershell
   Get-FileHash .\dist\Orbit-Setup-1.0.32.exe -Algorithm SHA256
   ```

2. Installer dans un dossier de test et vérifier :
   - l’icône de la fenêtre et de la zone de notification ;
   - l’ouverture de la bibliothèque et d’Orbit Play ;
   - les 13 thèmes ;
   - `Ctrl+Alt+O` et le mini-mode ;
   - **Réglages → Santé et diagnostic** ;
   - **Créer une sauvegarde** puis **Tester la dernière** ;
   - une session manuelle démarrage/arrêt, puis **Voir toutes les sessions** : modification, découpage, fusion et annulation d’une suppression ;
   - sur une **copie isolée** des données, la migration v2 en dry-run, puis le renommage d’un jeu, la suppression et l’annulation : sessions, favoris et jaquettes conservés ;
   - une requête `POST /api/flush` sans jeton doit répondre 403 ;
   - après le premier lancement, `config.json` ne contient plus `botToken` et `secrets.json` existe dans le dossier de données ;
   - l’absence de données de test dans le dossier utilisateur réel.

3. Publier l’installateur et son SHA-256 dans la version GitHub.
4. Taguer `v1.0.32` et pousser le tag.

## Migration v2 des données réelles

La migration a été appliquée le 23 novembre 2026 après sauvegarde vérifiée. La sauvegarde de référence est `%APPDATA%\orbit\backups\2026-11-23T00-44-14-486Z`.

Contrôle effectué après migration :

- 273 jeux et 198 sessions conservés ;
- aucun champ de jeu modifié, aucun horaire de session modifié ;
- 2 favoris, 619 jaquettes et 277 alias conservés ;
- 19 métadonnées orphelines dans `_orphans` et 4 doublons archivés dans `_archived`, sans suppression ;
- 16 sessions orphelines toujours signalées, jamais supprimées.

Pour revenir en arrière :

```powershell
node scripts\migrate-v2.mjs --rollback latest
```

Le script utilise `%APPDATA%\orbit` par défaut. La commande remplace l’état courant par la sauvegarde vérifiée et conserve l’état remplacé dans un nouveau dossier de sauvegarde.

## Retour arrière

- Conserver l’installateur précédent et son SHA-256.
- Ne jamais supprimer `%APPDATA%\orbit` lors d’une réinstallation.
- En cas de problème de données, restaurer une sauvegarde vérifiée depuis **Réglages → Données et sauvegardes**. Le fichier abîmé est conservé en `.corrupt-<horodatage>`.

## Signature Windows

L’installateur n’est pas signé. La configuration Authenticode pourra être ajoutée quand un certificat sera disponible. Tant que ce n’est pas le cas, SmartScreen peut afficher un avertissement : ne pas promettre le contraire dans les notes de version.
