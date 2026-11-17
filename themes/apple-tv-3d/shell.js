import { setupShell } from "../shared.js";
import { mountAppleTV3D } from "./runtime.js";

export default {
  id: "apple-tv-3d", name: "Apple TV (Parallaxe)", menuLayout: "cards-row", libraryLayout: "poster-grid", navigation: "gear",
  components: { intro: "cinema", menu: "large-cards", library: "wide-grid", settings: "glass-drawer", transitions: "depth-zoom" },
  mount(context) {
    setupShell(context, this);
    return mountAppleTV3D(context);
  }
};
