import assert from 'node:assert/strict';
import test from 'node:test';
import {createViewingTracker, isVideoActivity, readWatching} from '../discord-viewing.mjs';
const initial=[{id:'f',title:'Premier contact',originalTitle:'Arrival',type:'film',status:'watchlist',rating:4},{id:'s',title:'Better Call Saul',type:'series',status:'watching',season:4,episode:9}];
function fixture(){
 let rows=structuredClone(initial),now=Date.now();
 const tracker=createViewingTracker({items:()=>rows,save:item=>{rows=rows.map(x=>x.id===item.id?item:x)},notify(){},clock:()=>now});
 return {tracker,rows:()=>rows, now:()=>now, step(ms){now+=ms;tracker.tick()}};
}
test('La présence vidéo distingue services, jeux, menus et homonymes',()=>{
 const game={type:0,name:'Satisfactory'}, watch={type:3,name:'Netflix',details:'Better Call Saul',state:'Saison 4 · Épisode 10'};
 assert(!isVideoActivity(game));assert(isVideoActivity({...watch,type:0}));assert(!readWatching([game,{...watch,state:'En pause'}],initial));
 const v=readWatching([game,watch],initial);assert.deepEqual([v.id,v.season,v.episode],['s',4,10]);
 assert.equal(readWatching([{type:4,state:'Regarde Arrival'}],initial).id,'f');
 assert.equal(readWatching([{...watch,details:'Arrival',state:''}],[...initial,{id:'other',title:'Arrival',type:'film'}]).ambiguous,true);
 assert.equal(readWatching([{type:3,name:'Netflix'}],initial),null);
});
test('Journal du film après 90 % observés, sans doublon',()=>{
 const f=fixture(),a={type:0,name:'Stremio',details:'Arrival',timestamps:{start:new Date(f.now()),end:new Date(f.now()+100000)}};
 f.tracker.update([a]);assert.equal(f.rows()[0].status,'watching');
 for(let i=0;i<8;i++)f.step(10000);
 assert.equal(f.rows()[0].watchedAt,undefined);f.step(10000);f.tracker.update([a]);f.step(10000);
 const item=f.rows()[0];assert.equal(item.status,'watched');assert.equal(item.watchedDates.length,1);assert.equal(item.rating,4);
});
test('Durée absente, arrêt anticipé et veille préservent la progression',()=>{
 const f=fixture(),a={type:3,name:'Plex',details:'Better Call Saul - S04E10'};
 f.tracker.update([a]);f.step(3600000);assert.equal(f.rows()[1].episode,9);
 f.tracker.update([]);assert.equal(f.tracker.snapshot(),null);
 f.tracker.update([{...a,timestamps:{start:f.now(),end:f.now()+120000}}]);f.step(110000);assert.equal(f.rows()[1].episode,9);
 const k=f.tracker.snapshot().key;assert(f.tracker.confirm(k));assert(f.tracker.confirm(k));
 assert.equal(f.rows()[1].episode,10);assert.equal(f.rows()[1].episodeHistory.length,1);
 f.tracker.update([{...a,details:'Better Call Saul S1 E1'}]);assert(!f.tracker.confirm(k));assert(f.tracker.confirm(f.tracker.snapshot().key));assert.equal(f.rows()[1].episode,10);
});
