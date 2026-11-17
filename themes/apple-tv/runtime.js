// Parallaxe adaptée d’Apple TV Card par Marc Reichel (MIT).
// Gestion limitée aux cartes d’Orbit, sans bibliothèque de glisser-déposer.
export function mountAppleTVParallax(context) {
  const root = context.root;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const selector = ".tile,.section-card[data-active='true']";
  let activeCard = null, frame = 0, latestEvent = null;

  function cardFor(target) { return target instanceof Element ? target.closest(selector) : null; }
  function layerFor(card) {
    let layer = card.querySelector(":scope > .apple-tv-reflection");
    if (!layer) {
      layer = document.createElement("span");
      layer.className = "apple-tv-reflection";
      layer.setAttribute("aria-hidden", "true");
      card.prepend(layer);
    }
    return layer;
  }
  function reset(card) {
    if (!card) return;
    card.classList.remove("apple-tv-hover");
    for (const name of ["--atv-x","--atv-y","--atv-rotate-x","--atv-rotate-y"]) card.style.removeProperty(name);
    card.querySelector(".cv")?.style.removeProperty("transform");
    card.querySelector(".in")?.style.removeProperty("transform");
    card.querySelector(".section-icon")?.style.removeProperty("transform");
    card.querySelector(".section-name")?.style.removeProperty("transform");
    card.querySelector(".section-state")?.style.removeProperty("transform");
    card.querySelector(":scope > .apple-tv-reflection")?.style.removeProperty("transform");
  }
  function move() {
    frame = 0;
    const event = latestEvent, card = activeCard;
    if (!event || !card?.isConnected || reducedMotion) return;
    const rect = card.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    const dx = .5 - x, dy = .5 - y;
    card.style.setProperty("--atv-x", (x * 100) + "%");
    card.style.setProperty("--atv-y", (y * 100) + "%");
    card.style.setProperty("--atv-rotate-y", (dx * 4) + "deg");
    card.style.setProperty("--atv-rotate-x", (-dy * 3) + "deg");
    card.querySelector(".cv")?.style.setProperty("transform", `translate3d(${dx * -7}px,${dy * -5}px,0) scale(1.04)`);
    card.querySelector(".in")?.style.setProperty("transform", `translate3d(${dx * 3}px,${dy * 2}px,18px)`);
    card.querySelector(".section-icon")?.style.setProperty("transform", `translate3d(${dx * 3}px,${dy * 2}px,18px)`);
    card.querySelector(".section-name")?.style.setProperty("transform", `translate3d(${dx * 2}px,${dy * 2}px,12px)`);
    card.querySelector(".section-state")?.style.setProperty("transform", `translate3d(${dx * 1.5}px,${dy * 1.5}px,8px)`);
    card.querySelector(":scope > .apple-tv-reflection")?.style.setProperty("transform", `translate3d(${dx * -4}px,${dy * -3}px,0)`);
  }
  function activate(event) {
    const card = cardFor(event.target);
    if (!card) return;
    if (activeCard && activeCard !== card) reset(activeCard);
    activeCard = card;
    layerFor(card);
    card.classList.add("apple-tv-hover");
    if (event.pointerType !== "touch") { latestEvent = event; if (!frame) frame = requestAnimationFrame(move); }
  }
  function update(event) {
    if (!activeCard || !activeCard.contains(event.target)) return;
    latestEvent = event;
    if (!frame) frame = requestAnimationFrame(move);
  }
  function deactivate(event) {
    const card = cardFor(event.target);
    if (!card || card !== activeCard || card.contains(event.relatedTarget) || card.matches(":hover,:focus-within")) return;
    reset(card); activeCard = null; latestEvent = null;
  }
  function clear() { reset(activeCard); activeCard = null; latestEvent = null; }

  root.addEventListener("pointerover", activate);
  root.addEventListener("pointermove", update, { passive: true });
  root.addEventListener("pointerout", deactivate);
  root.addEventListener("focusin", activate);
  root.addEventListener("focusout", deactivate);
  window.addEventListener("blur", clear);
  return () => {
    if (frame) cancelAnimationFrame(frame);
    root.removeEventListener("pointerover", activate);
    root.removeEventListener("pointermove", update);
    root.removeEventListener("pointerout", deactivate);
    root.removeEventListener("focusin", activate);
    root.removeEventListener("focusout", deactivate);
    window.removeEventListener("blur", clear);
    root.querySelectorAll(".apple-tv-reflection").forEach(layer => layer.remove());
    root.querySelectorAll(".apple-tv-hover").forEach(reset);
  };
}
