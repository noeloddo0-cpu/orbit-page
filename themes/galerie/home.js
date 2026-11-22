import { mountCollectionHome } from "../collection-home.js";

export function mountGalleryHome(home) {
  const italic = document.createElement("em");
  italic.textContent = "galerie";
  return mountCollectionHome(home, ["La ", italic], "galerie-frame");
}
