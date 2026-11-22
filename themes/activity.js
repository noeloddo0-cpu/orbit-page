import { getSeriesGuide } from "./series-guide.js";

const el=(tag,text="",cls="")=>{const n=document.createElement(tag);n.textContent=text;n.className=cls;return n;};
const normalize=s=>String(s||"").normalize("NFD").replace(/\p{M}/gu,"").toLowerCase().trim();
const localDay=t=>{const d=new Date(t);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");};
const minutes=n=>{const m=Math.abs(n);return (n<0?"−":"")+(m>=60?Math.floor(m/60)+" h "+String(m%60).padStart(2,"0"):m+" min");};
const dayLabel=key=>new Date(key+"T12:00:00").toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
const shortSession=s=>s.durationMs<60000?"moins d’une minute":minutes(Math.floor(s.durationMs/60000));

export function timeAudit(game,sessions,psn,active) {
  const sums={discord:0,manual:0,other:0};
  for(const s of sessions) {
    const group=s.source==="discord"?"discord":s.source==="manual"?"manual":"other";
    sums[group]+=Math.max(0,Number(s.minutes)||0);
  }
  if(active && active.id===game.id && active.mins>0) sums[active.source==="discord"?"discord":active.source==="manual"?"manual":"other"]+=active.mins;
  const delta=Number(game.manualDelta)||0, rest=game.m-sums.discord-sums.manual-sums.other-delta;
  const rows=[["Sessions Discord",sums.discord],["Sessions lancées à la main",sums.manual],["Sessions d’origine inconnue",sums.other],["Corrections manuelles",delta],["Solde antérieur ou importé",rest]];
  const box=el("section");box.id="time-audit";box.append(el("strong","Origine du temps · "+minutes(game.m)));
  const now=Date.now(), midnight=new Date(now).setHours(0,0,0,0);
  const overlap=(from,to)=>Math.max(0,Math.min(to,now)-Math.max(from,midnight));
  const today=sessions.reduce((ms,s)=>ms+(s.end?overlap(s.start,s.end):0),0)
    +(active?.id===game.id?overlap(active.start,now):0);
  if(today>0)box.append(el("p","Sessions aujourd’hui · "+(today<60000?"moins d’une minute":minutes(Math.floor(today/60000)))));
  for(const [label,value] of rows) if(value)box.append(el("p",label+" · "+minutes(value)));
  if(Number.isFinite(psn))box.append(el("p","Relevé PSN importé · "+minutes(psn)+" (repère historique, déjà susceptible d’être inclus dans le total)"));
  return box;
}

export function journalEntries(sessions,items) {
  const entries=[];
  for(const s of sessions) if(s.game && s.start && s.end) entries.push({day:localDay(s.start),sort:s.start,title:s.game,meta:"Session de jeu · "+shortSession(s)});
  for(const i of items) {
    if(i.type==="film") {
      const dates=new Set([...(i.watchedDates||[]),i.watchedAt].filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d||"")));
      for(const day of dates)entries.push({day,sort:0,title:i.title,meta:"Film"+(i.rating?" · "+i.rating+"/5":"")});
    }
    for(const e of i.episodeHistory||[])if(e.at && e.s && e.e)entries.push({day:localDay(e.at),sort:e.at,title:i.title,meta:"Épisode vu · S"+e.s+" E"+e.e});
  }
  return entries.sort((a,b)=>b.day.localeCompare(a.day)||b.sort-a.sort||a.title.localeCompare(b.title,"fr"));
}

