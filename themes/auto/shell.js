import { setupShell } from "../shared.js";

export default {
  id: "auto", name: "Auto", menuLayout: "simple-cards", libraryLayout: "poster-grid", navigation: "gear",
  components: { intro: "fade", menu: "simple-cards", library: "poster-grid", settings: "plain-drawer", transitions: "fast-fade" },
  mount(context) { setupShell(context, this); return () => {}; }
};
