import { setupShell } from "../shared.js";

export default {
  id: "cinema-rouge", name: "Cinéma rouge", menuLayout: "profile-cinema", libraryLayout: "status-shelves", navigation: "cinema",
  components: { intro: "red-flash", menu: "profile-picker", library: "hero-and-shelves", settings: "cinema-panel", transitions: "cinema-reveal" },
  mount(context) {
    setupShell(context, this);
    const inner = context.home.querySelector(".orbit-home"), page = document.createElement("section");
    page.className = "cinema-profile-screen"; page.setAttribute("aria-label", "Choisir un profil");
    const kicker = document.createElement("div"); kicker.className = "orbit-kicker"; kicker.textContent = "CINÉMA";
    const title = document.createElement("h1"); title.textContent = "Qui regarde ?";
    const list = document.createElement("div"); list.className = "cinema-profile-list";
    function renderProfiles() {
      list.replaceChildren();
      for (const profile of context.data().profiles) {
        const button = document.createElement("button"); button.type = "button"; button.className = "cinema-profile";
        const face = document.createElement("span"); face.className = "cinema-profile-face"; face.textContent = profile.name.slice(0, 1).toUpperCase();
        const name = document.createElement("strong"); name.textContent = profile.name;
        button.append(face, name); button.setAttribute("aria-pressed", String(profile.id === context.data().activeProfileId));
        button.addEventListener("click", () => { context.actions.selectProfile(profile.id); page.hidden = true; inner.hidden = false; }); list.append(button);
      }
    }
    renderProfiles();
    page.append(kicker, title, list); context.home.append(page);
    if (context.initial && context.screen === "home") { page.hidden = false; inner.hidden = true; }
    else page.hidden = true;
    return { refresh: renderProfiles, dispose: () => { page.remove(); inner.hidden = false; } };
  }
};
