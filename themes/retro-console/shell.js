import { setupShell, addShellNav } from "../shared.js";

export default {
  id: "retro-console", name: "Rétro console", menuLayout: "icon-bar", libraryLayout: "console-grid", navigation: "horizontal-icons",
  components: { intro: "boot-screen", menu: "icon-bar", library: "console-grid", settings: "pixel-panel", transitions: "step-cut" },
  mount(context) {
    setupShell(context, this);
    const nav = addShellNav(context, this.id, "console", [
      { label: "Tous les jeux", icon: "▦", run: ctx => ctx.actions.setStatus(null) },
      ...["En cours", "En pause", "À faire", "Terminés"].map((label, i) => ({ label, icon: ["▶", "Ⅱ", "＋", "✓"][i], run: ctx => ctx.actions.setStatus(i) })),
      { label: "Favoris", icon: "★", run: ctx => ctx.actions.showFavorites() }
    ]);
    return nav;
  }
};
