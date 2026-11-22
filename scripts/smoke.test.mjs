import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import test from 'node:test';
import { episodeProgress, recentSessions } from '../themes/continue-progress.js';
import { exactSeriesMatch } from '../themes/series-guide.js';
import { classifySteam } from '../orbit-activity.mjs';
import { journalEntries } from '../themes/activity.js';
import { fillArtwork, selectArtwork } from '../game-art.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

test('Jaquettes console : édition exacte, portrait distinct et priorité manuelle', async t => {
  const dir=await mkdtemp(path.join(tmpdir(),'orbit-console-covers-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const name='Zelda: Ocarina of Time', full='The Legend of Zelda: Ocarina of Time';
  const file={f:'zelda.png'};
  function png(w,h){
    const bytes=Buffer.alloc(30);bytes.write('PNG',1);bytes.writeUInt32BE(w,16);bytes.writeUInt32BE(h,20);return bytes;
  }
  await writeFile(path.join(dir,file.f),png(330,340));
  let games=[{name:full+' 3D',coverart:'https://lutris.net/media/remake.jpg'}];
  const hits=[];
  t.mock.method(globalThis,'fetch',async url=>{
    const u=new URL(url);hits.push(u.href);
    if(u.pathname==='/api/games'){
      assert.equal(u.searchParams.get('search'),full);
      return Response.json({results:games});
    }
    if(u.hostname==='images.igdb.com')return new Response(png(420,210));
    if(u.pathname==='/media/igdb/cover_big/co123.jpg')return new Response(png(264,352));
    return new Response(null,{status:404});
  });
  assert.deepEqual(await fillArtwork(dir,name,['tall']),[]);
  const original={name:full,coverart:'https://lutris.net/media/igdb/cover_big/co123.jpg'};
  games=[original,{...original}];
  assert.deepEqual(await fillArtwork(dir,name,['tall']),[]);
  games=[games[0]];
  assert.deepEqual(await fillArtwork(dir,name,['tall']),['tall']);
  assert(!hits.includes('https://lutris.net/media/remake.jpg'));
  assert.match(selectArtwork(dir,name,file).tall.f,/^orbit-tall-/);
  assert.equal(selectArtwork(dir,name,file,{coverManual:true}).tall.f,file.f);
  assert.deepEqual(await readFile(path.join(dir,file.f)),png(330,340));
});

test('Steam distingue le multijoueur compétitif et la coop locale', () => {
  assert.equal(classifySteam([{id:37}]).local,false);
  assert.equal(classifySteam([{id:37}]).shared,true);
  assert.equal(classifySteam([{id:38}]).online,true);
  assert.equal(classifySteam([{id:39}]).coop,true);
  assert.equal(classifySteam(undefined),null);
});

test('Le journal déduplique les dates de film et conserve les épisodes explicitement datés', () => {
  const items=[{type:'film',title:'Film',watchedAt:'2026-01-12',watchedDates:['2026-01-12']},
    {type:'series',title:'Série',season:2,episode:5,episodeHistory:[{s:2,e:5,at:Date.UTC(2026,1,12,12)}]}];
  assert.deepEqual(journalEntries([],items).map(x=>x.meta),['Épisode vu · S2 E5','Film']);
});

test('La recherche automatique refuse les homonymes et respecte le titre original et l’année', () => {
  const matches = [{id:11,title:'Le Détour',originalTitle:'Detour',date:'2015-03-01'},
    {id:22,title:'Le détour',originalTitle:'Detour',date:'2023-04-01'}];
  assert.equal(exactSeriesMatch({title:'Detour',year:2015},matches),11);
  assert.equal(exactSeriesMatch({title:'Le detour'},matches),null);
  assert.equal(exactSeriesMatch({title:'Le détour',year:2009},matches),null);
});

test('Continuer suit les épisodes diffusés et les saisons déjà vues', () => {
  const guide = {seasons:{1:10,2:2}, aired:{s:2,e:2}, ended:true};
  assert.deepEqual(episodeProgress({season:1,episode:10},guide).next,{season:2,episode:1,final:false});
  assert.deepEqual(episodeProgress({season:1,episode:null},null).next,{season:2,episode:1,final:false});
  assert.deepEqual(episodeProgress({season:2,episode:1},guide).next,{season:2,episode:2,final:true});
  assert.equal(episodeProgress({season:2,episode:2},guide).next,null);
  assert.equal(episodeProgress({},null).next.episode,1);
});

test('Continuer ignore les simples ouvertures de fiche et les applications', () => {
  const games = ['Fiche ouverte','Jeu terminé hier','Session en cours','Application'].map((n,id)=>({n,id}));
  const sessions = [{game:games[1].n,start:100,end:200},{game:games[3].n,start:400,end:500}];
  const result = recentSessions({games,sessions,active:{id:2,start:300},key:n=>n,isGame:n=>n!=='Application'});
  assert.deepEqual(result.map(g=>g.id),[2,1]);
});

test('Les scripts intégrés aux pages sont lisibles par JavaScript', async () => {
  for (const name of ['bibliotheque.html', 'setup.html']) {
    const html = await readFile(path.join(root, name), 'utf8');
    for (const [, script] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
      if (script.trim()) new Script(script, { filename: name });
    }
  }
});

test('Premier lancement du pont avec une bibliothèque vide et sans identifiants', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'orbit-test-'));
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address();
  await new Promise(resolve => probe.close(resolve));
  const base = 'http://127.0.0.1:' + port;
  const env = {
    BRIDGE_PORT: String(port),
    GAME_TRACKER_DATA_DIR: directory,
    GAME_TRACKER_ENV_FILE: path.join(directory, 'absent.env'),
    GAME_TRACKER_ASSET_DIR: root
  };
  for (const key of ['SystemRoot', 'PATH', 'TMP', 'TEMP']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  const child = spawn(process.execPath, [path.join(root, 'bridge.js')], {
    cwd: directory, env, stdio: 'ignore', windowsHide: true
  });
  const closed = once(child, 'close');
  t.after(async () => {
    child.kill();
    await closed;
    await rm(directory, { recursive: true, force: true });
  });
  let state;
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw Error('Le pont a quitté au démarrage.');
    try {
      const response = await fetch(base + '/api/state', {signal: AbortSignal.timeout(2000)});
      if (response.ok) { state = await response.json(); break; }
    } catch {}
    await delay(150);
  }
  assert.ok(state, 'Le pont doit répondre');
  assert.deepEqual(state.games, []);
  assert.deepEqual(state.sessions, []);
  assert.deepEqual(state.favorites, []);
  for (const route of ['/', '/launcher.js', '/launcher.css', '/icon.svg', '/sw.js', '/manifest.webmanifest', '/mentions-legales', '/confidentialite']) {
    assert.equal((await fetch(base + route)).status, 200, route);
  }
  const config = await (await fetch(base + '/app-config.json')).json();
  assert.ok(config.sections.some(section => section.id === 'orbit-play' && section.active));
});
