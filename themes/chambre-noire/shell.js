import { setupShell } from "../shared.js";

export default {
  id: "chambre-noire",
  name: "Chambre noire",
  menuLayout: "cards-row",
  libraryLayout: "poster-grid",
  navigation: "gear",
  components: { intro: "shutter", menu: "contact-sheet", library: "poster-grid", settings: "drawer", transitions: "cut" },
  mount(context) {
    setupShell(context, this);
    const heading = context.home.querySelector(".orbit-title");
    const previous = Array.from(heading.childNodes);
    const firstLine = document.createElement("span");
    firstLine.textContent = "Ma ";
    heading.replaceChildren(firstLine, "collection");
    return () => heading.replaceChildren(...previous);
  }
};
