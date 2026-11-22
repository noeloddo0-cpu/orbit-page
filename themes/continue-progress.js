export function episodeLabel(season, episode) {
  return "S" + season + " E" + episode;
}

export function episodeProgress(item, guide) {
  const season = Number(item.season) || 0, episode = Number(item.episode) || 0;
  const last = episode ? "Dernier épisode vu · " + episodeLabel(season || 1, episode)
    : season ? "Saison " + season + " vue" : "Aucun épisode enregistré";
  let s = season || 1, e = episode + 1;
  if (season && !episode) { s++; e = 1; }
  if (guide && episode && guide.seasons[s] && e > guide.seasons[s]) { s++; e = 1; }
  const aired = guide?.aired;
  if (aired && (s > aired.s || (s === aired.s && e > aired.e))) {
    return { last, next: null, label: guide.ended ? "Dernier épisode atteint" : "À jour" };
  }
  if (s > 1000 || e > 10000) return { last, next:null, label:"Vérifier la progression dans la fiche" };
  const final = !!(guide?.ended && aired && s === aired.s && e === aired.e);
  return { last, next: { season:s, episode:e, final }, label:"À regarder ensuite · " + episodeLabel(s,e) };
}

export function recentSessions({ games, sessions, active, key, isGame }) {
  const last = new Map();
  for (const session of sessions || []) {
    const at = Number(session.end || session.start);
    if (!at || !session.game) continue;
    const id = key(session.game);
    if (at > (last.get(id) || 0)) last.set(id, at);
  }
  if (active) {
    const live = games.find(game => game.id === active.id);
    if (live) last.set(key(live.n), Number(active.start));
  }
  return games.filter(game => last.has(key(game.n)) && isGame(game.n))
    .sort((a,b) => last.get(key(b.n)) - last.get(key(a.n))).slice(0,2);
}
