import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Transform, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const repo = 'noeloddo0-cpu/orbit-page';
const versionPattern = /^v?(\d+\.\d+\.\d+)$/;
export function newer(candidate, current) {
  const a = versionPattern.exec(candidate), b = versionPattern.exec(current);
  if (!a || !b) return false;
  const av = a[1].split('.').map(Number), bv = b[1].split('.').map(Number);
  for (let i=0; i<3; i++) if (av[i] !== bv[i]) return av[i] > bv[i];
  return false;
}
export async function checkRelease(current) {
  const response = await fetch('https://api.github.com/repos/'+repo+'/releases/latest', {
    headers:{Accept:'application/vnd.github+json','User-Agent':'Orbit-Desktop'}, signal:AbortSignal.timeout(12000)
  });
  if (response.status===404) return {message:'Aucune version publique disponible.'};
  if (!response.ok) throw Error('GitHub est momentanément indisponible.');
  const release=await response.json(), version=versionPattern.exec(release.tag_name)?.[1];
  if (!version || release.draft || release.prerelease) return {message:'Aucune version stable compatible.'};
  if (!newer(version,current)) return {message:'Orbit '+current+' est à jour.'};
  const name='Orbit-Setup-'+version+'.exe';
  const url='https://github.com/'+repo+'/releases/download/'+release.tag_name+'/'+name;
  const asset=release.assets.find(a=>a.name===name && a.browser_download_url===url);
  if (!asset || !/^sha256:[a-f0-9]{64}$/.test(asset.digest) || !Number.isSafeInteger(asset.size) || asset.size<1 || asset.size>512*1024*1024) throw Error('La version publiée ne contient pas d’installateur vérifiable.');
  return {version,name,url,size:asset.size,digest:asset.digest,message:'Orbit '+version+' est disponible.'};
}
export async function downloadRelease(release) {
  const directory=await mkdtemp(path.join(tmpdir(),'orbit-update-')), target=path.join(directory,release.name);
  try {
    const response=await fetch(release.url,{signal:AbortSignal.timeout(240000)});
    if (!response.ok || !response.body) throw Error();
    const digest=createHash('sha256'); let size=0;
    const verify=new Transform({transform(chunk,_encoding,done){
      size+=chunk.length;
      if(size>release.size) return done(Error('Taille incorrecte'));
      digest.update(chunk);done(null,chunk);
    }});
    await pipeline(Readable.fromWeb(response.body), verify, createWriteStream(target,{flags:'wx'}));
    if(size!==release.size || 'sha256:'+digest.digest('hex')!==release.digest) throw Error();
    return target;
  } catch {
    await rm(directory,{recursive:true,force:true}).catch(()=>{});
    throw Error('Téléchargement incomplet ou fichier non conforme.');
  }
}
