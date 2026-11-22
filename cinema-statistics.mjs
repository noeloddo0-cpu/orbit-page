function dayKey(date) {
  return [date.getFullYear(), String(date.getMonth()+1).padStart(2,"0"), String(date.getDate()).padStart(2,"0")].join("-");
}

// Only committed edits enter this ledger. Importing an already watched film is an addition.
export function withCinemaStatistics(previous, next, now = new Date()) {
  const today = dayKey(now);
  const history = previous.statistics?.version === 1 ? previous.statistics : {version:1, since:today, days:{}};
  const byId = new Map(previous.items.map(item => [item.id, item]));
  const day = {...history.days[today]};
  let changed = false;
  for (const item of next.items) {
    const old = byId.get(item.id);
    const changes = [];
    if (!old) changes.push("added");
    if (Number(item.rating)>0 && !(Number(old?.rating)>0)) changes.push("rated");
    if (Number(old?.rating)>0 && Number(item.rating)>0 && Number(item.rating)!==Number(old.rating)) changes.push("rerated");
    if (old && old.status!=="watched" && item.status==="watched") changes.push("finished");
    if (!changes.length) continue;
    const group = {...day[item.type]};
    for (const key of changes) group[key] = (group[key] || 0) + 1;
    day[item.type] = group;
    changed = true;
  }
  const statistics = changed ? {...history,days:{...history.days,[today]:day}} : history;
  return {...next,statistics};
}

