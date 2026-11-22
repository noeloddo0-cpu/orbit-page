import {exactSeriesMatch} from './series-guide.js';

const dateLabel = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ?
  new Date(value+'T12:00:00').toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'}) : '';
const durationLabel = minutes => minutes >= 60 ? Math.floor(minutes/60)+' h'+(minutes%60?' '+String(minutes%60).padStart(2,'0'):'') : minutes+' min';
const states={watchlist:'À voir',watching:'En cours',watched:'Vu'};

export function createFilmDetail({lookup,search,edit}) {
  const dialog=document.createElement('dialog');
  dialog.id='cinema-detail';dialog.setAttribute('aria-labelledby','cinema-detail-title');
  dialog.innerHTML=`<article class="cd-layout">
    <div class="cd-poster"><span aria-hidden="true"></span></div>
    <div class="cd-copy">
      <header><p class="cd-kind"></p><h2 id="cinema-detail-title"></h2><p class="cd-original"></p><p class="cd-facts"></p></header>
      <section class="cd-synopsis"><h3>Synopsis</h3><p></p></section>
      <p class="cd-loading" role="status"></p>
      <section class="cd-personal"><h3>Mon suivi</h3><dl></dl></section>
      <button class="btn cd-edit" type="button">Modifier la fiche</button>
    </div>
    <button class="cd-close" type="button" aria-label="Fermer la fiche" autofocus>×</button>
  </article>`;
  document.body.append(dialog);
  const el=s=>dialog.querySelector(s), cache=new Map();
  let current=null,opener=null,diaryDate='',meta=null,art='',serial=0,lookupKey='';
  function line(sel,value){const node=el(sel);node.textContent=value||'';node.hidden=!value;}
  function poster(item,src){
    if(art===src)return;
    art=src;const box=el('.cd-poster');box.querySelector('img')?.remove();
    if(!src)return;
    const img=new Image();img.alt='Affiche de '+item.title;img.decoding='async';img.referrerPolicy='no-referrer';
    const large=src.replace(/^(https:\/\/image\.tmdb\.org\/t\/p\/)w(?:92|154|185|342|500)\//,'$1w780/');
    img.onerror=()=>{if(img.getAttribute('src')!==src){img.src=src;return;}img.remove();};
    img.src=large;box.append(img);
  }
  function render(item){
    const series=item.type==='series',date=item.releaseDate||meta?.releaseDate,year=item.year||date?.slice(0,4);
    const genres=item.genres?.length?item.genres:meta?.genres||[],runtime=item.runtime||meta?.runtime;
    const guide=meta?.episodeGuide?.seasons,seasonCount=guide&&Object.keys(guide).length;
    line('.cd-kind',[series?'Série':'Film',year].filter(Boolean).join(' · '));
    el('h2').textContent=item.title;
    const original=item.originalTitle||meta?.originalTitle;
    line('.cd-original',original&&original.toLocaleLowerCase()!==item.title.toLocaleLowerCase()?original:'');
    line('.cd-facts',[...genres,series?(seasonCount?seasonCount+(seasonCount>1?' saisons':' saison'):''):(runtime?durationLabel(runtime):'')].filter(Boolean).join(' · '));
    const summary=item.overview||meta?.overview;el('.cd-synopsis').hidden=!summary;el('.cd-synopsis p').textContent=summary||'';
    el('.cd-poster span').textContent=item.title.split(/\s+/).slice(0,2).map(s=>s[0]).join('').toLocaleUpperCase();
    poster(item,item.poster||(meta?.posterPath?'https://image.tmdb.org/t/p/w780'+meta.posterPath:''));
    const rows=[['Statut',states[item.status]],['Ma note',item.rating>0?Number(item.rating).toLocaleString('fr-FR')+' / 5':'']];
    if(series&&item.status==='watching'&&item.season) rows.push(['Progression',item.episode?'Saison '+item.season+' · Épisode '+item.episode:'Saison '+item.season+' vue']);
    const watched=diaryDate||item.watchedAt||item.watchedDates?.at(-1);
    rows.push(['Visionnage',dateLabel(watched)]);
    const list=el('dl');list.replaceChildren();
    for(const [label,value] of rows){if(!value)continue;const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;list.append(dt,dd);}
    if(dateLabel(date)){const info=el('.cd-facts');info.hidden=false;info.textContent+=(info.textContent?' · ':'')+'Sortie le '+dateLabel(date);}
  }
  async function enrich(item,key,generation){
    try{
      let id=item.tmdbId;
      if(!id)id=exactSeriesMatch(item,await search(item));
      if(!id)return;
      const r=await fetch('/api/cinema/details',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:item.type,id})});
      if(!r.ok)return;
      const data=await r.json();cache.set(key,data);
      if(serial===generation&&dialog.open){meta=data;render(lookup(current)||item);}
    }catch{}finally{if(serial===generation)line('.cd-loading','');}
  }
  function refresh(){
    if(!dialog.open)return;
    const item=lookup(current);if(!item){dialog.close();return;}
    const key=JSON.stringify([item.type,item.tmdbId,item.title,item.year]);
    if(key===lookupKey){render(item);return;}
    lookupKey=key;const generation=++serial;meta=cache.get(key)||null;line('.cd-loading','');render(item);
    if(!meta && (!item.overview||!item.poster||!item.genres?.length||item.type==='series'||!item.runtime)){
      line('.cd-loading','Recherche des informations…');enrich(item,key,generation);
    }
  }
  function open(item,trigger=document.activeElement,date=''){
    if(!item)return;
    current=item.id;opener=trigger;diaryDate=date;lookupKey='';meta=null;
    if(!dialog.open)dialog.showModal();
    refresh();dialog.scrollTop=0;el('.cd-close').focus({preventScroll:true});
  }
  el('.cd-close').onclick=()=>dialog.close();
  el('.cd-edit').onclick=()=>{const item=lookup(current);if(item)edit(item);};
  dialog.addEventListener('keydown',e=>{if(e.key==='Escape')e.stopPropagation();});
  dialog.onclick=e=>{if(e.target===dialog)dialog.close();};
  dialog.addEventListener('close',()=>{if(dialog.open)return;serial++;const id=current;current=null;
    const target=opener?.isConnected?opener:[...document.querySelectorAll('.film-card')].find(x=>x.dataset.filmId===String(id));
    target?.focus({preventScroll:true});
  });
  return {open,refresh,dialog};
}
