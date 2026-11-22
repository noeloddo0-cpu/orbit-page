// Les requêtes et les résultats sont partagés entre l'accueil et la fiche ouverte.
const pending = new Map();
const cache = new Map();
const lifetime = 15 * 60 * 1000;

const normalized = value => String(value || "").normalize("NFD").replace(/\p{M}/gu,"")
  .toLocaleLowerCase("fr").replace(/[^\p{L}\p{N}]+/gu," ").trim();
export function seriesKey(item) {
  return item.tmdbId ? "tv:" + item.tmdbId : normalized(item.title) + "|" + (item.year || "");
}

export function exactSeriesMatch(item, matches) {
  const title = normalized(item.title);
  const candidates = matches.filter(match =>
    (!item.year || String(item.year) === String(match.date || "").slice(0,4)) &&
    [match.title, match.originalTitle].some(name=>normalized(name) === title));
  return candidates.length === 1 ? candidates[0].id : null;
}

async function request(path, body) {
  const response = await fetch("/api/cinema/" + path, {method:"POST",
    headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)});
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 || response.status === 400) {
      const status = await fetch("/api/cinema/tmdb-key").then(r=>r.json()).catch(()=>null);
      if (status?.configured === false) throw Error("Ajoute ta clé TMDB dans Réglages pour charger les épisodes.");
    }
    throw Error(data.error || "TMDB est indisponible.");
  }
  return data;
}

async function resolveGuide(item) {
  let id = item.tmdbId;
  if (!id) {
    const data = await request("poster-search",{type:"series",title:item.title,year:item.year || null});
    id = exactSeriesMatch(item,data.results || []);
    if (!id) throw Error("Choisis la bonne série avec « Rechercher la fiche officielle ».");
  }
  const data = await request("details",{type:"series",id});
  if (!data.episodeGuide) throw Error("TMDB ne fournit pas de décompte pour cette série.");
  return data.episodeGuide;
}

export function getSeriesGuide(item, refresh=false) {
  const key=seriesKey(item), saved=cache.get(key);
  if (!refresh && saved && Date.now()-saved.at < lifetime) return Promise.resolve(saved.guide);
  if (pending.has(key)) return pending.get(key);
  const work=resolveGuide(item).then(guide=>{
    cache.set(key,{at:Date.now(),guide});
    window.dispatchEvent(new CustomEvent("orbit:series-guide",{detail:{key,guide}}));
    return guide;
  }).finally(()=>pending.delete(key));
  pending.set(key,work);
  return work;
}

function element(tag, text) {
  const node=document.createElement(tag);
  node.textContent=text;
  return node;
}
const plural=(count,singular) => count+" "+singular+(count>1?"s":"");
const episodeTag=e=>"S"+e.s+" E"+e.e;

export function createSeriesGuidePanel(panel) {
  let serial=0, current=null;
  const title=element("h3","Épisodes"), refresh=element("button","Actualiser");
  refresh.type="button"; refresh.className="btn";
  const head=document.createElement("header"); head.append(title,refresh);
  const message=element("p",""); message.setAttribute("role","status");
  const body=document.createElement("div");
  panel.replaceChildren(head,message,body);
  refresh.onclick=()=>show(current,true);
  async function show(item, force=false) {
    const stamp=++serial;
    current=item;
    panel.hidden=item?.type!=="series" || !item.title?.trim();
    body.replaceChildren(); message.textContent="";
    if (panel.hidden) return;
    refresh.disabled=true;
    message.textContent="Recherche des épisodes sur TMDB…";
    try {
      const guide=await getSeriesGuide(item,force);
      if (stamp!==serial) return;
      const seasons=Object.entries(guide.seasons);
      const counts=seasons.map(([,count])=>count);
      const total=counts.length && counts.every(Number.isInteger) ? counts.reduce((a,b)=>a+b,0) : null;
      const headline=total!==null ? plural(total,"épisode")+" hors spéciaux" :
        Number.isInteger(guide.total) ? plural(guide.total,"épisode")+" recensés par TMDB" : "Total indisponible";
      message.textContent=headline+" · "+plural(seasons.length,"saison");
      const list=document.createElement("ul");
      for(const [s,n] of seasons) {
        const line=document.createElement("li");
        line.append(element("span","Saison "+s),element("b",Number.isInteger(n)?plural(n,"épisode"):"Nombre inconnu"));
        list.append(line);
      }
      if (guide.specials>0) {
        const line=document.createElement("li"); line.append(element("span","Spéciaux"),element("b",plural(guide.specials,"épisode"))); list.append(line);
      }
      body.append(list);
      if (guide.aired) body.append(element("p","Dernier épisode diffusé · "+episodeTag(guide.aired)));
      if (guide.nextAir) {
        const date=guide.nextAir.date;
        const when=/^\d{4}-\d{2}-\d{2}$/.test(date||"") ?
          " · "+new Date(date+"T12:00:00").toLocaleDateString("fr-FR",{day:"numeric",month:"long",year:"numeric"}) : "";
        body.append(element("p","Prochain épisode annoncé · "+episodeTag(guide.nextAir)+when));
      }
      const link=element("a","Source · TMDB"); link.target="_blank";link.rel="noopener noreferrer";
      link.href="https://www.themoviedb.org/tv/"+guide.tvId; body.append(link);
    } catch(error) {
      if(stamp===serial) message.textContent=error.message==="Failed to fetch"?"Connexion impossible. Réessaie avec Actualiser.":error.message;
    } finally { if(stamp===serial) refresh.disabled=false; }
  }
  return show;
}
