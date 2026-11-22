import {cinemaStats,gameStats,duration,fmtNumber} from "./statistics-data.js";

function element(tag, text="", cls=""){
  const node=document.createElement(tag);
  if(cls)node.className=cls;
  node.textContent=text;
  return node;
}
function card(title,note){
  const section=element("section","","os-card");
  section.append(element("h3",title));
  if(note)section.append(element("p",note,"os-note"));
  return section;
}
function facts(rows){
  const dl=element("dl","","os-facts");
  for(const [label,value] of rows){
    const pair=element("div");
    pair.append(element("dt",label),element("dd",String(value)));
    dl.append(pair);
  }
  return dl;
}
function columns(rows,format=fmtNumber){
  const chart=element("ol","","os-columns");
  const max=Math.max(1,...rows.map(r=>r.value));
  for(const {label,value,key} of rows){
    const col=element("li"), track=element("div","","os-track"),bar=element("span","","os-bar"),valueLabel=element("span",format(value),"os-value");
    col.title=(key||label)+" · "+format(value);
    col.setAttribute("aria-label",col.title);
    valueLabel.setAttribute("aria-hidden","true");
    bar.style.height=(100*value/max)+"%";
    track.append(bar); col.append(valueLabel,track,element("small",label));chart.append(col);
  }
  return chart;
}
function ranking(rows,format,empty){
  if(!rows.length)return element("p",empty,"os-empty");
  const list=element("ol","","os-ranking"),max=rows[0][1];
  for(const [label,value] of rows){
    const li=element("li"),line=element("i");
    line.style.width=(value/max*100)+"%";
    li.append(element("span",label),element("b",format(value)),line);list.append(li);
  }
  return list;
}
const colors=["#81c6a1","#7ca7d4","#c8af78","#b494ca","#d98c79","#92999d","#9abdbd"];
function donut(rows){
  const total=rows.reduce((sum,r)=>sum+r[1],0);
  if(!total)return element("p","Aucun titre dans cette sélection.","os-empty");
  const box=element("div","","os-pie"),ring=element("div","","os-ring"),legend=element("ul");
  const stops=[];let end=0;
  rows.forEach(([label,value],i)=>{
    const start=end;end+=value/total*100;
    const color=colors[i%colors.length];
    if(value)stops.push(color+" "+start+"% "+end+"%");
    const row=element("li"),mark=element("i");
    mark.style.background=color;
    row.append(mark,element("span",label),element("b",fmtNumber(value)+" · "+fmtNumber(100*value/total)+" %"));legend.append(row);
  });
  ring.style.backgroundImage="conic-gradient("+stops.join(",")+")";
  ring.setAttribute("aria-hidden","true");ring.append(element("strong",fmtNumber(total)));box.append(ring,legend);return box;
}
function section(title,note,body){
  const node=card(title,note);node.append(body);return node;
}
function cinemaPage(api,type){
  const s=cinemaStats(api.items(),type,api.history()),film=type==="film",parts=[];
  parts.push(facts([[film?"Films":"Séries",s.total],["Titres notés",s.rated],["Note moyenne",s.average===null?"—":fmtNumber(s.average)+" / 5"],[film?"Visionnages datés":"Épisodes consignés",s.events]]));
  const grid=element("div","","os-grid");
  const noteText=(s.total-s.rated)+" sans note"+(s.offScale?" · "+s.offScale+" hors demi-étoiles":"");
  grid.append(section("Tes notes",noteText,columns(s.ratings.map((value,i)=>({label:fmtNumber((i+1)/2),key:fmtNumber((i+1)/2)+" sur 5",value})))),
    section("Répartition par statut","Toute la collection",donut([["À voir",s.statuses.watchlist],["En cours",s.statuses.watching],["Vu",s.statuses.watched]])),
    section(film?"Visionnages par mois":"Épisodes par mois","12 derniers mois · "+(film?s.repeats+" revisionnage(s) dans le journal complet":"Épisodes avec une date enregistrée"),columns(s.timeline)),
    section("Genres les plus présents",s.documented+" titres avec un genre renseigné sur "+s.total,ranking(s.genres,fmtNumber,"Aucun genre renseigné.")));
  const since=s.since?new Date(s.since+"T12:00:00").toLocaleDateString("fr-FR",{dateStyle:"long"}):"";
  const activity=section("Évolution de la collection",since?"Depuis le "+since+" · ajouts et changements enregistrés dans Orbit":"Le suivi commence au prochain enregistrement de la collection.",facts([["Ajouts",s.changes.added],["Notes attribuées",s.changes.rated],["Notes révisées",s.changes.rerated],["Passages au statut vu",s.changes.finished]]));
  parts.push(grid,activity);return parts;
}
function gamesPage(api){
  const s=gameStats(api.gameData()),grid=element("div","","os-grid");
  grid.append(section("Jeux les plus joués","Temps total par jeu, heures importées comprises",ranking(s.top,duration,"Aucun temps de jeu renseigné.")),
    section("Répartition par statut","Jeux de ta bibliothèque",donut(s.statuses)),
    section("Plateformes","Nombre de jeux · "+s.unknown+" sans plateforme connue. Un jeu peut compter sur plusieurs plateformes.",ranking(s.platforms,fmtNumber,"Aucune plateforme identifiée dans les tags, le relevé PSN ou les installations Steam.")),
    section("Jeux les plus lancés","Nombre de sessions enregistrées et terminées",ranking(s.launches,fmtNumber,"Aucune session enregistrée.")));
  const trend=section("Temps de jeu par mois","12 derniers mois · sessions terminées uniquement, en heures",columns(s.timeline,n=>fmtNumber(n/60)));
  const sessions=section("Durée des sessions","Sessions terminées dans Orbit",facts([["Sessions",s.countSessions],["Temps enregistré",duration(s.loggedMinutes)],["Durée moyenne",s.countSessions?duration(s.average):"—"],["La plus longue",s.countSessions?duration(s.longest):"—"]]));
  return [facts([["Jeux",s.total],["Temps total",duration(s.totalMinutes)],["Sessions enregistrées",s.countSessions],["Plateformes connues",s.platforms.length]]),grid,trend,sessions];
}

