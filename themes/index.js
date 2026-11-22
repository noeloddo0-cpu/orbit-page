// Shells Orbit, chargés uniquement lorsqu'ils sont enregistrés ici.
import appleTV from "./apple-tv/shell.js";
import liquidGlass from "./liquid-glass/shell.js";
import appleTV3D from "./apple-tv-3d/shell.js";
import studio from "./studio/shell.js";
import papier from "./papier/shell.js";
import papierSombre from "./papier-sombre/shell.js";
import steamLibrary from "./steam-library/shell.js";
import chambreNoire from "./chambre-noire/shell.js";
import galerie from "./galerie/shell.js";
import galerieSombre from "./galerie-sombre/shell.js";
import sillage from "./sillage/shell.js";
import { mountCollectionHome } from "./collection-home.js";

const collectionTitles = {
  "apple-tv": "Vos espaces", "apple-tv-3d": "Vos espaces",
  "liquid-glass": "Ma collection", studio: "Mon studio",
  papier: "Le sommaire", "papier-sombre": "Le sommaire",
  "steam-library": "Ma bibliothèque", sillage: "Ma collection"
};

export const shells = Object.freeze({
  "apple-tv": appleTV,
  "liquid-glass": liquidGlass,
  "apple-tv-3d": appleTV3D,
  studio,
  papier,
  "papier-sombre": papierSombre,
  "steam-library": steamLibrary,
  "chambre-noire": chambreNoire,
  galerie,
  "galerie-sombre": galerieSombre,
  sillage
});
export function getShell(id = "apple-tv") { return shells[id] || appleTV; }
export function mountShell(id, context) {
  const shell = getShell(id);
  const cleanup = shell.mount?.(context);
  const title = collectionTitles[shell.id];
  const removeCollection = title && mountCollectionHome(context.home, [title], "collection-art");
  if (title) context.root.dataset.collectionEdition = shell.id;
  return { shell, dispose() {
    if (removeCollection) {
      removeCollection();
      delete context.root.dataset.collectionEdition;
    }
    cleanup?.();
  } };
}
