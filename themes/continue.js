import { recentSessions, episodeProgress } from "./continue-progress.js";
import { getSeriesGuide, seriesKey } from "./series-guide.js";

const node = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text) el.textContent = text;
  return el;
};

export function mountContinue(api) {
  const home = document.querySelector("#home-screen");
  const section = node("section","continue-row"), heading = node("h2","","Continuer"), track = node("div","continue-track");
  section.hidden = true;
  heading.id = "continue-title";
  section.setAttribute("aria-labelledby",heading.id);
  section.append(heading, track);
  home.querySelector(".orbit-footer").before(section);
  const guides = new Map(), pending = new Set();
  let signature = "";
  function fetchGuide(item) {
    const key=seriesKey(item);
    if (guides.has(key)) return;
    guides.set(key,null);
    getSeriesGuide(item).then(guide=>{
      if (guides.get(key)!==guide) { guides.set(key,guide); render(); }
    }).catch(()=>{});
  }
  function gameEntry(g,active) {
    const live = active?.id === g.id, id = String(api.details(g.n).steamAppId || api.details(g.n).installedId || "");
    return { key:"game-"+g.id,title:g.n,cover:api.cover(g.n),lines:[live?"Session en cours":"Dernière session de jeu"],
      open:()=>api.openGame(g.id), steam:!live && /^\d{1,10}$/.test(id) ? id : null };
  }
  function seriesEntry(item) {
    fetchGuide(item);
    const progress = episodeProgress(item,guides.get(seriesKey(item)));
    return { key:"series-"+item.id,title:item.title,cover:item.poster,lines:[progress.last,progress.label],
      open:()=>api.openSeries(item),item,next:progress.next };
  }
  async function mark(entry,button) {
    if (pending.has(entry.key)) return;
    pending.add(entry.key); button.disabled=true;
    try {
      const response = await fetch("/api/cinema/episode", {method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({id:entry.item.id,season:entry.item.season || null,episode:entry.item.episode || null,next:entry.next})});
      const data = await response.json();
      if (data.item) api.replaceSeries(data.item);
      if (!response.ok) throw Error(data.error || "Enregistrement impossible.");
      api.notify(data.item.status==="watched" ? "Série terminée" : "Épisode enregistré");
    } catch(error) { api.notify(error.message || "Enregistrement impossible."); }
    finally { pending.delete(entry.key); button.disabled=false; render(); }
  }
  function card(entry) {
    const box = node("article","continue-card"), open=node("button","continue-open");
    open.type="button"; open.dataset.entry=entry.key; open.onclick=entry.open;
    if(entry.cover) {
      const img=node("img","continue-cover"); img.alt=""; img.loading="lazy"; img.referrerPolicy="no-referrer";
      img.onerror=()=>img.remove(); img.src=entry.cover; open.append(img);
    }
    const copy=node("span","continue-copy");
    copy.append(node("strong","",entry.title),...entry.lines.map(line=>node("small","",line)));
    open.append(copy); box.append(open);
    if (entry.steam) {
      const link=node("a","continue-action","Lancer"); link.href="steam://run/"+entry.steam;
      link.target="_blank"; link.rel="noopener noreferrer"; link.tabIndex=0;
      link.setAttribute("aria-label","Lancer "+entry.title+" avec Steam"); box.append(link);
    } else if (entry.next) {
      const btn=node("button","continue-action","Épisode vu"); btn.type="button"; btn.dataset.action=entry.key;
      btn.setAttribute("aria-label",entry.title+" · marquer S"+entry.next.season+" E"+entry.next.episode+" comme vu");
      btn.disabled=pending.has(entry.key); btn.onclick=()=>mark(entry,btn); box.append(btn);
    }
    return box;
  }
  function render() {
    const state=api.state();
    const games=recentSessions({...state,key:api.key,isGame:api.isGame}).map(g=>gameEntry(g,state.active));
    const series=api.series().filter(x=>x.type==="series" && x.status==="watching")
      .sort((a,b)=>(b.progressUpdatedAt||b.addedAt||0)-(a.progressUpdatedAt||a.addedAt||0)).slice(0,2).map(seriesEntry);
    const entries=[...games,...series];
    const nextSignature=JSON.stringify(entries.map(e=>[e.key,e.title,e.cover,e.lines,e.steam,e.next,pending.has(e.key)]));
    if(signature===nextSignature) return;
    signature=nextSignature;
    const focused=document.activeElement, hadFocus=track.contains(focused);
    const scroll=track.scrollLeft;
    track.replaceChildren(...entries.map(card)); track.scrollLeft=scroll;
    section.hidden=!entries.length;
    if(hadFocus) {
      const target=[...track.querySelectorAll("button,a")].find(b=>(focused.dataset.action && b.dataset.action===focused.dataset.action && !b.disabled) || (focused.dataset.entry && b.dataset.entry===focused.dataset.entry));
      (target || track.querySelector("button") || home.querySelector(".section-card")).focus({preventScroll:true});
    }
  }
  window.addEventListener("orbit:launcher-data",render);
  window.addEventListener("orbit:cinema-changed",render);
  window.addEventListener("orbit:series-guide",({detail})=>{
    guides.set(detail.key,detail.guide); render();
  });
  home.addEventListener("keydown",event=>{
    if(section.hidden || !event.key.startsWith("Arrow")) return;
    const controls=[...track.querySelectorAll("button:not(:disabled),a[href]")];
    const index=controls.indexOf(event.target);
    let target=null;
    if(index<0 && event.key==="ArrowDown" && event.target.closest("#section-cards")) target=controls[0];
    if(index>=0 && event.key==="ArrowUp") target=home.querySelector(".section-card[data-active=true]");
    if(index>=0 && event.key==="ArrowLeft") target=controls[Math.max(0,index-1)];
    if(index>=0 && event.key==="ArrowRight") target=controls[Math.min(controls.length-1,index+1)];
    if(target) { event.preventDefault(); event.stopImmediatePropagation(); target.focus(); }
  },true);
  render();
  return item => { const p=episodeProgress(item,guides.get(seriesKey(item))); return p.last+" · "+p.label; };
}
