import { setupShell } from "../shared.js";

export default {
  id: "ultima-transparent",
  name: "Ultima transparent",
  menuLayout: "cards-row",
  libraryLayout: "poster-grid",
  navigation: "gear",
  components: { intro: "fade", menu: "glass-cards", library: "poster-grid", settings: "glass-drawer", transitions: "soft-fade" },
  mount(context) {
    setupShell(context, this);
    return () => {};
  }
};
