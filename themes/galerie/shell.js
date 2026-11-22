import { setupShell } from "../shared.js";
import { mountGalleryHome } from "./home.js";

export default {
  id: "galerie", name: "Galerie", menuLayout: "cards-row", libraryLayout: "poster-grid", navigation: "gear",
  components: { intro: "imprint", menu: "gallery", library: "framed-grid", settings: "drawer", transitions: "fade" },
  mount(context) {
    setupShell(context, this);
    return mountGalleryHome(context.home);
  }
};
