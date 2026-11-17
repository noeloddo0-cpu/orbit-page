// Adaptation de l'effet de Shu Ding (MIT) : filtre SVG appliqué aux tuiles
// interactives de l'application. L'algorithme suit le pointeur et reste léger.
const SVG = "http://www.w3.org/2000/svg";
const XLINK = "http://www.w3.org/1999/xlink";

function smoothStep(a, b, t) {
  t = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function roundedRectSDF(x, y, width, height, radius) {
  const qx = Math.abs(x) - width + radius, qy = Math.abs(y) - height + radius;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius;
}
function texture(x, y) { return { x, y }; }

class TileRefraction {
  constructor(target, quality) {
    this.target = target;
    this.id = "orbit-glass-" + Math.random().toString(36).slice(2);
    this.dpi = quality === "max" ? .24 : .15;
    this.timer = 0;
    this.pointer = { x: .5, y: .5 };
    this.fragment = (uv, mouse) => {
      const x = uv.x - .5, y = uv.y - .5;
      const edge = roundedRectSDF(x, y, .44, .42, .09);
      const lens = smoothStep(.16, -.05, edge);
      const proximity = Math.max(0, 1 - Math.hypot(uv.x - mouse.x, uv.y - mouse.y) * 1.45);
      const strength = lens * (.2 + proximity * .8) * .026;
      return texture(uv.x + x * strength, uv.y + y * strength);
    };
    this.create();
    this.move = event => {
      const rect = target.getBoundingClientRect();
      this.pointer = { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
      if (!this.timer) this.timer = window.setTimeout(() => { this.timer = 0; this.update(); }, 48);
    };
    target.addEventListener("pointermove", this.move, { passive: true });
    this.resize = new ResizeObserver(() => this.update());
    this.resize.observe(target);
  }
  create() {
    const rect = this.target.getBoundingClientRect();
    this.width = Math.max(80, Math.round(rect.width));
    this.height = Math.max(50, Math.round(rect.height));
    this.svg = document.createElementNS(SVG, "svg");
    this.svg.setAttribute("aria-hidden", "true");
    this.svg.classList.add("lg-filter-defs");
    const defs = document.createElementNS(SVG, "defs"), filter = document.createElementNS(SVG, "filter");
    filter.id = this.id + "-filter";
    filter.setAttribute("filterUnits", "userSpaceOnUse");
    filter.setAttribute("color-interpolation-filters", "sRGB");
    filter.setAttribute("width", String(this.width)); filter.setAttribute("height", String(this.height));
    this.image = document.createElementNS(SVG, "feImage");
    this.image.setAttribute("width", String(this.width)); this.image.setAttribute("height", String(this.height));
    this.image.setAttribute("result", this.id + "-map");
    this.displacement = document.createElementNS(SVG, "feDisplacementMap");
    this.displacement.setAttribute("in", "SourceGraphic"); this.displacement.setAttribute("in2", this.id + "-map");
    this.displacement.setAttribute("xChannelSelector", "R"); this.displacement.setAttribute("yChannelSelector", "G");
    this.image.id = this.id + "-map"; filter.append(this.image, this.displacement); defs.append(filter); this.svg.append(defs);
    this.canvas = document.createElement("canvas"); this.canvas.width = Math.max(1, Math.round(this.width * this.dpi)); this.canvas.height = Math.max(1, Math.round(this.height * this.dpi));
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    this.layer = document.createElement("span");
    this.layer.className = "lg-refraction-layer";
    this.layer.setAttribute("aria-hidden", "true");
    const content = this.target.querySelector(":scope > .in");
    if (content) this.target.insertBefore(this.layer, content); else this.target.prepend(this.layer);
    document.body.append(this.svg); this.update();
  }
  update() {
    if (!this.target.isConnected) return;
    const rect = this.target.getBoundingClientRect(), width = Math.max(80, Math.round(rect.width)), height = Math.max(50, Math.round(rect.height));
    if (width !== this.width || height !== this.height) {
      this.width = width; this.height = height;
      this.svg.querySelector("filter").setAttribute("width", String(width)); this.svg.querySelector("filter").setAttribute("height", String(height));
      this.image.setAttribute("width", String(width)); this.image.setAttribute("height", String(height));
      this.canvas.width = Math.max(1, Math.round(width * this.dpi)); this.canvas.height = Math.max(1, Math.round(height * this.dpi));
    }
    const w = this.canvas.width, h = this.canvas.height, data = new Uint8ClampedArray(w * h * 4);
    let max = 0; const offsets = new Float32Array(w * h * 2);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const uv = { x: x / w, y: y / h }, p = this.fragment(uv, this.pointer), i = (y * w + x) * 2;
      offsets[i] = (p.x * w) - x; offsets[i + 1] = (p.y * h) - y;
      max = Math.max(max, Math.abs(offsets[i]), Math.abs(offsets[i + 1]));
    }
    max = Math.max(.001, max * .5);
    for (let pixel = 0, i = 0; pixel < w * h; pixel++, i += 4) {
      data[i] = Math.max(0, Math.min(255, (offsets[pixel * 2] / max + .5) * 255));
      data[i + 1] = Math.max(0, Math.min(255, (offsets[pixel * 2 + 1] / max + .5) * 255)); data[i + 3] = 255;
    }
    this.ctx.putImageData(new ImageData(data, w, h), 0, 0);
    this.image.setAttributeNS(XLINK, "href", this.canvas.toDataURL());
    this.displacement.setAttribute("scale", String(max / this.dpi));
    this.layer.style.setProperty("--lg-filter", `url(#${this.id}-filter)`);
  }
  destroy() {
    clearTimeout(this.timer); this.target.removeEventListener("pointermove", this.move); this.resize.disconnect();
    this.layer.remove(); this.svg.remove(); this.canvas.remove();
  }
}

export function mountLiquidGlass(context) {
  const root = context.root, reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const quality = () => document.documentElement.dataset.glassQuality || "balanced";
  const refractions = new Map();
  const eligible = element => element?.matches?.(".section-card,.tile") && root.contains(element);
  const bind = element => {
    if (!eligible(element) || element.hasAttribute("data-glass-bound") || quality() === "light" || reduceMotion) return;
    element.dataset.glassBound = "true";
    const effect = new TileRefraction(element, quality()); refractions.set(element, effect);
  };
  const activate = event => bind(event.target.closest?.(".section-card,.tile"));
  const deactivate = event => {
    const element = event.target.closest?.(".section-card,.tile");
    if (!eligible(element) || element.contains(event.relatedTarget) || element.matches(":hover,:focus-within")) return;
    refractions.get(element)?.destroy(); refractions.delete(element); delete element.dataset.glassBound;
  };
  root.addEventListener("pointerover", activate);
  root.addEventListener("pointerout", deactivate);
  root.addEventListener("focusin", activate);
  root.addEventListener("focusout", deactivate);
  const cleanupRemoved = new MutationObserver(() => {
    for (const [element, effect] of refractions) if (!element.isConnected) { effect.destroy(); refractions.delete(element); }
  });
  cleanupRemoved.observe(root, { childList: true, subtree: true });
  const qualityChanged = () => {
    refractions.forEach(effect => effect.destroy()); refractions.clear();
    root.querySelectorAll("[data-glass-bound]").forEach(element => { delete element.dataset.glassBound; });
    root.querySelectorAll(".section-card:hover,.tile:hover,.section-card:focus-within,.tile:focus-within").forEach(bind);
  };
  root.addEventListener("orbit:glass-quality", qualityChanged);
  let start = 0, frames = 0, lowWindows = 0, active = true, raf = 0;
  const monitor = now => {
    if (!active || root.dataset.theme !== "liquid-glass") return;
    if (document.hidden) { start = now; frames = 0; raf = requestAnimationFrame(monitor); return; }
    if (!start) start = now;
    frames++;
    if (now - start >= 1800) {
      const fps = frames * 1000 / (now - start); lowWindows = fps < 30 ? lowWindows + 1 : 0;
      start = now; frames = 0;
      if (lowWindows >= 2) { lowWindows = 0; context.actions.offerDefaultTheme("Le thème Liquid Glass semble ralentir l’application. Revenir au thème actuel ?"); }
    }
    raf = requestAnimationFrame(monitor);
  };
  raf = requestAnimationFrame(monitor);
  const fallbackKey = event => {
    if (event.ctrlKey && event.altKey && event.key === "0") {
      event.preventDefault(); context.actions.returnToDefaultTheme();
    }
  };
  window.addEventListener("keydown", fallbackKey);
  return () => {
    active = false; cancelAnimationFrame(raf); cleanupRemoved.disconnect(); root.removeEventListener("orbit:glass-quality", qualityChanged); window.removeEventListener("keydown", fallbackKey);
    root.removeEventListener("pointerover", activate); root.removeEventListener("pointerout", deactivate); root.removeEventListener("focusin", activate); root.removeEventListener("focusout", deactivate);
    refractions.forEach(effect => effect.destroy()); refractions.clear();
    root.querySelectorAll("[data-glass-bound]").forEach(element => delete element.dataset.glassBound);
  };
}
