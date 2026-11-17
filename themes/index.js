// Shells Orbit, chargés uniquement lorsqu'ils sont enregistrés ici.
import appleTV from "./apple-tv/shell.js";
import liquidGlass from "./liquid-glass/shell.js";
import appleTV3D from "./apple-tv-3d/shell.js";
import studio from "./studio/shell.js";
import papier from "./papier/shell.js";
import papierSombre from "./papier-sombre/shell.js";
import steamLibrary from "./steam-library/shell.js";
import sillage from "./sillage/shell.js";

export const shells = Object.freeze({
  "apple-tv": appleTV,
  "liquid-glass": liquidGlass,
  "apple-tv-3d": appleTV3D,
  studio,
  papier,
  "papier-sombre": papierSombre,
  "steam-library": steamLibrary,
  sillage
});
export function getShell(id = "apple-tv") { return shells[id] || appleTV; }
export function mountShell(id, context) {
  const shell = getShell(id);
  const cleanup = shell.mount ? shell.mount(context) : null;
  return { shell, dispose: typeof cleanup === "function" ? cleanup : () => {} };
}
