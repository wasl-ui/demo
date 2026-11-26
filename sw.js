/**
 * sw.js — installs and serves the app offline. A new version is installed only if its file list is
 * signed with the release key below and every file matches; otherwise the phone keeps the version it has.
 * The app's files are always served from this verified copy, never straight from the network.
 * No data ever goes through here: this file only handles the app's own code.
 */
'use strict';
importScripts('./js/crypto.js', './js/release.js');
const RELEASE_PUB = 'BHaW4pH2dClhn1JNRxVunxc7x5ygESIqFswYX0XBJn25SMUTx05ahmO2pxSmYL2DAwYhQ0PaK9oJCQ0b-vh3OXE';
const VERSION = '1.28.1-202611252014';
const CACHE = 'alasala-app-' + VERSION;
// v1.28.0: a version can also arrive inside a reply (not from the site). The newest installed version is the «active» one,
// written in a small cache of its own; a version that never starts is dropped by itself after three tries.
const META = 'wasl-active';
const MAX_TRIES = 3;
function cmp(a, b) {   // same rule as shared/update.js
  const pa = String(a).split('-'), pb = String(b).split('-');
  const x = pa[0].split('.').map(Number), y = pb[0].split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0 ? -1 : 1; }
  const s1 = pa.slice(1).join('-'), s2 = pb.slice(1).join('-');
  if (s1 === s2) return 0;
  if (/^\d+$/.test(s1) && /^\d+$/.test(s2)) return Number(s1) < Number(s2) ? -1 : 1;
  return s1 < s2 ? -1 : 1;
}
async function readState() {
  try { const r = await (await caches.open(META)).match('./state'); if (r) { const o = await r.json(); if (o && typeof o === 'object') return o; } } catch (e) { /* none */ }
  return {};
}
async function writeState(st) {
  try { await (await caches.open(META)).put('./state', new Response(JSON.stringify(st), { headers: { 'Content-Type': 'application/json' } })); } catch (e) { /* none */ }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const [mRes, sRes] = await Promise.all([fetch('./release.json', { cache: 'no-store' }), fetch('./release.sig', { cache: 'no-store' })]);
    if (!mRes.ok || !sRes.ok) throw new Error('release files missing');
    const text = await mRes.text();
    const manifest = await self.Release.verify(text, await sRes.text(), RELEASE_PUB);   // throws: install fails, the old version stays
    if (manifest.version !== VERSION) throw new Error('release version mismatch');
    const cache = await caches.open(CACHE);
    for (const path of Object.keys(manifest.files)) {
      const res = await fetch('./' + path, { cache: 'no-store' });
      if (!res.ok) throw new Error('missing ' + path);
      const bytes = new Uint8Array(await res.clone().arrayBuffer());
      await self.Release.checkFile(manifest, path, bytes);
      await cache.put('./' + path, new Response(bytes, { headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream' } }));
    }
    await self.skipWaiting();
  })().catch(async (e) => {
    await caches.delete(CACHE);
    // v1.22.6: tell the open app why this version did not install (it keeps the version it has)
    try { (await self.clients.matchAll({ includeUncontrolled: true, type: 'window' })).forEach((c) => c.postMessage({ type: 'wasl-install-failed', version: VERSION, why: String((e && e.message) || e) })); } catch (x) { /* no window */ }
    throw e;
  }));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const st = await readState();
    if (!st.active || cmp(VERSION, st.active) >= 0) { st.bad = st.bad || []; st.active = VERSION; st.prev = null; st.confirmed = true; st.tries = 0; }   // this worker brings the newest version
    const keep = [META, 'alasala-app-' + st.active].concat(st.prev ? ['alasala-app-' + st.prev] : []);
    const names = await caches.keys();
    await Promise.all(names.filter((n) => keep.indexOf(n) === -1).map((n) => caches.delete(n)));
    await writeState(st);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) { event.respondWith(new Response('', { status: 403 })); return; }   // the app never loads anything from elsewhere
  event.respondWith((async () => {
    let name = CACHE;
    const st = await readState();
    if (st.active && await caches.has('alasala-app-' + st.active)) {
      name = 'alasala-app-' + st.active;
      if (req.mode === 'navigate' && st.confirmed === false) {   // a version installed from a reply that has not yet proved it starts
        st.tries = (st.tries || 0) + 1;
        if (st.tries > MAX_TRIES && st.prev && await caches.has('alasala-app-' + st.prev)) {
          st.bad = (st.bad || []).concat([st.active]); st.active = st.prev; st.prev = null; st.confirmed = true; st.tries = 0;
          name = 'alasala-app-' + st.active;
          try { (await self.clients.matchAll({ includeUncontrolled: true, type: 'window' })).forEach((c) => c.postMessage({ type: 'wasl-rolled-back', version: st.bad[st.bad.length - 1] })); } catch (e) { /* none */ }
        }
        await writeState(st);
      }
    }
    const cache = await caches.open(name);
    let path = url.pathname.slice(new URL(self.registration.scope).pathname.length) || 'index.html';
    // files of the site that are not the app: the Android package, and .well-known/ (the APK's link to this site)
    if (path === 'wasl.apk' || path.indexOf('.well-known/') === 0) return fetch(req);
    if (req.mode === 'navigate') path = 'index.html';
    const hit = await cache.match('./' + path);
    if (hit) return hit;
    if (path === 'release.json' || path === 'release.sig' || path === 'sw.js') return fetch(req);
    return new Response('غير متاح دون اتصال', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  })());
});
