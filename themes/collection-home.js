// Le menu réutilise les boutons d'Orbit et leurs commandes clavier/manette.
const sections = ["library", "films", "orbit-play"];

function localCover(entry) {
  return entry?.f ? "/covers/" + encodeURIComponent(entry.f) + "?v=" + (Number(entry.v) || 0) : "";
}

function chooseArt(state, cinema) {
  const keys = (state?.games || []).map(game => String(game.n || "").toLowerCase()
    .normalize("NFD").replace(/\p{M}/gu, "").replace(/[®™©]/g, "").replace(/[^a-z0-9]+/g, " ").trim());
  const games = keys.map(key => localCover(state.covers?.[key])).filter(Boolean);
  const portraits = keys.map(key => localCover(state.steamCovers?.[key])).filter(Boolean);
  const poster = cinema?.items?.find(item => typeof item.poster === "string" &&
    /^(https?:\/\/|\/covers\/|data:image\/)/i.test(item.poster))?.poster;
  const library = games[0] || portraits[0];
  const play = [...portraits, ...games].find(src => src !== library);
  return [library, poster, play];
}

function includeCount(count, singular, plural) {
  return count + " " + (count > 1 ? plural : singular);
}

export function mountCollectionHome(home, title, frameClass) {
  const heading = home.querySelector(".orbit-title");
  const lead = home.querySelector(".orbit-lead");
  const originals = [heading, lead].map(node => [...node.childNodes]);
  heading.replaceChildren(...title);
  lead.textContent = "";
  const row = home.querySelector("#section-cards");
  let controller, art = [];
  function decorateCards() {
    sections.forEach((id, index) => {
      const card = row.querySelector('[data-section-id="' + id + '"]');
      if (!card) return;
      let frame = card.querySelector("." + frameClass);
      if (!frame) {
        frame = document.createElement("span");
        frame.className = frameClass;
        frame.setAttribute("aria-hidden", "true");
        card.prepend(frame);
      }
      const src = art[index] || "";
      if (frame.dataset.source === src) return;
      frame.dataset.source = src;
      frame.replaceChildren();
      if (!src) return;
      const img = new Image();
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.addEventListener("load", () => img.classList.add("ready"), { once: true });
      img.addEventListener("error", () => img.remove(), { once: true });
      frame.append(img);
      img.src = src;
    });
  }
  async function refresh() {
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    const read = async url => {
      const response = await fetch(url, { signal, cache: "no-store" });
      if (response.ok) return response.json();
    };
    const [gameResult, filmResult] = await Promise.allSettled([read("/api/state"), read("/api/cinema")]);
    if (signal.aborted) return;
    const state = gameResult.value, cinema = filmResult.value;
    const counts = [];
    if (Array.isArray(state?.games)) counts.push(includeCount(state.games.length, "jeu", "jeux"));
    if (Array.isArray(cinema?.items)) {
      const series = cinema.items.filter(item => item.type === "series").length;
      counts.push(includeCount(cinema.items.length - series, "film", "films"), includeCount(series, "série", "séries"));
    }
    lead.textContent = counts.join(" · ");
    art = chooseArt(state, cinema);
    decorateCards();
  }
  const cardsObserver = new MutationObserver(decorateCards);
  cardsObserver.observe(row, { childList: true });
  let onHome = home.classList.contains("on");
  const homeObserver = new MutationObserver(() => {
    const visible = home.classList.contains("on");
    if (visible && !onHome) refresh();
    onHome = visible;
  });
  homeObserver.observe(home, { attributes: true, attributeFilter: ["class"] });
  decorateCards();
  refresh();
  return () => {
    controller.abort();
    homeObserver.disconnect();
    cardsObserver.disconnect();
    row.querySelectorAll("." + frameClass).forEach(frame => frame.remove());
    [heading, lead].forEach((node, index) => node.replaceChildren(...originals[index]));
  };
}
