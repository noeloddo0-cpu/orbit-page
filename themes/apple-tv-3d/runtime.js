// Parallaxe adaptée du composant Apple TV Card de Marc Reichel (MIT).
// Les interactions sont limitées au shell actif et aux cartes d’Orbit.
export function mountAppleTV3D(context) {
  const root = context.root;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const selector = ".tile,.section-card[data-active='true']";
  let activeCard = null, frame = 0, latestEvent = null;

  function cardFor(target) { return target instanceof Element ? target.closest(selector) : null; }
  function layerFor(card) {
    let layer = card.querySelector(":scope > .tv3d-reflection");
    if (!layer) {
      layer = document.createElement("span");
      layer.className = "tv3d-reflection";
      layer.setAttribute("aria-hidden", "true");
      card.prepend(layer);
    }
    return layer;
  }
  function reset(card) {
    if (!card) return;
    card.classList.remove("tv3d-hover");
    for (const name of ["--tv3d-x","--tv3d-y","--tv3d-rotate-x","--tv3d-rotate-y","--tv3d-image-x","--tv3d-image-y"]) card.style.removeProperty(name);
    card.querySelector(".cv")?.style.removeProperty("transform");
    card.querySelector(".in")?.style.removeProperty("transform");
    card.querySelector(".section-icon")?.style.removeProperty("transform");
    card.querySelector(".section-name")?.style.removeProperty("transform");
    card.querySelector(".section-state")?.style.removeProperty("transform");
    card.querySelector(":scope > .tv3d-reflection")?.style.removeProperty("transform");
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
    card.style.setProperty("--tv3d-x", (x * 100) + "%");
    card.style.setProperty("--tv3d-y", (y * 100) + "%");
    card.style.setProperty("--tv3d-rotate-y", (dx * 8) + "deg");
    card.style.setProperty("--tv3d-rotate-x", (-dy * 6) + "deg");
    card.style.setProperty("--tv3d-image-x", (dx * -12) + "px");
    card.style.setProperty("--tv3d-image-y", (dy * -9) + "px");
    card.querySelector(".cv")?.style.setProperty("transform", "translate3d(" + (dx * -12) + "px," + (dy * -9) + "px,0) scale(1.075)");
    card.querySelector(".in")?.style.setProperty("transform", "translate3d(" + (dx * 5) + "px," + (dy * 4) + "px,34px)");
    card.querySelector(".section-icon")?.style.setProperty("transform", "translate3d(" + (dx * 5) + "px," + (dy * 4) + "px,32px)");
    card.querySelector(".section-name")?.style.setProperty("transform", "translate3d(" + (dx * 3) + "px," + (dy * 2) + "px,24px)");
    card.querySelector(".section-state")?.style.setProperty("transform", "translate3d(" + (dx * 2) + "px," + (dy * 2) + "px,18px)");
    card.querySelector(":scope > .tv3d-reflection")?.style.setProperty("transform", "translate3d(" + (dx * -7) + "px," + (dy * -5) + "px,0)");
  }
  function activate(event) {
    const card = cardFor(event.target);
    if (!card) return;
    if (activeCard && activeCard !== card) reset(activeCard);
    activeCard = card;
    layerFor(card);
    card.classList.add("tv3d-hover");
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
    root.querySelectorAll(".tv3d-reflection").forEach(layer => layer.remove());
    root.querySelectorAll(".tv3d-hover").forEach(reset);
  };
}
