const services = /^(?:netflix|disney\s*\+|prime video|amazon prime video|apple tv\s*\+?|stremio|plex(?: media player)?|jellyfin|crunchyroll|max|hbo max|canal\s*\+|mycanal|vlc(?: media player)?|mpv|emby|paramount\s*\+)$/i;
const watching = /^(?:watching|regarde|en train de regarder|visionne)\s*[:·-]?\s+/i;
const idle = /^(?:browsing|in the menus?|choosing|searching|idle|accueil|navigation|dans les menus|recherche|parcourt|parcourir|en pause|paused)\b/i;
const episodePattern = /\b(?:s(?:eason|aison)?\s*(\d{1,3})\s*[.,:·•|/–-]?\s*[ée](?:p(?:isode)?\.?)?\s*(\d{1,4})|(\d{1,3})x(\d{1,4}))\b/i;
const norm = s => String(s||'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();

export function isVideoActivity(a) {
  return a.type===3 || (a.type===0 && services.test(a.name)) || (a.type===4 && watching.test(a.state||''));
}
export function readWatching(activities, items) {
  for(const a of activities.filter(isVideoActivity)) {
    const fields=[a.details,a.state,a.name].filter(x=>typeof x==='string' && x.trim()).map(x=>x.trim().slice(0,300));
    if(fields.some(x=>idle.test(x)||/\b(?:paused|en pause|bande.annonce|trailer)\b/i.test(x)))continue;
    const ep=fields.join(' | ').match(episodePattern);
    const season=ep?Number(ep[1]||ep[3]):null, episode=ep?Number(ep[2]||ep[4]):null;
    if(ep && (!season || !episode))continue;
    const candidates=[];
    let year;
    for(const field of fields){
      const part=field.replace(watching,'').split(episodePattern)[0].replace(/\s*[-–—:|·,]+\s*$/,'').trim();
      const y=part.match(/\s*\(((?:19|20)\d{2})\)$/);
      if(y)year=Number(y[1]);
      const title=part.replace(/\s*\(((?:19|20)\d{2})\)$/,'').trim();
      if(title && !services.test(title) && !/^(?:custom status|statut personnalisé|watching|playing|lecture|film|movie|series?|episode|streaming)$/i.test(title) && !/^\d+:\d+/.test(title))candidates.push(title);
    }
    if(!candidates.length)continue;
    const keys=new Set(candidates.map(norm));
    const matches=items.filter(i=>(!ep || i.type==='series') && (!year || !i.year || Number(i.year)===year) && [i.title,i.originalTitle].some(t=>t&&keys.has(norm(t))));
    const item=matches.length===1?matches[0]:null;
    const title=item?.title||candidates[0];
    return {id:item?.id||null,title,ambiguous:matches.length>1,type:item?.type||(ep?'series':'film'),season,episode,year:year||null,
      start:+a.timestamps?.start||0,end:+a.timestamps?.end||0};
  }
  return null;
}

export function updateWatchedItem(item,view,completed,now) {
  if(!completed)return item.status==='watchlist'?{...item,status:'watching',progressUpdatedAt:now}:item;
  if(item.type==='series') {
    if(!view.season||!view.episode)return item;
    const history=item.episodeHistory||[];
    if(history.some(x=>x.s===view.season&&x.e===view.episode))return item;
    const advance=view.season>(item.season||0)||(view.season===item.season&&view.episode>(item.episode||0));
    return {...item,...(advance&&item.status!=='watched'?{season:view.season,episode:view.episode}:{}),
      progressUpdatedAt:now,episodeHistory:[...history,{s:view.season,e:view.episode,at:now}]};
  }
  const date=new Date(now),day=[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
  const dates=[...new Set([...(item.watchedDates||[]),item.watchedAt,day].filter(Boolean))].sort();
  if(item.status==='watched' && item.watchedAt===day && item.watchedDates?.includes(day))return item;
  return {...item,status:'watched',watchedAt:day,firstWatchedAt:item.firstWatchedAt||dates[0],watchedDates:dates,progressUpdatedAt:now};
}

// Une avance rapide ou un démarrage en milieu de film ne valide pas le visionnage.
export function createViewingTracker({items,save,notify,clock=Date.now}) {
  let view=null,signature='',lastSample=0,observed=0,done=false;
  const identity=v=>v?JSON.stringify([v.id,v.title,v.season,v.episode]):'';
  const snapshot=()=>view?{id:view.id,title:view.title,type:view.type,season:view.season,episode:view.episode,year:view.year,ambiguous:view.ambiguous,done,key:signature}:null;
  function commit(completed) {
    const item=view?.id && items().find(x=>x.id===view.id);
    if(!item || (completed && item.type==='series'&&!view.episode))return false;
    const next=updateWatchedItem(item,view,completed,clock());
    if(next!==item) {
      try { save(next); } catch { return false; }
    }
    if(completed)done=true;
    return true;
  }
  function tick() {
    const now=clock(),duration=view?.end-view?.start;
    if(view?.start>0 && duration>=60000 && duration<=12*3600000 && now-lastSample<=30000) {
      observed+=Math.max(0,Math.min(now,view.end)-Math.max(lastSample,view.start));
      if(!done && observed>=duration*.9 && commit(true))notify();
    }
    lastSample=now;
  }
  function update(activities) {
    tick();
    const next=readWatching(activities,items()),key=identity(next);
    if(key===signature) {
      if(next && (next.start!==view.start || next.end!==view.end)){observed=0;lastSample=clock();}
      const changed=next?.ambiguous!==view?.ambiguous;view=next;if(changed)notify();return;
    }
    view=next;signature=key;lastSample=clock();observed=0;done=false;
    if(view)commit(false);
    notify();
  }
  function confirm(key) {if(!view || key!==signature || !commit(true))return false;notify();return true;}
  return {update,tick,snapshot,confirm};
}
