const LIMIT=5;

function sample(items, count) {
  const pool=[...items];
  for(let i=0;i<count;i++){
    const j=i+Math.floor(Math.random()*(pool.length-i));
    [pool[i],pool[j]]=[pool[j],pool[i]];
  }
  return pool.slice(0,count);
}

export function createFilmHome(root,{card,selectTab,add}) {
  let picks=[],list=[],signature='';
  const resume=root.querySelector('[data-resume]'),recs=root.querySelector('[data-picks]');
  const shuffle=root.querySelector('[data-shuffle]'),feedback=root.querySelector('[data-feedback]');
  const empty=(where,message)=>{
    const p=document.createElement('p');p.className='fh-empty';p.textContent=message;where.replaceChildren(p);
  };
  root.querySelector('[data-all-watching]').onclick=()=>selectTab('watching');
  root.querySelector('[data-add]').onclick=add;

  function draw(force=false){
    const watchlist=list.filter(item=>item.status==='watchlist'),byId=new Map(watchlist.map(item=>[item.id,item]));
    const count=Math.min(LIMIT,watchlist.length),previous=picks.filter(id=>byId.has(id));
    const others=watchlist.filter(item=>!previous.includes(item.id));
    if(force){
      const fresh=sample(others,Math.min(others.length,count));
      const rest=sample(previous.map(id=>byId.get(id)),count-fresh.length);
      picks=[...fresh,...rest].map(item=>item.id);
      if(picks.length>1 && picks.every((id,i)=>id===previous[i]))picks.push(picks.shift());
    }else{
      picks=[...previous,...sample(others,count-previous.length).map(item=>item.id)];
    }
    if(picks.length)recs.replaceChildren(...picks.map(id=>card(byId.get(id))));
    else empty(recs,'Ajoute des titres à ta watchlist pour les retrouver ici.');
    shuffle.hidden=count<2;
    root.querySelector('[data-add]').hidden=!!count;
    if(force)feedback.textContent='Nouvelle sélection : '+picks.map(id=>byId.get(id).title).join(', ')+'.';
  }
  shuffle.onclick=()=>draw(true);

  return function update(items) {
    list=items;
    const next=JSON.stringify(items.filter(x=>x.status==='watching'||x.status==='watchlist').map(x=>[x.id,x.status,x.title,x.type,x.poster,x.year,x.rating,x.season,x.episode,x.addedAt,x.progressUpdatedAt]));
    if(next===signature)return;
    signature=next;
    const focusedId=root.contains(document.activeElement)?document.activeElement.dataset.filmId:null;
    const current=items.filter(x=>x.status==='watching').sort((a,b)=>(b.progressUpdatedAt||b.addedAt||0)-(a.progressUpdatedAt||a.addedAt||0));
    if(current.length){
      resume.replaceChildren(...current.slice(0,4).map(item=>{
        const tile=card(item),meta=tile.querySelector('.film-card-year');
        const progress=item.type==='film'?'Film en cours':item.season?(item.episode?'Dernier épisode vu · S'+item.season+' E'+item.episode:'Saison '+item.season+' vue'):'Série en cours';
        meta.textContent=progress;tile.setAttribute('aria-label',item.title+' · '+progress);return tile;
      }));
    }else empty(resume,'Les films et séries que tu passes en cours apparaissent ici.');
    root.querySelector('[data-all-watching]').hidden=current.length<=4;
    feedback.textContent='';draw();
    if(focusedId)root.querySelector('[data-film-id="'+CSS.escape(focusedId)+'"]')?.focus({preventScroll:true});
  };
}
