# Thème Liquid Glass

Ce thème habille Orbit avec du verre translucide, des reflets et une réfraction SVG légère sur les tuiles. Le menu en rangée et la bibliothèque en grille restent ceux de l’application. Le thème actuel reste le choix par défaut.

## Source et licence

Le dépôt demandé, [awesome-liquid-glass](https://github.com/carolhsiaoo/awesome-liquid-glass), est un catalogue de ressources sous licence CC0-1.0 ; il ne contient pas directement l’interface du verre. L’effet repris vient de [shuding/liquid-glass](https://github.com/shuding/liquid-glass), fichier liquid-glass.js, par Shu Ding (2025), sous licence MIT. Son algorithme de déplacement par carte canvas et filtre SVG (feDisplacementMap) a été adapté dans runtime.js aux tuiles d’Orbit.

Cette adaptation n’ajoute aucune dépendance npm. La licence MIT et son avis de droit d’auteur sont conservés dans LICENSE.txt.

## Utilisation

Dans l’application : Réglages → Apparence → **Liquid Glass**. Le choix est enregistré automatiquement. **Qualité du verre** propose Max, Équilibré ou Léger. Si Orbit détecte un ralentissement prolongé, une fenêtre propose de revenir au thème actuel. Le raccourci **Ctrl + Alt + 0** revient immédiatement au thème actuel.

## Désactiver ou supprimer

- Pour désactiver le thème sans supprimer de fichier, choisir **Actuel** dans Réglages → Apparence.
- Pour le retirer complètement, après avoir fermé Orbit, supprimer le dossier themes/liquid-glass/ puis retirer l’import et l’entrée liquid-glass de themes/index.js. Les données de bibliothèque et les sauvegardes sont stockées ailleurs et ne sont pas concernées.

## Vérification rapide

Lancer Orbit, ouvrir Réglages, passer de **Actuel** à **Liquid Glass**, puis revenir à **Actuel**. Vérifier que le menu reste en rangée, que les jeux restent en tuiles, que la recherche et la fiche restent accessibles et que le choix survit au redémarrage.
