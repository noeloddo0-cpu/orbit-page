export function mountCoopFilter({panel, render}) {
  const label=document.createElement("label");
  label.htmlFor="op-coop";label.textContent="Jouer à deux";
  const select=document.createElement("select");select.id="op-coop";
  for(const [key,text] of [["","Tous les jeux"],["coop","Toutes les coops"],["local","Coop locale"],["online","Coop en ligne"],["shared","Écran partagé ou commun"]])select.add(new Option(text,key));
  const note=document.createElement("p");note.id="op-coop-note";note.setAttribute("role","status");
  panel.append(label,select,note);
  let entries={},timer=0,seq=0;
  async function refresh(start) {
    const turn=++seq;clearTimeout(timer);
    if(!select.value){note.textContent="";render();return;}
    try {
      const r=await fetch("/api/steam/coop",{method:start?"POST":"GET",cache:"no-store"});
      if(!r.ok)throw Error();const data=await r.json();if(turn!==seq)return;
      entries=data.entries;
      note.textContent=data.problem?"Steam est temporairement indisponible. Les modes déjà vérifiés restent affichés.":
        data.running?"Vérification des fiches Steam…":"Résultats limités aux modes confirmés par Steam.";
      if(data.running) timer=setTimeout(()=>refresh(false),2000);
    }catch{if(turn!==seq)return;note.textContent="Connexion à Orbit indisponible.";}
    render();
  }
  select.onchange=()=>refresh(true);
  return {matches(details){if(!select.value)return true;return !!entries[details.installedId||details.steamAppId]?.[select.value];},
    reset(){select.value="";seq++;clearTimeout(timer);note.textContent="";}};
}
