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
let currentTab = "home", currentFilter = "all", collection = "all";
const statusNames = ["En cours", "En pause", "À faire", "Terminé", "Abandonné", "Neutre"];
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
const pendingLaunches=new Set();
function canLaunch(game){
  return detailsFor(game).kind!=="app" && !!detailsFor(game).installedId && typeof window.tracker?.launchSteam==="function";
}
async function launchGame(game,control){
  const steamId=Number(detailsFor(game).installedId);
  if(!canLaunch(game)||!Number.isSafeInteger(steamId)||pendingLaunches.has(steamId))return;
  pendingLaunches.add(steamId);control.disabled=true;
  try{
    const result=await window.tracker.launchSteam(steamId);
    if(!result?.ok)throw Error();
    bridge().played(game.id);
    bridge().notify("Lancement demandé à Steam pour "+game.n+".");
    render();
  }catch{bridge().notify("Steam n’a pas pu ouvrir "+game.n+". Vérifie son installation.");}
  finally{pendingLaunches.delete(steamId);control.disabled=false;}
}
function addPlayActions(item, game) {
  const actions = document.createElement('div'); actions.className='op-card-actions';
  if(canLaunch(game)){
    const play=action("Jouer",()=>launchGame(game,play));
    play.setAttribute("aria-label","Jouer à "+game.n+" avec Steam");actions.append(play);
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

let refreshAfterDetail = false;
function showGameDetail(game, button) {
  const shelfTitle = button.closest(".op-shelf")?.querySelector("h2")?.textContent;
  const featured = button.closest("#op-hero");
  const scrollTop = screen.scrollTop;
  const shelves = () => [...screen.querySelectorAll(".op-shelf")];
  const titleOf = shelf => shelf.querySelector("h2")?.textContent;
  const positions = new Map(shelves().map(shelf => [titleOf(shelf), shelf.querySelector(".op-track").scrollLeft]));
  bridge()?.openGame?.(game.id, () => {
    if (refreshAfterDetail) {
      refreshAfterDetail = false;
      render();
    }
    for (const shelf of shelves()) {
      const left = positions.get(titleOf(shelf));
      if (left !== undefined) shelf.querySelector(".op-track").scrollLeft = left;
    }
    screen.scrollTop = scrollTop;
    const scope = shelfTitle ? shelves().find(shelf => titleOf(shelf) === shelfTitle) : grid;
    const replacement = featured ? hero.querySelector('[data-home-action="detail"]') : scope?.querySelector(`[data-game-id="${CSS.escape(String(game.id))}"]`);
    (button.isConnected ? button : replacement || screen.querySelector('[aria-current="page"]'))?.focus({preventScroll:true});
  });
}
function card(game, tools) {
  const item = document.createElement("article"); item.className = "op-card";
  const button = document.createElement("button"); button.type = "button"; button.className = "op-card-button";
  button.dataset.gameId = String(game.id);
  button.setAttribute("aria-label", `Ouvrir la fiche de ${game.n}`);
  const image = new Image();
  image.alt = ""; image.loading = "lazy"; image.decoding = "async";
  button.append(image);
  bridge().loadGameArt(image, game.n, true, null, () => {
    const initial = document.createElement("span");
    initial.className = "op-card-fallback";
    initial.textContent = (game.n.match(/[A-Za-z0-9]/) || ["?"])[0].toUpperCase();
    image.replaceWith(initial);
  });
  const shade = document.createElement("span"); shade.className = "op-card-shade";
  const badge = document.createElement("span"); badge.className = "op-card-status"; badge.textContent = statusNames[game.s] || statusNames[0];
  const copy = document.createElement("span"); copy.className = "op-card-copy";
  const title = document.createElement("span"); title.className = "op-card-title"; title.textContent = game.n;
  const time = document.createElement("span"); time.className = "op-card-hours"; time.textContent = bridge()?.formatTime?.(Number(game.m) || 0) || "0 h";
  copy.append(title, time); button.append(badge); item.append(copy); button.addEventListener("click", () => showGameDetail(game, button)); item.prepend(button);
  if (tools) { item.classList.add("op-library-card"); addPlayActions(item,game); }
  return item;
}
function showCollection(group="all", filter="all", sort="name", focusSearch=false) {
  collection=group;
  currentFilter=filter;
  search.value="";
  byId("op-sort").value=sort;
  byId("op-custom").value="";
  coopFilter?.reset();
  setTab("library",focusSearch);
  screen.scrollTop=0;
  if(!focusSearch)screen.querySelector('[data-op-tab="library"]').focus({preventScroll:true});
}
function makeShelf(title, games, fragment, browse) {
  if (!games.length) return;
  const section = document.createElement("section"); section.className = "op-shelf";
  const head = document.createElement("div"); head.className = "op-shelf-head";
  const heading = document.createElement("h2"); heading.textContent = title;
  const link=action("Tout voir",browse);link.className="op-shelf-link";link.setAttribute("aria-label","Tout voir · "+title);
  head.append(heading, link);
  const track = document.createElement("div"); track.className = "op-track";
  games.slice(0, 8).forEach(game => track.append(card(game,true)));
  section.append(head, track); fragment.append(section);
}
function node(tag,cls,text=""){
  const el=document.createElement(tag);el.className=cls;el.textContent=text;return el;
}
function button(label,key,handler,cls="op-button"){
  const b=action(label,()=>handler(b));b.className=cls;b.dataset.homeAction=key;return b;
}
function lastPlayed(at){
  if(!at)return "";
  const date=new Date(at);
  if(!Number.isFinite(+date))return "";
  const today=new Date(),yesterday=new Date();yesterday.setDate(today.getDate()-1);
  if(date.toDateString()===today.toDateString())return "Aujourd’hui";
  if(date.toDateString()===yesterday.toDateString())return "Hier";
  return date.toLocaleDateString("fr-FR",{day:"numeric",month:"short",...(date.getFullYear()!==today.getFullYear()?{year:"numeric"}:{})});
}
function recentChooser(recent,featured) {
  const rail=node("section","op-recent"),title=node("h2","","Dernières parties");
  const list=node("div","op-recent-games");
  for(const {game,at} of recent){
    const name=normalize(game.n);
    const pick=button("","recent-"+name,()=>{
      selectedName=name;render();
    },"op-recent-pick");
    pick.setAttribute("aria-pressed",String(game.id===featured.id));
    const cover=node("span","op-recent-art"),image=new Image();
    image.alt="";image.loading="lazy";cover.append(image);
    bridge().loadGameArt(image,game.n,true,null,()=>{cover.textContent=game.n.trim().slice(0,1);});
    const copy=node("span","op-recent-copy");copy.append(node("strong","",game.n),node("small","",lastPlayed(at)));
    pick.append(cover,copy);list.append(pick);
  }
  rail.append(title,list);return rail;
}
let selectedName="", homeSignature="";
function renderHome(state) {
  const games=state.games.filter(g=>detailsFor(g).kind!=="app");
  const byName=new Map(games.map(g=>[normalize(g.n),g]));
  const recent=[],seen=new Set();
  for(const entry of state.recent){
    const name=normalize(entry.name),game=byName.get(name);
    if(game&&!seen.has(name)){seen.add(name);recent.push({game,at:entry.at});}
  }
  const live=byName.get(normalize(state.session?.name));
  if(live&&!seen.has(normalize(live.n)))recent.unshift({game:live,at:state.session.start});
  const installed=games.filter(g=>detailsFor(g).installedId);
  const favorites=games.filter(g=>state.favorites.includes(normalize(g.n)));
  const later=games.filter(g=>g.s===2);
  const featured=recent.find(r=>normalize(r.game.n)===selectedName)?.game || live || recent[0]?.game || installed[0] || favorites[0] || games[0];
  const entry=recent.find(r=>r.game===featured);
  const signature=JSON.stringify([featured?.id,state.session,state.favorites,recent.map(r=>[r.game.id,r.at,bridge().portraitFor(r.game.n)]),
    [featured,...installed.slice(0,8),...favorites.slice(0,8),...later.slice(0,8)].filter(Boolean).map(g=>[g.id,g.n,g.m,g.s,detailsFor(g).installedId,bridge().coverFor(g.n),bridge().portraitFor(g.n)])]);
  if(signature===homeSignature)return;
  homeSignature=signature;
  const focused=document.activeElement?.dataset.homeAction;
  const shelfPositions=new Map([...shelves.querySelectorAll(".op-shelf")].map(s=>[s.querySelector("h2").textContent,s.querySelector(".op-track").scrollLeft]));
  const recentTop=hero.querySelector(".op-recent-games")?.scrollTop||0,recentLeft=hero.querySelector(".op-recent-games")?.scrollLeft||0;
  hero.replaceChildren();hero.classList.toggle("op-with-recent",recent.length>1);
  byId("op-home-title").textContent=entry || !featured ? "Reprendre" : "Jouer";
  if(featured){
    const section=node("section","op-hero"),art=node("div","op-hero-art"),image=new Image();
    image.alt="";image.fetchPriority="high";art.append(image);
    bridge().loadGameArt(image,featured.n,false,null,()=>{
      section.classList.add("op-no-wide");
      const portrait=new Image();portrait.alt="";art.replaceChildren(portrait);
      bridge().loadGameArt(portrait,featured.n,true,null,()=>{art.replaceChildren();section.classList.add("op-no-art");});
    });
    const copy=node("div","op-hero-copy"),playing=live===featured;
    const label=playing?"Session en cours":entry?["Dernière partie",lastPlayed(entry.at)].filter(Boolean).join(" · "):installed.includes(featured)?"Installé sur ce PC":"Dans ta collection";
    const title=node("h2","",featured.n);
    const meta=node("p","op-hero-meta",[statusNames[featured.s],bridge().formatTime(featured.m||0)+" de jeu",installed.includes(featured)?"Steam":""].filter(Boolean).join(" · "));
    const actions=node("div","op-actions");
    const detail=button("Fiche du jeu","detail",b=>showGameDetail(featured,b));
    if(!playing && canLaunch(featured)){
      actions.append(button(entry?"Reprendre le jeu":"Lancer le jeu","launch",b=>launchGame(featured,b),"op-button primary"));
    }else if(playing && state.session.source==="manual"){
      actions.append(button("Terminer le suivi","end",()=>bridge().stopTracking(),"op-button primary"));
    }else if(!state.session){
      actions.append(button("Démarrer le suivi","track",()=>bridge().startTracking(featured.id),"op-button primary"));
    }else{
      detail.classList.add("primary");
    }
    actions.append(detail);
    const favorite=favorites.includes(featured);
    const fav=button(favorite?"Retirer des favoris":"Ajouter aux favoris","favorite",()=>bridge().favorite(featured.id),"op-favorite-action");
    copy.append(node("p","op-hero-label",label),title,meta,actions,fav);section.append(art,copy);hero.append(section);
    if(recent.length>1)hero.append(recentChooser(recent,featured));
  }else{
    const empty=node("div","op-shelf-empty");empty.append(node("p","","Ta prochaine partie apparaîtra ici."),button("Parcourir la bibliothèque","browse",()=>showCollection()));hero.append(empty);
  }
  const fragment=document.createDocumentFragment();
  makeShelf("Installés sur ce PC",installed,fragment,()=>showCollection("installed"));
  makeShelf("Favoris",favorites,fragment,()=>showCollection("favorites"));
  makeShelf("À faire",later,fragment,()=>showCollection("all","2"));
  shelves.replaceChildren(fragment);
  for(const s of shelves.querySelectorAll(".op-shelf"))s.querySelector(".op-track").scrollLeft=shelfPositions.get(s.querySelector("h2").textContent)||0;
  const rail=hero.querySelector(".op-recent-games");if(rail){rail.scrollTop=recentTop;rail.scrollLeft=recentLeft;}
  if(focused)hero.querySelector('[data-home-action="'+CSS.escape(focused)+'"]')?.focus({preventScroll:true});
}
let coopFilter;
import("/themes/coop-filter.js").then(({mountCoopFilter})=>{
  coopFilter=mountCoopFilter({panel:filters.closest("aside")||filters.parentElement,render:()=>renderLibrary(data())});
});
function renderLibrary(state) {
  syncCollections(state.games || []);
  const group=(state.games||[]).filter(g=>inCollection(g,state) && (!coopFilter || coopFilter.matches(detailsFor(g))));
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
document.getElementById('op-portrait-import').addEventListener('click',async event=>{const b=event.currentTarget;b.disabled=true;b.textContent='Recherche des jaquettes…';try{const r=await fetch('/api/steam/portraits',{method:'POST'}),result=await r.json();if(!r.ok||!result.ok)throw Error(result.message||'Recherche impossible');status.textContent=result.added+' nouvelle(s) jaquette(s) · '+result.total+' disponibles · '+result.missing+' sans jaquette verticale';}catch(error){status.textContent=error.message;}finally{b.disabled=false;b.textContent='Jaquettes verticales';}});
document.getElementById('op-steam-import').addEventListener('click',async event=>{const button=event.currentTarget;button.disabled=true;button.textContent='Lecture de Steam…';try{const response=await fetch('/api/steam/import',{method:'POST'}),result=await response.json();if(!response.ok||!result.ok)throw new Error(result.message||'Import impossible');renderLibrary(data());status.textContent=result.added+' jeu(x) ajouté(s) · '+result.portraits+' jaquette(s) verticale(s) Steam';}catch(error){status.textContent=error.message;}finally{button.disabled=false;button.textContent='Importer Steam';}});
search.addEventListener("input", () => renderLibrary(data()));
document.getElementById('op-sort').addEventListener('change',()=>renderLibrary(data()));
document.getElementById('op-reset').addEventListener('click',()=>{currentFilter='all';search.value='';coopFilter?.reset();renderLibrary(data());});
document.querySelectorAll('[data-op-collection]').forEach(button=>button.addEventListener('click',()=>{collection=button.dataset.opCollection;byId('op-custom').value='';document.querySelectorAll('[data-op-collection]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));renderLibrary(data());}));
window.addEventListener("orbit:launcher-ready", activate);
window.addEventListener("orbit:launcher-show", () => {
  selectedName="";setTab("home");screen.scrollTop=0;
});
byId("op-find-game").onclick=()=>showCollection("all","all","name",true);
screen.querySelectorAll("[data-op-shortcut]").forEach(b=>b.onclick=()=>showCollection(b.dataset.opShortcut));
window.addEventListener("orbit:launcher-data", () => {
  if (byId("op-game-layer").open) refreshAfterDetail = true;
  else if (screen?.classList.contains("on")) render();
});
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
