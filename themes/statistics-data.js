const number = new Intl.NumberFormat("fr-FR",{maximumFractionDigits:1});
export const fmtNumber = value => number.format(value);
export function duration(minutes) {
  const whole = Math.max(0,Math.round(minutes));
  return whole < 60 ? whole+" min" : Math.floor(whole/60)+" h "+String(whole%60).padStart(2,"0");
}
function yearMonth(date) {
  return date.getFullYear()+"-"+String(date.getMonth()+1).padStart(2,"0");
}
function months(now) {
  return Array.from({length:12},(_,i)=>{
    const from = new Date(now.getFullYear(),now.getMonth()-11+i,1);
    return {key:yearMonth(from),label:from.toLocaleDateString("fr-FR",{month:"short"}),start:+from,
      end:+new Date(from.getFullYear(),from.getMonth()+1,1),value:0};
  });
}
const count = (map,key) => map.set(key,(map.get(key)||0)+1);
const ranked = map => [...map].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0],"fr"));
export function cinemaStats(all, type, history, now = new Date()) {
  const items = all.filter(i=>i.type===type);
  const ratings = Array(10).fill(0), timeline=months(now), genres=new Map();
  const statuses = {watched:0,watching:0,watchlist:0};
  let rated=0, sum=0, events=0, repeats=0, documented=0, offScale=0;
  for (const item of items) {
    if (Object.hasOwn(statuses,item.status)) statuses[item.status]++;
    const note=Number(item.rating);
    if (note>0 && note<=5) {
      sum+=note; rated++;
      if (Number.isInteger(note*2)) ratings[note*2-1]++;
      else offScale++;
    }
    const tags=new Set((item.genres||[]).filter(Boolean));
    if(tags.size) documented++;
    for(const tag of tags) count(genres,tag);
    const dates=type==="film"
      ? [...new Set([...(item.watchedDates||[]),item.firstWatchedAt,item.watchedAt].filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d||"")))]
      : (item.episodeHistory||[]).filter(e=>e.s>0 && e.e>0 && e.at && Number.isFinite(+new Date(e.at))).map(e=>yearMonth(new Date(e.at)));
    if(type==="film") repeats+=Math.max(0,dates.length-1);
    events+=dates.length;
    for(const date of dates) {
      const month=timeline.find(m=>m.key===date.slice(0,7));
      if(month) month.value++;
    }
  }
  const changes={added:0,rated:0,rerated:0,finished:0};
  for(const day of Object.values(history?.days||{})){
    for(const key of Object.keys(changes)) changes[key]+=day[type]?.[key]||0;
  }
  return {total:items.length,ratings,rated,offScale,average:rated?sum/rated:null,statuses,events,repeats,timeline,
    genres:ranked(genres).slice(0,6),documented,changes,since:history?.since};
}
function platformFamily(tag) {
  if(/^(playstation|ps[1-5p]|ps vita|psvr)/i.test(tag)) return "PlayStation";
  if(/^(pc|windows|steam|linux|mac)(\b|$)/i.test(tag)) return "PC";
  if(/^xbox/i.test(tag)) return "Xbox";
  if(/^(nintendo|switch|wii|gamecube|3ds)/i.test(tag)) return "Nintendo";
  return tag;
}
export function gameStats({games,sessions,details,isGame,normalize,statusNames},now=new Date()){
  const titles=games.filter(g=>isGame(g.n)), timeline=months(now);
  const nameByKey=new Map(titles.map(g=>[normalize(g.n),g.n]));
  const platforms=new Map(), launches=new Map(), statuses=statusNames.map(s=>[s,0]);
  let totalMinutes=0, unknown=0, countSessions=0, loggedMs=0,longestMs=0;
  const top=[];
  for(const game of titles){
    const minutes=Math.max(0,Number(game.m)||0);
    totalMinutes+=minutes;
    if(minutes)top.push([game.n,minutes]);
    const group=statuses[game.s];
    if(group)group[1]++;
    else{let missing=statuses.find(x=>x[0]==="Non renseigné");if(!missing){missing=["Non renseigné",0];statuses.push(missing);}missing[1]++;}
    const info=details(game.n), tags=new Set((info.platforms||[]).map(t=>platformFamily(t.trim())).filter(Boolean));
    if(Number.isFinite(info.psnMinutes))tags.add("PlayStation");
    if(info.installedId)tags.add("PC");
    if(!tags.size)unknown++;
    for(const tag of tags)count(platforms,tag);
  }
  for(const session of sessions){
    const title=nameByKey.get(normalize(session.game)), start=Number(session.start);
    if(!title || !(start>0))continue;
    const elapsed=Math.max(0,Number(session.durationMs)||((session.end>start)?session.end-start:0)||Number(session.minutes)*60000||0);
    countSessions++; loggedMs+=elapsed;longestMs=Math.max(longestMs,elapsed);count(launches,title);
    for(const m of timeline) m.value+=Math.max(0,Math.min(start+elapsed,m.end)-Math.max(start,m.start))/60000;
  }
  return {total:titles.length,totalMinutes,top:top.sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],"fr")).slice(0,8),
    platforms:ranked(platforms),unknown,statuses,countSessions,loggedMinutes:loggedMs/60000,
    average:countSessions?loggedMs/countSessions/60000:0,longest:longestMs/60000,launches:ranked(launches).slice(0,5),timeline};
}

