import test from "node:test";
import assert from "node:assert/strict";
import {gameStats,cinemaStats} from "../themes/statistics-data.js";
import {withCinemaStatistics} from "../cinema-statistics.mjs";
const now=new Date(2026,10,19,12), item={id:"a",type:"film",status:"watchlist",title:"A",rating:0};
test("Notes, revisionnages, épisodes et genres ont leurs propres dénominateurs",()=>{
  const items=[{...item,rating:4.5,status:"watched",genres:["Drame","Drame"],watchedAt:"2026-11-03",watchedDates:["2026-11-03","2026-09-15"]},
    {...item,id:"b"},{...item,id:"c",rating:4.2},{...item,id:"s",type:"series",rating:5,season:6,episodeHistory:[{s:1,e:1,at:+now}]}];
  const films=cinemaStats(items,"film",null,now),series=cinemaStats(items,"series",null,now);
  assert.equal(films.rated,2);assert.equal(films.ratings[8],1);assert.equal(films.offScale,1);
  assert.equal(films.events,2);assert.equal(films.repeats,1);assert.equal(films.timeline.at(-1).value,1);
  assert.deepEqual(films.genres,[["Drame",1]]);assert.equal(series.events,1);assert.equal(series.ratings[9],1);
  assert.equal(cinemaStats([],"film",null,now).average,null);
});
test("Les imports ne sont pas additionnés aux sessions, les plateformes sont dédupliquées",()=>{
  const start=+new Date(2026,9,31,23,30);
  const result=gameStats({games:[{n:"T",m:1000,s:0},{n:"U",m:20,s:1},{n:"App",m:3000,s:0}],
    sessions:[{game:"T",start,durationMs:3600000},{game:"App",start,durationMs:60000}],
    isGame:n=>n!=="App",normalize:n=>n.toLowerCase(),details:n=>n==="T"?{psnMinutes:0,installedId:7,platforms:["PS5","PlayStation","Steam"]}:{steamAppId:3},statusNames:["En cours","À faire"]},now);
  assert.equal(result.totalMinutes,1020);assert.equal(result.countSessions,1);assert.equal(result.unknown,1);assert.equal(result.longest,60);
  assert.deepEqual(result.platforms,[["PC",1],["PlayStation",1]]);assert.deepEqual(result.timeline.slice(-2).map(x=>x.value),[30,30]);
  assert.deepEqual(result.statuses,[["En cours",1],["À faire",1]]);
});
test("Le suivi distingue édition, import, première note et passage à vu et résiste au rechargement",()=>{
  const old={items:[item]},b={...item,id:"b",type:"series",rating:4,status:"watched"};
  let saved=withCinemaStatistics(old,{items:[{...item,status:"watched",rating:3},b]},now);
  let day=saved.statistics.days["2026-11-19"];
  assert.deepEqual(day.film,{rated:1,finished:1});assert.deepEqual(day.series,{added:1,rated:1});
  saved=withCinemaStatistics(JSON.parse(JSON.stringify(saved)),{items:saved.items},now);
  assert.deepEqual(saved.statistics.days["2026-11-19"],day);
  saved=withCinemaStatistics(saved,{items:[{...saved.items[0],rating:4},b]},new Date(2026,10,20));
  assert.deepEqual(saved.statistics.days["2026-11-20"].film,{rerated:1});
  assert.equal(cinemaStats(saved.items,"film",saved.statistics,now).changes.rated,1);
});

