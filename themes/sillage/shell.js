import { setupShell } from "../shared.js";

export default {
  id: "sillage",
  name: "Sillage",
  menuLayout: "cards-row",
  libraryLayout: "status-shelves",
  navigation: "gear",
  components: { intro: "quiet-cinema", menu: "collection-rail", library: "status-shelves", settings: "drawer", transitions: "short-cut" },
  mount(context) {
    setupShell(context, this);
    return () => {};
  }
};
