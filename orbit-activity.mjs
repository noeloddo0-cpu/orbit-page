import fs from "node:fs";
import path from "node:path";

export function classifySteam(categories) {
  if (!Array.isArray(categories)) return null;
  const ids=new Set(categories.map(row=>row.id));
  return {coop:ids.has(9)||ids.has(38)||ids.has(39), online:ids.has(38), local:ids.has(39),
    shared:ids.has(24)||ids.has(39)||ids.has(37)};
}

export function createCoopIndex(directory,write) {
  const file=path.join(directory,"coop-cache.json");
  let cache={};
  try { cache=JSON.parse(fs.readFileSync(file,"utf8")); } catch {}
  let running=false, retryAfter=0, problem="";
  const snapshot=()=>({entries:cache,running,problem});
  async function scan(ids) {
    running=true; problem="";
    try {
      for(const id of new Set(ids.filter(id=>/^\d{1,10}$/.test(String(id))))) {
        if(cache[id]?.at>Date.now()-30*86400000) continue;
        const response=await fetch("https://store.steampowered.com/api/appdetails?appids="+id+"&filters=categories&l=english",
          {signal:AbortSignal.timeout(9000)});
        if(!response.ok) throw Error(response.status===429?"Steam demande une pause.":"Steam est indisponible.");
        const row=(await response.json())[id];
        if(row?.success && Array.isArray(row.data?.categories)) {
          cache[id]={...classifySteam(row.data.categories),at:Date.now()}; write(file,cache);
        }
        await new Promise(resolve=>setTimeout(resolve,650));
      }
    } catch(error){problem=error.message;retryAfter=Date.now()+60000;}
    finally {running=false;}
  }
  return {snapshot, start(ids){if(!running && Date.now()>=retryAfter) void scan(ids);return snapshot();}};
}
