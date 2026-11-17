import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export function normalizeSteamName(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[®™©]/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
export function imageSize(bytes) {
  if(bytes.length>24 && bytes.subarray(1,4).toString()==='PNG')return [bytes.readUInt32BE(16),bytes.readUInt32BE(20)];
  if(bytes[0]!==255||bytes[1]!==216)return null;
  let i=2;while(i+8<bytes.length){if(bytes[i++]!==255)continue;let marker=bytes[i++];while(marker===255)marker=bytes[i++];if(marker===217||marker===218)break;if(marker===0||marker===1||(marker>=208&&marker<=215))continue;const size=bytes.readUInt16BE(i);if(size<2||i+size>bytes.length)break;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker))return [bytes.readUInt16BE(i+5),bytes.readUInt16BE(i+3)];i+=size;}return null;
}
function read(file){try{return fs.readFileSync(file,'utf8')}catch{return ''}}
function entries(dir){try{return fs.readdirSync(dir,{withFileTypes:true})}catch{return []}}
function value(text,key){return text.match(new RegExp('"'+key+'"\\s+"([^"\\r\\n]*)"','i'))?.[1]||''}
export function steamRoots() {
  const candidates=[path.join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Steam'),path.join(process.env.ProgramFiles||'C:/Program Files','Steam')];
  if(process.platform==='win32')try{const text=execFileSync('reg.exe',['query','HKCU\\Software\\Valve\\Steam','/v','SteamPath'],{encoding:'utf8',windowsHide:true,timeout:3000,stdio:['ignore','pipe','ignore']});const match=text.match(/SteamPath\s+REG_SZ\s+(.+)/i);if(match)candidates.unshift(match[1].trim())}catch{}
  return [...new Set(candidates.map(p=>path.resolve(p)))].filter(p=>fs.existsSync(path.join(p,'steamapps')));
}
export function installedSteamGames(roots=steamRoots()) {
  const libraries=new Set(roots);for(const root of roots){const text=read(path.join(root,'steamapps','libraryfolders.vdf'));for(const m of text.matchAll(/"path"\s+"((?:\\.|[^"\\])*)"/g))libraries.add(m[1].replace(/\\\\/g,'\\'));}
  const games=new Map();for(const dir of libraries)for(const entry of entries(path.join(dir,'steamapps'))){if(!/^appmanifest_\d+\.acf$/i.test(entry.name))continue;const text=read(path.join(dir,'steamapps',entry.name)),id=Number(value(text,'appid')),name=value(text,'name'),install=value(text,'installdir');if(!id||!name||!install||!fs.existsSync(path.join(dir,'steamapps','common',install)))continue;if(id===228980||/^Steamworks|^Steam Linux Runtime|^Proton\b/i.test(name))continue;games.set(id,{appId:id,name});}return [...games.values()];
}
export function localPortrait(appId,roots=steamRoots()) {
  if(!/^\d+$/.test(String(appId)))return null;
  for(const root of roots){const cache=path.join(root,'appcache','librarycache'),candidates=[];const visit=(dir,depth)=>{for(const e of entries(dir)){const f=path.join(dir,e.name);if(e.isDirectory()&&depth<3)visit(f,depth+1);else if(e.isFile()&&/library_(600x900|capsule).*\.(jpe?g|png)$/i.test(e.name))candidates.push(f);}};visit(path.join(cache,String(appId)),0);for(const e of entries(cache))if(e.isFile()&&e.name.startsWith(appId+'_')&&/library_(600x900|capsule).*\.(jpe?g|png)$/i.test(e.name))candidates.push(path.join(cache,e.name));candidates.sort((a,b)=>Number(/2x/.test(b))-Number(/2x/.test(a)));for(const file of candidates){try{const stat=fs.statSync(file);if(stat.size>8*1024*1024)continue;const bytes=fs.readFileSync(file),size=imageSize(bytes);if(size&&size[1]>size[0]&&size[0]>=150)return {bytes,extension:path.extname(file).toLowerCase()==='.png'?'.png':'.jpg',width:size[0],height:size[1]};}catch{}}}return null;
}
