# Publier une version Windows

La page vitrine est le fichier `index.html` à la racine. Les téléchargements de l’application se trouvent dans **Releases**.

## Préparer l’installateur sur GitHub

1. Une fois les sources sur `main`, ouvre **Actions → Préparer une version Windows → Run workflow**. Choisis la branche `main`.
2. GitHub installe les dépendances, teste le démarrage du pont et construit l’installateur sur Windows. Quand les deux tâches sont vertes, ouvre **Releases**. Un brouillon contient déjà l’installateur.
3. Relis le titre et décris les changements. Clique sur **Publish release** lorsque la version est prête pour les utilisateurs.

Si GitHub demande d’activer les workflows, utilise **Actions → Enable workflows**. Si ton dépôt interdit la création du brouillon, l’installateur reste disponible dans les **Artifacts** de la tâche de construction. Télécharge l’archive, extrais le fichier `.exe` et joins-le à une release manuelle.

## Publier un installateur déjà construit

Dans **Releases → Draft a new release**, choisis le tag `v1.0.31` sur `main`, saisis **Orbit 1.0.31** comme titre et joins `Orbit-Setup-1.0.31.exe`. Publie une version stable pour que les installations plus anciennes puissent la détecter dans **Réglages → Mises à jour**.

Les corrections suivantes utilisent un nouveau numéro. Par exemple, depuis `1.0.31`, la commande `npm version patch --no-git-tag-version` prépare `1.0.32` dans `package.json` et son fichier de verrouillage. Enregistre ces deux fichiers dans Git avant de relancer le workflow.

Le tag, la version du paquet et le nom de l’installateur doivent correspondre. Orbit vérifie le fichier téléchargé à l’aide de l’empreinte SHA-256 fournie par GitHub. Garde le nom produit par la compilation.
