const CACHE="orbit-shell-v17";
const CORE=["/","/manifest.webmanifest","/app-config.json","/icon.svg","/launcher.css","/launcher.js","/themes/orbit-play/assets/SourceSans3-400-latin.woff2","/themes/orbit-play/assets/SourceSans3-400-latin-ext.woff2","/themes/orbit-play/assets/SourceSans3-600-latin.woff2","/themes/orbit-play/assets/SourceSans3-600-latin-ext.woff2","/themes/sillage/assets/BarlowSemiCondensed-400-latin.woff2","/themes/sillage/assets/BarlowSemiCondensed-400-latin-ext.woff2","/themes/sillage/assets/BarlowSemiCondensed-600-latin.woff2","/themes/sillage/assets/BarlowSemiCondensed-600-latin-ext.woff2"];
self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener("activate",event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith("orbit-shell-")&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=="GET"||url.origin!==self.location.origin||url.pathname.startsWith("/api/"))return;
 if(request.mode==="navigate"){
  event.respondWith(fetch(request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put("/",copy));}return response;}).catch(()=>caches.match("/").then(response=>response||Response.error())));return;
 }
 if(url.pathname==="/app-config.json"||url.pathname==="/manifest.webmanifest"){
  event.respondWith(fetch(request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy));}return response;}).catch(()=>caches.match(request).then(response=>response||Response.error())));return;
 }
 if(url.pathname.startsWith("/covers/")){
  event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy));}return response;})));return;
 }
 if(CORE.includes(url.pathname)||url.pathname==="/sw.js")event.respondWith(caches.match(request).then(cached=>cached||fetch(request)));
});
