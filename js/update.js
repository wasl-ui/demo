/**
 * update.js — an app update that travels as data (inside a reply, a file or a code), not from a web site.
 *
 *   package = { u:1, app, from, to, m, s, f }
 *     m, s   the new version's signed file list (release.json and release.sig), exactly as the release key signed them
 *     f      only the files that changed: { path: {k:'p', b:<hash of the old file>, d:<patch>} | {k:'f', d:<whole file>} }
 *            (d is compressed, then base64url)
 *
 * The package itself needs no signature of its own: the phone rebuilds every file, checks each one against the
 * hash in the signed list, and installs nothing unless the list is signed by the key built into the app.
 */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const api = factory(isNode ? require('./crypto.js') : root.AC, isNode ? require('./release.js') : root.Release, isNode ? require('./patch.js') : root.Patch);
  if (isNode) module.exports = api; else root.Update = api;
})(typeof self !== 'undefined' ? self : globalThis, function (AC, Release, Patch) {
  'use strict';
  const PREFIX = 'WU1.';
  const MAX_FILES = 600;

  class UpdateError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

  /** «1.28.0» > «1.27.9»; for the same number, the build stamp after the dash decides («1.28.0-202611250900» is newer than «1.28.0-202611241541»). */
  function cmp(a, b) {
    const pa = String(a).split('-'), pb = String(b).split('-');
    const x = pa[0].split('.').map(Number), y = pb[0].split('.').map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0 ? -1 : 1; }
    const s1 = pa.slice(1).join('-'), s2 = pb.slice(1).join('-');
    if (s1 === s2) return 0;
    if (/^\d+$/.test(s1) && /^\d+$/.test(s2)) return Number(s1) < Number(s2) ? -1 : 1;
    return s1 < s2 ? -1 : 1;
  }

  /** Station side. prev / next: { version, files: {path: Uint8Array} }; next also holds the signed list as text. */
  async function make(prev, next) {
    const manifest = JSON.parse(next.manifestText);
    const f = {};
    for (const path of Object.keys(manifest.files)) {
      const nb = next.files[path];
      if (!nb) throw new UpdateError('MISSING', 'file missing in the new version: ' + path);
      const nn = Release.forHash(path, nb);
      const pb = prev && prev.files[path];
      if (pb) {
        const pn = Release.forHash(path, pb);
        if (await Release.sha256Hex(pn) === manifest.files[path]) continue;   // unchanged
        const p = await AC.gzip(Patch.diff(pn, nn));
        const whole = await AC.gzip(nn);
        f[path] = p.length < whole.length * 0.9
          ? { k: 'p', b: await Release.sha256Hex(pn), d: AC.b64u(p) }
          : { k: 'f', d: AC.b64u(whole) };
      } else {
        f[path] = { k: 'f', d: AC.b64u(await AC.gzip(nn)) };
      }
    }
    return { u: 1, app: manifest.app, from: prev ? prev.version : '', to: manifest.version, m: next.manifestText, s: next.sig, f };
  }

  const encode = async (pkg) => PREFIX + AC.b64u(await AC.gzip(AC.utf8(JSON.stringify(pkg))));
  const looksLike = (text) => typeof text === 'string' && text.startsWith(PREFIX);
  async function decode(text) {
    if (!looksLike(text)) throw new UpdateError('FORMAT', 'not an update');
    let pkg;
    try { pkg = JSON.parse(AC.fromUtf8(await AC.gunzip(AC.unb64u(text.slice(PREFIX.length).trim())))); } catch (e) { throw new UpdateError('FORMAT', 'update unreadable'); }
    return check(pkg);
  }
  function check(pkg) {
    if (!pkg || typeof pkg !== 'object' || pkg.u !== 1 || typeof pkg.m !== 'string' || typeof pkg.s !== 'string' || !pkg.f || typeof pkg.f !== 'object') throw new UpdateError('FORMAT', 'not an update');
    return pkg;
  }

  /**
   * Phone side. current: { version, read(path) -> Uint8Array|null }, pub: the release key built into the app.
   * Returns { version, files: {path: bytes}, manifestText, sig } or throws UpdateError:
   *   SIGNATURE (not signed by our key) · SAME / OLDER · BASE (this phone's files are not the ones the patch expects) ·
   *   MISSING · ALTERED (a rebuilt file does not match the signed list)
   */
  async function open(pkg, current, pub) {
    check(pkg);
    let manifest;
    try { manifest = await Release.verify(pkg.m, pkg.s, pub); } catch (e) { throw new UpdateError('SIGNATURE', e.message); }
    if (manifest.version !== pkg.to) throw new UpdateError('FORMAT', 'version does not match the signed list');
    const c = cmp(manifest.version, current.version);
    if (c === 0) throw new UpdateError('SAME', 'already on this version');
    if (c < 0) throw new UpdateError('OLDER', 'older than this version');
    const paths = Object.keys(manifest.files);
    if (paths.length > MAX_FILES) throw new UpdateError('FORMAT', 'too many files');
    const files = {};
    for (const path of paths) {
      const e = pkg.f[path];
      let bytes;
      if (!e) {
        const old = await current.read(path);
        if (!old) throw new UpdateError('MISSING', 'file not on this phone: ' + path);
        bytes = Release.forHash(path, old);
      } else if (e.k === 'f') {
        try { bytes = await AC.gunzip(AC.unb64u(e.d)); } catch (x) { throw new UpdateError('FORMAT', 'file unreadable: ' + path); }
      } else if (e.k === 'p') {
        const old = await current.read(path);
        if (!old) throw new UpdateError('BASE', 'file not on this phone: ' + path);
        const base = Release.forHash(path, old);
        if (await Release.sha256Hex(base) !== e.b) throw new UpdateError('BASE', 'this phone has another copy of ' + path);
        try { bytes = Patch.apply(base, await AC.gunzip(AC.unb64u(e.d))); } catch (x) { throw new UpdateError('FORMAT', 'patch unreadable: ' + path); }
      } else throw new UpdateError('FORMAT', 'unknown step for ' + path);
      try { await Release.checkFile(manifest, path, bytes); } catch (x) { throw new UpdateError('ALTERED', x.message); }
      files[path] = bytes;
    }
    return { version: manifest.version, files, manifestText: pkg.m, sig: pkg.s };
  }

  return { make, open, encode, decode, looksLike, cmp, UpdateError, PREFIX };
});
