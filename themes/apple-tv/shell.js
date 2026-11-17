import { setupShell } from "../shared.js";
import { mountAppleTVParallax } from "./runtime.js";

export default {
  id: "apple-tv", name: "Apple TV", menuLayout: "cards-row", libraryLayout: "poster-grid", navigation: "gear",
  components: { intro: "cinema", menu: "large-cards", library: "poster-grid", settings: "glass-drawer", transitions: "slow-zoom" },
  mount(context) {
    setupShell(context, this);
    return mountAppleTVParallax(context);
  }
};
