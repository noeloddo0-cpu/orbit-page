import { setupShell } from "../shared.js";

export default {
  id: "oled",
  name: "OLED",
  menuLayout: "cards-row",
  libraryLayout: "poster-grid",
  navigation: "standard",
  components: { intro: "fade", menu: "cards-row", library: "poster-grid", settings: "drawer", transitions: "short-fade" },
  mount(context) {
    setupShell(context, this);
    return () => {};
  }
};
