/**
 * qrframes.js — splits a bundle into numbered QR frames shown in a loop ("animated QR"),
 * and puts it back together on the other side, in any order, with an integrity check.
 *
 * Frame text:  AQ2/<session>/<index>/<count>/<hash8>/<crc4>/<chunk>   (v1.26.0: crc4 of the chunk, so one badly read
 *   frame is dropped alone and read again on the next turn; AQ1 frames without it are still understood)
 *   session  random per transfer, so frames of two transfers never mix
 *   hash8    first 8 hex chars of SHA-256 of the whole payload (checked once complete)
 */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./crypto.js') : root.AC);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QRFrames = api;
})(typeof self !== 'undefined' ? self : globalThis, function (AC) {
  'use strict';
  const PREFIX = 'AQ1', PREFIX2 = 'AQ2';
  function crc4(t) { let c = 0xFFFF; for (let i = 0; i < t.length; i++) { c ^= t.charCodeAt(i) << 8; for (let k = 0; k < 8; k++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) & 0xFFFF : (c << 1) & 0xFFFF; } return c.toString(16).padStart(4, '0'); }
  const MAX_FRAMES = 4000;

  async function hash8(text) { const h = await AC.sha256(AC.utf8(text)); return Array.from(h.slice(0, 4), (b) => b.toString(16).padStart(2, '0')).join(''); }

  async function split(text, chunk) {
    chunk = chunk || 450;
    const sid = AC.b64u(AC.rand(4));
    const h = await hash8(text);
    const n = Math.max(1, Math.ceil(text.length / chunk));
    if (n > MAX_FRAMES) throw new Error('Too large for QR: use a file');
    const frames = [];
    for (let i = 0; i < n; i++) { const part = text.slice(i * chunk, (i + 1) * chunk); frames.push([PREFIX2, sid, i, n, h, crc4(part), part].join('/')); }
    return frames;
  }

  class Assembler {
    constructor() { this.reset(); }
    reset() { this.sid = null; this.n = 0; this.h = ''; this.parts = new Map(); this.done = null; }
    /** Feed one decoded QR text. Returns {status, have, total} ; status: 'single' | 'progress' | 'complete' | 'ignored' */
    async add(text) {
      if (typeof text !== 'string') return { status: 'ignored' };
      if (!text.startsWith(PREFIX + '/') && !text.startsWith(PREFIX2 + '/')) {
        // a plain (single) QR: join requests are shown this way
        // a plain (single) QR: join requests and approval codes (W1Q. / W1A.) are shown this way
        if (text.charAt(0) === '{' || /^W1[QA]\./.test(text)) return { status: 'single', text };
        return { status: 'ignored' };
      }
      const p = text.split('/');
      if (p.length < 6) return { status: 'ignored' };
      const v2 = p[0] === PREFIX2;
      const [, sid, iS, nS, h] = p;
      const chunk = p.slice(v2 ? 6 : 5).join('/');
      if (v2 && (p.length < 7 || crc4(chunk) !== p[5])) return { status: 'ignored', bad: true };   // misread frame: dropped, read again next turn
      const i = Number(iS), n = Number(nS);
      if (!Number.isInteger(i) || !Number.isInteger(n) || n < 1 || n > MAX_FRAMES || i < 0 || i >= n || !/^[0-9a-f]{8}$/.test(h)) return { status: 'ignored' };
      if (this.sid !== sid) { this.reset(); this.sid = sid; this.n = n; this.h = h; }
      if (n !== this.n || h !== this.h) return { status: 'ignored' };
      if (!this.parts.has(i)) this.parts.set(i, chunk);
      if (this.parts.size === this.n && !this.done) {
        let all = ''; for (let k = 0; k < this.n; k++) all += this.parts.get(k);
        if ((await hash8(all)) !== this.h) { this.reset(); return { status: 'progress', have: 0, total: n, error: 'checksum' }; }
        this.done = all;
        return { status: 'complete', text: all, have: n, total: n };
      }
      return { status: this.done ? 'complete' : 'progress', text: this.done || undefined, have: this.parts.size, total: this.n, missing: this.missing() };
    }
    missing() { const m = []; for (let k = 0; k < this.n && m.length < 12; k++) if (!this.parts.has(k)) m.push(k + 1); return m; }
  }

  return { split, Assembler, PREFIX };
});
