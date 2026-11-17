import { setupShell } from "../shared.js";
import { mountLiquidGlass } from "./runtime.js";

export default {
  id: "liquid-glass", name: "Liquid Glass", menuLayout: "cards-row", libraryLayout: "poster-grid", navigation: "gear",
  components: { intro: "cinema", menu: "large-cards", library: "poster-grid", settings: "glass-drawer", transitions: "liquid" },
  mount(context) {
    setupShell(context, this);
    return mountLiquidGlass(context);
  }
};
