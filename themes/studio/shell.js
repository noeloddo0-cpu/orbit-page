import { setupShell } from "../shared.js";

export default {
  id: "studio",
  name: "Studio",
  menuLayout: "cards-row",
  libraryLayout: "poster-grid",
  navigation: "gear",
  components: { intro: "quiet-fade", menu: "cards-row", library: "poster-grid", settings: "drawer", transitions: "short-fade" },
  mount(context) {
    setupShell(context, this);
    return () => {};
  }
};
