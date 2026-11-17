import { setupShell } from "../shared.js";

export default {
  id: "papier",
  name: "Papier",
  menuLayout: "cards-row",
  libraryLayout: "poster-grid",
  navigation: "gear",
  components: { intro: "quiet-fade", menu: "cards-row", library: "poster-grid", settings: "drawer", transitions: "short-fade" },
  mount(context) {
    setupShell(context, this);
    return () => {};
  }
};
