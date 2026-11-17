# Thème Apple TV 3D pour Orbit

Ce thème ajoute une variante Apple TV inspirée de la démonstration expérimentale de Marc Reichel : grandes cartes, relief au survol, parallaxe légère et reflet qui suit le pointeur. Le thème Apple TV classique reste indépendant et inchangé.

## Origine et licence

L'application d'origine est le dépôt [`marcreichel/apple-tv`](https://github.com/marcreichel/apple-tv), publié sous licence MIT. Son effet de carte 3D vient du projet [`marcreichel/apple-tv-card`](https://github.com/marcreichel/apple-tv-card), également sous licence MIT. Les licences et les fichiers source utiles sont conservés dans `LICENSE.txt` et `vendor/`.

Orbit reprend l'idée et adapte l'effet au HTML/CSS existant. Il n'intègre pas Muuri ni les autres dépendances de la démo : cela évite de déplacer/réordonner les jeux et garde le thème autonome. Les fichiers spécifiques sont dans ce dossier. Le CSS ne s'applique que lorsque l'attribut racine vaut `data-theme="apple-tv-3d"`.

## Activer / désactiver

Dans Orbit : Réglages → Apparence → Apple TV (Parallaxe). Pour revenir, sélectionner Actuel. Le choix est mémorisé. Pour retirer ce thème, enlever son entrée du registre `themes/index.js`, supprimer `themes/apple-tv-3d/` et retirer la reconnaissance de `apple-tv-3d` dans les deux petits scripts de démarrage de `bibliotheque.html`.

Le thème respecte `prefers-reduced-motion`; les effets de survol et le fond animé sont réduits ou coupés dans ce mode.