let modal, refresh;
export function openStatistics(api){
  if(!modal){
    modal=element("dialog");modal.id="orbit-stats";modal.setAttribute("aria-labelledby","os-title");
    const header=element("header"),title=element("h2","Statistiques"),close=element("button","Fermer"),nav=element("nav"),body=element("div","","os-body");
    title.id="os-title";close.type="button";close.onclick=()=>modal.close();
    nav.setAttribute("aria-label","Domaine des statistiques");header.append(title,close);
    let mode="film";
    const tabs=[["film","Films"],["series","Séries"],["games","Jeux"]].map(([id,label])=>{
      const button=element("button",label);button.type="button";button.dataset.mode=id;
      button.onclick=()=>{mode=id;refresh();};nav.append(button);return button;
    });
    refresh=()=>{
      modal.dataset.mode=mode;
      for(const b of tabs)b.setAttribute("aria-pressed",String(b.dataset.mode===mode));
      body.replaceChildren(...(mode==="games"?gamesPage(api):cinemaPage(api,mode)));
    };
    let frame=0;
    const schedule=()=>{if(modal.open&&!frame)frame=requestAnimationFrame(()=>{frame=0;if(modal.open)refresh();});};
    modal.addEventListener("close",()=>{
      window.removeEventListener("orbit:cinema-changed",schedule);
      window.removeEventListener("orbit:launcher-data",schedule);
      document.getElementById("activity-stats")?.focus({preventScroll:true});
    });
    modal.addEventListener("orbit:show",()=>{window.addEventListener("orbit:cinema-changed",schedule);window.addEventListener("orbit:launcher-data",schedule);});
    modal.onclick=e=>{if(e.target!==modal)return;const r=modal.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)modal.close();};
    modal.append(header,nav,body);document.body.append(modal);
  }
  refresh();
  if(!modal.open){modal.showModal();modal.scrollTop=0;modal.querySelector('[aria-pressed="true"]').focus();modal.dispatchEvent(new Event("orbit:show"));}
}

