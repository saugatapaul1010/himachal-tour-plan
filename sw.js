// sw.js — Himachal Tour Plan offline cache.
// Two caches: the app shell (this document, so a reload works with zero signal) and map
// tiles + Wikimedia photo thumbnails (runtime-cached opportunistically on top of whatever
// the in-app "Download for offline" control explicitly fetches).
// OSRM (router.project-osrm.org) and Open-Meteo are deliberately NOT cached here — the app
// already caches those in localStorage with its own freshness rules (hpx26_osrm12,
// hpx26_wx1); a SW-level cache on top would risk silently serving stale routing/weather.
const SHELL_CACHE='hpx26-shell-v1';
const TILE_CACHE='hpx26-tiles-v1';
const KNOWN_CACHES=[SHELL_CACHE,TILE_CACHE];

const CACHEABLE_HOSTS=[
  'server.arcgisonline.com',
  'basemaps.cartocdn.com',
  'commons.wikimedia.org',
  'upload.wikimedia.org'
];

// Precache the shell during install. Without this the app shell is only cached from the
// SECOND online visit onward: the first navigation request completes before this worker
// exists to intercept it, so a rider who loaded the page once and then lost signal could
// not reopen it. Both './' and './index.html' are stored because the navigation URL may be
// either, depending on how the page was opened.
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    try{
      const cache=await caches.open(SHELL_CACHE);
      // Added one at a time: cache.addAll rejects the whole batch if any single request
      // fails, which would abort the install over a redundant URL.
      for(const u of ['./','./index.html']){
        try{ await cache.add(u); }catch(e){}
      }
    }catch(e){}
    await self.skipWaiting();
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const names=await caches.keys();
    await Promise.all(names.filter(n=>KNOWN_CACHES.indexOf(n)===-1).map(n=>caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return; // never intercept non-GET

  // 1) The app document itself: network-first (so an online visit always gets the latest
  //    deploy), cache fallback (so a reload with zero signal still opens the last build
  //    that loaded successfully).
  if(req.mode==='navigate'||req.destination==='document'){
    event.respondWith((async()=>{
      try{
        const res=await fetch(req);
        const cache=await caches.open(SHELL_CACHE);
        cache.put(req,res.clone());
        return res;
      }catch(e){
        const cache=await caches.open(SHELL_CACHE);
        const hit=(await cache.match(req))||(await cache.match('./'));
        if(hit)return hit;
        throw e;
      }
    })());
    return;
  }

  // 2) Map tiles + Wikimedia thumbnails: cache-first (they never change once published),
  //    warming the cache on every successful runtime fetch too — not just from the explicit
  //    download control. A cache miss + failed network fetch here rejects the underlying
  //    <img> load, which is what the page's own 'tileerror' handler is listening for (it
  //    swaps in a transparent placeholder instead of a broken-image box).
  const url=new URL(req.url);
  if(CACHEABLE_HOSTS.indexOf(url.hostname)!==-1){
    event.respondWith((async()=>{
      const cache=await caches.open(TILE_CACHE);
      const hit=await cache.match(req);
      if(hit)return hit;
      const res=await fetch(req);
      cache.put(req,res.clone());
      return res;
    })());
    return;
  }

  // Everything else (OSRM, Open-Meteo, any other origin): default browser behaviour.
});
