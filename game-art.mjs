import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { imageSize, normalizeSteamName } from './steam-local.mjs';

const sizes = new Map();
function dimensions(b) {
  const size = imageSize(b);
  if (size || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP' || b.length < 30) return size;
  switch (b.toString('ascii', 12, 16)) {
    case 'VP8X': return [1+b.readUIntLE(24,3), 1+b.readUIntLE(27,3)];
    case 'VP8 ': return [b.readUInt16LE(26)&16383, b.readUInt16LE(28)&16383];
    case 'VP8L': { const n=b.readUInt32LE(21); return [(n&16383)+1, ((n>>>14)&16383)+1]; }
    default: return null;
  }
}
function format(size) {
  if (!size) return '';
  return size[0] > size[1] ? 'wide' : size[1] > size[0] ? 'tall' : '';
}
function artworkName(name, kind) {
  const id = crypto.createHash('sha1').update(normalizeSteamName(name)).digest('hex');
  return 'orbit-'+kind+'-'+id;
}
function localArt(dir, file, kind, requirePortrait = false) {
  if (!file?.f) return null;
  const target=path.join(dir,path.basename(file.f));
  try {
    const st=fs.statSync(target);
    let cached=sizes.get(target);
    if (!cached || cached.stamp!==st.mtimeMs || cached.bytes!==st.size) {
      const fd=fs.openSync(target,'r');
      try {
        const head=Buffer.alloc(Math.min(st.size,262144));
        fs.readSync(fd,head,0,head.length,0);
        const size=dimensions(head);
        cached={kind:format(size),portrait:size && size[1]>=size[0]*1.15,stamp:st.mtimeMs,bytes:st.size};
        sizes.set(target,cached);
      } finally { fs.closeSync(fd); }
    }
    return cached.kind===kind && (!requirePortrait || cached.portrait) ? {f:file.f,v:Math.round(st.mtimeMs)} : null;
  } catch { return null; }
}
export function selectArtwork(dir, name, named, meta = {}, files, {allowNearSquare=true}={}) {
  const sidecar = kind => {
    const stem=artworkName(name,kind);
    return files ? [files[normalizeSteamName(stem)]] : ['jpg','png','webp'].map(ext=>({f:stem+'.'+ext}));
  };
  const pick = (kind, files, requirePortrait=false) => {
    for (const file of files) { const match=localArt(dir,file,kind,requirePortrait); if(match)return match; }
    return null;
  };
  return {
    wide:pick('wide',[named,...(meta.autoBannerOff?[]:sidecar('wide'))]),
    tall:pick('tall',[meta.playPortrait,meta.coverManual && named]) ||
      pick('tall',[named,meta.steamPortrait,...sidecar('tall')],true) ||
      (allowNearSquare ? pick('tall',[named,meta.steamPortrait,...sidecar('tall')]) : null)
  };
}
const clean = name => name.replace(/\s*\((?:PS[345]|PSVR2?|PC)\)\s*$/i,'').trim();
const slug = name => normalizeSteamName(clean(name).replace(/['’]/g,'')).replaceAll(' ','-');
async function download(url, kind) {
  const r=await fetch(url,{signal:AbortSignal.timeout(7000)});
  if(!r.ok){await r.body?.cancel();return null;}
  const chunks=[];let length=0;
  for await(const chunk of r.body){length+=chunk.length;if(length>8*1024*1024)return null;chunks.push(chunk);}
  const bytes=Buffer.concat(chunks),size=dimensions(bytes);
  if(format(size)!==kind || Math.min(...size)<150 || (kind==='tall' && size[1]<size[0]*1.15))return null;
  return {bytes,ext:bytes[0]===255?'jpg':bytes.toString('ascii',0,4)==='RIFF'?'webp':'png'};
}
async function sonyImages(name) {
  const key=slug(name);
  if(!key)return {};
  const r=await fetch('https://www.playstation.com/en-us/games/'+key+'/',{signal:AbortSignal.timeout(8000)});
  if(!r.ok || new URL(r.url).pathname.split('/').filter(Boolean).pop()!==key){await r.body?.cancel();return {};}
  let html=await r.text();
  const concept=html.match(/<meta\s+name="conceptId"\s+content="(\d+)"/i)?.[1];
  if(concept && !html.includes('"role":"PORTRAIT_BANNER"')) {
    const store=await fetch('https://store.playstation.com/en-us/concept/'+concept,{signal:AbortSignal.timeout(8000)});
    if(store.ok)html=await store.text();
  }
  const result={};
  for(const match of html.matchAll(/"role":"(GAMEHUB_COVER_ART|EDITION_KEY_ART|BACKGROUND|PORTRAIT_BANNER)","type":"IMAGE","url":"(https:\/\/image\.api\.playstation\.com\/[^"\s]+)"/g)){
    const [,role,url]=match;
    result[role]??=url.split('?')[0]+'?w=960';
  }
  return {wide:[result.GAMEHUB_COVER_ART,result.BACKGROUND,result.EDITION_KEY_ART],tall:result.PORTRAIT_BANNER};
}
function catalogTitle(name) {
  return clean(name).replace(/[®™©]/g,'').replace(/^zelda\s*:\s*/i,'The Legend of Zelda: ').trim();
}
async function catalogCover(title) {
  const url=new URL('https://lutris.net/api/games');
  url.searchParams.set('search',title);
  const response=await fetch(url,{signal:AbortSignal.timeout(7000)});
  if(!response.ok)return [];
  const matches=((await response.json()).results || []).filter(game=>slug(game.name)===slug(title));
  if(matches.length!==1 || !matches[0].coverart)return [];
  const cover=new URL(matches[0].coverart);
  if(cover.origin!=='https://lutris.net' || !cover.pathname.startsWith('/media/'))return [];
  const id=cover.pathname.match(/^\/media\/igdb\/cover_big\/(co[a-z0-9]+)\.jpg$/i)?.[1];
  return id ? ['https://images.igdb.com/igdb/image/upload/t_cover_big_2x/'+id+'.jpg',cover.href] : [cover.href];
}
async function wikiCover(title) {
  const path=encodeURIComponent(title.replaceAll(' ','_'));
  const response=await fetch('https://en.wikipedia.org/api/rest_v1/page/summary/'+path,{
    headers:{'User-Agent':'Orbit-Game-Library/1.0 (personal game library)'},signal:AbortSignal.timeout(6500)
  });
  if(!response.ok)return null;
  const page=await response.json(), image=page.originalimage;
  if(slug((page.title||'').replace(/ \((?:\d{4} )?video game\)$/i,''))!==slug(title) ||
     page.type==='disambiguation' || !/\bvideo game\b/i.test(page.description||'') || !image?.source)return null;
  const url=new URL(image.source);
  if(url.origin!=='https://upload.wikimedia.org' || /(?:logo|icon|screenshot|gameplay)/i.test(url.pathname))return null;
  return {kind:format([image.width,image.height]),url:url.href};
}
async function xboxImages(name) {
  const catalog='https://displaycatalog.mp.microsoft.com/v7.0/';
  const params=new URLSearchParams({market:'US',languages:'en-us',query:clean(name),topProducts:'12',productFamilyNames:'Games'});
  const options=()=>({signal:AbortSignal.timeout(7000)});
  const r=await fetch(catalog+'productfamilies/autosuggest?'+params,options());
  if(!r.ok)return {};
  const matches=(await r.json()).Results?.find(x=>x.ProductFamilyName==='Games')?.Products || [];
  const match=matches.find(x=>slug(x.Title)===slug(name));
  if(!match || !/^[A-Z0-9]{12}$/i.test(match.ProductId))return {};
  const details=await fetch(catalog+'products?market=US&languages=en-us&bigIds='+match.ProductId,options());
  if(!details.ok)return {};
  const images=(await details.json()).Products?.[0]?.LocalizedProperties?.[0]?.Images || [];
  function pick(roles,kind) {
    for(const role of roles) {
      const asset=images.find(x=>x.ImagePurpose===role && format([x.Width,x.Height])===kind);
      if(!asset)continue;
      const url=new URL(asset.Uri,'https://store-images.s-microsoft.com');
      if(url.protocol!=='https:' || url.hostname!=='store-images.s-microsoft.com')continue;
      url.searchParams.set('w','960');
      return url.href;
    }
  }
  return {wide:pick(['TitledHeroArt','SuperHeroArt','FeaturePromotionalArt'],'wide'),tall:pick(['Poster','BoxArt'],'tall')};
}
export async function fillArtwork(dir,name,wanted,knownId) {
  const pending=new Set(wanted),added=[];
  async function take(kind,url) {
    if(!pending.has(kind)||!url)return;
    try {
      const result=await download(url,kind);if(!result)return;
      const file=path.join(dir,artworkName(name,kind)+'.'+result.ext);
      const temp=file+'.'+crypto.randomUUID()+'.tmp';
      try { fs.writeFileSync(temp,result.bytes);fs.renameSync(temp,file); }
      finally {try{fs.unlinkSync(temp);}catch{}}
      pending.delete(kind);added.push(kind);
    }catch{}
  }
  async function tryCandidates(kind,urls) {
    for(const url of urls){
      if(!pending.has(kind))break;
      await take(kind,url);
    }
  }
  let id=knownId;
  if(!id && pending.size){
    try {
      const term=clean(name),r=await fetch('https://store.steampowered.com/api/storesearch/?'+new URLSearchParams({term,l:'english',cc:'us'}),{signal:AbortSignal.timeout(7000)});
      if(r.ok)id=(await r.json()).items?.find(x=>slug(x.name)===slug(term))?.id;
    }catch{}
  }
  if(/^\d{1,10}$/.test(String(id))){
    const base='https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/'+id+'/';
    await Promise.all([take('wide',base+'header.jpg'),take('tall',base+'library_600x900.jpg')]);
    if (pending.size) {
      try {
        const r=await fetch('https://store.steampowered.com/api/appdetails?appids='+id,{signal:AbortSignal.timeout(7000)});
        const details=r.ok?(await r.json())[id]?.data:null;
        if(details?.header_image) {
          const header=new URL(details.header_image);
          if(header.protocol==='https:' && /(?:^|\.)(?:steamstatic\.com|steamcontent\.com)$/.test(header.hostname)){
            await take('wide',header.href);
            await take('tall',new URL('library_600x900.jpg',header).href);
          }
        }
      }catch{}
    }
  }
  if(pending.size){
    try {
      const sony=await sonyImages(name);
      await Promise.all([tryCandidates('wide',sony.wide||[]),take('tall',sony.tall)]);
    }catch{}
  }
  if(pending.size){
    try {
      const xbox=await xboxImages(name);
      await Promise.all([...pending].map(kind=>take(kind,xbox[kind])));
    }catch{}
  }
  const title=catalogTitle(name);
  if(pending.has('tall')){
    try{await tryCandidates('tall',await catalogCover(title));}catch{}
  }
  if(pending.size){
    try{
      const fallback=await wikiCover(title);
      if(fallback)await take(fallback.kind,fallback.url);
    }catch{}
  }
  return added;
}
