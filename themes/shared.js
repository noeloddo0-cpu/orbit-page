export function setupShell(ctx, shell) {
  ctx.root.dataset.orbitShell = shell.id;
  ctx.home.dataset.menuLayout = shell.menuLayout || "cards";
  ctx.library.dataset.libraryLayout = shell.libraryLayout || "poster-grid";
  ctx.root.dataset.shellNavigation = shell.navigation || "standard";
}

export function addShellNav(ctx, id, placement, items) {
  const nav = document.createElement("nav");
  nav.className = "shell-nav shell-nav-" + placement;
  nav.dataset.shellNav = id;
  nav.setAttribute("aria-label", "Navigation " + id);
  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "shell-nav-item";
    button.setAttribute("aria-label", item.label);
    button.title = item.label;
    const icon = document.createElement("span");
    icon.className = "shell-nav-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = item.icon;
    const label = document.createElement("span");
    label.className = "shell-nav-label";
    label.textContent = item.label;
    button.append(icon, label);
    button.addEventListener("click", () => item.run(ctx));
    nav.append(button);
  }
  ctx.root.append(nav);
  return () => nav.remove();
}

export const commonItems = [
  { label: "Menu", icon: "⌂", run: ctx => ctx.actions.goHome() },
  { label: "Bibliothèque", icon: "▦", run: ctx => ctx.actions.openLibrary() },
  { label: "Favoris", icon: "☆", run: ctx => ctx.actions.showFavorites() },
  { label: "Réglages", icon: "⚙", run: ctx => ctx.actions.openSettings() }
];
