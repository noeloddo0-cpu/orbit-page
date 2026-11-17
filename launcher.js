(()=>{
"use strict";
const screen = document.getElementById("launcher-screen");
const homeView = document.getElementById("op-home-view");
const libraryView = document.getElementById("op-library-view");
const hero = document.getElementById("op-hero");
const shelves = document.getElementById("op-shelves");
const grid = document.getElementById("op-grid");
const status = document.getElementById("op-status");
const search = document.getElementById("op-search");
const filters = document.getElementById("op-filters");
let currentTab = "library", currentFilter = "all", collection = "all";
const statusNames = ["En cours", "En pause", "À faire", "Terminé", "Abandonné"];
const normalize = value => String(value || "").toLocaleLowerCase("fr").normalize("NFD").replace(/\p{M}/gu, "").replace(/[®™©]/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

function bridge() { return window.__orbitLauncherBridge; }
function data() { return bridge()?.getData?.() || { games: [], recent: [], favorites: [], session: null }; }
function setTab(tab, focusSearch = false) {
  currentTab = tab === "library" ? "library" : "home";
  homeView.classList.toggle("op-hidden", currentTab !== "home");
  libraryView.classList.toggle("op-hidden", currentTab !== "library");
  document.querySelectorAll("[data-op-tab]").forEach(button => button.setAttribute("aria-current", button.dataset.opTab === currentTab ? "page" : "false"));
  render();
  if (focusSearch) search.focus({ preventScroll: true });
}
const byId = id => document.getElementById(id);
const editor = byId('play-editor');
let editingName = '', searchVersion = 0;
const detailsFor = game => bridge()?.detailsFor(game.n) || {};
function openPersonal(game) {
  editingName = game.n;
  const details = detailsFor(game);
  byId('play-editor-title').textContent = game.n;
  byId('play-kind').value = details.kind;
  byId('play-note').value = details.note || '';
  byId('play-platforms').value = (details.platforms || []).join(', ');
  byId('play-tags').value = (details.collections || []).join(', ');
  byId('play-cover-query').value = game.n;
  byId('play-results').replaceChildren();
  byId('play-message').textContent = '';
  byId('play-image').value = '';
  editor.showModal();
}
window.addEventListener('orbit:personal-game', e => openPersonal(e.detail));
byId('play-close').onclick = () => editor.close();
editor.addEventListener('close', () => { editingName = ''; searchVersion++; });
editor.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); editor.close(); } });
const splitTags = text => [...new Set(text.split(',').map(s => s.trim()).filter(Boolean))];
async function savePlay(url, options, success) {
  const name = editingName;
  try {
    const response = await fetch(url, options), result = await response.json();
    if (!response.ok) throw Error(result.error || 'Enregistrement impossible.');
    if (name === editingName) byId('play-message').textContent = success;
  } catch (error) { if (name === editingName) byId('play-message').textContent = error.message; }
}
byId('play-form').onsubmit = async event => {
  event.preventDefault();
  const details = {kind: byId('play-kind').value, note: byId('play-note').value, collections: splitTags(byId('play-tags').value), platforms: splitTags(byId('play-platforms').value)};
  await savePlay('/api/play/details', {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name:editingName,details})}, 'Fiche enregistrée.');
};
function savePortrait(bytes, steamId) {
  const params = new URLSearchParams({name: editingName});
  if (steamId) params.set('steam', steamId);
  byId('play-message').textContent = 'Enregistrement de la jaquette…';
  return savePlay('/api/play/portrait?' + params, {method:'PUT', body:bytes}, 'Jaquette enregistrée dans Orbit Play.');
}
byId('play-image').onchange = e => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 8*1024*1024) { byId('play-message').textContent = 'L’image doit faire moins de 8 Mo.'; return; }
  savePortrait(file);
};
byId('play-search-form').onsubmit = async e => {
  e.preventDefault();
  const version = ++searchVersion, results = byId('play-results'), msg = byId('play-message');
  results.replaceChildren(); msg.textContent = 'Recherche en cours…';
  try {
    const response = await fetch('/api/search-games?name='+encodeURIComponent(byId('play-cover-query').value));
    if (!response.ok) throw Error();
    const {results: choices} = await response.json();
    if (version !== searchVersion) return;
    for (const choice of choices.filter(c=>/^\d{1,10}$/.test(String(c.appId)))) {
      const b = document.createElement('button'), img = document.createElement('img'), title = document.createElement('span');
      b.type='button'; b.className='btn'; img.alt=''; img.src='https://cdn.cloudflare.steamstatic.com/steam/apps/'+choice.appId+'/library_600x900.jpg';
      img.onerror=()=>img.hidden=true; title.textContent=choice.name; b.append(img,title);
      b.onclick=()=>savePortrait(null,choice.appId); results.append(b);
    }
    msg.textContent=results.childElementCount?'Choisis la jaquette du bon jeu.':'Aucun résultat Steam. Tu peux importer une image.';
  } catch { if(version===searchVersion) msg.textContent='Recherche indisponible.'; }
};
function action(label, onClick) {
  const b=document.createElement('button'); b.type='button'; b.className='op-action-link'; b.textContent=label; b.onclick=onClick; return b;
}
function addPlayActions(item, game) {
  const actions = document.createElement('div'); actions.className='op-card-actions';
  const {installedId,kind}=detailsFor(game);
  if (kind!=='app' && installedId && window.tracker?.launchSteam) {
    const play = action('Jouer', async () => {
      play.disabled=true;
      try {
        const result=await window.tracker.launchSteam(installedId);
        if (!result.ok) throw Error(result.message);
        bridge().played(game.id);
        status.textContent='Lancement demandé à Steam pour '+game.n+'.';
      } catch { status.textContent='Steam n’a pas pu ouvrir '+game.n+'. Vérifie son installation.'; }
      finally { play.disabled=false; }
    });
    play.setAttribute('aria-label','Jouer à '+game.n+' avec Steam');actions.append(play);
  }
  const edit=action('Ma fiche',()=>openPersonal(game));
  edit.setAttribute('aria-label','Modifier ma fiche pour '+game.n);actions.append(edit);item.append(actions);
}
function inCollection(game, state) {
  const d=detailsFor(game);
  if (collection==='apps') return d.kind==='app';
  if (d.kind==='app') return false;
  if (collection==='favorites') return (state.favorites||[]).includes(normalize(game.n));
  if (collection==='installed') return !!d.installedId;
  if (collection==='missing') return !bridge()?.portraitFor(game.n);
  if (collection==='custom') return (d.collections||[]).includes(byId('op-custom').value);
  return true;
}
function syncCollections(games) {
  const select=byId('op-custom'), current=select.value;
  const tags=[...new Set(games.flatMap(g=>detailsFor(g).kind==='app'?[]:detailsFor(g).collections||[]))].sort((a,b)=>a.localeCompare(b,'fr'));
  if (JSON.stringify(tags)!==select.dataset.tags) {
    select.replaceChildren(new Option('Mes collections',''),...tags.map(tag=>new Option(tag,tag)));
    select.dataset.tags=JSON.stringify(tags); select.value=tags.includes(current)?current:'';
    if(collection==='custom'&&!select.value)collection='all';
  }
  select.hidden=!tags.length;
  document.querySelectorAll('[data-op-collection]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.opCollection===collection)));
}
byId('op-custom').onchange=e=>{collection=e.target.value?'custom':'all';renderLibrary(data());};

function card(game, tools) {
  const item = document.createElement("article"); item.className = "op-card";
  const button = document.createElement("button"); button.type = "button"; button.className = "op-card-button";
  button.dataset.gameId = String(game.id);
  button.setAttribute("aria-label", `Ouvrir la fiche de ${game.n}`);
  const cover = bridge()?.portraitFor?.(game.n) || bridge()?.coverFor?.(game.n);
  if (cover) { const image = document.createElement("img"); image.src = cover; image.alt = ""; image.loading = "lazy"; image.decoding = "async"; button.append(image); }
  else { const initial = document.createElement("span"); initial.className = "op-card-fallback"; initial.textContent = (game.n.match(/[A-Za-z0-9]/) || ["?"])[0].toUpperCase(); button.append(initial); }
  const shade = document.createElement("span"); shade.className = "op-card-shade";
  const badge = document.createElement("span"); badge.className = "op-card-status"; badge.textContent = statusNames[game.s] || statusNames[0];
  const copy = document.createElement("span"); copy.className = "op-card-copy";
  const title = document.createElement("span"); title.className = "op-card-title"; title.textContent = game.n;
  const time = document.createElement("span"); time.className = "op-card-hours"; time.textContent = bridge()?.formatTime?.(Number(game.m) || 0) || "0 h";
  copy.append(title, time); button.append(badge); item.append(copy); button.addEventListener("click", () => bridge()?.openGame?.(game.id)); item.prepend(button);
  if (tools) { item.classList.add("op-library-card"); addPlayActions(item,game); }
  return item;
}
function makeShelf(title, games, fragment) {
  if (!games.length) return;
  const section = document.createElement("section"); section.className = "op-shelf";
  const head = document.createElement("div"); head.className = "op-shelf-head";
  const heading = document.createElement("h2"); heading.textContent = title;
  const link = document.createElement("button"); link.type = "button"; link.className = "op-shelf-link"; link.textContent = "Tout voir"; link.addEventListener("click", () => setTab("library", true));
  head.append(heading, link); const track = document.createElement("div"); track.className = "op-track";
  games.slice(0, 18).forEach(game => track.append(card(game, false)));
  section.append(head, track); fragment.append(section);
}
function renderHome(state) {
  const games = (state.games || []).filter(g=>detailsFor(g).kind!=='app');
  const recent = (state.recent || []).map(item => games.find(game => normalize(game.n) === normalize(item.name))).filter(Boolean);
  const active = state.session && games.find(game => normalize(game.n) === normalize(state.session.name));
  const featured = active || recent[0] || [...games].sort((a, b) => (Number(b.m) || 0) - (Number(a.m) || 0))[0];
  hero.replaceChildren();
  if (featured) {
    const section = document.createElement("section"); section.className = "op-hero";
    const art = document.createElement("div"); art.className = "op-hero-art";
    const src = bridge()?.coverFor?.(featured.n);
    if (src) { const image = document.createElement("img"); image.src = src; image.alt = ""; image.fetchPriority = "high"; art.append(image); }
    else { const empty = document.createElement("span"); empty.className = "op-empty-hero"; art.append(empty); }
    const copy = document.createElement("div"); copy.className = "op-hero-copy";
    const label = document.createElement("span"); label.className = "op-hero-label"; label.textContent = active ? "Session en cours" : recent.includes(featured) ? "À reprendre" : "Dans ta collection";
    const title = document.createElement("h2"); title.textContent = featured.n;
    const meta = document.createElement("p"); meta.className = "op-hero-meta"; meta.textContent = `${statusNames[featured.s] || statusNames[0]} · ${bridge()?.formatTime?.(Number(featured.m) || 0) || "0 h"} jouées`;
    const actions = document.createElement("div"); actions.className = "op-actions";
    const open = document.createElement("button"); open.type = "button"; open.className = "op-button primary"; open.textContent = "Ouvrir la fiche"; open.addEventListener("click", () => bridge()?.openGame?.(featured.id));
    const browse = document.createElement("button"); browse.type = "button"; browse.className = "op-button"; browse.textContent = "Ma bibliothèque"; browse.addEventListener("click", () => setTab("library", true));
    actions.append(open, browse); copy.append(label, title, meta, actions); section.append(art, copy); hero.append(section);
  } else {
    const empty = document.createElement("div"); empty.className = "op-shelf-empty";
    const message = document.createElement("p"); message.textContent = "Ta collection est vide. Ajoute des jeux dans la Bibliothèque pour les retrouver ici.";
    const browse = document.createElement("button"); browse.type = "button"; browse.className = "op-button"; browse.textContent = "Ouvrir la Bibliothèque"; browse.addEventListener("click", () => bridge()?.goToLibrary?.());
    empty.append(message, browse); hero.append(empty);
  }
  const fragment = document.createDocumentFragment();
  makeShelf("Reprendre", recent, fragment);
  makeShelf("À découvrir dans ta collection", games.filter(game => game.s === 2).sort((a, b) => (Number(b.t) || 0) - (Number(a.t) || 0)), fragment);
  makeShelf("Tes jeux les plus joués", [...games].sort((a, b) => (Number(b.m) || 0) - (Number(a.m) || 0)).filter(game => (Number(game.m) || 0) > 0), fragment);
  shelves.replaceChildren(fragment);
}
function renderLibrary(state) {
  syncCollections(state.games || []);
  const group=(state.games||[]).filter(g=>inCollection(g,state));
  const activeFilter = document.activeElement?.dataset?.opFilter;
  const allFilters = [{ id: "all", label: "Tous les statuts" }, ...statusNames.map((label,i)=>({id:String(i),label}))];
  const filterFragment = document.createDocumentFragment();
  allFilters.forEach(filter => { const button = document.createElement("button"); button.type = "button"; button.className = "op-filter"; button.dataset.opFilter = filter.id; const count=filter.id==='all'?group.length:group.filter(g=>Number(g.s)===Number(filter.id)).length; button.textContent=filter.label;const counter=document.createElement('span');counter.textContent=String(count);button.append(counter); button.setAttribute("aria-pressed", String(filter.id === currentFilter)); button.addEventListener("click", () => { currentFilter = filter.id; renderLibrary(data()); }); filterFragment.append(button); });
  filters.replaceChildren(filterFragment);
  const query = search.value.trim().toLocaleLowerCase("fr");
  const games = group.filter(game => (!query || normalize(game.n).includes(normalize(query)))

    && (currentFilter === "all" || Number(game.s) === Number(currentFilter)))
    .sort((a,b)=>{const sort=document.getElementById('op-sort').value;return (sort==='time'?Number(b.m||0)-Number(a.m||0):sort==='recent'?Number(b.t||0)-Number(a.t||0):0)||a.n.localeCompare(b.n,'fr');});
  grid.replaceChildren(...games.map(game => card(game, true)));
  status.textContent = collection==="apps" ? games.length+" application"+(games.length>1?"s":"") : games.length ? `${games.length} jeu${games.length > 1 ? "x" : ""}` : "Aucun jeu ne correspond à cette recherche.";
  if (activeFilter) filters.querySelector(`[data-op-filter="${CSS.escape(activeFilter)}"]`)?.focus({ preventScroll: true });
}
function render() { if (!screen?.classList.contains("on")) return; const active = screen.contains(document.activeElement) ? document.activeElement : null; const activeId = active?.dataset?.gameId; const activeTab = active?.dataset?.opTab; const wasSearch = active === search; const state = data(); if(currentTab==="home") renderHome(state); else renderLibrary(state); if (activeId) screen.querySelector(`[data-game-id="${CSS.escape(activeId)}"]`)?.focus({ preventScroll: true }); else if (activeTab) screen.querySelector(`[data-op-tab="${activeTab}"]`)?.focus({ preventScroll: true }); else if (wasSearch) search.focus({ preventScroll: true }); }
function activate() { if (!bridge()) return; setTab(currentTab); }
document.querySelectorAll("[data-op-tab]").forEach(button => button.addEventListener("click", () => setTab(button.dataset.opTab, button.dataset.opTab === "library")));
document.getElementById("op-return").addEventListener("click", () => bridge()?.goHome?.());
document.getElementById('op-portrait-import').addEventListener('click',async event=>{const b=event.currentTarget;b.disabled=true;b.textContent='Recherche des jaquettes…';try{const r=await fetch('/api/steam/portraits',{method:'POST'}),result=await r.json();if(!r.ok||!result.ok)throw Error(result.message||'Recherche impossible');status.textContent=result.added+' nouvelle(s) jaquette(s) · '+result.total+' disponibles · '+result.missing+' introuvables sur Steam';}catch(error){status.textContent=error.message;}finally{b.disabled=false;b.textContent='Jaquettes verticales';}});
document.getElementById('op-steam-import').addEventListener('click',async event=>{const button=event.currentTarget;button.disabled=true;button.textContent='Lecture de Steam…';try{const response=await fetch('/api/steam/import',{method:'POST'}),result=await response.json();if(!response.ok||!result.ok)throw new Error(result.message||'Import impossible');renderLibrary(data());status.textContent=result.added+' jeu(x) ajouté(s) · '+result.portraits+' jaquette(s) verticale(s) Steam';}catch(error){status.textContent=error.message;}finally{button.disabled=false;button.textContent='Importer Steam';}});
search.addEventListener("input", () => renderLibrary(data()));
document.getElementById('op-sort').addEventListener('change',()=>renderLibrary(data()));
document.getElementById('op-reset').addEventListener('click',()=>{currentFilter='all';search.value='';renderLibrary(data());});
document.querySelectorAll('[data-op-collection]').forEach(button=>button.addEventListener('click',()=>{collection=button.dataset.opCollection;byId('op-custom').value='';document.querySelectorAll('[data-op-collection]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));renderLibrary(data());}));
window.addEventListener("orbit:launcher-ready", activate);
window.addEventListener("orbit:launcher-show", activate);
window.addEventListener("orbit:launcher-data", () => { if (screen?.classList.contains("on")) render(); });
if(window.tracker?.checkUpdate) {
  byId('orbit-update-settings').hidden=false;
  const check=byId('orbit-update-check'), msg=byId('orbit-update-status');
  let version;
  check.onclick=async()=>{
    check.disabled=true;msg.textContent=version?'Préparation de l’installation…':'Vérification sur GitHub…';
    try {
      const result=await window.tracker.checkUpdate(version);
      version=result.version;msg.textContent=result.message;
      check.textContent=version?'Installer Orbit '+version:'Vérifier les mises à jour';
    } catch {msg.textContent='Vérification impossible pour le moment.';}
    finally {check.disabled=false;}
  };
}
if (bridge()) activate();

})();
