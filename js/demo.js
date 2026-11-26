/* demo.js — board demo only. One phone, several made-up people: pick one, the app opens as that person, already signed in.
   Nothing here exists in the real app. Data and names are fictional. */
(function () {
  'use strict';
  const D = window.WASL_DEMO;
  if (!D || !D.personas || !D.personas.length) return;
  const KEY = 'waslDemoPerson';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const personOf = (id) => D.personas.find((p) => p.id === id);
  const stored = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };

  // the person's phone data (as it was when the demo was built) goes into the phone's own storage
  function putPhone(p) {
    return new Promise((res, rej) => {
      const r = indexedDB.open('alasala-offline', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onerror = () => rej(r.error);
      r.onsuccess = () => {
        const db = r.result, t = db.transaction('kv', 'readwrite'), s = t.objectStore('kv');
        s.put(p.kv.meta, 'meta'); s.put(p.kv.vault, 'vault');
        t.oncomplete = () => { db.close(); res(); };
        t.onerror = () => rej(t.error);
      };
    });
  }

  const css = document.createElement('style');
  css.textContent = `
    #offTabWarn,#offForgot,#offForgotNote{display:none!important}
    #dmPick{position:fixed;inset:0;z-index:2147483000;background:linear-gradient(160deg,#10231b,#1e382b 55%,#0f172a);display:flex;align-items:center;justify-content:center;padding:18px;overflow:auto;font-family:Tajawal,sans-serif;color:#fff;direction:rtl}
    #dmPick .box{width:100%;max-width:420px;margin:auto}
    #dmPick h1{font-size:22px;font-weight:900;margin:0 0 6px;text-align:center}
    #dmPick p.s{font-size:13px;color:#fde68a;text-align:center;margin:0 0 18px;line-height:1.8}
    #dmPick button.c{display:flex;width:100%;align-items:center;justify-content:space-between;gap:10px;background:rgba(255,255,255,.1);border:1.5px solid rgba(253,230,138,.45);border-radius:18px;padding:14px 16px;margin:0 0 10px;color:#fff;font-family:inherit;cursor:pointer;direction:ltr}
    #dmPick button.c:active{background:rgba(253,230,138,.25)}
    #dmPick .n{font-size:18px;font-weight:900}
    #dmPick .t{font-size:14px;font-weight:700;color:#fde68a;letter-spacing:.04em}
    #dmPick .x{display:block;margin:14px auto 0;background:none;border:0;color:#cbd5e1;font:700 13px Tajawal,sans-serif;text-decoration:underline;cursor:pointer}
    #dmBar{position:fixed;left:8px;bottom:8px;opacity:.9;z-index:2147482000;display:flex;align-items:center;gap:6px;background:rgba(15,23,42,.88);color:#fff;border-radius:999px;padding:4px 10px;font:700 11px Tajawal,sans-serif;direction:ltr;box-shadow:0 4px 14px rgba(0,0,0,.4);cursor:pointer;border:1px solid rgba(253,230,138,.6)}
    #dmBar b{color:#fde68a}
    #dmCover{position:fixed;inset:0;z-index:2147481000;background:linear-gradient(160deg,#10231b,#1e382b 55%,#0f172a);display:flex;align-items:center;justify-content:center;color:#fde68a;font:700 15px Tajawal,sans-serif;direction:rtl}
    #dmBar .sw{font-size:15px;line-height:1}
  `;
  document.head.appendChild(css);

  function picker(canClose) {
    const cur = stored();
    const el = document.createElement('div'); el.id = 'dmPick';
    el.innerHTML = '<div class="box"><h1>وصل — نسخة تجريبية</h1><p class="s">أسماء وبيانات وهمية للعرض فقط.<br>اختر شخصاً لتفتح التطبيق بصلاحياته.</p>' +
      D.personas.map((p) => '<button class="c" data-id="' + esc(p.id) + '"><span class="n">' + esc(p.name) + '</span><span class="t">' + esc(p.title) + '</span></button>').join('') +
      (canClose && cur ? '<button class="x" id="dmX">رجوع</button>' : '') + '</div>';
    document.body.appendChild(el);
    el.querySelectorAll('button.c').forEach((b) => {
      b.onclick = async () => {
        const p = personOf(b.getAttribute('data-id'));
        b.disabled = true;
        try { await putPhone(p); localStorage.setItem(KEY, p.id); sessionStorage.setItem('waslDemoLoaded:' + p.id, '1'); } catch (e) { /* shown below */ }
        location.reload();
      };
    });
    const x = el.querySelector('#dmX'); if (x) x.onclick = () => el.remove();
  }

  function bar(p) {
    const b = document.createElement('div'); b.id = 'dmBar';
    b.innerHTML = '<b>' + esc(p.name) + '</b><span class="sw">⇄</span>';
    b.onclick = () => { if (!document.getElementById('dmPick')) picker(true); };
    document.body.appendChild(b);
  }

  // the sign-in screen is never shown: a plain cover stays up until the person is in
  function cover(on) {
    let c = document.getElementById('dmCover');
    if (on && !c) { c = document.createElement('div'); c.id = 'dmCover'; c.textContent = 'جارٍ الفتح…'; document.body.appendChild(c); }
    else if (!on && c) c.remove();
  }
  const signedIn = () => typeof AppState !== 'undefined' && !!AppState.currentUser;

  // signed in at once: the person's code is typed by this page, nobody sees it
  function autoLogin() {
    let busy = false, waited = 0;
    cover(true);
    setInterval(() => {
      if (document.getElementById('dmPick')) { cover(false); return; }
      if (signedIn()) { waited = 0; cover(false); return; }
      if (++waited < 50) cover(true); else cover(false);   // never a cover for ever
      if (busy) return;
      const scr = document.getElementById('loginScreen'), pin = document.getElementById('loginPinInput'), em = document.getElementById('loginEmailInput');
      if (!scr || !pin || !em || !em.value || scr.classList.contains('hidden') || scr.offsetParent === null) return;
      if (typeof window.submitEmailPinLogin !== 'function') return;
      busy = true; pin.value = D.pin;
      try { window.submitEmailPinLogin(); } catch (e) { /* retried below */ }
      setTimeout(() => { busy = false; }, 5000);
    }, 600);
  }

  // ---------------------------------------------------------------- simulated phone-to-phone exchange
  // The sync button opens these screens instead of the real ones: same look, nothing is really sent or received
  // (no other phone, no station, no network). A fake file can be saved. Every screen says it is a simulation.
  const SIM = (function () {
    let layer = null, qr = null, timers = [], pending = 3;
    const $ = (s) => (layer ? layer.querySelector(s) : null);
    const other = () => { const i = D.personas.findIndex((p) => p.id === stored()); return D.personas[(i + 1) % D.personas.length].name; };
    const NOTE = '<div style="background:#fef3c7;color:#92400e;border-radius:12px;padding:8px 10px;font-size:12px;font-weight:700;margin:8px 0;line-height:1.7">محاكاة للعرض: لا يوجد هاتف آخر ولا اتصال حقيقي.</div>';
    const ICQR = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h3M20 17v4"/></svg>';
    const ICNET = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>';
    const WORDS = 'river-moon-apple';
    const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()); };
    const fname = (k) => 'wasl-' + k + '-' + stamp() + '.txt';
    function fakeText() { let t = 'WU1.demo.'; const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; for (let i = 0; i < 1500; i++) t += a[Math.floor(Math.random() * a.length)]; return t; }
    function stopAll() { timers.forEach(clearTimeout); timers.forEach(clearInterval); timers = []; if (qr) { try { qr.stop(); } catch (e) { /* stopped */ } qr = null; } }
    function paint(html) {
      stopAll();
      if (!layer) { layer = document.createElement('div'); layer.id = 'offLayer'; document.body.appendChild(layer); }
      layer.innerHTML = '<div class="oc">' + html + '</div>'; layer.scrollTop = 0;
      const x = $('#smX'); if (x) x.onclick = close;
    }
    function close() { stopAll(); if (layer) { layer.remove(); layer = null; } }
    const X = '<button class="x" id="smX">×</button>';
    const step = (n, on, body) => '<div style="display:flex;gap:10px;align-items:flex-start;margin:10px 0"><span style="flex:0 0 26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;' + (on ? 'background:#047857;color:#fff' : 'background:#e2e8f0;color:#475569') + '">' + n + '</span><div style="flex:1">' + body + '</div></div>';
    function saveFake(kind) {
      const name = fname(kind);
      const url = URL.createObjectURL(new Blob(['WASL — ملف تجريبي للعرض فقط. لا يحتوي أي بيانات.\n' + fakeText() + '\n'], { type: 'text/plain' }));
      const a = document.createElement('a'); a.href = url; a.download = name; a.style.display = 'none'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      const m = $('#smFileMsg'); if (m) { m.style.display = 'block'; m.textContent = 'حُفظ الملف في مجلد التنزيلات باسم ' + name + '. أرسله من مدير الملفات أو من أي تطبيق.'; }
    }
    function home() {
      paint(X + '<h2>المزامنة</h2>' + NOTE + '<p>تحيينات لم تُرسل بعد: <b>' + pending + '</b></p><button class="ob" id="smSend">📤 إرسال</button><button class="ob" id="smRead">📥 استلام</button>');
      $('#smSend').onclick = send; $('#smRead').onclick = read;
    }
    function done(title, text) {
      paint(X + '<h2>' + title + ' ✓</h2>' + NOTE + '<p>' + text + '</p><button class="ob" id="smOk">إغلاق</button><button class="ob l" id="smBack">رجوع إلى المزامنة</button>');
      $('#smOk').onclick = close; $('#smBack').onclick = home;
    }
    // ---- send
    function send() {
      paint(X + '<h2>إرسال تحييناتك</h2>' + NOTE + '<p>اختر طريقة الإرسال:</p><div class="ways"><button type="button" class="way" id="smWayQR">' + ICQR + '<span>الإرسال عن قرب QR Code</span><small>وجهاً لوجه</small></button><button type="button" class="way" id="smWayNet">' + ICNET + '<span>الإرسال عن بعد</span><small>بين مكانين بعيدين</small></button></div>' +
        '<div id="smQRBox" style="display:none"><p style="margin:10px 0 4px">اترك الهاتف ثابتاً حتى يكتمل. الشاشة بأعلى إضاءة، ويقرّب الهاتف الآخر قليلاً.</p><div id="smQR"></div><button class="ob g" id="smQRdone">الهاتف الآخر قرأ الرمز (محاكاة)</button></div>' +
        '<button type="button" class="lnk" id="smSave">أو تنزيل الملف</button><div id="smFileMsg" class="note" style="display:none"></div><button class="ob l" id="smToRead">التالي: استلام</button>');
      let started = false;
      $('#smWayQR').onclick = () => {
        const box = $('#smQRBox'), on = box.style.display === 'none'; box.style.display = on ? 'block' : 'none'; $('#smWayQR').classList.toggle('on', on);
        if (on && !started && window.QRUI) { started = true; qr = window.QRUI.player($('#smQR'), fakeText(), { chunk: 240, fps: 4, sizes: false }); }
      };
      $('#smQRdone').onclick = () => { pending = 0; done('تمّ الإرسال', 'وصلت تحييناتك إلى <b>' + other() + '</b>.'); };
      $('#smWayNet').onclick = sendFar;
      $('#smSave').onclick = () => saveFake('send');
      $('#smToRead').onclick = read;
    }
    function sendFar() {
      const name = fname('send');
      paint(X + '<h2>إرسال عن بعد</h2>' + NOTE +
        step('✓', true, '<b>الملف جاهز</b><div style="font-size:12px;color:#64748b">حُفظ في التنزيلات: <span dir="ltr">' + name + '</span></div>') +
        step(2, true, '<b>افتح صفحة الإرسال</b><div style="font-size:12.5px;color:#475569;margin:2px 0 6px">اختر الملف الذي حُفظ للتو.</div><button class="ob" id="smOpen" style="margin:0">فتح صفحة الإرسال</button>') +
        step(3, false, '<b>أرسل الكلمات التي تظهر</b><div style="font-size:12.5px;color:#475569">تظهر ثلاث كلمات. أرسلها للشخص الذي سيستلم.</div>'));
      saveFake('send');
      $('#smOpen').onclick = () => {
        paint(X + '<h2>صفحة الإرسال</h2>' + NOTE + '<p>الملف المختار: <span dir="ltr">' + name + '</span></p><p>الكلمات التي تظهر الآن:</p>' +
          '<div dir="ltr" style="font:800 22px monospace;text-align:center;background:#eef2f0;border-radius:14px;padding:14px;margin:8px 0">' + WORDS + '</div><p id="smWait">بانتظار الشخص الذي سيستلم…</p>');
        timers.push(setTimeout(() => { pending = 0; done('تمّ الإرسال', 'استلم <b>' + other() + '</b> ملفك.'); }, 4000));
      };
    }
    // ---- receive
    function read() {
      paint(X + '<h2>استلام</h2>' + NOTE + '<p>اختر طريقة الاستلام:</p><div class="ways"><button type="button" class="way" id="smScan">' + ICQR + '<span>قراءة رمز QR Code</span><small>وجهاً لوجه</small></button><button type="button" class="way" id="smFar">' + ICNET + '<span>الاستلام عن بعد</span><small>بين مكانين بعيدين</small></button></div><button type="button" class="lnk" id="smPick">أو اختيار ملف</button>');
      $('#smScan').onclick = scan; $('#smFar').onclick = readFar; $('#smPick').onclick = pickFile;
    }
    function scan() {
      paint(X + '<h2>قراءة الرمز</h2>' + NOTE + '<p>وجّه الكاميرا إلى شاشة الهاتف الآخر.</p>' +
        '<div style="position:relative;width:240px;height:240px;margin:12px auto;border:3px dashed #1e382b;border-radius:18px;overflow:hidden;background:#0f172a"><div id="smLine" style="position:absolute;left:0;right:0;height:3px;background:#34d399;top:0"></div></div>' +
        '<div id="smFrames" style="text-align:center;font-weight:800;color:#334155">الإطار 0 من 6</div>');
      let n = 0, y = 0, dir = 1;
      timers.push(setInterval(() => { y += dir * 12; if (y > 235 || y < 0) dir = -dir; const l = $('#smLine'); if (l) l.style.top = y + 'px'; }, 40));
      timers.push(setInterval(() => { n++; const f = $('#smFrames'); if (f) f.textContent = 'الإطار ' + Math.min(n, 6) + ' من 6'; if (n >= 6) { stopAll(); done('تمّ الاستلام', 'وصلت تحيينات جديدة (3) من <b>' + other() + '</b>.'); } }, 700));
    }
    function readFar() {
      paint(X + '<h2>استلام عن بعد</h2>' + NOTE +
        step(1, true, '<b>الكلمات التي وصلتك</b><div style="font-size:12.5px;color:#475569;margin:2px 0 6px">اكتبها أو الصقها هنا.</div><input id="smWords" dir="ltr" placeholder="river-moon-apple" autocomplete="off"><button class="ob l" id="smPaste" style="margin:6px 0 0">لصق</button>') +
        step(2, true, '<b>افتح صفحة الاستلام</b><div style="font-size:12.5px;color:#475569;margin:2px 0 6px">تنزل الصفحة الملف عندما تكتب الكلمات.</div><button class="ob" id="smOpen" style="margin:0">فتح صفحة الاستلام</button>') +
        step(3, true, '<b>افتح الملف هنا</b><div style="font-size:12.5px;color:#475569;margin:2px 0 6px">اختر الملف الذي نزّلته.</div><button class="ob" id="smFile" style="margin:0">اختيار الملف</button>'));
      $('#smPaste').onclick = () => { $('#smWords').value = WORDS; };
      $('#smOpen').onclick = () => {
        const w = ($('#smWords').value || WORDS).trim() || WORDS;
        paint(X + '<h2>صفحة الاستلام</h2>' + NOTE + '<p>الكلمات: <span dir="ltr" style="font-weight:800">' + w + '</span></p><div style="background:#eef2f0;border-radius:12px;height:14px;overflow:hidden;margin:12px 0"><div id="smBar" style="height:100%;width:0;background:#047857;transition:width 2.4s linear"></div></div><p id="smDl">جارٍ تنزيل الملف…</p>');
        timers.push(setTimeout(() => { const b = $('#smBar'); if (b) b.style.width = '100%'; }, 50));
        timers.push(setTimeout(() => { const t = $('#smDl'); if (t) t.textContent = 'نزل الملف ' + fname('reply') + '. ارجع إلى التطبيق واختره.'; paintBackBtn(); }, 2700));
      };
      $('#smFile').onclick = pickFile;
    }
    function paintBackBtn() { const t = $('#smDl'); if (!t) return; const b = document.createElement('button'); b.className = 'ob'; b.textContent = 'رجوع إلى التطبيق'; b.onclick = readFar; t.after(b); }
    function pickFile() {
      const name = fname('reply');
      paint(X + '<h2>اختيار الملف</h2>' + NOTE + '<p>ملفات في التنزيلات:</p>' +
        '<button class="ob l" id="smF1" dir="ltr" style="text-align:left">📄 ' + name + '</button><button class="ob l" id="smF2" dir="ltr" style="text-align:left;opacity:.6">📄 photo-2026.jpg</button>');
      $('#smF1').onclick = () => done('تمّ الاستلام', 'وصلت تحيينات جديدة (3) من <b>' + other() + '</b>.');
      $('#smF2').onclick = () => { const f = $('#smF2'); f.textContent = 'هذا ليس ملفاً من وصل'; };
    }
    return { open: home };
  })();
  document.addEventListener('click', (e) => {
    const b = e.target && e.target.closest ? e.target.closest('#offSyncBtn') : null;
    if (!b) return;
    e.stopImmediatePropagation(); e.preventDefault();
    SIM.open();
  }, true);

  // offline.js waits for this before it reads the phone's storage
  window.WaslDemoReady = (async () => {
    await new Promise((r) => { if (document.body) r(); else document.addEventListener('DOMContentLoaded', r); });
    const p = personOf(stored());
    if (!p) { picker(false); return new Promise(() => {}); }
    if (!sessionStorage.getItem('waslDemoLoaded:' + p.id)) { await putPhone(p); sessionStorage.setItem('waslDemoLoaded:' + p.id, '1'); }
    bar(p); autoLogin();
  })();
})();