export function mountActivity(api) {
  const tools=el("nav");tools.id="activity-tools";tools.setAttribute("aria-label","Outils de la collection");
  document.querySelector(".orbit-home .orbit-footer").before(tools);
  const dialog=el("dialog");dialog.id="activity-dialog";dialog.setAttribute("aria-labelledby","activity-heading");
  const head=el("header"),title=el("h2"),close=el("button","Fermer","btn");
  title.id="activity-heading";close.onclick=()=>dialog.close();head.append(title,close);
  const input=el("input","","field"),content=el("div");
  input.type="search";input.placeholder="Jeux, films et séries";input.setAttribute("aria-label","Rechercher dans Orbit");
  dialog.append(head,input,content);document.body.append(dialog);
  let token=0;
  function row(label,detail,action) {
    const n=el(action?"button":"div",label,"activity-entry");
    if(action)n.onclick=()=>{dialog.close();action();};
    if(detail)n.append(el("small",detail));return n;
  }
  function search(){
    const q=normalize(input.value);content.replaceChildren();
    if(!q){content.append(el("p","Tape un titre pour ouvrir sa fiche."));return;}
    const found=[...api.games().filter(g=>api.isGame(g.n)).map(g=>({title:g.n,type:"Jeu",open:()=>api.game(g.id)})),
      ...api.items().map(i=>({title:i.title,type:i.type==="series"?"Série":"Film",open:()=>api.media(i)}))]
      .filter(i=>normalize(i.title).includes(q)).sort((a,b)=>Number(normalize(b.title).startsWith(q))-Number(normalize(a.title).startsWith(q))||a.title.localeCompare(b.title,"fr"));
    found.slice(0,40).forEach(i=>content.append(row(i.title,i.type,i.open)));
    if(!found.length)content.append(el("p","Aucun titre trouvé."));
    if(found.length>40)content.append(el("p","Précise ta recherche pour voir les autres titres."));
  }
  async function calendar(id){
    const series=api.items().filter(i=>i.type==="series"&&i.status==="watching");
    content.textContent=series.length?"Consultation de TMDB…":"Aucune série en cours.";
    if(!series.length)return;
    const events=await Promise.all(series.map(async i=>{
      try {const g=await getSeriesGuide(i);return {i,next:g.nextAir};} catch {return {i,error:true};}
    }));
    if(id!==token||!dialog.open)return;
    events.sort((a,b)=>(a.next?.date||"9999").localeCompare(b.next?.date||"9999"));
    content.replaceChildren();
    for(const {i,next,error} of events){
      const dated=/^\d{4}-\d{2}-\d{2}$/.test(next?.date||"");
      const detail=next?"S"+next.s+" E"+next.e+" · "+(dated?dayLabel(next.date):"Date à confirmer"):error?"Guide TMDB indisponible":"Aucune diffusion annoncée";
      content.append(row(i.title,detail,()=>api.media(i)));
    }
  }
  function journal(){
    const entries=journalEntries(api.sessions().filter(s=>api.isGame(s.game)),api.items());
    if(!entries.length){content.textContent="Aucune activité datée pour le moment.";return;}
    let index=0,day="";
    function more(){let count=0;while(index<entries.length && count++<50){const e=entries[index++];if(day!==e.day){day=e.day;content.append(el("h3",dayLabel(day)));}content.append(row(e.title,e.meta));}
      if(index<entries.length){const b=el("button","Voir plus","btn");b.onclick=()=>{b.remove();more();};content.append(b);}}
    more();
  }
  function open(mode){
    token++;title.textContent=mode;content.replaceChildren();input.hidden=mode!=="Rechercher";input.value="";
    if(!dialog.open)dialog.showModal();
    if(!input.hidden){input.focus();search();}else if(mode==="Calendrier des séries")calendar(token);else journal();
  }
  for(const label of ["Rechercher","Calendrier des séries","Journal"]){const b=el("button",label);b.type="button";b.onclick=()=>open(label);tools.append(b);}
  const stats=el("button","Statistiques");stats.type="button";stats.id="activity-stats";stats.onclick=api.stats;tools.append(stats);
  input.oninput=search;input.onkeydown=e=>{if(e.key==="Enter")content.querySelector("button")?.click();};
  dialog.addEventListener("close",()=>token++);
  document.addEventListener("keydown",e=>{
    if(document.getElementById("orbit-stats")?.open)return;
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();open("Rechercher");}
    if(dialog.open && e.key==="Escape"){e.preventDefault();e.stopImmediatePropagation();dialog.close();}
  },true);
}
