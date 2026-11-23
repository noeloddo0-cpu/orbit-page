(()=>{
"use strict";
const screen = document.getElementById("launcher-screen");
const homeView = document.getElementById("op-home-view");
const libraryView = document.getElementById("op-library-view");
const hero = document.getElementById("op-hero");
const shelves = document.getElementById("op-shelves");
const weekBox = document.getElementById("op-week");
const grid = document.getElementById("op-grid");
const status = document.getElementById("op-status");
const search = document.getElementById("op-search");
const filters = document.getElementById("op-filters");
const advancedBox = document.getElementById("op-advanced");
let currentTab = "home", currentFilter = "all";
const statusNames = ["En cours", "En pause", "À faire", "Terminé", "Abandonné", "Neutre"];
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const normalize = value => String(value || "").toLocaleLowerCase("fr").normalize("NFD").replace(/\p{M}/gu, "").replace(/[®™©]/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const isFavoriteGame = (game, state) => Boolean(game) && ((state?.favorites || []).some(value => String(value) === String(game.id)) || (state?.favorites || []).includes(normalize(game.n)));
const byId = id => document.getElementById(id);
function bridge() { return window.__orbitLauncherBridge; }
function data() { return bridge()?.getData?.() || { games: [], recent: [], favorites: [], sessions: [], films: [], recap: {}, session: null }; }
const detailsFor = game => bridge()?.detailsFor?.(game.n) || {};

function setTab(tab, focusSearch = false) {
  currentTab = tab === "library" ? "library" : "home";
  homeView.classList.toggle("op-hidden", currentTab !== "home");
  libraryView.classList.toggle("op-hidden", currentTab !== "library");
  document.querySelectorAll("[data-op-tab]").forEach(button => button.setAttribute("aria-current", button.dataset.opTab === currentTab ? "page" : "false"));
  render();
  if (focusSearch) search.focus({ preventScroll: true });
}

/* ---------- Fiche personnelle : note, mini-critique, jaquette ---------- */
const editor = byId('play-editor');
let editingName = '', searchVersion = 0;
function openPersonal(game) {
  editingName = game.n;
  const details = detailsFor(game);
  byId('play-editor-title').textContent = game.n;
  byId('play-kind').value = details.kind || 'game';
  byId('play-note').value = details.note || '';
  byId('play-platforms').value = (details.platforms || []).join(', ');
  byId('play-tags').value = (details.collections || []).join(', ');
  byId('play-rating').value = String(Number(details.rating) || 0);
  byId('play-review').value = details.review || '';
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
  const details = {
    kind: byId('play-kind').value,
    note: byId('play-note').value,
    collections: splitTags(byId('play-tags').value),
    platforms: splitTags(byId('play-platforms').value),
    rating: Math.max(0, Math.min(5, Number(byId('play-rating').value) || 0)),
    review: byId('play-review').value,
  };
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

/* ---------- Actions ---------- */
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
  edit.setAttribute('aria-label','Modifier ma fiche pour '+game.n);actions.append(edit);
  item.append(actions);
}
function inCollection(game) {
  const d=detailsFor(game);
  return d.kind!=='app' && !!d.installedId;
}

/* ---------- Navigation et fiche ---------- */
let refreshAfterDetail = false;
function showGameDetail(game, button) {
  const shelfTitle = button.closest(".op-shelf")?.querySelector("h2")?.textContent;
  const featured = button.closest("#op-hero");
  const scrollTop = screen.scrollTop;
  const shelves = () => [...screen.querySelectorAll(".op-shelf")];
  const titleOf = shelf => shelf.querySelector("h2")?.textContent;
  const positions = new Map(shelves().filter(shelf=>shelf.querySelector(".op-track")).map(shelf => [titleOf(shelf), shelf.querySelector(".op-track").scrollLeft]));
  bridge()?.openGame?.(game.id, () => {
    if (refreshAfterDetail) {
      refreshAfterDetail = false;
      render();
    }
    for (const shelf of shelves()) {
      const left = positions.get(titleOf(shelf));
      if (left !== undefined) { const track=shelf.querySelector(".op-track"); if(track) track.scrollLeft = left; }
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
  const badge = document.createElement("span"); badge.className = "op-card-status"; badge.textContent = statusNames[game.s] ?? statusNames[5];
  const copy = document.createElement("span"); copy.className = "op-card-copy";
  const title = document.createElement("span"); title.className = "op-card-title"; title.textContent = game.n;
  const time = document.createElement("span"); time.className = "op-card-hours"; time.textContent = bridge()?.formatTime?.(Number(game.m) || 0) || "0 h";
  copy.append(title, time); button.append(badge); item.append(copy);
  const trophy = bridge()?.trophyFor?.(game.n), rating = Number(detailsFor(game).rating) || 0;
  if ((trophy?.ok && Number(trophy.total)) || rating) {
    const badges = document.createElement("span"); badges.className = "op-card-badges";
    if (trophy?.ok && Number(trophy.total)) {
      const t = document.createElement("span"); t.className = "op-card-trophies"; t.textContent = "🏆 " + (Number(trophy.unlocked)||0) + "/" + (Number(trophy.total)||0); t.title = "Trophées Steam"; badges.append(t);
    }
    if (rating) { const r = document.createElement("span"); r.className = "op-card-rating"; r.textContent = "★ " + rating.toLocaleString("fr-FR") + "/5"; r.title = "Ma note"; badges.append(r); }
    button.append(badges);
  }
  button.addEventListener("click", () => showGameDetail(game, button)); item.prepend(button);
  if (tools) { item.classList.add("op-library-card"); addPlayActions(item,game); }
  return item;
}
function showCollection(filter="all", sort="name", focusSearch=false) {
  currentFilter=filter;
  search.value="";
  byId("op-sort").value=sort;
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

/* ---------- Données de jeu et suggestions ---------- */
function sessionMs(session){
  return Math.max(0, Number(session?.durationMs) || Number(session?.minutes)*60000 || (session?.end ? Number(session.end)-Number(session.start) : 0));
}
function sessionOverlap(session,start,end){
  const from=Number(session.start)||0,to=session.live?Date.now():(Number(session.end)||from+sessionMs(session));
  return Math.max(0,Math.min(to,end)-Math.max(from,start));
}
function mondayStart(now=Date.now()){
  const date=new Date(now);date.setHours(0,0,0,0);date.setDate(date.getDate()-((date.getDay()+6)%7));return date.getTime();
}
function queueNames(state){return Array.isArray(state.recap?.queue)?state.recap.queue:[];}
function queueGames(state){
  const map=new Map((state.games||[]).map(game=>[normalize(game.n),game]));
  return queueNames(state).map(name=>map.get(normalize(name))).filter(Boolean);
}
function gameLastSession(name,state){
  const key=normalize(name);let last=0;
  for(const session of state.sessions||[]){
    if(normalize(session.game)!==key)continue;
    last=Math.max(last,Number(session.end)||Number(session.start)||0);
  }
  return last;
}
function gameSessions(name,state){
  const key=normalize(name);
  return (state.sessions||[]).filter(session=>normalize(session.game)===key);
}
function playedThisWeek(name,state){
  const start=mondayStart(),end=Date.now(),key=normalize(name);
  if(state.session&&normalize(state.session.name)===key)return true;
  return (state.sessions||[]).some(session=>normalize(session.game)===key&&sessionOverlap(session,start,end)>0);
}
function smartCandidates(state,games,recent,live){
  const now=Date.now(),hour=new Date().getHours(),queue=queueNames(state).map(normalize);
  const lastSessions=new Map(),durations=new Map();
  for(const session of state.sessions||[]){
    const key=normalize(session.game);
    lastSessions.set(key,Math.max(lastSessions.get(key)||0,Number(session.end)||Number(session.start)||0));
    durations.set(key,(durations.get(key)||0)+sessionMs(session));
  }
  const allDurations=[...durations.values()].filter(Boolean);
  const globalAverage=allDurations.length?allDurations.reduce((a,b)=>a+b,0)/allDurations.length:45*60000;
  const dayOfYear=Math.floor((now-new Date(new Date(now).getFullYear(),0,0))/86400000);
  return games.map(game=>{
    const key=normalize(game.n),last=Math.max(Number(game.t)||0,lastSessions.get(key)||0);
    const queueIndex=queue.indexOf(key);
    let score=last?Math.max(0,140-Math.min(140,(now-last)/86400000*5)):0;
    if(game.s===0)score+=30; else if(game.s===1)score+=10;
    if(isFavoriteGame(game,state))score+=14;
    if(queueIndex>=0)score+=70-Math.min(45,queueIndex*8);
    if(!last&&!Number(game.m)){let seed=0;for(const ch of String(game.name||game.n||""))seed=(seed*31+ch.charCodeAt(0))%997;score+=6+(seed*37+dayOfYear)%17;}
    const average=durations.get(key)?durations.get(key)/Math.max(1,gameSessions(game.n,state).length):globalAverage;
    if(hour>=20||hour<3)score+=Math.min(20,average/60000/10);
    else score+=Math.max(0,14-average/60000/12);
    return {game,score,last,queueIndex,reason:queueIndex>=0?(queueIndex===0?"Prochain jeu de ta file":"Dans ta file d’attente"):last?["Dernière partie",lastPlayed(last)].filter(Boolean).join(" · "):game.s===2?"Suggestion du backlog":isFavoriteGame(game,state)?"Un de tes favoris":"À reprendre"};
  }).sort((a,b)=>b.score-a.score||a.game.n.localeCompare(b.game.n,"fr"));
}

/* ---------- Récap de la semaine ---------- */
function weekReport(state){
  const start=mondayStart(),end=Date.now(),now=new Date();
  const sessions=(state.sessions||[]).filter(session=>normalize(session.game)&&isGameName(state,session.game));
  const live=state.session?{game:state.session.name,start:state.session.start,live:true}:null;
  if(live)sessions.push(live);
  const byGame=new Map();let minutes=0,count=0;
  for(const session of sessions){
    const overlap=sessionOverlap(session,start,end);
    if(!overlap)continue;
    minutes+=overlap/60000;count++;
    const key=normalize(session.game);byGame.set(key,(byGame.get(key)||0)+overlap/60000);
  }
  let films=0;
  for(const item of state.films||[]){
    const dates=new Set([...(item.watchedDates||[]),item.watchedAt].filter(value=>/^\d{4}-\d{2}-\d{2}$/.test(value||"")));
    for(const day of dates)if(new Date(day+"T12:00:00")>=new Date(start))films++;
    for(const episode of item.episodeHistory||[])if(Number(episode.at)>=start)films++;
  }
  let trophies=0;
  for(const game of state.games||[]){const summary=bridge()?.trophyFor?.(game.n);if(summary?.ok)trophies+=Number(summary.unlockedThisWeek)||0;}
  const top=[...byGame].map(([key,value])=>({name:(state.games||[]).find(game=>normalize(game.n)===key)?.n||key,value})).sort((a,b)=>b.value-a.value).slice(0,6);
  return {start,end,sessions:count,minutes:Math.round(minutes),films,trophies,top,now};
}
function openReport(title,subtitle,stats,columns){
  let dialog=byId("op-year");
  if(!dialog){
    dialog=document.createElement("dialog");dialog.id="op-year";
    dialog.innerHTML='<div class="op-report"><header><div><h2></h2><p class="op-report-sub"></p></div><button class="op-report-close" type="button">Fermer</button></header><div class="op-report-grid"></div><div class="op-report-columns"></div></div>';
    document.body.append(dialog);
    dialog.querySelector(".op-report-close").onclick=()=>dialog.close();
    dialog.addEventListener("click",event=>{if(event.target===dialog)dialog.close();});
  }
  dialog.querySelector("h2").textContent=title;
  dialog.querySelector(".op-report-sub").textContent=subtitle||"";
  const grid=dialog.querySelector(".op-report-grid");grid.replaceChildren();
  for(const [value,label] of stats){
    const box=document.createElement("div");box.className="op-report-stat";
    const b=document.createElement("b");b.textContent=value;const span=document.createElement("span");span.textContent=label;
    box.append(b,span);grid.append(box);
  }
  const cols=dialog.querySelector(".op-report-columns");cols.replaceChildren();
  for(const column of columns){
    const box=document.createElement("section");box.className="op-report-card";
    const h=document.createElement("h3");h.textContent=column.title;box.append(h);
    if(!column.rows.length){const empty=document.createElement("p");empty.textContent=column.empty||"Rien pour le moment.";empty.style.color="#a8b1b8";empty.style.fontSize="13px";box.append(empty);}
    for(const [label,value] of column.rows){
      const row=document.createElement("div");row.className="op-report-row";
      const span=document.createElement("span");span.textContent=label;const b=document.createElement("b");b.textContent=value;
      row.append(span,b);box.append(row);
    }
    cols.append(box);
  }
  if(!dialog.open)dialog.showModal();
}
function openWeekReport(state=data()){
  const report=weekReport(state);
  openReport("Ta semaine",
    "Du "+new Date(report.start).toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"})+" à aujourd’hui",
    [[bridge().formatTime(report.minutes),"Temps de jeu"],[String(report.sessions),"Sessions"],[String(report.trophies),"Trophées"],[String(report.films),"Films / épisodes"]],
    [{title:"Jeux de la semaine",rows:report.top.map(item=>[item.name,bridge().formatTime(Math.round(item.value))]),empty:"Aucune session cette semaine."},
     {title:"À retenir",rows:[["Sessions démarrées cette semaine",String(report.sessions)],["Trophées débloqués",String(report.trophies)],["Visionnages",String(report.films)]]}]);
}
function openYearReport(state=data()){
  const year=new Date().getFullYear(),start=new Date(year,0,1).getTime(),end=Date.now();
  const sessions=(state.sessions||[]).filter(session=>Number(session.start)>=start&&Number(session.start)<=end);
  if(state.session&&Number(state.session.start)>=start)sessions.push({...state.session,live:true});
  const byGame=new Map();let minutes=0,count=0;
  for(const session of sessions){
    const overlap=sessionOverlap(session,start,end);if(!overlap)continue;
    minutes+=overlap/60000;count++;
    const key=normalize(session.game);byGame.set(key,(byGame.get(key)||0)+overlap/60000);
  }
  let films=0,episodes=0,ratings=[];
  for(const item of state.films||[]){
    const dates=new Set([...(item.watchedDates||[]),item.watchedAt].filter(value=>/^\d{4}-\d{2}-\d{2}$/.test(value||"")));
    for(const day of dates)if(Number(day.slice(0,4))===year)films++;
    for(const episode of item.episodeHistory||[])if(new Date(episode.at).getFullYear()===year)episodes++;
    if(Number(item.rating)>0)ratings.push([item.title,Number(item.rating)]);
  }
  let trophies=0;
  for(const game of state.games||[]){const summary=bridge()?.trophyFor?.(game.n);if(summary?.ok)trophies+=Number(summary.unlockedThisYear)||0;}
  const top=[...byGame].map(([key,value])=>({name:(state.games||[]).find(game=>normalize(game.n)===key)?.n||key,value})).sort((a,b)=>b.value-a.value).slice(0,8);
  const best=ratings.sort((a,b)=>b[1]-a[1]).slice(0,6);
  openReport("Année Orbit "+year,"Ton année en jeux, trophées et images.",
    [[bridge().formatTime(Math.round(minutes)),"Temps de jeu"],[String(count),"Sessions"],[String(trophies),"Trophées"],[String(films+episodes),"Visionnages"]],
    [{title:"Jeux les plus joués",rows:top.map(item=>[item.name,bridge().formatTime(Math.round(item.value))]),empty:"Aucune session cette année."},
     {title:"Films et séries préférés",rows:best.map(([name,rating])=>[name,rating.toLocaleString("fr-FR")+" / 5"]),empty:"Aucune note cette année."}]);
}

/* ---------- File d’attente ---------- */
function renderQueueShelf(state){
  const games=queueGames(state);
  if(!games.length)return null;
  const section=node("section","op-shelf op-queue-shelf");
  const head=node("div","op-shelf-head");
  const heading=node("h2","","À jouer ensuite");
  const tools=node("div","op-hub-links");
  const choose=action("Choisir pour moi",()=>chooseForMe(state));choose.className="op-shelf-link";
  const random=action("Mélanger",()=>shuffleQueue(state));random.className="op-shelf-link";
  tools.append(choose,random);head.append(heading,tools);
  const list=node("div","op-queue-list");
  const raw=queueNames(state);
  games.forEach((game,displayIndex)=>{
    const rawIndex=raw.findIndex(name=>normalize(name)===normalize(game.n));
    if(rawIndex<0)return;
    const row=node("div","op-queue-row");row.draggable=true;row.dataset.queueIndex=String(rawIndex);
    const index=node("div","op-queue-index",String(rawIndex+1));
    const cover=node("div","op-queue-cover"),image=new Image();image.alt="";cover.append(image);
    bridge().loadGameArt(image,game.n,true,null,()=>{cover.textContent=game.n.slice(0,1);});
    const copy=node("div","op-queue-copy");copy.append(node("b","",game.n),node("small","",[statusNames[game.s] ?? statusNames[5],bridge().formatTime(game.m||0),playedThisWeek(game.n,state)?"Joué cette semaine":""].filter(Boolean).join(" · ")));
    const open=document.createElement("button");open.type="button";open.textContent="Ouvrir";open.onclick=()=>showGameDetail(game,open);
    const remove=document.createElement("button");remove.type="button";remove.textContent="Retirer";remove.onclick=()=>bridge().queueRemove(game.id);
    row.append(index,cover,copy,open,remove);
    row.addEventListener("dragstart",event=>{row.classList.add("dragging");event.dataTransfer.setData("text/plain",String(rawIndex));event.dataTransfer.effectAllowed="move";});
    row.addEventListener("dragend",()=>row.classList.remove("dragging"));
    row.addEventListener("dragover",event=>{event.preventDefault();row.classList.add("drag-over");});
    row.addEventListener("dragleave",()=>row.classList.remove("drag-over"));
    row.addEventListener("drop",event=>{event.preventDefault();row.classList.remove("drag-over");const from=Number(event.dataTransfer.getData("text/plain"));bridge().queueMove(from,rawIndex);});
    list.append(row);
  });
  section.append(head,list);return section;
}
function chooseForMe(state){
  const queue=queueGames(state);
  const pool=(state.games||[]).filter(game=>detailsFor(game).kind!=="app"&&game.s===2);
  const pick=queue[0]||pool[Math.floor(Math.random()*pool.length)]||(state.games||[]).filter(game=>detailsFor(game).kind!=="app")[0];
  if(!pick)return;
  selectedName=normalize(pick.n);currentTab="home";bridge().notify("Orbit propose "+pick.n+".");setTab("home");screen.scrollTo({top:0,behavior:"smooth"});
}
function shuffleQueue(state){
  const games=queueGames(state);if(games.length<2)return;
  const shuffled=[...games].sort(()=>Math.random()-.5);
  for(let index=0;index<shuffled.length;index++){
    const from=queueNames(state).findIndex(name=>normalize(name)===normalize(shuffled[index].n));
    if(from>=0)bridge().queueMove(from,index);
  }
  bridge().notify("File mélangée.");
}

/* ---------- Accueil ---------- */
let selectedName="", homeSignature="", homeCandidates=[];
function isGameName(state,name){return (state.games||[]).some(game=>normalize(game.n)===normalize(name)&&detailsFor(game).kind!=="app");}
function trophyLine(game){
  const summary=bridge()?.trophyFor?.(game.n);
  if(!summary?.ok||!summary.next)return null;
  const line=node("p","op-trophy-next");
  line.append(document.createTextNode("Prochain trophée : "));
  const strong=node("b","",summary.next.title||"À découvrir");line.append(strong);
  if(summary.next.description)line.append(document.createTextNode(" — "+summary.next.description));
  return line;
}
function renderHome(state) {
  const allGames=state.games||[];
  const games=allGames.filter(g=>detailsFor(g).kind!=="app" && detailsFor(g).installedId);
  const byName=new Map(allGames.map(g=>[normalize(g.n),g]));
  const recent=[],seen=new Set();
  for(const entry of state.recent||[]){
    const name=normalize(entry.name),game=byName.get(name);
    if(game&&!seen.has(name)){seen.add(name);recent.push({game,at:entry.at});}
  }
  const live=byName.get(normalize(state.session?.name));
  if(live&&!seen.has(normalize(live.n)))recent.unshift({game:live,at:state.session.start});
  const favorites=games.filter(g=>isFavoriteGame(g,state));
  const later=games.filter(g=>g.s===2);
  const queue=queueGames(state);
  homeCandidates=smartCandidates(state,games,recent,live);
  const selected=homeCandidates.find(item=>normalize(item.game.n)===selectedName)?.game;
  const featured=selected||live||queue.find(game=>games.includes(game))||homeCandidates[0]?.game||favorites[0]||games[0];
  const candidate=homeCandidates.find(item=>item.game===featured);
  const entry=recent.find(r=>r.game===featured);
  const trophy=featured?bridge()?.trophyFor?.(featured.n):null;
  const signature=JSON.stringify([featured?.id,state.session,state.favorites,queue,state.sessions?.length,state.films?.length,
    recent.map(r=>[r.game.id,r.at,bridge().portraitFor(r.game.n)]),
    trophy?[trophy.unlocked,trophy.total,trophy.next?.title]:null,
    [featured,...games.slice(0,10),...favorites.slice(0,8),...later.slice(0,8)].filter(Boolean).map(g=>[g.id,g.n,g.m,g.s,detailsFor(g).installedId,detailsFor(g).rating,bridge().coverFor(g.n),bridge().portraitFor(g.n)])]);
  if(signature===homeSignature)return;
  homeSignature=signature;
  const focused=document.activeElement?.dataset.homeAction;
  const shelfPositions=new Map([...shelves.querySelectorAll(".op-shelf")].filter(s=>s.querySelector(".op-track")).map(s=>[s.querySelector("h2").textContent,s.querySelector(".op-track").scrollLeft]));
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
    const label=playing?"Session en cours":candidate?.reason|| (entry?["Dernière partie",lastPlayed(entry.at)].filter(Boolean).join(" · "):installedLabel(featured));
    const title=node("h2","",featured.n);
    const details=detailsFor(featured);
    const metaParts=[statusNames[featured.s] ?? statusNames[5],bridge().formatTime(featured.m||0)+" de jeu"];
    if(Number(details.steamMinutes)>0)metaParts.push("Steam : "+bridge().formatTime(Number(details.steamMinutes)));
    const meta=node("p","op-hero-meta",metaParts.filter(Boolean).join(" · "));
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
    if(homeCandidates.length>1){
      const change=button("Changer de jeu","change",()=>{
        const current=homeCandidates.findIndex(item=>item.game===featured);
        const next=homeCandidates[(current+1)%Math.min(homeCandidates.length,6)].game;
        selectedName=normalize(next.n);render();
      });change.classList.add("op-secondary-action");actions.append(change);
    }
    const favorite=isFavoriteGame(featured,state);
    const fav=button(favorite?"Retirer des favoris":"Ajouter aux favoris","favorite",()=>bridge().favorite(featured.id),"op-favorite-action");
    copy.append(node("p","op-hero-label",label),title,meta,actions,fav);
    const trophies=trophyLine(featured);if(trophies)copy.append(trophies);
    section.append(art,copy);hero.append(section);
    if(recent.length>1)hero.append(recentChooser(recent,featured));
  }else{
    const empty=node("div","op-shelf-empty");empty.append(node("p","","Aucun jeu installé détecté sur ce PC."),button("Voir mes jeux","browse",()=>showCollection()));hero.append(empty);
  }
  renderWeek(state);
  const fragment=document.createDocumentFragment();
  makeShelf("Jeux installés",games,fragment,()=>showCollection());
  makeShelf("Favoris",favorites,fragment,()=>showCollection());
  makeShelf("À faire",later,fragment,()=>showCollection("2"));
  const queueShelf=renderQueueShelf(state);if(queueShelf)fragment.append(queueShelf);
  shelves.replaceChildren(fragment);
  for(const s of shelves.querySelectorAll(".op-shelf")){const track=s.querySelector(".op-track");if(track)track.scrollLeft=shelfPositions.get(s.querySelector("h2").textContent)||0;}
  const rail=hero.querySelector(".op-recent-games");if(rail){rail.scrollTop=recentTop;rail.scrollLeft=recentLeft;}
  if(focused)hero.querySelector('[data-home-action="'+CSS.escape(focused)+'"]')?.focus({preventScroll:true});
}
function installedLabel(game){return detailsFor(game).installedId?"Installé sur ce PC":"Dans ta collection";}
function renderWeek(state){
  if(!weekBox)return;
  const report=weekReport(state);
  weekBox.replaceChildren();
  const card=node("div","op-week-card"),intro=node("div","op-week-intro");
  intro.append(node("b","","Ta semaine"),node("span","","Depuis lundi · "+bridge().formatTime(report.minutes)+" de jeu"));
  const link=action("Voir le bilan complet",()=>openWeekReport(state));link.className="op-week-link";
  const yearLink=action("Année Orbit",()=>openYearReport(state));yearLink.className="op-week-link";
  intro.append(link,yearLink);card.append(intro);
  for(const [value,label] of [[String(report.sessions),"sessions"],[String(report.trophies),"trophées"],[String(report.films),"films / épisodes"],[bridge().formatTime(report.minutes),"de jeu"]]){
    const metric=node("div","op-week-metric");metric.append(node("b","",value),node("span","",label));card.append(metric);
  }
  weekBox.append(card);
}

/* ---------- Bibliothèque et filtres avancés ---------- */
const advanced={trophies:"all",installed:false,unplayed:false,week:false,steam:false};
function trophyFilterMatch(game,value){const summary=bridge()?.trophyFor?.(game.n);const total=Number(summary?.total)||0,unlocked=Number(summary?.unlocked)||0;if(value==="all")return true;if(value==="complete")return total>0&&unlocked>=total;if(value==="progress")return total>0&&unlocked>0&&unlocked<total;if(value==="none")return !total;return true;}
function matchesAdvanced(game,state){
  if(advanced.installed&&!detailsFor(game).installedId)return false;
  if(advanced.unplayed&&(Number(game.m)>0||Number(game.t)>0))return false;
  if(advanced.week&&!playedThisWeek(game.n,state))return false;
  if(advanced.steam&&!detailsFor(game).steamAppId)return false;
  return trophyFilterMatch(game,advanced.trophies);
}
function buildAdvancedFilters(state){
  if(!advancedBox)return;
  if(advancedBox.dataset.ready)return;
  advancedBox.dataset.ready="1";
  const make=(label,key,value,count)=>document.createElement("button");
  const trophyGroup=document.createElement("div");trophyGroup.className="op-advanced";
  const trophyTitle=document.createElement("h3");trophyTitle.textContent="Trophées";trophyGroup.append(trophyTitle);
  const trophyDefs=[["Tous","all"],["100 %","complete"],["En cours","progress"],["Sans trophées","none"]];
  for(const [label,value] of trophyDefs){
    const b=document.createElement("button");b.type="button";b.dataset.advTrophy=value;
    const span=document.createElement("span");span.textContent=label;const small=document.createElement("small");small.dataset.count=value;b.append(span,small);
    b.onclick=()=>{advanced.trophies=value;renderLibrary(data());};trophyGroup.append(b);
  }
  const more=document.createElement("div");more.className="op-advanced";
  const moreTitle=document.createElement("h3");moreTitle.textContent="Affiner";more.append(moreTitle);
  const defs=[["Installés","installed"],["Jamais lancés","unplayed"],["Joués cette semaine","week"],["Steam uniquement","steam"]];
  for(const [label,key] of defs){
    const b=document.createElement("button");b.type="button";b.dataset.advFilter=key;
    const span=document.createElement("span");span.textContent=label;const small=document.createElement("small");small.dataset.count=key;b.append(span,small);
    b.onclick=()=>{advanced[key]=!advanced[key];renderLibrary(data());};more.append(b);
  }
  advancedBox.append(trophyGroup,more);
  advancedBox.addEventListener("click",event=>{if(event.target.closest("button"))renderLibrary(data());});
}
function updateAdvancedFilters(state,collection){
  if(!advancedBox)return;
  const set=(selector,count)=>{const el=advancedBox.querySelector(selector);if(el)el.textContent=String(count);};
  const trophyCounts={all:collection.length,complete:0,progress:0,none:0};
  for(const game of collection){
    const summary=bridge()?.trophyFor?.(game.n);const total=Number(summary?.total)||0,unlocked=Number(summary?.unlocked)||0;
    if(!total)trophyCounts.none++;else if(unlocked>=total)trophyCounts.complete++;else if(unlocked>0)trophyCounts.progress++;
  }
  for(const [key,value] of Object.entries(trophyCounts))set('[data-count="'+key+'"]',value);
  set('[data-count="installed"]',collection.filter(g=>detailsFor(g).installedId).length);
  set('[data-count="unplayed"]',collection.filter(g=>!(Number(g.m)>0||Number(g.t)>0)).length);
  set('[data-count="week"]',collection.filter(g=>playedThisWeek(g.n,state)).length);
  set('[data-count="steam"]',collection.filter(g=>detailsFor(g).steamAppId).length);
  advancedBox.querySelectorAll("[data-adv-trophy]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.advTrophy===advanced.trophies)));
  advancedBox.querySelectorAll("[data-adv-filter]").forEach(b=>b.setAttribute("aria-pressed",String(!!advanced[b.dataset.advFilter])));
}
let coopFilter;
import("/themes/coop-filter.js").then(({mountCoopFilter})=>{
  coopFilter=mountCoopFilter({panel:filters.closest("aside")||filters.parentElement,render:()=>renderLibrary(data())});
});
function renderLibrary(state) {
  const collection=(state.games||[]).filter(g=>inCollection(g)&&(!coopFilter||coopFilter.matches(detailsFor(g))));
  buildAdvancedFilters(state);
  updateAdvancedFilters(state,collection);
  const group=collection.filter(game=>matchesAdvanced(game,state));
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
  status.textContent = games.length ? `${games.length} jeu${games.length > 1 ? "x" : ""}` : "Aucun jeu ne correspond à ces filtres.";
  if (activeFilter) filters.querySelector(`[data-op-filter="${CSS.escape(activeFilter)}"]`)?.focus({ preventScroll: true });
}

/* ---------- Palette Ctrl+K ---------- */
let paletteDialog,paletteInput,paletteList,paletteActions=[],paletteIndex=0;
function ensurePalette(){
  if(paletteDialog)return;
  paletteDialog=document.createElement("dialog");paletteDialog.id="op-palette";paletteDialog.setAttribute("aria-label","Palette de commandes");
  paletteDialog.innerHTML='<div class="op-palette-box"><input type="search" autocomplete="off" spellcheck="false" placeholder="Chercher un jeu, un film ou une action" aria-label="Palette de commandes"><div id="op-palette-list" role="listbox"></div><div class="op-palette-foot"><span>↑ ↓ pour choisir · Entrée pour ouvrir</span><span>Échap pour fermer</span></div></div>';
  document.body.append(paletteDialog);
  paletteInput=paletteDialog.querySelector("input");paletteList=paletteDialog.querySelector("#op-palette-list");
  paletteInput.addEventListener("input",()=>fillPalette(paletteInput.value));
  paletteInput.addEventListener("keydown",event=>{
    if(event.key==="ArrowDown"||event.key==="ArrowUp"){event.preventDefault();movePalette(event.key==="ArrowDown"?1:-1);}
    else if(event.key==="Enter"){event.preventDefault();paletteActions[paletteIndex]?.run();}
  });
  paletteDialog.addEventListener("click",event=>{if(event.target===paletteDialog)paletteDialog.close();});
  paletteDialog.addEventListener("close",()=>{paletteActions=[];paletteList.replaceChildren();});
}
function paletteRows(query){
  const rows=[],q=normalize(query),state=data();
  const add=(label,meta,run)=>{if(q&&!normalize(label+" "+meta).includes(q))return;rows.push({label,meta,run});};
  add("Accueil","Navigation",()=>{closePalette();if(screen.classList.contains("on"))setTab("home");else bridge()?.openLauncher?.();});
  add("Jeux","Navigation",()=>{closePalette();bridge()?.openLauncher?.();setTimeout(()=>setTab("library"),40);});
  add("Films & séries","Navigation",()=>{closePalette();bridge()?.openFilms?.();});
  add("Réglages","Navigation",()=>{closePalette();bridge()?.openSettings?.();});
  add("Statistiques","Outils",()=>{closePalette();bridge()?.openStatistics?.();});
  add("Récap de la semaine","Outils",()=>{closePalette();openWeekReport(state);});
  add("Année Orbit","Outils",()=>{closePalette();openYearReport(state);});
  add("Mode TV / manette","Affichage",()=>{closePalette();const on=bridge()?.toggleTvMode?.();if(on!==false)openPaletteFlash(on?"Mode TV activé.":"Mode TV désactivé.");});
  add("Mini-mode","Affichage",()=>{closePalette();Promise.resolve(bridge()?.toggleMiniMode?.()).then(on=>openPaletteFlash(on?"Mini-mode activé.":"Mini-mode désactivé."));});
  add("Synchroniser Steam","Steam",()=>{closePalette();syncSteam(true);});
  add("Choisir un jeu pour moi","Jeux",()=>{closePalette();chooseForMe(state);});
  const games=(state.games||[]).filter(game=>detailsFor(game).kind!=="app").sort((a,b)=>a.n.localeCompare(b.n,"fr"));
  for(const game of games.slice(0,120)){
    add("Ouvrir "+game.n,"Jeu",()=>{closePalette();bridge()?.openGame?.(game.id);});
    if(canLaunch(game))add("Lancer "+game.n,"Steam",()=>{closePalette();bridge()?.openGame?.(game.id);setTimeout(()=>{const b=byId("op-game-layer")?.querySelector(".steam-launch");if(b&&b.tagName==="A")b.click();else if(canLaunch(game))window.tracker.launchSteam(Number(detailsFor(game).installedId));},350);});
    if(!queueNames(state).some(name=>normalize(name)===normalize(game.n)))add("Ajouter "+game.n+" à la file","File",()=>{closePalette();bridge()?.queueGame?.(game.id);});
  }
  for(const film of (state.films||[]).slice(0,120))add("Ouvrir "+film.title,film.type==="series"?"Série":"Film",()=>{closePalette();bridge()?.openFilm?.(film.id);});
  return rows.slice(0,80);
}
function fillPalette(query){
  paletteActions=paletteRows(query);paletteIndex=0;paletteList.replaceChildren();
  if(!paletteActions.length){const empty=document.createElement("div");empty.id="op-palette-empty";empty.textContent="Aucun résultat.";paletteList.append(empty);return;}
  paletteActions.forEach((item,index)=>{
    const b=document.createElement("button");b.type="button";b.setAttribute("role","option");b.dataset.paletteIndex=String(index);
    const label=document.createElement("span");label.textContent=item.label;const meta=document.createElement("small");meta.textContent=item.meta;
    b.append(label,meta);b.addEventListener("click",()=>item.run());b.addEventListener("pointermove",()=>{paletteIndex=index;updatePaletteSelection();});
    paletteList.append(b);
  });
  updatePaletteSelection();
}
function updatePaletteSelection(){
  [...paletteList.querySelectorAll("button")].forEach((b,index)=>b.setAttribute("aria-selected",String(index===paletteIndex)));
  paletteList.querySelector('[aria-selected="true"]')?.scrollIntoView({block:"nearest"});
}
function movePalette(direction){
  if(!paletteActions.length)return;
  paletteIndex=(paletteIndex+direction+paletteActions.length)%paletteActions.length;updatePaletteSelection();
}
function openPalette(){
  ensurePalette();paletteInput.value="";fillPalette("");if(!paletteDialog.open)paletteDialog.showModal();paletteInput.focus({preventScroll:true});
}
function closePalette(){if(paletteDialog?.open)paletteDialog.close();}
function openPaletteFlash(message){bridge()?.notify?.(message);}

/* ---------- Synchronisation Steam ---------- */
let steamSyncing=false,steamAutoDone=false;
async function syncSteam(manual=false){
  if(steamSyncing)return;
  steamSyncing=true;
  try{
    const response=await fetch("/api/steam/sync",{method:"POST"});
    const result=await response.json();
    if(!response.ok||!result.ok)throw Error(result.message||"Synchronisation Steam impossible.");
    bridge()?.loadTrophies?.(manual);
    if(manual)bridge()?.notify?.("Steam synchronisé · "+result.linked+" jeux liés · "+result.playtime+" temps de jeu.");
  }catch(error){if(manual)bridge()?.notify?.(error.message||"Synchronisation Steam impossible.");}
  finally{steamSyncing=false;steamAutoDone=true;}
}

/* ---------- Rendu global ---------- */
function render() { if (!screen?.classList.contains("on")) return; const active = screen.contains(document.activeElement) ? document.activeElement : null; const activeId = active?.dataset?.gameId; const activeTab = active?.dataset?.opTab; const wasSearch = active === search; const state = data(); if(currentTab==="home") renderHome(state); else renderLibrary(state); if (activeId) screen.querySelector(`[data-game-id="${CSS.escape(activeId)}"]`)?.focus({ preventScroll: true }); else if (activeTab) screen.querySelector(`[data-op-tab="${activeTab}"]`)?.focus({ preventScroll: true }); else if (wasSearch) search.focus({ preventScroll: true }); }
function activate() { if (!bridge()) return; setTab(currentTab); bridge()?.loadTrophies?.(); if(!steamAutoDone)setTimeout(()=>syncSteam(false),1800); }
document.querySelectorAll("[data-op-tab]").forEach(button => button.addEventListener("click", () => setTab(button.dataset.opTab, button.dataset.opTab === "library")));
document.getElementById("op-return").addEventListener("click", () => bridge()?.goHome?.());
document.getElementById('op-portrait-import').addEventListener('click',async event=>{const b=event.currentTarget;b.disabled=true;b.textContent='Recherche des jaquettes…';try{const r=await fetch('/api/steam/portraits',{method:'POST'}),result=await r.json();if(!r.ok||!result.ok)throw Error(result.message||'Recherche impossible');status.textContent=result.added+' nouvelle(s) jaquette(s) · '+result.total+' disponibles · '+result.missing+' sans jaquette verticale';}catch(error){status.textContent=error.message;}finally{b.disabled=false;b.textContent='Jaquettes verticales';}});
document.getElementById('op-steam-import').addEventListener('click',()=>{if(window.orbitImport?.open)window.orbitImport.open('steam');else status.textContent='Ouvre la bibliothèque pour importer Steam avec aperçu.';});
search.addEventListener("input", () => renderLibrary(data()));
document.getElementById('op-sort').addEventListener('change',()=>renderLibrary(data()));
document.getElementById('op-reset').addEventListener('click',()=>{currentFilter='all';search.value='';for(const key of ['installed','unplayed','week','steam'])advanced[key]=false;advanced.trophies='all';coopFilter?.reset();renderLibrary(data());});
byId('op-tv-toggle').onclick=()=>{const on=bridge()?.toggleTvMode?.();if(on!==false)byId('op-tv-toggle').textContent=on?"Mode TV : activé":"Mode TV";};
byId('op-stats-link').onclick=()=>bridge()?.openStatistics?.();

window.addEventListener("orbit:launcher-ready", activate);
window.addEventListener("orbit:launcher-show", () => {
  selectedName="";setTab("home");screen.scrollTop=0;
});
byId("op-find-game").onclick=()=>showCollection("all","name",true);
screen.querySelectorAll("[data-op-shortcut]").forEach(b=>b.onclick=()=>showCollection());
window.addEventListener("orbit:launcher-data", () => {
  homeSignature="";
  if (byId("op-game-layer").open) refreshAfterDetail = true;
  else if (screen?.classList.contains("on")) render();
});
window.addEventListener("orbit:trophies", () => { homeSignature=""; if(screen?.classList.contains("on")) render(); });
window.addEventListener("orbit:queue-changed", () => { homeSignature=""; if(screen?.classList.contains("on")) render(); });
window.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault(); event.stopImmediatePropagation(); openPalette();
  }
}, true);
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
