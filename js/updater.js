/**
 * updater.js — installs an app update that arrived inside a reply, a file or a code (see shared/update.js).
 *
 * The new version is built in a cache of its own next to the one in use; nothing the phone runs is touched until every
 * file has been rebuilt and checked against the list signed by the release key built into this app. Then one small
 * record («active») points at the new version. A version that does not start is dropped by the service worker after
 * three tries and the phone goes back to the previous one (sw.js).
 */
(function () {
  'use strict';
  const RELEASE_PUB = 'BHaW4pH2dClhn1JNRxVunxc7x5ygESIqFswYX0XBJn25SMUTx05ahmO2pxSmYL2DAwYhQ0PaK9oJCQ0b-vh3OXE';
  const META = 'wasl-active', PREFIX = 'alasala-app-';
  const TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', svg: 'image/svg+xml', webmanifest: 'application/manifest+json', png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', woff2: 'font/woff2', txt: 'text/plain; charset=utf-8' };
  let appVersion = '';

  async function state() {
    try { const r = await (await caches.open(META)).match('./state'); if (r) { const o = await r.json(); if (o && typeof o === 'object') return o; } } catch (e) { /* none */ }
    return {};
  }
  async function writeState(st) { await (await caches.open(META)).put('./state', new Response(JSON.stringify(st), { headers: { 'Content-Type': 'application/json' } })); }
  async function readFile(path, st) {
    let res = null;
    if (st.active && await caches.has(PREFIX + st.active)) res = await (await caches.open(PREFIX + st.active)).match('./' + path);
    if (!res) res = await caches.match('./' + path);
    return res ? new Uint8Array(await res.arrayBuffer()) : null;
  }
  const err = (code, msg) => { const e = new Error(msg || code); e.code = code; return e; };

  /** Version in use now (the newest installed), or the one this page was built as. */
  async function current() { const st = await state(); return st.active || appVersion; }

  async function install(input) {
    if (!('caches' in self)) throw err('UNSUPPORTED', 'no storage for updates');
    const pkg = typeof input === 'string' ? await window.Update.decode(input) : input;
    const st = await state();
    const cur = st.active || appVersion;
    if ((st.bad || []).indexOf(pkg.to) !== -1) throw err('BAD', 'this version did not start on this phone');
    let o;
    try { o = await window.Update.open(pkg, { version: cur, read: (p) => readFile(p, st) }, RELEASE_PUB); }
    catch (e) { throw err(e.code || 'FORMAT', e.message); }
    const name = PREFIX + o.version;
    await caches.delete(name);
    try {
      const c = await caches.open(name);
      const paths = Object.keys(o.files);
      for (const p of paths) {
        const ext = (p.split('.').pop() || '').toLowerCase();
        await c.put('./' + p, new Response(o.files[p], { headers: { 'Content-Type': TYPES[ext] || 'application/octet-stream' } }));
      }
      await c.put('./release.json', new Response(o.manifestText, { headers: { 'Content-Type': 'application/json' } }));
      await c.put('./release.sig', new Response(o.sig, { headers: { 'Content-Type': 'text/plain' } }));
      if ((await c.keys()).length < paths.length + 2) throw err('STORAGE', 'not all files were stored');
      if (!(await c.match('./index.html'))) throw err('STORAGE', 'index.html missing');
    } catch (e) { await caches.delete(name); throw err(e.code || 'STORAGE', e.message); }
    await writeState({ active: o.version, prev: cur, confirmed: false, tries: 0, bad: st.bad || [] });
    return { version: o.version, from: cur };
  }

  /** The new version started and works: the previous copy is no longer kept. */
  async function confirm() {
    const st = await state();
    if (!st.active || st.confirmed !== false || st.active !== appVersion) return false;
    st.confirmed = true; st.tries = 0; st.prev = null;
    await writeState(st);
    for (const n of await caches.keys()) if (n !== META && n !== PREFIX + st.active) await caches.delete(n);
    return true;
  }

  window.WaslUpdater = { init: (v) => { appVersion = String(v || ''); }, install, confirm, current, state, RELEASE_PUB };
})();
