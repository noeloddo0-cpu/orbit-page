import { setupShell, addShellNav, commonItems } from "../shared.js";

export default {
  id: "neon", name: "Néon", menuLayout: "terminal", libraryLayout: "poster-grid", navigation: "hud-rail",
  components: { intro: "glitch", menu: "terminal-rail", library: "glow-grid", settings: "hud-drawer", transitions: "glitch-cut" },
  mount(context) { setupShell(context, this); return addShellNav(context, this.id, "rail", commonItems); }
};
