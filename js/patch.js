/**
 * patch.js — byte-level differences between two versions of a file (the station makes them, the phone applies them).
 *
 * A patch is a list of two kinds of steps: «copy this part of the old file» and «add these new bytes».
 * It is cut into the smallest list the matcher finds; the whole package is compressed afterwards.
 *
 *   patch   = varint(newLength) { 0 varint(offset) varint(length)  |  1 varint(length) bytes }
 *
 * apply() checks every step against the lengths, so a damaged or hostile patch cannot read outside the old file
 * or write more than newLength bytes. The result is checked again by the caller against the signed hash.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Patch = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';
  const WIN = 12;                    // smallest part worth copying
  const TABLE_BITS = 20;
  const MAX_OUT = 64 * 1024 * 1024;

  function putVar(out, n) { while (n >= 128) { out.push((n % 128) | 128); n = Math.floor(n / 128); } out.push(n); }
  function getVar(b, st) {
    let n = 0, mul = 1;
    for (let i = 0; i < 9; i++) {
      if (st.p >= b.length) throw new Error('patch: cut short');
      const c = b[st.p++]; n += (c & 127) * mul;
      if (c < 128) return n;
      mul *= 128;
    }
    throw new Error('patch: bad number');
  }

  function hashAt(b, i) {   // 12 bytes -> 20 bits
    let h = 2166136261 >>> 0;
    for (let k = 0; k < WIN; k++) h = Math.imul(h ^ b[i + k], 16777619) >>> 0;
    return h >>> (32 - TABLE_BITS);
  }

  function diff(oldB, newB) {
    const out = [];
    putVar(out, newB.length);
    const table = new Int32Array(1 << TABLE_BITS).fill(-1);
    for (let i = 0; i + WIN <= oldB.length; i++) { const h = hashAt(oldB, i); if (table[h] === -1) table[h] = i; }
    let addFrom = 0, i = 0, hint = -1;
    const flushAdd = (to) => {
      if (to > addFrom) { out.push(1); putVar(out, to - addFrom); for (let k = addFrom; k < to; k++) out.push(newB[k]); }
    };
    const matchLen = (o, n) => { let l = 0; while (o + l < oldB.length && n + l < newB.length && oldB[o + l] === newB[n + l]) l++; return l; };
    while (i + WIN <= newB.length) {
      let o = -1, l = 0;
      if (hint >= 0) { const hl = matchLen(hint, i); if (hl >= WIN) { o = hint; l = hl; } }
      if (o < 0) {
        const cand = table[hashAt(newB, i)];
        if (cand >= 0) { const cl = matchLen(cand, i); if (cl >= WIN) { o = cand; l = cl; } }
      }
      if (o < 0) { i++; continue; }
      let back = 0;   // extend backwards into bytes waiting to be added
      while (o - back > 0 && i - back > addFrom && oldB[o - back - 1] === newB[i - back - 1]) back++;
      flushAdd(i - back);
      out.push(0); putVar(out, o - back); putVar(out, l + back);
      i += l; addFrom = i; hint = o + l;
    }
    flushAdd(newB.length);
    return Uint8Array.from(out);
  }

  function apply(oldB, patch) {
    const st = { p: 0 };
    const len = getVar(patch, st);
    if (len > MAX_OUT) throw new Error('patch: too large');
    const res = new Uint8Array(len);
    let w = 0;
    while (st.p < patch.length) {
      const op = patch[st.p++];
      if (op === 0) {
        const off = getVar(patch, st), n = getVar(patch, st);
        if (off + n > oldB.length || w + n > len) throw new Error('patch: copy out of range');
        res.set(oldB.subarray(off, off + n), w); w += n;
      } else if (op === 1) {
        const n = getVar(patch, st);
        if (st.p + n > patch.length || w + n > len) throw new Error('patch: add out of range');
        res.set(patch.subarray(st.p, st.p + n), w); st.p += n; w += n;
      } else throw new Error('patch: unknown step');
    }
    if (w !== len) throw new Error('patch: wrong length');
    return res;
  }

  return { diff, apply };
});
