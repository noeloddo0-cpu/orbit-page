import { setupShell } from "../shared.js";

export default {
  id: "steam-library",
  name: "Bibliothèque Steam",
  menuLayout: "cards-row",
  libraryLayout: "steam-library",
  navigation: "gear",
  components: { intro: "quiet-fade", menu: "cards-row", library: "steam-library", settings: "drawer", transitions: "short-fade" },
  mount(context) {
    setupShell(context, this);
    return () => {};
  }
};
