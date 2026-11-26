/* offline.js — connects the v66 screens to the phone's local engine, and adds the screens the offline
   version needs: enrollment, sync by animated QR or file, PIN change, automatic lock. */
(function () {
  'use strict';
  const IDLE_MS = 15 * 60 * 1000;         // automatic lock after 15 minutes open on the screen without a touch
  const HIDDEN_MS = 10 * 60 * 1000;       // or 10 minutes in the background (v1.16.1: was 5 min / 1 min)
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const standalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;

  // ---------------------------------------------------------------- worker RPC
  // on the master station («العمل باسم شخص»), station-as.js replaces the phone's storage with the station
  const AS = window.WaslStationAs || null;
  const worker = AS ? null : new Worker('./worker.js');
  let seq = 0; const waiting = new Map();
  if (worker) worker.onmessage = (e) => { const { id, result, error } = e.data; const p = waiting.get(id); if (!p) return; waiting.delete(id); if (error) { const er = new Error(error.message); er.code = error.code; p.reject(er); } else p.resolve(result); };
  const rpc = AS ? (method, ...args) => AS.rpc(method, args) : (method, ...args) => new Promise((resolve, reject) => { const id = ++seq; waiting.set(id, { resolve, reject }); worker.postMessage({ id, method, args }); });

  const READS = { init: 1, actInit: 1, ceoInit: 1, areaList: 1, pubLoad: 1, pubSearch: 1, majlisInit: 1, majlisSearch: 1, actClassInit: 1, actContribInit: 1, login: 1, logout: 1 };
  window.LocalBackend = {
    async call(body) {
      try {
        const r = await rpc('api', body);
        if (body && body.action === 'login' && r && r.success) afterLogin();
        else if (body && !READS[body.action]) updateBadge();
        return r;
      }
      catch (e) { if (e.code === 'STATION_LOCKED') return { success: false, code: 'SESSION_EXPIRED', error: e.message }; if (e.code === 'LOCKED') return { success: false, code: 'SESSION_EXPIRED', error: 'انتهت الجلسة، يرجى تسجيل الدخول من جديد.' }; return { success: false, code: e.code || 'ERROR', error: e.message }; }
    },
    rpc
  };

  // a wait screen of the app that lasts (v1.15.4): after 20 s it says so and can be closed, instead of staying for ever
  setInterval(() => {
    const ov = document.getElementById('loadingOverlay'); if (!ov) return;
    const on = !ov.classList.contains('hidden');
    if (!on) { ov.dataset.since = ''; const n = document.getElementById('offSlow'); if (n) n.remove(); return; }
    if (!ov.dataset.since) { ov.dataset.since = String(Date.now()); return; }
    if (Date.now() - Number(ov.dataset.since) < 20000 || document.getElementById('offSlow')) return;
    const box = document.createElement('div'); box.id = 'offSlow';
    box.style.cssText = 'margin-top:14px;max-width:290px;text-align:center;background:#fff;border-radius:16px;padding:12px 14px;font:700 13px/1.7 Tajawal,sans-serif;color:#334155';
    box.innerHTML = 'تأخّر الرد. إن لم ينتهِ، أغلق هذه النافذة، ثم تأكّد هل حُفظ ما أدخلته قبل إعادته. وإن تكرّر، أغلق التطبيق وأعد فتحه.<button type="button" style="display:block;width:100%;margin-top:8px;padding:9px;border:0;border-radius:12px;background:#1e382b;color:#fff;font:800 14px Tajawal,sans-serif">إغلاق</button>';
    box.querySelector('button').onclick = () => { ov.classList.add('hidden'); box.remove(); };
    ov.appendChild(box);
  }, 2000);

  // ---------------------------------------------------------------- styles of the added screens
  const css = document.createElement('style');
  css.textContent = `
    #waslTitle{margin:0;line-height:0}
    #waslTitle img{display:block;margin:0 auto;width:min(62vw,250px);height:auto;filter:drop-shadow(0 3px 14px rgba(0,0,0,.7)) drop-shadow(0 1px 2px rgba(0,0,0,.5))}
    #waslSub{font-size:12px;letter-spacing:.45em;text-transform:uppercase;color:#f5d58ccc;margin-top:6px;font-weight:700}
    #offForgot{display:block;margin:14px auto 0;background:none;border:0;color:#fde68a;font-size:12.5px;font-weight:700;text-decoration:underline;cursor:pointer}
    #offForgotNote{margin-top:8px;font-size:12px;line-height:1.7;color:#fef3c7;text-align:center}
    #offLayer .hint{font-size:12px;color:#64748b;margin-top:4px}
    #offLayer .hint.ok{color:#047857;font-weight:700}
    #offLayer .hint.bad{color:#b91c1c;font-weight:700}
    #offLayer{position:fixed;inset:0;z-index:90;background:rgba(15,23,42,.72);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:16px}
    #offLayer .oc{background:#fff;border-radius:22px;max-width:560px;width:100%;padding:18px;margin:auto 0;box-shadow:0 25px 60px -15px rgba(0,0,0,.5);font-family:Tajawal,sans-serif;color:#0f172a}
    #offLayer h2{font-size:18px;font-weight:900;margin:0 0 8px}
    #offLayer p{font-size:13px;line-height:1.8;color:#334155;margin:6px 0}
    #offLayer label{display:block;font-size:12px;font-weight:800;margin:10px 0 4px;color:#1e293b}
    #offLayer input{width:100%;padding:12px 14px;border:1px solid #cbd5e1;border-radius:14px;font-size:15px;box-sizing:border-box}
    #offLayer .ob{display:block;width:100%;margin-top:10px;padding:13px;border-radius:14px;border:0;font-weight:900;font-size:14px;cursor:pointer;background:#1e382b;color:#fff;font-family:inherit}
    #offLayer .ob.l{background:#eef2f0;color:#1e382b}
    #offLayer input.pinf,input.pinf{-webkit-text-security:disc;text-security:disc}
    #offLayer .ways{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:12px}
    #offLayer .way{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px 4px;border-radius:16px;border:1px solid #d5e0da;background:#f4f8f6;color:#1e382b;cursor:pointer;font-family:inherit}
    #offLayer .way span{font-weight:900;font-size:13px;line-height:1.25;text-align:center}#offLayer .way small{font-size:11px;color:#64748b}
    #offLayer .way.on{background:#1e382b;color:#fff;border-color:#1e382b}#offLayer .way.on small{color:#cbd5e1}
    #offLayer .lnk{display:block;margin:8px auto 0;border:0;background:none;color:#64748b;text-decoration:underline;font-family:inherit;font-size:12px;cursor:pointer}
    #offLayer .ob.r{background:#fee2e2;color:#b91c1c}
    #offLayer .note{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:14px;padding:10px 12px;font-size:12.5px;line-height:1.8}
    #offAreaHint .warn{background:#fffbeb;border:1px solid #fde68a;border-radius:14px;padding:10px 12px;font-size:12.5px;line-height:1.8;color:#78350f}
    #offAreaHint .note{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:14px;padding:10px 12px;font-size:12.5px;line-height:1.8}
    #offAreaHint .ob{display:block;width:100%;padding:10px;border:0;border-radius:12px;background:#eef2f0;color:#1e382b;font-weight:800;font-family:inherit;cursor:pointer}
    #offLayer .warn{background:#fffbeb;border:1px solid #fde68a;border-radius:14px;padding:10px 12px;font-size:12.5px;line-height:1.8;color:#78350f}
    #offLayer .err{background:#fef2f2;border:1px solid #fecaca;border-radius:14px;padding:10px 12px;font-size:12.5px;color:#7f1d1d;margin-top:8px}
    #offLayer .code{font-size:38px;font-weight:900;letter-spacing:5px;text-align:center;direction:ltr;padding:12px;background:#fffbeb;border:2px dashed #f59e0b;border-radius:16px;margin:10px 0;font-family:'Plus Jakarta Sans',sans-serif}
    #offLayer .row{display:flex;gap:8px}#offLayer .row>*{flex:1}
    #offLayer ul{font-size:12.5px;line-height:1.8;padding-inline-start:18px;margin:6px 0}
    #offLayer .x{float:left;background:none;border:0;font-size:22px;cursor:pointer;color:#64748b}
    #offLayer .steps{display:flex;gap:6px;margin:0 0 12px}
    #offLayer .steps>div{flex:1;text-align:center;font-size:11px;font-weight:800;color:#94a3b8}
    #offLayer .steps b{display:flex;align-items:center;justify-content:center;width:28px;height:28px;margin:0 auto 3px;border-radius:50%;background:#e2e8f0;color:#64748b;font-size:13px}
    #offLayer .steps .on{color:#1e382b}#offLayer .steps .on b{background:#1e382b;color:#fff}
    #offLayer .steps .done{color:#047857}#offLayer .steps .done b{background:#d1fae5;color:#047857}
    #offLayer .wait{background:#fffbeb;border:1px solid #fde68a;border-radius:14px;padding:10px 12px;font-size:13px;font-weight:700;line-height:1.8;color:#78350f;margin:10px 0}
    #offLayer .sum{background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:10px 12px;font-size:13px;line-height:1.9;margin:8px 0}
    #offLayer .big{font-size:56px;line-height:1;text-align:center;margin:8px 0 2px}
    #offLayer .ob.g{background:#047857;color:#fff}
    #offLayer textarea{width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:14px;font-size:14px;box-sizing:border-box;font-family:inherit}
    #offLayer select{width:100%;padding:12px 14px;border:1px solid #cbd5e1;border-radius:14px;font-size:15px;box-sizing:border-box;background:#fff;font-family:inherit}
    #offLayer .evc{display:block;width:100%;text-align:right;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:12px 14px;margin:8px 0;cursor:pointer;font-family:inherit;color:#1e293b}
    #offLayer .evc b{font-size:15px}#offLayer .evc small{display:block;color:#64748b;font-size:12px;margin-top:3px}
    #offLayer .evp{display:flex;align-items:center;gap:8px;border-bottom:1px solid #f1f5f9;padding:9px 2px}
    #offLayer .evp .n{flex:1;font-weight:700;font-size:14px}#offLayer .evp .n small{display:block;font-weight:500;color:#64748b;font-size:11.5px}
    #offFresh{display:block;width:100%;text-align:right;font:700 12px Tajawal,sans-serif;border-radius:12px;padding:8px 12px;margin:0 0 12px;cursor:pointer;border:1px solid}
    body.offBlur #appShell main,body.offBlur #offDock{filter:blur(9px);pointer-events:none;user-select:none}
    #offBlurNote{position:fixed;left:16px;right:16px;top:30%;z-index:80;background:#fff;border:1px solid #fecaca;border-radius:18px;padding:18px;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.18);font-family:Tajawal,sans-serif}
    #offBlurNote .ob{display:block;width:100%;padding:13px;border-radius:14px;border:0;font-weight:900;font-size:14px;cursor:pointer;background:#1e382b;color:#fff;font-family:inherit}
    #offBlurNote b{display:block;color:#991b1b;font-size:15px;margin-bottom:6px}#offBlurNote p{font-size:13px;color:#334155;margin:0 0 12px}
    #offDock{position:fixed;left:0;right:0;bottom:0;z-index:45;display:flex;gap:8px;padding:8px 12px calc(8px + env(safe-area-inset-bottom));background:rgba(255,255,255,.97);border-top:1px solid #e2e8f0;box-shadow:0 -4px 18px rgba(15,23,42,.08);direction:rtl}
    #offDock button{flex:1;display:flex;align-items:center;justify-content:center;gap:7px;min-height:46px;padding:8px 10px;border-radius:14px;border:1px solid #e2e8f0;background:#f8fafc;color:#1e382b;font:800 13.5px Tajawal,sans-serif;cursor:pointer}
    #offDock button:active{background:#e2e8f0}
    #offDock button{flex:1 1 0;min-width:0}
    #offDock.n4{gap:5px;padding-left:6px;padding-right:6px}
    #offDock.n4 button{flex-direction:column;gap:2px;padding:6px 2px;font-size:11px;line-height:1.15;text-align:center}
    #offDock.n4 button svg{width:18px;height:18px;flex:0 0 auto}
    #userTier{display:none !important}   /* v1.22.0: roles are in «حسابي», in words */
    #logoutBtn{display:none !important}
    body.offDocked #appShell{padding-bottom:76px}
    body.offDocked #appShell main{padding-bottom:calc(110px + env(safe-area-inset-bottom)) !important}   /* v1.21.8: the last cards above the dock */
    body.offDocked #floatingSaveBar{bottom:84px!important}
    #appShell.hidden #offDock{display:none}
    #offLayer .plc{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:11px 13px;margin:8px 0;color:#1e293b}
    #offLayer .plc.pldr{background:repeating-linear-gradient(135deg,#fff,#fff 10px,#fffbeb 10px,#fffbeb 20px);border-style:dashed;border-color:#f59e0b}
    #offLayer .plc small{display:block;color:#475569;font-size:12px;margin-top:3px;line-height:1.6}
    #offLayer .pld{margin:14px 2px 2px;font-size:13.5px;color:#1e382b}
    #offLayer .pld small{color:#64748b;font-weight:500}
    #offLayer .pld.today{color:#0369a1}
    #offLayer .plchips{display:flex;flex-wrap:wrap;gap:6px 12px;margin:4px 0 6px}
    #offLayer .plchips label{display:flex;align-items:center;gap:4px;font-size:13px;font-weight:700;margin:0}
    #offLayer .plchips input{width:auto;margin:0}
    #offLayer .chip{display:inline-block;font-size:11px;font-weight:800;border-radius:999px;padding:2px 9px}
    #offLayer .chip.p{background:#dcfce7;color:#166534}#offLayer .chip.t{background:#fef3c7;color:#92400e}
    #offLayer .mini{border:0;border-radius:10px;padding:7px 10px;font-weight:800;font-size:12px;cursor:pointer;font-family:inherit;background:#eef2f0;color:#1e382b}
    #offLayer .mini.on{background:#1e382b;color:#fff}#offLayer .mini.x{background:#fee2e2;color:#b91c1c}
    #offSyncBtn{position:relative}
    #offSyncBadge{position:absolute;top:2px;left:2px;min-width:16px;height:16px;border-radius:9px;background:#d97706;color:#fff;font-size:10px;font-weight:800;display:none;align-items:center;justify-content:center;padding:0 3px}
    /* the header refresh button: on a phone, new data only comes with «أخذ التحيينات» */
    button[onclick="refreshLiveBackend()"]{display:none!important}
    #offTabWarn{position:fixed;top:0;left:0;right:0;z-index:2147483000;background:#7c2d12;color:#fff;font-size:12px;font-weight:700;padding:8px 12px;text-align:center}
    /* login fields: dark with white text, also when focused or filled in by the phone (autofill paints them light) */
    #loginScreen input,#loginScreen input:focus,#loginScreen input:hover{background-color:#101c16 !important;color:#fff !important;-webkit-text-fill-color:#fff !important;caret-color:#fbbf24}
    #loginScreen input:-webkit-autofill,#loginScreen input:-webkit-autofill:focus,#loginScreen input:-webkit-autofill:hover{-webkit-box-shadow:0 0 0 1000px #101c16 inset !important;box-shadow:0 0 0 1000px #101c16 inset !important;-webkit-text-fill-color:#fff !important;transition:background-color 99999s}`;
  document.head.appendChild(css);

  let layer = null, widgets = [];
  function stopWidgets() { widgets.forEach((w) => { try { w.stop(); } catch (e) { /* stopped */ } }); widgets = []; }
  function show(html) {
    stopWidgets();
    if (!layer) { layer = document.createElement('div'); layer.id = 'offLayer'; document.body.appendChild(layer); }
    layer.innerHTML = '<div class="oc">' + html + '</div>';
    layer.scrollTop = 0;
    return layer;
  }
  function close() { stopWidgets(); if (layer) { layer.remove(); layer = null; } }
  // Android back (v1.15): a screen of this layer with a × closes like a tap on ×; one without (a required step) stays
  window.WaslOfflineBack = () => {
    if (!layer) return false;
    const x = layer.querySelector('#offX, #plX');
    if (x) x.click();
    return true;
  };
  function errBox(msg) { const e = $('#offErr'); if (e) { e.textContent = msg; e.style.display = 'block'; } }
  // Files: a plain .txt file (Android shares only known file types). Share opens Android's share sheet
  // (Quick Share, Bluetooth, WhatsApp, croc…); Download saves it in the Download folder.
  const fileName = (kind) => { const d = new Date(), p = (n) => String(n).padStart(2, '0');   // local date and time
    return 'wasl-' + kind + '-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + '.txt'; };
  const FILE_BUTTONS = '<button class="ob l" id="offSave">تنزيل الملف</button><div id="offFileMsg" class="note" style="display:none"></div>';   // v1.26.0: no «share» (it opens mail, messengers...)
  function fileMsg(t) { const m = $('#offFileMsg'); if (m) { m.textContent = t; m.style.display = 'block'; } }
  function saveFile(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    fileMsg('حُفظ الملف في مجلد التنزيلات باسم ' + name + '. أرسله من مدير الملفات أو من أي تطبيق.');
  }
  function bindFile(kind, text) {
    const name = fileName(kind);
    $('#offSave').onclick = () => saveFile(name, text);
    const net = $('#offNet'); if (net) net.onclick = () => sendByCroc(name, text);
  }
  // v1.18.1: over the internet with croc (getcroc.com, croc's own web page): the file is saved, croc opens, the person
  // picks the file and gives the croc code phrase to whoever receives it. The file stays sealed: croc cannot read it.
  const NET_BUTTON = '';   // v1.19.1: part of WAYS below
  // v1.19.1: three clear choices instead of a QR and four buttons; the QR shows only when chosen
  const IC = {
    qr: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/></svg>',
    net: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>'
  };
  const WAYS = `<div class="ways">
      <button type="button" class="way" id="offWayQR">${IC.qr}<span>الإرسال عن قرب QR Code</span><small>وجهاً لوجه</small></button>
      <button type="button" class="way" id="offNet">${IC.net}<span>الإرسال عن بعد</span><small>بين مكانين بعيدين</small></button></div>
    <div id="offQRBox" style="display:none"><p style="margin:10px 0 4px">اترك الهاتف ثابتاً حتى يكتمل. الشاشة بأعلى إضاءة، ويقرّب الهاتف الآخر قليلاً.</p><div id="offQR"></div></div>
    <button type="button" class="lnk" id="offSave">أو تنزيل الملف</button><div id="offFileMsg" class="note" style="display:none"></div>`;
  function bindWays(kind, text) {
    bindFile(kind, text);
    let started = false;
    $('#offWayQR').onclick = () => {
      const box = $('#offQRBox'), on = box.style.display === 'none';
      box.style.display = on ? 'block' : 'none'; $('#offWayQR').classList.toggle('on', on);
      if (on && !started) { started = true; widgets.push(QRUI.player($('#offQR'), text, { chunk: 240, fps: 4, sizes: true })); }
    };
  }
  // v1.22.7: sending from afar, guided: 1 the file is ready, 2 the sending page, 3 the words it shows (v1.22.8: no messaging app named)
  const CROC = 'https://getcroc.com/';
  const stepCss = 'display:flex;gap:10px;align-items:flex-start;margin:10px 0';
  const stepN = (n, on) => '<span style="flex:0 0 26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;' + (on ? 'background:#047857;color:#fff' : 'background:#e2e8f0;color:#475569') + '">' + n + '</span>';
  const wordsOf = (v) => { const m = String(v || '').trim().match(/[A-Za-z0-9]+(?:-[A-Za-z0-9]+){2,}/); return m ? m[0].toLowerCase() : ''; };   // v1.22.8: word-word-word
  function sendByCroc(name, text) {
    saveFile(name, text);
    show(`<button class="x" id="offX">×</button><h2>إرسال عن بعد</h2>
      <div style="${stepCss}">${stepN('✓', true)}<div><b>الملف جاهز</b><div style="font-size:12px;color:#64748b">حُفظ في التنزيلات: <span dir="ltr">${esc(name)}</span></div></div></div>
      <div style="${stepCss}">${stepN(2, true)}<div style="flex:1"><b>افتح صفحة الإرسال</b><div style="font-size:12.5px;color:#475569;margin:2px 0 6px">اضغط <b dir="ltr">Send</b>، ثم اختر الملف الذي حُفظ للتو. اترك الصفحة مفتوحة حتى يستلمه.</div>
        <button class="ob" id="offCrocOpen" style="margin:0">فتح صفحة الإرسال</button></div></div>
      <div style="${stepCss}">${stepN(3, true)}<div style="flex:1"><b>أرسل الكلمات التي تظهر</b><div style="font-size:12.5px;color:#475569;margin:2px 0 6px">تظهر ثلاث كلمات مثل <span dir="ltr" style="font-weight:700">river-moon-apple</span>. أرسل هذه الكلمات للشخص الذي تريد إرسال الملف إليه، ليكتبها عنده في «استلام عن بعد».</div></div></div>
      <div id="offErr" class="err" style="display:none"></div>`);
    $('#offX').onclick = close;
    $('#offCrocOpen').onclick = () => { try { window.open(CROC, '_blank', 'noopener'); } catch (e) { /* none */ } };
  }
  // and receiving from afar: 1 the words received, 2 the receiving page, 3 the file it downloaded
  function crocReceive(done) {
    stopWidgets();
    show(`<button class="x" id="offX">×</button><h2>استلام عن بعد</h2>
      <div style="${stepCss}">${stepN(1, true)}<div style="flex:1"><b>الكلمات التي وصلتك</b><div style="font-size:12.5px;color:#475569;margin:2px 0 6px">الكلمات التي أرسلها لك الشخص، اكتبها أو الصقها هنا:</div>
        <input id="offCrocWords" dir="ltr" placeholder="river-moon-apple" autocomplete="off" autocapitalize="off" spellcheck="false" style="width:100%;box-sizing:border-box;padding:10px 12px;border-radius:12px;border:1px solid #cbd5e1;font-size:15px">
        <button class="ob l" id="offCrocPaste" style="margin:6px 0 0">لصق</button></div></div>
      <div style="${stepCss}">${stepN(2, true)}<div style="flex:1"><b>افتح صفحة الاستلام</b><div style="font-size:12.5px;color:#475569;margin:2px 0 6px">اضغط <b dir="ltr">Receive</b>، والصق الكلمات (نُسخت لك)، ثم نزّل الملف.</div>
        <button class="ob" id="offCrocOpen" style="margin:0">فتح صفحة الاستلام</button></div></div>
      <div style="${stepCss}">${stepN(3, true)}<div style="flex:1"><b>افتح الملف هنا</b><div style="font-size:12.5px;color:#475569;margin:2px 0 6px">اختر الملف الذي نزّلته (يبدأ بـ <span dir="ltr">wasl</span>).</div>
        <button class="ob" id="offCrocFile" style="margin:0">اختيار الملف</button></div></div>
      <div id="offErr" class="err" style="display:none"></div>`);
    $('#offX').onclick = close;
    const inp = $('#offCrocWords');
    $('#offCrocPaste').onclick = async () => { try { inp.value = wordsOf(await navigator.clipboard.readText()) || ''; } catch (e) { inp.focus(); errBox('اضغط مطوّلاً على الخانة ثم «لصق».'); } };
    $('#offCrocOpen').onclick = async () => {
      const w = wordsOf(inp.value);
      if (w) { try { await navigator.clipboard.writeText(w); } catch (e) { /* typed by hand then */ } }
      try { window.open(CROC, '_blank', 'noopener'); } catch (e) { /* none */ }
    };
    $('#offCrocFile').onclick = () => fileInput(done);
  }
  function fileInput(onText) {
    const i = document.createElement('input'); i.type = 'file';
    i.onchange = () => { const f = i.files && i.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => onText(String(r.result).trim()); r.readAsText(f); };
    i.click();
  }
  const MSG = {
    WEAK: 'الرمز ضعيف: 8 أرقام على الأقل، أو كلمة مرور من 10 أحرف فأكثر.', BAD_SECRET: 'الرمز غير صحيح.', LOCKED: 'تم تعليق الدخول مؤقتاً بسبب محاولات خاطئة متكررة.',
    SEAL: 'هذا الرمز أو الملف ليس لهذا الهاتف.', SIGNATURE: 'هذا الرمز أو الملف غير صالح لهذا الهاتف.', MISMATCH: 'هذا الرمز أو الملف لا يخص هذا الهاتف أو هذه المزامنة.',
    OLD: 'هذا الرمز أو الملف قديم.', FORMAT: 'هذا ليس رمزاً ولا ملفاً من تطبيق وصل.', VERSION: 'صيغة أحدث من التطبيق: حدّث التطبيق عند توفر الإنترنت.', BAD_INPUT: 'هذا ليس الرمز أو الملف المنتظر.', MISMATCH_OWN: 'هذا الرمز أو الملف صادر عن هاتفك أنت.', OLD_STATION: 'هذا الرد من محطة لم تعد مستعملة: زامن مع المحطة الحالية.', WIPED: 'مُسحت بيانات الهاتف بعد محاولات خاطئة كثيرة.'
  };
  const msgOf = (e) => MSG[e.code] || e.message;

  // ---------------------------------------------------------------- enrollment
  async function onboarding(st) {
    if (st.state === 'joining') {
      show(`<h2>متابعة التسجيل</h2><p>أدخل الرمز السري الذي اخترته لهذا الهاتف.</p><label>الرمز السري</label><input id="offPin" type="text" class="pinf" dir="ltr" autocomplete="off" autocapitalize="off" spellcheck="false" autocomplete="current-password">
        <div id="offErr" class="err" style="display:none"></div><button class="ob" id="offGo">متابعة</button><button class="ob r" id="offRestart">البدء من جديد</button>`);
      $('#offGo').onclick = async () => { try { await rpc('unlock', $('#offPin').value); showJoin(await rpc('joinText')); } catch (e) { errBox(msgOf(e)); } };
      $('#offRestart').onclick = async () => { if (confirm('حذف ما بدأته والبدء من جديد؟')) { await rpc('wipe'); onboarding({ state: 'new' }); } };
      return;
    }
    show(`<h2>تسجيل هذا الهاتف</h2>
      ${standalone() ? '' : '<div class="warn" id="offInstall"><b>ثبّت التطبيق أولاً</b>، ثم افتحه من أيقونته على الشاشة الرئيسية، لا من المتصفح.<a class="ob" id="offApk" href="./wasl.apk" download="wasl.apk" style="display:none;text-align:center;text-decoration:none;margin:10px 0 6px">تحميل التطبيق (APK)</a><div id="offApkOr" style="display:none">أو من قائمة المتصفح ⋮ ثم «تثبيت التطبيق».</div></div>'}
      <label>اسم المستخدم</label><input id="offLabel" maxlength="40">
      <label>الرمز السري للتطبيق</label><input id="offP1" type="text" class="pinf" dir="ltr" autocomplete="off" autocapitalize="off" spellcheck="false">
      <div class="hint" id="offP1Hint">${PIN_RULE}</div>
      <label>أعد كتابة الرمز</label><input id="offP2" type="text" class="pinf" dir="ltr" autocomplete="off" autocapitalize="off" spellcheck="false">
      <div class="hint" id="offP2Hint"></div>
      <div id="offErr" class="err" style="display:none"></div><button class="ob" id="offGo">متابعة</button>`);
    if (!standalone()) fetch('./wasl.apk', { method: 'HEAD', cache: 'no-store' }).then((r) => { if (r.ok && $('#offApk')) { $('#offApk').style.display = 'block'; $('#offApkOr').style.display = 'block'; } }).catch(() => {});
    pinChecks('offP1', 'offP2', false);
    $('#offGo').onclick = async () => {
      const a = $('#offP1').value, b = $('#offP2').value;
      if (a !== b) return errBox('الرمزان غير متطابقين.');
      if (!$('#offLabel').value.trim()) return errBox('اكتب اسم المستخدم.');
      $('#offGo').disabled = true;
      try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { /* not available */ }
      try { try { localStorage.setItem('offPinKind', /^\d+$/.test(a) ? 'digits' : 'text'); } catch (e) { /* none */ } showJoin(await rpc('join', $('#offLabel').value.trim(), a)); }
      catch (e) { errBox(msgOf(e)); $('#offGo').disabled = false; }
    };
  }
  // ---- PIN rules shown while typing (the phone checks them again when saving)
  const PIN_RULE = '8 أرقام على الأقل، أو كلمة سر من 10 أحرف فأكثر.';
  const PIN_RULE_STRONG = '12 حرفاً على الأقل، فيها حروف.';
  const pinOk = (v, strong) => (strong ? v.length >= 12 && /[^0-9]/.test(v) : /^\d{8,}$/.test(v) || (v.length >= 10 && /[^0-9]/.test(v)));
  function pinChecks(a, b, strong) {
    const A = $('#' + a), B = $('#' + b), hA = $('#' + a + 'Hint'), hB = $('#' + b + 'Hint');
    const rule = strong ? PIN_RULE_STRONG : PIN_RULE;
    const upd = () => {
      if (hA) { const ok = pinOk(A.value, strong); hA.className = 'hint' + (A.value ? (ok ? ' ok' : '') : ''); hA.textContent = ok ? '✓ ' + rule : rule; }
      if (hB) {
        if (!B.value) { hB.className = 'hint'; hB.textContent = ''; }
        else if (B.value === A.value) { hB.className = 'hint ok'; hB.textContent = '✓ الرمزان متطابقان'; }
        else { hB.className = 'hint bad'; hB.textContent = '✗ الرمزان غير متطابقين'; }
      }
    };
    A.addEventListener('input', upd); B.addEventListener('input', upd); upd();
  }
  function showJoin(joinText) {
    show(`<h2>1 — اعرض الرمز على الكاميرا</h2><div id="offQR"></div>
      <button class="ob" id="offNext">التالي: امسح الرمز</button>${FILE_BUTTONS}`);
    QRUI.still($('#offQR'), joinText);
    bindFile('join', joinText);
    $('#offNext').onclick = scanEnroll;
  }
  function scanEnroll() {
    show(`<h2>2 — امسح الرمز</h2><p>وجّه الكاميرا نحو الرمز حتى يكتمل الشريط.</p><div id="offScan"></div>
      <div id="offErr" class="err" style="display:none"></div><button class="ob l" id="offFile">قراءة ملف بدلاً من ذلك</button><button class="ob l" id="offBack">رجوع</button>`);
    const done = async (text) => {
      try {
        const r = await rpc('enroll', text);
        show(`<h2>3 — تحقق من رقم المطابقة</h2><p>هل يظهر الرقم نفسه على الشاشة الأخرى؟</p><div class="code">${esc(r.code)}</div>
          <p>هذا الهاتف لـ <b>${esc(r.profile.name)}</b>.</p>
          <button class="ob" id="offYes">نعم، الرقم مطابق</button><button class="ob r" id="offNo">لا، الرقم مختلف</button>`);
        $('#offYes').onclick = () => (r.mustUpgradeSecret ? changeSecret(true) : finishEnroll());
        $('#offNo').onclick = async () => { await rpc('wipe'); alert('أُلغي التسجيل.'); onboarding({ state: 'new' }); };
      } catch (e) { errBox(msgOf(e)); setTimeout(scanEnroll, 2500); }
    };
    widgets.push(QRUI.scanner($('#offScan'), done, { allowSingle: false }));
    $('#offFile').onclick = () => fileInput(done);
    $('#offBack').onclick = async () => showJoin(await rpc('joinText'));
  }
  function finishEnroll() { close(); location.reload(); }

  function changeSecret(forced) {
    show(`${forced ? '' : '<button class="x" id="offX">×</button>'}<h2>${forced ? 'اختر كلمة مرور أقوى' : 'تغيير الرمز السري'}</h2>
      <label>الرمز الحالي</label><input id="offOld" type="text" class="pinf" dir="ltr" autocomplete="off" autocapitalize="off" spellcheck="false">
      <label>الرمز الجديد</label><input id="offN1" type="text" class="pinf" dir="ltr" autocomplete="off" autocapitalize="off" spellcheck="false">
      <div class="hint" id="offN1Hint"></div>
      <label>أعد كتابته</label><input id="offN2" type="text" class="pinf" dir="ltr" autocomplete="off" autocapitalize="off" spellcheck="false">
      <div class="hint" id="offN2Hint"></div>
      <div id="offErr" class="err" style="display:none"></div><button class="ob" id="offGo">حفظ</button>`);
    if (!forced) $('#offX').onclick = close;
    if (forced) pinChecks('offN1', 'offN2', true);
    else rpc('details').then((d) => { const strong = /^T[345]$/.test((d && d.eduTier) || '') || /^A[34]$/.test((d && d.tier) || ''); pinChecks('offN1', 'offN2', strong); }).catch(() => pinChecks('offN1', 'offN2', false));
    $('#offGo').onclick = async () => {
      if ($('#offN1').value !== $('#offN2').value) return errBox('الرمزان غير متطابقين.');
      try {
        await rpc('changeSecret', $('#offOld').value, $('#offN1').value);
        try { localStorage.setItem('offPinKind', /^\d+$/.test($('#offN1').value) ? 'digits' : 'text'); } catch (e) { /* none */ }
        if (forced) finishEnroll(); else { close(); if (typeof showToast === 'function') showToast('تم تغيير الرمز', 'success'); }
      } catch (e) { errBox(e.code === 'WEAK' ? e.message.replace('Your role needs a passphrase of at least 12 characters, with letters', 'كلمة المرور: 12 حرفاً على الأقل، فيها حروف.').replace('Use at least 8 digits, or a passphrase of 10 characters or more', MSG.WEAK) : msgOf(e)); }
    };
  }

  // ---------------------------------------------------------------- sync
  const REASONS = { 'action not allowed': 'عملية غير مسموحة', 'bad payload': 'بيانات غير صالحة', 'refused after review': 'رفضتها الإدارة بعد المراجعة' };
  const ACTIONS = { actClassAbsNote: 'سبب انقطاع', undoAdd: 'إزالة إضافة خاطئة', saveAttendance: 'تسجيل حضور', addStudent: 'إضافة طالب', updateStudent: 'تحيين طالب', createCourse: 'فتح درس', updateCourse: 'تعديل درس', updateCourseBook: 'تغيير الكتاب', moveStudent: 'نقل طالب', requestDeletion: 'طلب إزالة', suggestNameChange: 'اقتراح اسم', markNoSession: 'درس لم ينعقد', clearNoSession: 'إلغاء «لم ينعقد»', markFeedSeen: 'قراءة التنبيهات', createRequest: 'طلب درس', assignRequest: 'إسناد طلب', setRequestStatus: 'حالة طلب', addRequestNote: 'ملاحظة', placeRequest: 'إدماج طلب', logFollowUp: 'متابعة', requestDetails: 'طلب تفاصيل', spotDecision: 'اعتماد فوري', evCreate: 'مناسبة جديدة', evMark: 'تسجيل في مناسبة', evNew: 'شخص جديد في مناسبة', evGuests: 'عدد الضيوف' };
  async function openSync() {
    let info, st;
    try { info = await rpc('info'); st = await rpc('status'); } catch (e) { return; }
    const last = st.lastSync;
    show(`<button class="x" id="offX">×</button><h2>المزامنة</h2>
      <p>تحيينات لم تُرسل بعد: <b>${info.pending.length}</b>${last ? '<br>' + (Math.floor((Date.now() - new Date(last).getTime()) / 86400e3) <= 0 ? 'تمّ التحيين اليوم' : 'لم يتم التحيين منذ ' + dayWord(Math.floor((Date.now() - new Date(last).getTime()) / 86400e3))) : ''}</p>
      ${st.inTransit ? '<div class="note">تحييناتك مع <b>' + esc(st.inTransit.by) + '</b>.</div>' : ''}
      <button class="ob" id="offSend">📤 إرسال</button>
      <button class="ob" id="offRead">📥 استلام</button>
      <button class="ob l" id="offCarried" style="display:none"></button>
      <button class="ob l" id="offDetails" style="display:none"></button>`);
    $('#offX').onclick = close;
    rpc('carriedReplies').then((cr) => { const b = $('#offCarried'); if (!b || !cr || !cr.people.length) return; const n = cr.people.filter((p) => p.pending).length;
      b.textContent = '📬 تسليم ما جاء لزملائي' + (n ? ' (' + n + ')' : ''); b.style.display = 'block'; if (n) { b.style.background = '#fef3c7'; b.style.color = '#92400e'; } b.onclick = openCarried; }).catch(() => {});
    // T4: a course's member list for 14 days; A3 / A4: the programs summary and lists for 14 days
    rpc('details').then((d) => { if (d && (d.canCourse || d.canClass || d.prog)) { const b = $('#offDetails'); if (b) { b.textContent = detailsTitle(d); b.style.display = 'block'; b.onclick = openDetails; } } }).catch(() => {});
    $('#offSend').onclick = async () => {
      try {
        const b = await rpc('makeBundle');
        show(`<button class="x" id="offX">×</button><h2>إرسال تحييناتك</h2><p>اختر طريقة الإرسال:</p>${WAYS}
          <button class="ob" id="offRead">التالي: استلام</button>`);
        $('#offX').onclick = close;
        bindWays('send', b.text);
        $('#offRead').onclick = receive;
      } catch (e) { alert(msgOf(e)); }
    };
    $('#offRead').onclick = receive;
  }
  // ---------------------------------------------------------------- programs summary & details on request
  const pct = (v) => (v === null || v === undefined ? '—' : Math.round(v) + '٪');
  const small = (n) => (n === null || n === undefined || n > 30 ? '—' : n);
  const KIND = { course: 'الدرس ', class: 'الصف ', pub: 'الدرس العام ', area: 'القائمة الكاملة لأفراد الصفوف التي تحت إشرافك' };
  const dayOf = (iso) => esc(String(iso || '').slice(0, 10));
  async function openDetails() {
    let d; try { d = await rpc('details'); } catch (e) { return; }
    const p = d.prog;
    const classes = p ? p.classes : [];
    show(`<button class="x" id="offX">×</button><h2>${detailsTitle(d)}</h2>
      ${p ? `<p>من ${dayOf(p.from)} إلى ${dayOf(p.to)}.</p>
        <div style="overflow:auto"><table style="width:100%;font-size:12px;border-collapse:collapse" id="offProg"><tr style="background:#eef2f0"><th style="padding:6px;text-align:right">الصف</th><th>الأعضاء</th><th>الحضور</th><th>قبلها</th><th>الدرس العام</th><th>صرّحوا بمساهمة</th><th>دفعوا</th></tr>
        ${classes.map((c) => `<tr style="border-top:1px solid #e2e8f0"><td style="padding:6px">${esc(c.label)}${c.branch ? '<br><small style="color:#64748b">' + esc(c.branch) + '</small>' : ''}</td><td style="text-align:center">${small(c.members)}</td><td style="text-align:center">${pct(c.att)}</td><td style="text-align:center;color:#64748b">${pct(c.attPrev)}</td><td style="text-align:center">${pct(c.pub)}</td><td style="text-align:center">${pct(c.declared)}</td><td style="text-align:center">${pct(c.paid)}</td></tr>`).join('')}</table></div>
        ${p.councils && p.councils.length ? '<p>مجالس الذكر (30 يوماً): ' + p.councils.map((m) => esc(m.branch) + ' ' + pct(m.done)).join(' — ') + '</p>' : ''}
        <p style="font-size:11.5px;color:#64748b">يُحدَّث الملخص مع كل أخذ للتحيينات.</p>` : ''}
      ${d.grants.length ? '<h2 style="font-size:14px;margin-top:14px">تفاصيل على هاتفك الآن</h2><ul>' + d.grants.map((g) => '<li>' + KIND[g.kind] + esc(g.kind === 'class' ? labelOf(classes, g.ref) : g.kind === 'area' ? '' : g.kind === 'course' ? courseName(d, g.ref) : g.ref) + (g.members !== null && g.members !== undefined ? ' (' + g.members + ' عضواً)' : '') + ' — تُمحى تلقائياً يوم ' + dayOf(g.until) + (g.kind === 'pub' ? '<br><small>سجّل الحضور من «الدرس العام» في قسم البرامج.</small>' : '') + (g.kind !== 'pub' && g.kind !== 'area' && g.people && g.people.length ? '<details><summary style="cursor:pointer;color:#1e382b;font-weight:800">عرض الأسماء</summary><ul style="margin:4px 0">' + g.people.map((x) => '<li>' + esc(x.name) + (x.level ? ' — م' + esc(x.level) : '') + (x.city ? ' — ' + esc(x.city) : '') + (x.phone ? ' — <a dir="ltr" href="tel:' + esc(x.phone) + '">' + esc(x.phone) + '</a>' : '') + '</li>').join('') + '</ul></details>' : '') + '</li>').join('') + '</ul>' : ''}
      ${d.asked.length ? '<div class="note">طلبات تُرسل مع التحيينات القادمة: ' + d.asked.map((a) => KIND[a.kind] + esc(a.kind === 'class' ? labelOf(classes, a.ref) : a.kind === 'course' ? courseName(d, a.ref) : a.ref)).join('، ') + '</div>' : ''}
      ${d.canCourse ? `<h2 style="font-size:14px;margin-top:14px">طلب قائمة أعضاء درس</h2><p>ابحث باسم المدرس أو الكتاب أو المقر، ثم اختر الدرس. تصل القائمة مع أخذ التحيينات، وتبقى على هاتفك المدة التي تختارها.</p>${daysPicker('offDaysC')}
        ${d.courseDir.length ? `<input id="offCourseQ" placeholder="ابحث: مدرس، كتاب، مقر، يوم…" autocomplete="off"><div id="offCourseList" style="max-height:300px;overflow:auto;margin-top:8px"></div>`
          : '<div class="note">تصل قائمة الدروس مع أخذ التحيينات القادم.</div>'}` : ''}
      ${d.canClass && classes.length ? `<h2 style="font-size:14px;margin-top:14px">طلب قائمة أعضاء صف</h2><p>تصل القائمة مع أخذ التحيينات، وتبقى على هاتفك المدة التي تختارها.</p>
        <select id="offClass" style="width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:14px;font-size:14px">${classes.map((c) => '<option value="' + esc(c.key) + '">' + esc(c.label) + (c.branch ? ' — ' + esc(c.branch) : '') + '</option>').join('')}</select>
        ${daysPicker('offDaysK')}<button class="ob" id="offAskClass">طلب القائمة</button>` : ''}
      ${d.canPub && d.pubLessons.length ? `<h2 style="font-size:14px;margin-top:14px">درس عام أسجّل حضوره بالأسماء</h2><p>يصل الدرس وحصصه الأخيرة ومن حضرها، للمدة التي تختارها. من لا يوجد على هاتفك يُضاف برقم هاتفه.</p>
        <select id="offPub" style="width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:14px;font-size:14px">${d.pubLessons.map((l) => '<option value="' + esc(l.code) + '">' + esc(l.code) + ' — ' + esc(l.venue) + (l.day ? ' — ' + esc(l.day) : '') + '</option>').join('')}</select>
        ${daysPicker('offDaysP')}<button class="ob" id="offAskPub">طلب الدرس</button>` : ''}
      <div id="offErr" class="err" style="display:none"></div>`);
    $('#offX').onclick = close;
    const ask = async (kind, ref, days) => {
      const r = await LocalBackend.call({ action: 'requestDetails', kind, ref, days });
      if (r && r.success) { updateBadge(); openDetails(); setTimeout(() => { const n = document.createElement('div'); n.className = 'note'; n.textContent = r.message; const c = $('#offLayer .oc'); if (c) c.insertBefore(n, c.children[2] || null); }, 50); }
      else errBox((r && r.error) || 'تعذّر الطلب');
    };
    if ($('#offCourseList')) {
      const dir = d.courseDir, asked = new Set(d.asked.filter((a) => a.kind === 'course').map((a) => a.ref)), held = new Set(d.grants.filter((g) => g.kind === 'course').map((g) => g.ref));
      const norm = (t) => String(t || '').replace(/[\u064B-\u0652\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').toLowerCase();
      const draw = () => {
        const q = norm($('#offCourseQ').value).split(/\s+/).filter(Boolean);
        const hits = dir.filter((c) => { const t = norm([c.teacher, c.book, c.venue, c.day, c.time].join(' ')); return q.every((w) => t.indexOf(w) !== -1); });
        $('#offCourseList').innerHTML = hits.slice(0, 40).map((c) => {
          const state = held.has(c.code) ? 'على هاتفك' : asked.has(c.code) ? 'مطلوب' : '';
          return `<button type="button" class="ob l" data-code="${esc(c.code)}" ${state ? 'disabled' : ''} style="text-align:right;margin:0 0 6px;padding:10px 12px;font-weight:600;line-height:1.6">
            <b>${esc(c.book || 'درس')}</b> — ${esc(c.teacher)}<br><small style="color:#64748b">${esc([c.day, c.time].filter(Boolean).join(' '))}${c.venue ? ' — ' + esc(c.venue) : ''}${state ? ' — ' + state : ''}</small></button>`;
        }).join('') + (hits.length > 40 ? '<div class="note">' + hits.length + ' درساً: اكتب كلمة أخرى لتضييق البحث.</div>' : '') + (!hits.length ? '<div class="note">لا درس يطابق البحث.</div>' : '');
        $('#offCourseList').querySelectorAll('button[data-code]').forEach((b) => { b.onclick = () => { const c = dir.find((x) => x.code === b.dataset.code); if (confirm('طلب قائمة أعضاء: ' + (c.book || '') + ' — ' + c.teacher + '؟')) ask('course', c.code, daysOf('offDaysC')); }; });
      };
      $('#offCourseQ').oninput = draw; draw();
    }
    if ($('#offAskClass')) $('#offAskClass').onclick = () => ask('class', $('#offClass').value, daysOf('offDaysK'));
    if ($('#offAskPub')) $('#offAskPub').onclick = () => ask('pub', $('#offPub').value, daysOf('offDaysP'));
    bindDays();
  }
  // how long the details stay on the phone: 7, 14 or 30 days (v1.15)
  function daysPicker(id) {
    return `<div class="offDays" id="${id}" data-v="14" style="display:flex;gap:6px;align-items:center;margin:8px 0;font-size:13px;font-weight:700"><span>المدة:</span>${[7, 14, 30].map((n) => '<button type="button" data-d="' + n + '" style="flex:1;padding:8px 0;border-radius:12px;border:1px solid ' + (n === 14 ? '#1e382b;background:#1e382b;color:#fff' : '#cbd5e1;background:#fff;color:#334155') + ';font:800 13px Tajawal,sans-serif;cursor:pointer">' + n + ' يوماً</button>').join('')}</div>`;
  }
  function bindDays(root) {
    (root || document).querySelectorAll('.offDays').forEach((box) => box.querySelectorAll('button[data-d]').forEach((b) => {
      b.onclick = () => { box.dataset.v = b.dataset.d; box.querySelectorAll('button[data-d]').forEach((x) => { const on = x === b; x.style.background = on ? '#1e382b' : '#fff'; x.style.color = on ? '#fff' : '#334155'; x.style.borderColor = on ? '#1e382b' : '#cbd5e1'; }); };
    }));
  }
  function daysOf(id) { const b = document.getElementById(id); return b ? Number(b.dataset.v) || 14 : 14; }

  // A4 (v1.15): where the programs screen shows a class with nobody on the phone, ask for it right there
  let a4Det = null;
  function hookA4Members() {
    if (AS || typeof renderActMembers !== 'function' || renderActMembers.__a4) return;
    const orig = renderActMembers;
    window.renderActMembers = function () { const r = orig.apply(this, arguments); a4MembersCard(); return r; };
    window.renderActMembers.__a4 = true;
  }
  async function a4MembersCard() {
    const AS0 = typeof AppState !== 'undefined' ? AppState : null;     // a top-level const of the app page (not on window)
    const A = AS0 && AS0.act, st = AS0 && AS0.actState;
    if (!A || A.tier !== 'A4' || !st) return;
    try { a4Det = await rpc('details'); } catch (e) { return; }
    const d = a4Det; if (!d || d.admin || !d.canClass) return;
    const box = document.getElementById('actMembers'); if (!box) return;
    const key = st.classKey;
    const n = key === '' ? A.members.length : (typeof actMembersOf === 'function' ? actMembersOf(key).length : 0);
    const old = document.getElementById('offA4Ask'); if (old) old.remove();
    const cls = (A.classes || []).find((c) => c.key === key);
    const label = cls ? (typeof actClassLabel === 'function' ? actClassLabel(cls) : cls.name) : '';
    const held = d.grants.filter((g) => g.kind === 'class' && g.ref === key).sort((a, b) => (a.until < b.until ? 1 : -1))[0];
    const asked = d.asked.find((a) => a.kind === 'class' && a.ref === key);
    const p = d.prog && d.prog.classes ? d.prog.classes.find((c) => c.key === key) : null;
    const card = document.createElement('div'); card.id = 'offA4Ask';
    card.style.cssText = 'background:#f8fafc;border:1px solid #cbd5e1;border-radius:16px;padding:12px;margin:0 0 10px;font-size:13px;line-height:1.7;text-align:right';
    if (key === '' || key === '__none') {
      if (n) return;
      card.innerHTML = '<b>لا أحد على هاتفك بعد.</b><br>اختر صفاً من القائمة أعلاه، ثم اطلب بياناته من المحطة.';
    } else if (held) {
      card.innerHTML = '<b>' + esc(label) + '</b> على هاتفك حتى ' + dayOf(held.until) + ' (' + n + ' فرداً)، ثم تُمحى تلقائياً.' + (asked ? '<br>تمديد مطلوب لـ ' + asked.days + ' يوماً: يصل مع المزامنة القادمة.' : '<br><button type="button" id="offA4More" style="margin-top:6px;border:0;background:none;color:#1e382b;font:800 13px Tajawal,sans-serif;text-decoration:underline;cursor:pointer">تمديد المدة</button>');
      a4Place(card, box);
      const more = document.getElementById('offA4More');
      if (more) more.onclick = () => { card.innerHTML = '<b>تمديد ' + esc(label) + '</b>' + daysPicker('offA4Days') + '<button type="button" class="offA4Go" id="offA4Go">طلب التمديد</button>'; a4Bind(card, key); };
      return;
    } else if (n && p && p.members !== null && p.members !== undefined && n >= p.members) return;   // the whole class is here
    else if (asked) {
      card.innerHTML = '<b>' + esc(label) + '</b>: الطلب مسجّل لـ ' + asked.days + ' يوماً.<br>يصل مع المزامنة القادمة.<button type="button" class="offA4Go" id="offA4Sync">المزامنة الآن</button>';
    } else {
      const there = p ? '<br><small style="color:#64748b">في المحطة: ' + (p.members === null || p.members === undefined ? 'أكثر من 30' : p.members) + ' فرداً · الحضور ' + pct(p.att) + '</small>' : '';
      card.innerHTML = (n ? '<b>على هاتفك ' + n + ' فقط من ' + esc(label) + '.</b>' : '<b>بيانات ' + esc(label) + ' ليست على هاتفك.</b>') + there +
        '<br>اطلب الصف كاملاً لمتابعته: يصل مع المزامنة القادمة، ويُمحى من هاتفك بعد المدة.' + daysPicker('offA4Days') + '<button type="button" class="offA4Go" id="offA4Go">طلب بيانات الصف</button><div id="offA4Err" style="color:#b91c1c;display:none"></div>';
    }
    if (!n) box.innerHTML = '';
    a4Place(card, box);
    a4Bind(card, key);
  }
  // right under the class picker, where the count is read (else above the list)
  function a4Place(card, box) {
    const pick = document.getElementById('actClassList');
    if (pick && pick.parentNode) { card.style.marginTop = '10px'; pick.parentNode.insertBefore(card, pick.nextSibling); }
    else box.parentNode.insertBefore(card, box);
  }
  function a4Bind(card, key) {
    card.querySelectorAll('.offA4Go').forEach((b) => { b.style.cssText = 'display:block;width:100%;margin-top:8px;padding:11px;border:0;border-radius:14px;background:#1e382b;color:#fff;font:800 14px Tajawal,sans-serif;cursor:pointer'; });
    bindDays(card);
    const go = document.getElementById('offA4Go');
    if (go) go.onclick = async () => {
      go.disabled = true;
      const r = await LocalBackend.call({ action: 'requestDetails', kind: 'class', ref: key, days: daysOf('offA4Days') });
      if (r && r.success) { updateBadge(); a4MembersCard(); }
      else { go.disabled = false; const e = document.getElementById('offA4Err'); if (e) { e.textContent = (r && r.error) || 'تعذّر الطلب'; e.style.display = 'block'; } }
    };
    const sy = document.getElementById('offA4Sync'); if (sy) sy.onclick = openSync;
  }
  function detailsTitle(d) { return d.prog ? 'ملخص البرامج' : 'طلب قائمة أعضاء درس'; }
  function courseName(d, code) { const c = (d.courseDir || []).find((x) => x.code === code); return c ? (c.book || 'درس') + ' — ' + c.teacher : code; }
  function labelOf(classes, key) { const c = (classes || []).find((x) => x.key === key); return c ? c.label : key; }

  // v1.17.4: the collection round: who I collected from, and when each one last reached the station
  function collectedLog() { try { return JSON.parse(localStorage.getItem('offCollected') || '{}') || {}; } catch (e) { return {}; } }
  function noteCollected(name) { const l = collectedLog(); l[name] = new Date().toISOString().slice(0, 10); try { localStorage.setItem('offCollected', JSON.stringify(l)); } catch (e) { /* none */ } }
  function teamListHtml() {
    const A = typeof AppState !== 'undefined' && AppState.anomalies, ppl = (A && A.people) || [];
    if (!ppl.length) return '';
    const mine = collectedLog(), today = Date.now();
    const age = (d) => d ? Math.floor((today - new Date(d).getTime()) / 86400e3) : null;
    return '<details class="team" style="margin-top:12px"><summary style="font-weight:800;font-size:13px;cursor:pointer">فريقي (' + ppl.length + ')</summary><div style="margin-top:8px">' +
      ppl.map((p) => { const a = age(p.last), col = a === null || a >= 31 ? '#991b1b' : a >= 8 ? '#92400e' : '#166534';
        return '<div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;padding:6px 0;border-bottom:1px solid #f1f5f9"><b>' + esc(p.name) + '</b><span style="color:' + col + '">' +
          (a === null ? 'لم يسجّل هاتفه' : a === 0 ? 'تمّ التحيين اليوم' : 'لم يتم التحيين منذ ' + dayWord(a)) + (mine[p.name] ? ' · استلمتُ منه ' + esc(mine[p.name].slice(5)) : '') + '</span></div>'; }).join('') + '</div></details>';
  }
  // v1.18.1: «ردود أحملها»: the people I collected from, and whether the station's reply is waiting to be handed back
  async function openCarried() {
    let cr; try { cr = await rpc('carriedReplies'); } catch (e) { return alert(msgOf(e)); }
    const d = (t) => t ? new Date(t).toISOString().slice(0, 10) : '—';
    const row = (p) => '<div style="padding:10px 0;border-bottom:1px solid #f1f5f9"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><div><b>' + esc(p.name || 'هاتف') + '</b><div style="font-size:12px;color:' + (p.pending ? '#92400e' : '#64748b') + '">' +
      (p.pending ? 'وصله جديد، وينتظر أن تسلّمه إياه' : p.replies ? 'سلّمتَه يوم ' + d(p.delivered) : 'لم يصله جديد بعد. يظهر هنا بعد مزامنتك') + '</div></div>' +
      (p.replies ? '<button class="ob' + (p.pending ? '' : ' l') + '" style="width:auto;margin:0;padding:9px 14px" data-dev="' + esc(p.device) + '" data-name="' + esc(p.name) + '">' + (p.pending ? 'سلّمه الآن' : 'سلّمه مرة أخرى') + '</button>' : '') + '</div></div>';
    const pend = cr.people.filter((p) => p.pending), rest = cr.people.filter((p) => !p.pending);
    show(`<button class="x" id="offX">×</button><h2>تسليم ما جاء لزملائي</h2>
      <p>أخذتَ ملفات من زملاء لا يصلهم الإنترنت. عندما يصلهم جديد، تسلّمه لهم هنا.</p>
      ${pend.length ? '<h2 style="font-size:14px;margin-top:12px">ينتظرون منك (' + pend.length + ')</h2>' + pend.map(row).join('') : '<div class="note">لا شيء تسلّمه الآن.</div>'}
      ${rest.length ? '<h2 style="font-size:14px;margin-top:12px">الآخرون</h2>' + rest.map(row).join('') : ''}
      <button class="ob l" id="offBack">رجوع</button>`);
    $('#offX').onclick = close; $('#offBack').onclick = openSync;
    document.querySelectorAll('#offLayer [data-dev]').forEach((b) => { b.onclick = () => handReply(b.dataset.dev, b.dataset.name); });
  }
  async function handReply(dev, name) {
    try {
      const back = await rpc('packFor', dev, []);
      show(`<button class="x" id="offX">×</button><h2>تسليم ${esc(name)}</h2>
        <ol style="margin:0 0 8px;padding-inline-start:20px;line-height:1.9;font-size:14px"><li>${esc(name)} يفتح تطبيقه ويضغط «📥 استلام».</li><li>أنت تختار هنا الطريقة، وتظهر لك الشاشة.</li><li>${esc(name)} يوجّه كاميرته نحو الرمز (أو يقرأ الملف).</li></ol>
        ${WAYS}<button class="ob" id="offOk">تمّ</button>`);
      $('#offX').onclick = close; $('#offOk').onclick = openCarried;
      bindWays('reply', back.text);
    } catch (e) { alert(msgOf(e)); }
  }
  // v1.26.0: ONE «استلام» screen. The phone reads the code and knows by itself whether it is someone's updates to carry
  // (collect) or a reply for me (apply): nobody has to choose between two almost identical buttons.
  function receive() {
    show(`<button class="x" id="offX">×</button><h2>استلام</h2><p>وجّه الكاميرا نحو الرمز الظاهر على الهاتف الآخر. إن أرسله لك من بعيد، اختر «استلام عن بعد».</p><div id="offScan"></div>
      <div id="offErr" class="err" style="display:none"></div><div class="row"><button class="ob l" id="offFile">قراءة ملف</button><button class="ob l" id="offNetRx">استلام عن بعد</button></div>${teamListHtml()}`);
    $('#offX').onclick = close;
    const done = async (text) => {
      if (window.Update && Update.looksLike(text)) return updateDone(text);   // v1.28.0: an update sent alone
      let kind;
      try { kind = (await rpc('classify', text)).kind; } catch (e) { errBox(msgOf(e)); return setTimeout(receive, 2500); }
      return kind === 'collect' ? collectDone(text) : replyDone(text);
    };
    widgets.push(QRUI.scanner($('#offScan'), done, { allowSingle: false }));
    $('#offFile').onclick = () => fileInput(done);
    $('#offNetRx').onclick = () => crocReceive(done);
  }
  async function collectDone(text) {
    try {
      const c = await rpc('collect', text);
      noteCollected(c.name);
      const back = await rpc('packFor', c.from, c.bundles);
      show(`<button class="x" id="offX">×</button><h2>استُلمت تحيينات ${esc(c.name)}</h2>
        <p>أعطِ ${esc(c.name)} ردّه: يضغط «استلام» ثم يمسح الرمز أو يقرأ الملف.</p>
        ${WAYS}<div class="row"><button class="ob" id="offNext">التالي: شخص آخر</button><button class="ob l" id="offOk">انتهيت</button></div>`);
      $('#offX').onclick = close; $('#offOk').onclick = openSync; $('#offNext').onclick = receive;
      bindWays('reply', back.text);
    } catch (e) { errBox(msgOf(e)); setTimeout(receive, 2500); }
  }
  async function replyDone(text) {
    try {
      const x = await rpc('applyIncoming', text);
      const r = x.mine;
      const upd = r && r.update ? await applyUpdate(r.update) : null;   // v1.28.0
      show(`<h2>تم</h2>
        ${r ? `<p>قُبل: <b>${r.accepted}</b>${r.rejected.length ? ' — لم يُقبل: <b>' + r.rejected.length + '</b>' : ''}${r.held.length ? ' — للمراجعة: <b>' + r.held.length + '</b>' : ''}</p>` : ''}
        ${updateNote(upd)}
        ${x.inTransit ? '<div class="note">تحييناتك مع <b>' + esc(x.inTransit.by) + '</b>.</div>' : ''}
        ${x.mineError ? '<div class="err">' + esc(MSG[x.mineError] || x.mineError) + '</div>' : ''}
        ${!r && !x.inTransit && !x.carriedDown && !x.mineError ? '<p>لا جديد لك في هذا الرمز.</p>' : ''}
        ${r && r.rejected.length ? '<div class="err">لم يُقبل:<ul>' + r.rejected.map((y) => '<li>' + esc(ACTIONS[y.action] || y.action) + ': ' + esc(REASONS[y.reason] || y.reason) + '</li>').join('') + '</ul></div>' : ''}
        ${r && r.flagged.some((f) => /newer edit kept/.test(f.reason)) ? '<div class="warn">بعض تعديلاتك كانت أقدم من تعديل آخر على الخانة نفسها: بقي التعديل الأحدث.</div>' : ''}
        <button class="ob" id="offOk">حسناً</button>`);
      { const rs = $('#offRestart'); if (rs) rs.onclick = () => location.reload(); }
      $('#offOk').onclick = () => { close(); if (r && typeof refreshLiveBackend === 'function') refreshLiveBackend(true); updateBadge(); setTimeout(freshBanner, 1200); const wb = $('#offWatchBtn'); if (wb) wb.remove(); addWatchButton(); areaBanner(); };
    } catch (e) { errBox(msgOf(e)); setTimeout(receive, 2500); }
  }
  async function updateBadge() {
    try { const st = await rpc('status'); const b = $('#offSyncBadge'); if (b) { b.textContent = st.pending; b.style.display = st.pending ? 'flex' : 'none'; } } catch (e) { /* locked */ }
  }

  // ---------------------------------------------------------------- login screen & header
  // ---------------------------------------------------------------- approval on the spot (teacher and T4 face to face)
  // Teacher: 1 show my code → 2 scan the T4's answer → 3 done.   T4: 1 scan the teacher's code → 2 decide → 3 show my answer.
  const SPOT_KIND = { deletion: 'إزالة عضو من درس', name: 'تغيير اسم عضو' };
  function steps(n, labels) {
    return '<div class="steps">' + labels.map((l, i) => '<div class="' + (i + 1 < n ? 'done' : i + 1 === n ? 'on' : '') + '"><b>' + (i + 1 < n ? '✓' : i + 1) + '</b>' + l + '</div>').join('') + '</div>';
  }
  const T_STEPS = ['رمز الطلب', 'جواب المدير', 'تمّ'], D_STEPS = ['مسح الطلب', 'القرار', 'رمز الجواب'];
  function spotSummary(kind, f, sh, from) {
    f = f || {}; sh = sh || {};
    let h = '<div class="sum"><b>' + esc(SPOT_KIND[kind] || kind) + '</b>';
    if (from) h += '<br>من: <b>' + esc(from) + '</b>';
    if (kind === 'deletion') h += '<br>العضو: <b>' + esc(sh.student || f.studentId) + '</b><br>الدرس: <b>' + esc(sh.course || f.courseCode) + '</b>';
    else h += '<br>الاسم الحالي: <b>' + esc(sh.current || sh.student || f.studentId) + '</b><br>الاسم المقترح: <b>' + esc(f.newName) + '</b>';
    if (f.reason) h += '<br>السبب: ' + esc(f.reason);
    return h + '</div>';
  }
  function qrBox(text) {
    const box = $('#offQR'); box.innerHTML = '';
    const c = document.createElement('canvas'); c.style.cssText = 'width:100%;max-width:340px;image-rendering:pixelated;background:#fff;border-radius:12px;display:block;margin:6px auto';
    box.appendChild(c); QRUI.drawQR(c, text, 'L');
  }
  function backToApp() { close(); if (typeof refreshLiveBackend === 'function') refreshLiveBackend(true); updateBadge(); }

  // ---- teacher
  async function spotStart(o) {
    let r;
    try { r = await rpc('spotStart', o.kind, o.fields, o.show); }
    catch (e) { show('<h2>تعذر</h2><div class="err">' + esc(msgOf(e)) + '</div><button class="ob" id="spOk">حسناً</button>'); $('#spOk').onclick = close; return; }
    spotShowRequest(r.text, o);
  }
  function spotShowRequest(text, o) {
    show(steps(1, T_STEPS) + '<h2>اعتماد فوري من المدير</h2>' + spotSummary(o.kind, o.fields, o.show) +
      '<p><b>اعرض هذا الرمز على المدير ليمسحه بهاتفه.</b></p><div id="offQR"></div>' +
      '<div class="wait">⏳ انتظر: المدير يمسح الرمز ثم يقرّر. حين يظهر على هاتفه رمز الجواب، اضغط الزر الأخضر.</div>' +
      '<button class="ob g" id="spNext">ظهر رمز الجواب على هاتف المدير: امسحه</button><button class="ob l" id="spCancel">إلغاء الطلب</button>');
    qrBox(text);
    $('#spNext').onclick = () => spotScanAnswer(text, o);
    $('#spCancel').onclick = async () => { try { await rpc('spotCancel'); } catch (e) { /* none */ } close(); };
  }
  function spotScanAnswer(text, o) {
    show(steps(2, T_STEPS) + '<h2>امسح جواب المدير</h2><p><b>وجّه الكاميرا نحو الرمز الظاهر على هاتف المدير.</b></p><div id="offScan"></div>' +
      '<div id="offErr" class="err" style="display:none"></div><button class="ob l" id="spBack">رجوع إلى رمز الطلب</button>');
    const done = async (t) => {
      try { spotDone(await rpc('spotFinish', t)); }
      catch (e) {
        if (e.code === 'SPOT_UNKNOWN') {
          show(steps(2, T_STEPS) + '<h2>تعذر التحقق من الجواب على هاتفك</h2><div class="warn">هاتفك لا يعرف هاتف هذا المدير بعد (يعرفه بعد أخذ التحيينات). لا شيء ضاع: هاتف المدير يحتفظ بقراره ويرسله إلى المحطة، وتصلك النتيجة مع التحيينات القادمة.</div><button class="ob" id="spOk">حسناً</button>');
          $('#spOk').onclick = async () => { try { await rpc('spotCancel'); } catch (x) { /* none */ } close(); };
          return;
        }
        errBox(e.code === 'MISMATCH' ? 'هذا الجواب لطلب آخر.' : e.code === 'BAD_INPUT' ? 'هذا ليس رمز جواب المدير.' : msgOf(e));
        setTimeout(() => spotScanAnswer(text, o), 2500);
      }
    };
    widgets.push(spotScanner = QRUI.scanner($('#offScan'), done, {}));
    $('#spBack').onclick = () => spotShowRequest(text, o);
  }
  function spotDone(r) {
    const yes = r.decision === 'approve';
    const what = r.kind === 'deletion' ? 'أُزيل العضو من الدرس على هاتفك.' : 'اعتُمد الاسم: <b>' + esc(r.finalName || '') + '</b>.';
    show(steps(4, T_STEPS) + '<div class="big" style="color:' + (yes ? '#047857' : '#b91c1c') + '">' + (yes ? '✓' : '✕') + '</div>' +
      '<h2 style="text-align:center">' + (yes ? 'تمّ: وافق ' + esc(r.by) : 'رفض ' + esc(r.by) + ' الطلب') + '</h2>' +
      (yes ? '<p style="text-align:center">' + (r.kind === 'name' && !r.finalName ? 'اعتُمد الاسم المقترح.' : what) + '</p>' : (r.note ? '<div class="sum">ملاحظة المدير: ' + esc(r.note) + '</div>' : '')) +
      '<div class="note">تتأكد المحطة من القرار مع التحيينات القادمة. يمكن للمدير الآن أن يضغط «إنهاء» على هاتفه.</div><button class="ob" id="spOk">إنهاء</button>');
    $('#spOk').onclick = backToApp;
  }

  // ---- T4
  function t4Scan() {
    show('<button class="x" id="offX">×</button>' + steps(1, D_STEPS) + '<h2>اعتماد طلب</h2><p><b>امسح الرمز الظاهر على هاتف المدرس.</b></p><div id="offScan"></div><div id="offErr" class="err" style="display:none"></div>');
    $('#offX').onclick = close;
    const done = async (t) => {
      try { t4Decide(t, await rpc('spotRead', t)); }
      catch (e) { errBox(e.code === 'BAD_INPUT' ? 'هذا ليس رمز طلب.' : e.code === 'MISMATCH_OWN' ? 'هذا رمزك أنت.' : e.code === 'OLD' ? 'هذا الطلب قديم: يعيده المدرس.' : msgOf(e)); setTimeout(t4Scan, 2500); }
    };
    widgets.push(spotScanner = QRUI.scanner($('#offScan'), done, {}));
  }
  function t4Decide(text, d) {
    show(steps(2, D_STEPS) + '<h2>قرّر</h2>' + spotSummary(d.kind, d.fields, d.show, d.from) +
      (d.kind === 'name' ? '<label>الاسم المعتمد (يمكنك تصحيحه)</label><input id="spName" value="' + esc(d.fields.newName) + '">' : '') +
      '<label>ملاحظة (إجبارية عند الرفض)</label><textarea id="spNote" rows="2" maxlength="200"></textarea>' +
      '<div id="offErr" class="err" style="display:none"></div>' +
      '<div class="wait">⏳ المدرس ينتظر قرارك.</div>' +
      '<div class="row"><button class="ob g" id="spYes">موافقة</button><button class="ob r" id="spNo">رفض</button></div><button class="ob l" id="spBack">إلغاء</button>');
    const go = async (decision) => {
      const note = $('#spNote').value.trim();
      if (decision === 'reject' && !note) return errBox('اكتب سبب الرفض في الملاحظة.');
      const name = $('#spName') ? $('#spName').value.trim() : '';
      if (d.kind === 'name' && decision === 'approve' && name.length < 2) return errBox('اكتب الاسم المعتمد.');
      $('#spYes').disabled = $('#spNo').disabled = true;
      try { t4Answer(await rpc('spotDecide', text, decision, note, name), decision); }
      catch (e) { errBox(msgOf(e)); $('#spYes').disabled = $('#spNo').disabled = false; }
    };
    $('#spYes').onclick = () => go('approve'); $('#spNo').onclick = () => go('reject');
    $('#spBack').onclick = close;
  }
  function t4Answer(r, decision) {
    show(steps(3, D_STEPS) + '<h2>' + (decision === 'approve' ? 'وافقت' : 'رفضت') + ': اعرض هذا الرمز على المدرس</h2><div id="offQR"></div>' +
      '<div class="wait">⏳ انتظر حتى تظهر «تمّ» على هاتف المدرس، ثم اضغط «إنهاء».</div>' +
      '<div class="note">قرارك محفوظ على هاتفك ويصل إلى المحطة مع المزامنة القادمة، حتى لو لم يمسح المدرس هذا الرمز.</div><button class="ob" id="spOk">إنهاء</button>');
    qrBox(r.text);
    $('#spOk').onclick = backToApp;
  }
  async function addSpotButton() {
    let info; try { info = await rpc('info'); } catch (e) { return; }
    if (AS || !info || !info.profile || info.profile.tier !== 'T4' || $('#offSpotBtn')) return;
    const sync = $('#offSyncBtn'); if (!sync || !sync.parentNode) return;
    const b = document.createElement('button'); b.id = 'offSpotBtn'; b.type = 'button'; b.title = 'اعتماد طلب فوري'; b.className = sync.className;
    b.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 12.5l2.7 2.7L16 9.5"/></svg>';
    sync.parentNode.insertBefore(b, sync);
    b.onclick = t4Scan;
  }
  let spotScanner = null;
  // feed: the same as a code read by the camera (used to read a code from a picture or by the tests)
  if (!AS) window.WaslSpot = { start: spotStart, feed: (t) => spotScanner && spotScanner.feed(t) };

  // ---------------------------------------------------------------- المناسبات (events)
  const evNorm = (t) => String(t || '').replace(/[\u064B-\u0652\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').toLowerCase();
  const evDescr = (e) => ({ type: e.type, date: e.date, center: e.center, title: e.title });
  const evWhere = (e) => e.branch ? 'الفرع: كل المقرات' : esc(e.center);
  const evName = (e) => esc(e.type) + (e.title ? ' — ' + esc(e.title) : '');
  let evState = null;
  // v1.16.2: what creates something is sent once: a second tap while it is being saved is ignored
  const ONCE = { evCreate: 1, evNew: 1, planSave: 1, planStart: 1 };
  let evBusy = false;
  async function evCall(payload) {
    const once = !!ONCE[payload && payload.action];
    if (once && evBusy) { const e = new Error('جارٍ الحفظ…'); e.quiet = true; throw e; }
    if (once) { evBusy = true; document.querySelectorAll('#offLayer .ob').forEach((b) => { b.dataset.busy = '1'; b.disabled = true; }); }
    try {
      const r = await LocalBackend.call(payload);
      if (!r || !r.success) throw new Error((r && r.error) || 'تعذّر');
      return r;
    } finally {
      if (once) { evBusy = false; document.querySelectorAll('#offLayer .ob[data-busy]').forEach((b) => { b.disabled = false; delete b.dataset.busy; }); }
    }
  }
  async function openEvents() {
    let r, d;
    try { r = await evCall({ action: 'evInit' }); d = await rpc('details'); } catch (e) { show('<h2>المناسبات</h2><div class="err">' + esc(e.message) + '</div><button class="ob" id="evX">حسناً</button>'); $('#evX').onclick = close; return; }
    evState = { init: r, counts: d.evCounts || {} };
    const cnt = (e) => evState.counts[e.id] || e;
    show(`<button class="x" id="offX">×</button><h2>المناسبات</h2>
      <p style="font-size:12px;color:#475569">يُسجَّل الحضور من «الأنشطة السنوية»: اختر النشاط واضغط «تسجيل الحضور».</p>
      ${r.events.length ? r.events.map((e, i) => { const c = cnt(e); return `<button type="button" class="evc" data-i="${i}"><b>${evName(e)}</b>
          <small>${esc(e.date)} — ${evWhere(e)}</small>
          <small>الحاضرون: ${c.present} — شاركوا: ${c.part} — غير مسجلين من قبل: ${c.newcomers} — الضيوف: ${e.guests || 0}</small></button>`; }).join('')
        : '<div class="note">لا حضور مسجَّل بعد. افتح «الأنشطة السنوية» واختر النشاط.</div>'}
      <p style="font-size:11.5px;color:#64748b">الأعداد من المحطة حسب آخر تحيين، وتشمل ما سجّله الجميع.</p>`);
    $('#offX').onclick = close;
    document.querySelectorAll('#offLayer .evc').forEach((b) => { b.onclick = () => openEvent(r.events[+b.dataset.i].id); });
  }
  async function openEvent(id, keep) {
    try { evState = { init: await evCall({ action: 'evInit' }), counts: (await rpc('details')).evCounts || {} }; } catch (e) { /* the screen below reports it */ }
    let L; try { L = await evCall({ action: 'evLoad', id }); } catch (e) { errBox(e.message); return; }
    const e = L.event, c = (evState && evState.counts[e.id]) || e, mine = {}; L.marks.forEach((m) => { mine[m.id] = m; });
    const q = keep && keep.q || '';
    show(`<button class="x" id="offX">×</button><h2>${evName(e)}</h2>
      <div class="sum">${esc(e.date)} — ${evWhere(e)}<br>الحاضرون: <b>${Math.max(c.present, e.present)}</b> — شاركوا: <b>${Math.max(c.part, e.part)}</b> — غير مسجلين من قبل: <b>${Math.max(c.newcomers, e.newcomers)}</b>
        <br><small style="color:#64748b">من قائمتك هنا: ${L.marks.length}</small></div>
      ${L.canMark && L.open ? `<div class="row" style="align-items:flex-end"><div><label>عدد الضيوف (غير الأعضاء)</label><input id="evGuests" type="number" min="0" max="5000" dir="ltr" value="${e.guests || 0}"></div><div style="flex:0 0 90px"><button class="ob l" id="evGuestsGo">حفظ</button></div></div>
        <label>ابحث في قائمتك: الاسم أو الهاتف</label><input id="evQ" autocomplete="off" value="${esc(q)}"><div id="evHits"></div>` : (L.open ? '' : '<div class="note">مرّ أكثر من 30 يوماً على المناسبة: لا تُعدَّل.</div>')}
      <div id="offErr" class="err" style="display:none"></div><div id="evMsg" class="note" style="display:none"></div>
      <h2 style="font-size:14px;margin-top:14px">المسجّلون من قائمتك (${L.marks.length})</h2><div id="evMarked"></div>
      ${L.canNew && L.open ? `<details style="margin-top:12px"><summary style="cursor:pointer;font-weight:800;color:#1e382b">شخص غير موجود في قائمتك: إضافته بالاسم والهاتف</summary>
        <label>الاسم واللقب</label><input id="evNName" maxlength="80"><label>الهاتف</label><input id="evNPhone" dir="ltr" inputmode="tel" maxlength="20">
        <label>الصنف</label><select id="evNCat"><option>رجال</option><option>نساء</option></select>
        ${L.mawlid ? '<label>المشاركة</label><select id="evNMark"><option value="present">حضر فقط</option><option value="part">شارك في التحضير</option></select>' + taskBox('evN') : '<label>المشاركة</label><select id="evNMark"><option value="present">حاضر</option><option value="part">شارك في النشاط</option></select>'}
        <button class="ob" id="evNGo">إضافة وتسجيل</button></details>` : ''}
      <button class="ob l" id="evBack">الأنشطة السنوية</button>`);
    $('#offX').onclick = close; $('#evBack').onclick = () => openPlan();
    const label = (m) => m.mark === 'شارك' ? (L.mawlid ? 'شارك في التحضير' + (m.task ? ': ' + esc(m.task) : '') : 'شارك') : (L.mawlid ? 'حضر فقط' : 'حاضر');
    const row = (p, m) => `<div class="evp"><div class="n">${esc(p.name)}<small>${[p.level ? 'م' + esc(p.level) : '', esc(p.center || ''), p.phoneEnd ? '…' + esc(p.phoneEnd) : ''].filter(Boolean).join(' — ')}${m && m.newcomer ? ' — غير مسجل من قبل' : ''}</small></div>
      ${m ? '<span class="chip ' + (m.mark === 'شارك' ? 't' : 'p') + '">' + label(m) + '</span>' : ''}${L.canMark && L.open ? '<button class="mini" data-id="' + esc(p.id) + '">' + (m ? 'تعديل' : 'تسجيل') + '</button>' : ''}</div>`;
    const people = {}; L.people.forEach((p) => { people[p.id] = p; });
    $('#evMarked').innerHTML = L.marks.length ? L.marks.map((m) => row(people[m.id] || { id: m.id, name: m.name }, m)).join('') : '<p style="color:#64748b">لا أحد بعد.</p>';
    const draw = () => {
      const box = $('#evHits'); if (!box) return;
      const t = evNorm($('#evQ').value).trim(); const dg = t.replace(/\D/g, '');
      if (t.length < 2) { box.innerHTML = ''; return; }
      const words = t.replace(/[0-9+]/g, ' ').split(/\s+/).filter(Boolean);
      const hits = L.people.filter((p) => (!words.length || words.every((w) => evNorm(p.name).indexOf(w) !== -1)) && (dg.length < 3 || (p.phone8 || '').indexOf(dg) !== -1));
      box.innerHTML = hits.slice(0, 25).map((p) => row(p, mine[p.id])).join('') + (hits.length > 25 ? '<div class="note">' + hits.length + ' نتيجة: اكتب أكثر.</div>' : '') + (!hits.length ? '<div class="note">لا أحد في قائمتك بهذا الاسم.' + (L.canNew ? ' أضفه بالاسم والهاتف أسفله.' : '') + '</div>' : '');
      bindRows(box);
    };
    const bindRows = (root) => root.querySelectorAll('.mini[data-id]').forEach((b) => { b.onclick = () => markPanel(b.closest('.evp'), people[b.dataset.id] || { id: b.dataset.id, name: '' }, mine[b.dataset.id]); });
    bindRows($('#evMarked'));
    if ($('#evQ')) { $('#evQ').oninput = draw; draw(); }
    const done = (x) => { const m = $('#evMsg'); openEvent(id, { q: $('#evQ') ? $('#evQ').value : '' }).then(() => { const n = $('#evMsg'); if (n) { n.textContent = x.message; n.style.display = 'block'; } }); updateBadge(); };
    function markPanel(el, p, m) {
      const pre = el.nextElementSibling; if (pre && pre.classList.contains('evpanel')) { pre.remove(); return; }
      const d = document.createElement('div'); d.className = 'evpanel sum';
      d.innerHTML = `<div class="row" style="flex-wrap:wrap">
          <button class="mini ${m && m.mark !== 'شارك' ? 'on' : ''}" data-m="present">${L.mawlid ? 'حضر فقط' : 'حاضر'}</button>
          <button class="mini ${m && m.mark === 'شارك' ? 'on' : ''}" data-m="part">${L.mawlid ? 'شارك في التحضير' : 'شارك في النشاط'}</button>
          ${m ? '<button class="mini x" data-m="">إلغاء التسجيل</button>' : ''}</div>${L.mawlid ? '<div class="evtask" style="display:' + (m && m.mark === 'شارك' ? 'block' : 'none') + '">' + taskBox('evT', m && m.task) + '<button class="mini on" data-m="part!" style="margin-top:8px">حفظ المهمة</button></div>' : ''}`;
      el.after(d);
      d.querySelectorAll('.mini[data-m]').forEach((b) => { b.onclick = async () => {
        let mk = b.dataset.m;
        if (L.mawlid && mk === 'part') { d.querySelector('.evtask').style.display = 'block'; return; }
        if (mk === 'part!') mk = 'part';
        const task = L.mawlid && mk === 'part' ? taskVal('evT') : {};
        try { done(await evCall(Object.assign({ action: 'evMark', event: evDescr(e), studentId: p.id, mark: mk }, task))); } catch (x) { errBox(x.message); }
      }; });
      bindTask('evT');
    }
    if ($('#evGuestsGo')) $('#evGuestsGo').onclick = async () => {
      // v1.16.2: an empty or wrong box is refused (it was saved as 0, erasing the count recorded before)
      const g = String($('#evGuests').value).trim();
      if (!/^\d{1,4}$/.test(g)) return errBox('اكتب عدد الضيوف بالأرقام (0 إن لم يكن هناك ضيوف).');
      try { done(await evCall({ action: 'evGuests', event: evDescr(e), guests: Number(g) })); } catch (x) { errBox(x.message); }
    };
    if ($('#evNGo')) {
      bindTask('evN');
      const tsel = $('#evNMark'); const tb = document.getElementById('evNTaskBox'); if (tb) { tb.style.display = 'none'; tsel.onchange = () => { tb.style.display = tsel.value === 'part' ? 'block' : 'none'; }; }
      $('#evNGo').onclick = async () => {
        const mk = $('#evNMark').value, task = L.mawlid && mk === 'part' ? taskVal('evN') : {};
        try { done(await evCall(Object.assign({ action: 'evNew', event: evDescr(e), name: $('#evNName').value, phone: $('#evNPhone').value, category: $('#evNCat').value, mark: mk }, task))); } catch (x) { errBox(x.message); }
      };
    }
  }
  function taskBox(pre, cur) {
    const tasks = (evState && evState.init.tasks) || ['أخرى'];
    const base = String(cur || '').indexOf('أخرى: ') === 0 ? 'أخرى' : (cur || '');
    return `<div id="${pre}TaskBox"><label>المهمة</label><select id="${pre}Task">${tasks.map((t) => '<option' + (t === base ? ' selected' : '') + '>' + esc(t) + '</option>').join('')}</select>
      <input id="${pre}Other" maxlength="40" placeholder="حدّد المهمة" style="margin-top:6px;display:${base === 'أخرى' ? 'block' : 'none'}" value="${base === 'أخرى' ? esc(String(cur).slice(6)) : ''}"></div>`;
  }
  function bindTask(pre) { const s = document.getElementById(pre + 'Task'); if (s) s.onchange = () => { document.getElementById(pre + 'Other').style.display = s.value === 'أخرى' ? 'block' : 'none'; }; }
  function taskVal(pre) { return { task: document.getElementById(pre + 'Task').value, taskOther: document.getElementById(pre + 'Other').value }; }
  // ---------------------------------------------------------------- the annual plan («الأنشطة السنوية», v1.14)
  let plState = null;
  const PL_COL = { act: '#ea580c', edu: '#2563eb' };
  const PL_SIDE = { act: 'الأنشطة', edu: 'التعليم' };
  const PL_ST = { done: ['أُنجز', '#047857', '#dcfce7'], partial: ['أُنجز في بعض المقرات', '#b45309', '#fef3c7'], missed: ['لم يُنجز', '#b91c1c', '#fee2e2'], today: ['اليوم', '#0369a1', '#e0f2fe'], planned: ['مخطط', '#475569', '#f1f5f9'], postponed: ['مؤجل', '#7c3aed', '#ede9fe'], cancelled: ['ملغى', '#64748b', '#f1f5f9'] };
  const plHijri = (d) => { try { return new Intl.DateTimeFormat('ar-TN-u-ca-islamic-umalqura', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(d + 'T00:00:00Z')); } catch (e) { return ''; } };
  const plDay = (d) => { try { return new Intl.DateTimeFormat('ar-TN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(d + 'T00:00:00Z')); } catch (e) { return d; } };
  const plLevels = (it) => (it.levels.length ? 'م' + (it.levels.length > 2 && it.levels[it.levels.length - 1] - it.levels[0] === it.levels.length - 1 ? it.levels[0] + '–' + it.levels[it.levels.length - 1] : it.levels.join('، ')) : 'كل المستويات') + (it.kids ? ' · أطفال' : '') + (it.youth ? ' · شباب' : '');
  const plNewId = () => { const b = new Uint8Array(5); crypto.getRandomValues(b); return 'PL-' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(''); };
  async function addPlanButton() {
    let info; try { info = await rpc('info'); } catch (e) { return; }
    const p = info && info.profile; if (!p || $('#offPlBtn')) return;
    if (!/^(T[1-4])$/.test(p.tier || '') && !/^A[1-4]$/.test(p.act || '')) return;
    const b = document.createElement('button'); b.id = 'offPlBtn'; b.type = 'button'; b.title = 'الأنشطة السنوية';
    b.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1z"/><path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/><path d="M8.5 13.5l2.2 2.2 4.8-4.8"/></svg><span>الأنشطة السنوية</span>';
    if (!dockAdd(b, 2)) return;
    b.onclick = () => openPlan();
  }
  async function openPlan(opts) {
    opts = opts || {};
    let init, L;
    try {
      init = await evCall({ action: 'planInit' });
      const all = !!opts.all && init.canEditAct;
      L = await evCall(Object.assign({ action: 'planList' }, all ? { all: true, from: init.today.slice(0, 4) + '-01-01', to: (Number(init.today.slice(0, 4)) + 1) + '-12-31' } : {}));
    } catch (e) { show('<h2>الأنشطة السنوية</h2><div class="err">' + esc(e.message) + '</div><button class="ob" id="plX">حسناً</button>'); $('#plX').onclick = close; return; }
    plState = { init, items: L.items, all: !!opts.all, f: (plState && plState.f) || { centre: '', cls: '', side: '', q: '' } };
    drawPlan(opts.scrollTo);
  }
  function drawPlan(scrollTo) {
    const { init, items, f } = plState;
    const today = init.today;
    const mine = init.classes.filter((c) => c.mine);
    const list = items.filter((it) => (!f.side || it.side === f.side) && (!f.centre || it.branch || it.centres.indexOf(f.centre) !== -1) && (!f.cls || !it.classes.length || it.classes.indexOf(f.cls) !== -1));
    const groups = []; list.forEach((it) => { const g = groups[groups.length - 1]; if (g && g.d === it.from) g.l.push(it); else groups.push({ d: it.from, l: [it] }); });
    const many = init.canEditAct || init.admin || mine.length > 1;
    const card = (it) => {
      const st = PL_ST[it.state] || PL_ST.planned;
      const canStart = init.canStart && !it.draft && it.state !== 'done' && it.state !== 'cancelled' && it.from <= today && (it.to >= today || (Date.parse(today) - Date.parse(it.to)) / 864e5 <= 7);
      return `<div class="plc${it.draft ? ' pldr' : ''}" style="border-inline-start:6px solid ${PL_COL[it.side]}${it.state === 'cancelled' ? ';opacity:.6' : ''}" data-id="${esc(it.id)}">
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">${it.draft ? '<span class="chip" style="background:#fef3c7;color:#92400e;border:1px dashed #d97706">خطة · غير نهائي</span>' : ''}<span class="chip" style="background:${PL_COL[it.side]}1a;color:${PL_COL[it.side]}">${PL_SIDE[it.side]}</span><span class="chip" style="background:${st[2]};color:${st[1]}">${st[0]}</span>${it.time ? '<span class="chip" style="background:#f1f5f9;color:#334155" dir="ltr">' + esc(it.time) + '</span>' : ''}</div>
        <b style="display:block;margin-top:6px;${it.state === 'cancelled' ? 'text-decoration:line-through' : ''}">${esc(it.type)}${it.title ? ' — ' + esc(it.title) : ''}</b>
        ${it.to !== it.from ? '<small>من ' + esc(plDay(it.from)) + ' إلى ' + esc(plDay(it.to)) + '</small>' : ''}
        <small>${it.branch ? 'الفرع: كل المقرات' : esc(it.centres.join('، '))} · ${esc(it.category === 'الكل' ? 'رجال ونساء' : it.category)} · ${esc(plLevels(it))}</small>
        ${it.classLabels.length && !it.branch ? '<small>الصفوف: ' + esc(it.classLabels.slice(0, 4).join('، ')) + (it.classLabels.length > 4 ? ' +' + (it.classLabels.length - 4) : '') + '</small>' : ''}
        ${it.prevDate ? '<small style="color:#7c3aed">كان موعده ' + esc(it.prevDate) + (it.reason ? ' — ' + esc(it.reason) : '') + '</small>' : it.reason ? '<small>' + esc(it.reason) + '</small>' : ''}
        ${it.done.length && it.state === 'partial' ? '<small>أُنجز في: ' + esc(it.done.join('، ')) + '</small>' : ''}
        ${(it.state === 'partial' || it.state === 'missed') && (it.want || []).filter((c) => it.done.indexOf(c) === -1).length ? '<small style="color:#b91c1c;font-weight:700">لم يُسجَّل في: ' + esc((it.want || []).filter((c) => it.done.indexOf(c) === -1).join('، ')) + '</small>' : ''}
        ${it.notes ? '<small>' + esc(it.notes) + '</small>' : ''}
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
          ${canStart ? '<button class="mini" data-start="' + esc(it.id) + '" style="background:#047857;color:#fff">تسجيل الحضور</button>' : ''}
          ${it.events.map((e) => '<button class="mini" data-ev="' + esc(e.id) + '">الحضور ' + esc(e.center) + ': ' + e.present + '</button>').join('')}
          ${it.canEdit ? '<button class="mini" data-edit="' + esc(it.id) + '">تعديل</button><button class="mini" data-more="' + esc(it.id) + '">…</button>' : ''}
        </div></div>`;
    };
    const drafts = Array.from(new Set(items.filter((it) => it.draft).map((it) => it.from.slice(0, 4)))).sort();
    show(`<button class="x" id="offX">×</button><h2>الأنشطة السنوية</h2>
      ${drafts.length ? '<div class="note" style="border:1px dashed #d97706;background:#fffbeb;color:#92400e;font-weight:700">سنة ' + drafts.join(' و') + ': خطة غير نهائية بعد. لا يراها إلا المسؤولون، ولا يُسجَّل لها حضور حتى تُعتمد.</div>' : ''}
      <p style="font-size:12px;color:#475569;margin:0 0 6px">${plState.all ? 'السنة كاملة' : 'من أسبوعين مضيا إلى ' + Math.round(init.ahead / 30) + ' أشهر قادمة'} · <span style="color:${PL_COL.act};font-weight:800">■ الأنشطة</span> · <span style="color:${PL_COL.edu};font-weight:800">■ التعليم</span></p>
      ${many ? `<div style="display:flex;gap:6px;flex-wrap:wrap">
        <select id="plC" style="flex:1"><option value="">كل المقرات</option>${init.centres.map((c) => '<option' + (c === f.centre ? ' selected' : '') + '>' + esc(c) + '</option>').join('')}</select>
        <select id="plK" style="flex:1"><option value="">كل الصفوف</option>${(init.canEditAct || init.admin ? init.classes : mine).map((c) => '<option value="' + esc(c.key) + '"' + (c.key === f.cls ? ' selected' : '') + '>' + esc(c.label) + '</option>').join('')}</select>
        ${init.seeAct && init.seeEdu ? '<select id="plS" style="flex:1"><option value="">الأنشطة والتعليم</option><option value="act"' + (f.side === 'act' ? ' selected' : '') + '>الأنشطة</option><option value="edu"' + (f.side === 'edu' ? ' selected' : '') + '>التعليم</option></select>' : ''}</div>` : ''}
      ${init.canEditAct ? '<div style="display:flex;gap:6px"><button class="ob g" id="plNew" style="flex:1">+ نشاط</button><button class="ob l" id="plAll" style="flex:1">' + (plState.all ? 'الأشهر القادمة فقط' : 'السنة كاملة') + '</button></div>' : ''}
      ${groups.length ? groups.map((g) => '<div class="pld' + (g.d === today ? ' today' : '') + '" id="pld-' + esc(g.d) + '"><b>' + esc(plDay(g.d)) + '</b> <small>' + esc(plHijri(g.d)) + '</small>' + (g.d === today ? ' <span class="chip" style="background:#e0f2fe;color:#0369a1">اليوم</span>' : '') + '</div>' + g.l.map(card).join('')).join('')
        : '<div class="note">لا شيء في المخطط لهذه الفترة.</div>'}
      <div class="note" style="margin-top:10px">النشاط الذي ليس في هذه القائمة لا يُسجَّل له حضور. أبلغ المسؤول ليضيفه إلى الأنشطة السنوية.</div>`);
    $('#offX').onclick = close;
    const bindF = (id, k) => { if ($(id)) $(id).onchange = () => { plState.f[k] = $(id).value; drawPlan(); }; };
    bindF('#plC', 'centre'); bindF('#plK', 'cls'); bindF('#plS', 'side');
    if ($('#plNew')) $('#plNew').onclick = () => plForm(null);
    if ($('#plAll')) $('#plAll').onclick = () => openPlan({ all: !plState.all });
    const L = document.querySelectorAll('#offLayer');
    L.forEach((root) => {
      root.querySelectorAll('[data-start]').forEach((b) => { b.onclick = () => plStart(items.find((x) => x.id === b.dataset.start)); });
      root.querySelectorAll('[data-ev]').forEach((b) => { b.onclick = () => openEvent(b.dataset.ev); });
      root.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => plForm(items.find((x) => x.id === b.dataset.edit)); });
      root.querySelectorAll('[data-more]').forEach((b) => { b.onclick = () => plMore(items.find((x) => x.id === b.dataset.more)); });
    });
    const target = scrollTo || (groups.find((g) => g.d >= today) || {}).d;
    if (target && $('#pld-' + target)) setTimeout(() => { try { $('#pld-' + target).scrollIntoView({ block: 'start' }); } catch (e) { /* none */ } }, 30);
  }
  async function plStart(it) {
    const init = plState.init;
    let centre = '';
    const choices = it.branch ? init.centres : it.centres;
    if (it.type !== 'حفل المولد' && choices.length > 1) {
      show(`<button class="x" id="offX">×</button><h2>تسجيل الحضور: ${esc(it.type)}</h2><p>في أي مقر؟</p>
        ${choices.map((c) => '<button class="ob l" data-c="' + esc(c) + '">' + esc(c) + (c === init.home ? ' (مقرك)' : '') + '</button>').join('')}<button class="ob l" id="plBack">رجوع</button>`);
      $('#offX').onclick = close; $('#plBack').onclick = () => drawPlan();
      centre = await new Promise((res) => { document.querySelectorAll('#offLayer [data-c]').forEach((b) => { b.onclick = () => res(b.dataset.c); }); });
    } else centre = choices[0] || '';
    try { const r = await evCall({ action: 'planStart', id: it.id, center: centre }); openEvent(r.event.id); }
    catch (e) { errBox(e.message); }
  }
  function plMore(it) {
    show(`<button class="x" id="offX">×</button><h2>${esc(it.type)}${it.title ? ' — ' + esc(it.title) : ''}</h2><p>${esc(plDay(it.from))}</p>
      <label>تأجيل إلى</label><input id="plNd" type="date" dir="ltr" value="${esc(it.from)}"><label>السبب</label><input id="plWhy" maxlength="120" value="${esc(it.reason || '')}">
      <button class="ob" id="plPost">تأجيل</button>
      <button class="ob l" id="plDone">أُنجز (دون مناسبة مسجّلة)</button>
      <button class="ob r" id="plCancel">${it.status === 'ملغى' ? 'إعادة إلى المخطط' : 'إلغاء النشاط'}</button>
      <button class="ob r" id="plDel">حذف${it.series ? ' هذا النشاط' : ''}</button>${it.series ? '<button class="ob r" id="plDelS">حذف هذا النشاط وما بعده في السلسلة</button>' : ''}
      <div id="offErr" class="err" style="display:none"></div><button class="ob l" id="plBack">رجوع</button>`);
    $('#offX').onclick = close; $('#plBack').onclick = () => drawPlan();
    const go = async (p, msg) => { try { await evCall(p); await openPlan({ all: plState.all, scrollTo: it.from }); } catch (e) { const x = $('#offErr'); if (x) { x.textContent = e.message; x.style.display = ''; } } };
    $('#plPost').onclick = () => go({ action: 'planStatus', id: it.id, status: 'postponed', from: $('#plNd').value, reason: $('#plWhy').value });
    $('#plDone').onclick = () => go({ action: 'planStatus', id: it.id, status: 'done', reason: $('#plWhy').value });
    $('#plCancel').onclick = () => go({ action: 'planStatus', id: it.id, status: it.status === 'ملغى' ? 'planned' : 'cancelled', reason: $('#plWhy').value });
    $('#plDel').onclick = () => { if (confirm('حذف هذا النشاط من المخطط؟')) go({ action: 'planDelete', id: it.id }); };
    if ($('#plDelS')) $('#plDelS').onclick = () => { if (confirm('حذف هذا النشاط وكل ما بعده في السلسلة؟')) go({ action: 'planDelete', id: it.id, series: true }); };
  }
  function plForm(it) {
    const init = plState.init;
    const side = it ? it.side : (init.canEditAct ? 'act' : 'edu');
    const x = it || { type: init.types[side][0], title: '', from: init.today, to: init.today, time: '', category: 'الكل', centres: ['الفرع'], levels: [], kids: false, youth: false, budget: 0, notes: '', classes: [] };
    const cs = ['الفرع'].concat(init.centres);
    const has = (c) => (c === 'الفرع' ? x.branch || x.centres.indexOf('الفرع') !== -1 : x.centres.indexOf(c) !== -1);
    show(`<button class="x" id="offX">×</button><h2>${it ? 'تعديل نشاط' : 'نشاط جديد'} — <span style="color:${PL_COL[side]}">${PL_SIDE[side]}</span></h2>
      <label>النوع</label><select id="plT">${init.types[side].map((t) => '<option' + (t === x.type ? ' selected' : '') + '>' + esc(t) + '</option>').join('')}${init.types[side].indexOf(x.type) === -1 ? '<option selected>' + esc(x.type) + '</option>' : ''}</select>
      <label>العنوان (اختياري)</label><input id="plTi" maxlength="120" value="${esc(x.title)}">
      <div style="display:flex;gap:6px"><div style="flex:1"><label>من</label><input id="plF" type="date" dir="ltr" value="${esc(x.from)}"></div><div style="flex:1"><label>إلى</label><input id="plTo" type="date" dir="ltr" value="${esc(x.to)}"></div></div>
      <small id="plH" style="color:#475569"></small>
      <label>الوقت (اختياري)</label><input id="plTm" maxlength="30" value="${esc(x.time)}" placeholder="18:00">
      <label>الفئة</label><select id="plCat">${['الكل', 'رجال', 'نساء'].map((c) => '<option value="' + c + '"' + (c === x.category ? ' selected' : '') + '>' + (c === 'الكل' ? 'رجال ونساء' : c) + '</option>').join('')}</select>
      <label>المقرات</label><div class="plchips" id="plCs">${cs.map((c) => '<label><input type="checkbox" value="' + esc(c) + '"' + (has(c) ? ' checked' : '') + '> ' + esc(c === 'الفرع' ? 'الفرع كله' : c) + '</label>').join('')}</div>
      <label>المستويات (لا شيء = الكل)</label><div class="plchips" id="plLv">${[1, 2, 3, 4, 5, 6, 7].map((n) => '<label><input type="checkbox" value="' + n + '"' + (x.levels.indexOf(n) !== -1 ? ' checked' : '') + '> ' + n + '</label>').join('')}<label><input type="checkbox" id="plKid"${x.kids ? ' checked' : ''}> أطفال</label><label><input type="checkbox" id="plYo"${x.youth ? ' checked' : ''}> شباب</label></div>
      <label>الموازنة (د)</label><input id="plB" type="number" min="0" dir="ltr" value="${esc(x.budget || '')}">
      <label>ملاحظات</label><input id="plN" maxlength="300" value="${esc(x.notes)}">
      ${it ? '' : `<label>التكرار</label><select id="plR"><option value="">مرة واحدة</option><option value="week">كل أسبوع</option><option value="2weeks">كل أسبوعين</option><option value="month">كل شهر</option></select><div id="plRu" style="display:none"><label>حتى</label><input id="plU" type="date" dir="ltr" value="${esc(init.today.slice(0, 4))}-12-31"></div>`}
      <p style="font-size:11.5px;color:#64748b">تختار المحطة الصفوف حسب المقرات والفئة والمستويات.</p>
      <div id="offErr" class="err" style="display:none"></div>
      <button class="ob" id="plGo">${it ? 'حفظ' : 'إضافة'}</button><button class="ob l" id="plBack">رجوع</button>`);
    $('#offX').onclick = close; $('#plBack').onclick = () => drawPlan();
    const hj = () => { $('#plH').textContent = 'هجري: ' + plHijri($('#plF').value) + ($('#plTo').value && $('#plTo').value !== $('#plF').value ? ' — ' + plHijri($('#plTo').value) : ''); };
    $('#plF').onchange = () => { if (!$('#plTo').value || $('#plTo').value < $('#plF').value) $('#plTo').value = $('#plF').value; hj(); }; $('#plTo').onchange = hj; hj();
    if ($('#plR')) $('#plR').onchange = () => { $('#plRu').style.display = $('#plR').value ? '' : 'none'; };
    $('#plCs').addEventListener('change', (e) => { if (e.target.value === 'الفرع' && e.target.checked) $('#plCs').querySelectorAll('input').forEach((i) => { if (i.value !== 'الفرع') i.checked = false; }); else if (e.target.checked) $('#plCs').querySelector('input[value="الفرع"]').checked = false; });
    $('#plGo').onclick = async () => {
      const centres = Array.from($('#plCs').querySelectorAll('input:checked')).map((i) => i.value);
      const levels = Array.from($('#plLv').querySelectorAll('input[type=checkbox]:checked')).map((i) => Number(i.value)).filter((n) => n);
      const item = { id: it ? it.id : '', newId: it ? '' : plNewId(), side, type: $('#plT').value, title: $('#plTi').value, from: $('#plF').value, to: $('#plTo').value || $('#plF').value, time: $('#plTm').value,
        category: $('#plCat').value, centres: centres.length ? centres : ['الفرع'], levels, kids: $('#plKid').checked, youth: $('#plYo').checked, budget: Number($('#plB').value) || 0, notes: $('#plN').value };
      if (it && item.category === it.category && JSON.stringify(item.levels) === JSON.stringify(it.levels) && JSON.stringify(item.centres.slice().sort()) === JSON.stringify((it.branch ? ['الفرع'] : it.centres).slice().sort())) item.classes = it.classes;
      const bad = (m) => { const x = $('#offErr'); if (x) { x.textContent = m; x.style.display = ''; } };
      if (!item.from) return bad('اختر تاريخ البداية («من»).');
      if (item.to < item.from) return bad('تاريخ النهاية («إلى») قبل تاريخ البداية («من»).');
      const p = { action: 'planSave', item };
      if (!it && $('#plR').value) p.repeat = { every: $('#plR').value, until: $('#plU').value };
      try { await evCall(p); await openPlan({ all: plState.all, scrollTo: item.from }); }
      catch (e) { const x2 = $('#offErr'); x2.textContent = e.message; x2.style.display = ''; }
    };
  }

  // v1.15: events and annual activities in a bar at the bottom of the screen, with their names (within thumb's reach)
  window.WaslDockAdd = (b, order) => dockAdd(b, order);   // v1.17.1: the public lesson button of a T3
  function dockAdd(b, order) {
    const shell = $('#appShell'); if (!shell) return false;
    let dock = $('#offDock');
    if (!dock) { dock = document.createElement('nav'); dock.id = 'offDock'; dock.setAttribute('aria-label', 'المناسبات والأنشطة السنوية'); shell.appendChild(dock); document.body.classList.add('offDocked'); }
    b.dataset.order = order;
    const after = Array.from(dock.children).find((x) => Number(x.dataset.order) > order);
    dock.insertBefore(b, after || null);
    dock.classList.toggle('n4', dock.children.length >= 4);   // four buttons: icon above a short label
    return true;
  }
  // ---------------------------------------------------------------- v1.17.4: «لم يتم التحيين منذ…» and blur after 90 days
  const FRESH_WARN = 8, FRESH_RED = 31, FRESH_BLUR = 90;
  const dayWord = (n) => n === 1 ? 'يوم' : n === 2 ? 'يومين' : n <= 10 ? n + ' أيام' : n + ' يوماً';
  async function freshBanner() {
    let st, d; try { st = await rpc('status'); d = await rpc('details'); } catch (e) { return; }
    const main = document.querySelector('#appShell main');
    if (!st || !st.lastSync || !main || (d && d.admin) || window.WaslNoFresh) return;
    const days = Math.max(0, Math.floor((Date.now() - new Date(st.lastSync).getTime()) / 86400e3));
    window.WaslFresh = { days, last: st.lastSync };
    let el = $('#offFresh');
    if (!el) { el = document.createElement('button'); el.id = 'offFresh'; el.type = 'button'; el.onclick = openSync; main.insertBefore(el, main.firstChild); }
    const c = days >= FRESH_RED ? ['#fef2f2', '#991b1b', '#fecaca'] : days >= FRESH_WARN ? ['#fffbeb', '#92400e', '#fde68a'] : ['#f0fdf4', '#166534', '#bbf7d0'];
    el.style.background = c[0]; el.style.color = c[1]; el.style.borderColor = c[2];
    const appr = typeof waslPendingApprovals === 'function' ? waslPendingApprovals() : 0;
    el.innerHTML = (days === 0 ? 'تمّ التحيين اليوم' : 'لم يتم التحيين منذ ' + dayWord(days)) + (days >= FRESH_WARN ? ' — اضغط للمزامنة' : '') +
      (appr && days >= 2 ? '<br><span style="color:#991b1b">لديك ' + appr + ' طلبات تنتظر موافقة الإدارة: أرسل تحييناتك.</span>' : '');
    const blur = days >= FRESH_BLUR;
    document.body.classList.toggle('offBlur', blur);
    let note = $('#offBlurNote');
    if (blur && !note) {
      note = document.createElement('div'); note.id = 'offBlurNote';
      note.innerHTML = '<b>لم يتم التحيين منذ ' + dayWord(days) + '</b><p>البيانات محجوبة حتى ترسل تحييناتك وتأخذ الجديد.</p><button class="ob" id="offBlurSync" type="button">المزامنة</button>';
      document.body.appendChild(note); $('#offBlurSync').onclick = openSync;
    } else if (!blur && note) note.remove();
  }
  window.WaslFreshBanner = freshBanner;

  // ---------------------------------------------------------------- v1.18.3: the account sheet (tap the icon next to the name)
  const APP_VERSION = '1.28.1-202611262108';
  const FB_EVERY = 14 * 86400e3;   // the question comes back every 2 weeks
  const fbKey = () => 'fbLast:' + String((typeof AppState !== 'undefined' && AppState.currentUser && AppState.currentUser.email) || '').toLowerCase();
  const fbDue = () => { const t = Number(localStorage.getItem(fbKey()) || 0); return Date.now() - t >= FB_EVERY; };
  function fbDot() {
    const a = document.getElementById('userAvatar'); if (!a) return;
    a.style.position = 'relative'; a.style.cursor = 'pointer';
    let d = document.getElementById('offFbDot');
    if (fbDue()) { if (!d) { d = document.createElement('span'); d.id = 'offFbDot'; d.style.cssText = 'position:absolute;top:-3px;left:-3px;width:12px;height:12px;border-radius:50%;background:#dc2626;border:2px solid #fff'; a.appendChild(d); } }
    else if (d) d.remove();
  }
  function fbWeekly() {   // one short reminder per period, the day the dot appears
    if (!fbDue()) return;
    const k = fbKey() + ':toast', t = Number(localStorage.getItem(k) || 0);
    if (Date.now() - t < FB_EVERY) return;
    try { localStorage.setItem(k, String(Date.now())); } catch (e) { /* none */ }
    if (typeof showToast === 'function') showToast('هل سهّل التطبيق عملك اليوم؟ اضغط على النقطة الحمراء بجانب اسمك.', 'info');
  }
  // the bubble: the question, 👍 / 👎, then «what could be better» with a round send button (like WhatsApp)
  function openFeedback() {
    let old = document.getElementById('offFb'); if (old) old.remove();
    const box = document.createElement('div'); box.id = 'offFb';
    box.style.cssText = 'position:fixed;top:72px;right:12px;left:12px;max-width:420px;margin:0 auto;z-index:300;background:#fff;border:1px solid #e2e8f0;border-radius:20px;box-shadow:0 12px 32px rgba(0,0,0,.18);padding:14px;font-family:Tajawal,sans-serif;direction:rtl';
    box.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b style="font-size:15px;color:#0f172a">هل سهّل التطبيق عملك اليوم؟</b>
        <button type="button" id="offFbX" aria-label="إغلاق" style="border:0;background:none;font-size:20px;color:#94a3b8;cursor:pointer">×</button></div>
      <div style="display:flex;gap:10px;margin-top:10px">
        <button type="button" data-a="نعم" class="fbA" style="flex:1;padding:10px;border-radius:14px;border:1px solid #cbd5e1;background:#f8fafc;font-size:22px;cursor:pointer">👍</button>
        <button type="button" data-a="لا" class="fbA" style="flex:1;padding:10px;border-radius:14px;border:1px solid #cbd5e1;background:#f8fafc;font-size:22px;cursor:pointer">👎</button></div>
      <div id="offFbMore" style="display:none;margin-top:10px">
        <div style="display:flex;align-items:flex-end;gap:8px">
          <textarea id="offFbNote" rows="1" maxlength="1000" placeholder="ما الذي يمكن تحسينه؟ (اختياري)" style="flex:1;resize:none;padding:10px 14px;border:1px solid #cbd5e1;border-radius:22px;font:inherit;font-size:14px;max-height:120px"></textarea>
          <button type="button" id="offFbSend" aria-label="إرسال" style="width:46px;height:46px;flex:0 0 46px;border-radius:50%;border:0;background:#25d366;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" style="transform:scaleX(-1)"><path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z"/></svg></button></div>
        <div id="offFbErr" style="display:none;color:#b91c1c;font-size:12px;margin-top:6px"></div></div>`;
    document.body.appendChild(box);
    const note = box.querySelector('#offFbNote');
    note.oninput = () => { note.style.height = 'auto'; note.style.height = Math.min(120, note.scrollHeight) + 'px'; };
    box.querySelector('#offFbX').onclick = () => box.remove();
    let ans = '';
    box.querySelectorAll('.fbA').forEach((b) => { b.onclick = () => {
      ans = b.dataset.a;
      box.querySelectorAll('.fbA').forEach((x) => { const on = x === b; x.style.background = on ? (ans === 'نعم' ? '#dcfce7' : '#fee2e2') : '#f8fafc'; x.style.borderColor = on ? (ans === 'نعم' ? '#22c55e' : '#ef4444') : '#cbd5e1'; });
      box.querySelector('#offFbMore').style.display = 'block'; note.focus();
    }; });
    box.querySelector('#offFbSend').onclick = async () => {
      if (!ans) return;
      try {
        const r = await rpc('api', { action: 'sendFeedback', answer: ans, note: note.value.trim(), version: APP_VERSION.split('-')[0] });
        if (!r || !r.success) { const e = box.querySelector('#offFbErr'); e.textContent = (r && r.error) || 'تعذر الإرسال'; e.style.display = 'block'; return; }
        try { localStorage.setItem(fbKey(), String(Date.now())); } catch (e) { /* none */ }
        box.remove(); fbDot();
        if (typeof showToast === 'function') showToast('شكراً، وصل رأيك.', 'success');
      } catch (e) { const er = box.querySelector('#offFbErr'); er.textContent = msgOf(e); er.style.display = 'block'; }
    };
  }
  async function openAccount() {
    let st = null; try { st = await rpc('status'); } catch (e) { /* none */ }
    const u = (typeof AppState !== 'undefined' && AppState.currentUser) || {};
    const days = st && st.lastSync ? Math.max(0, Math.floor((Date.now() - new Date(st.lastSync).getTime()) / 86400e3)) : null;
    const sv = (typeof AppState !== 'undefined' && AppState.stationVersion) || '';
    // v1.22.0: everything about the person in one place: roles in words, versions, PIN, feedback, sign out
    const ROLE = { T1: 'مدرس', T2: 'مدرس صف', T3: 'معوض الدرس العام', T4: 'مدير', T5: 'المدير التنفيذي', A1: 'عضو فريق الصف', A2: 'منسق', A3: 'منسق منطقة', A4: 'مسؤول البرامج', M1: 'مجالس الذكر' };
    const A = (typeof AppState !== 'undefined' && AppState.act) || null, C = (typeof AppState !== 'undefined' && AppState.ceo) || null;
    const codes = [];
    String((u && (u.role || u.roleRaw || u.accessTier)) || '').toUpperCase().split(/[^A-Z0-9]+/).forEach((t) => { if (ROLE[t] && codes.indexOf(t) === -1) codes.push(t); });
    if (A && A.tier && codes.indexOf(A.tier) === -1) codes.push(A.tier);
    if (A && A.majlis && codes.indexOf('M1') === -1) codes.push('M1');
    if (C && codes.indexOf('T5') === -1) codes.push('T5');
    const roles = codes.map((t) => '<span dir="ltr" style="display:inline-block;margin:2px 0 2px 6px;padding:3px 10px;border-radius:999px;background:#ecfdf5;color:#065f46;font-weight:700;font-size:12.5px">' + t + '</span>').join('');   // v1.22.1: the codes only
    show(`<button class="x" id="offX">×</button><h2>حسابي</h2>
      <div style="display:flex;align-items:center;gap:12px;margin:6px 0 10px"><div style="width:46px;height:46px;border-radius:16px;background:#d1fae5;color:#065f46;display:flex;align-items:center;justify-content:center;flex:0 0 auto"><svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg></div>
        <div><div style="font-weight:800;font-size:16px">${esc(u.name || '')}</div>${u.location ? '<div style="color:#64748b;font-size:13px">' + esc(u.location) + '</div>' : ''}</div></div>
      ${roles ? '<div style="margin-bottom:10px">' + roles + '</div>' : ''}
      <div class="note" style="text-align:right">
        <div>نسخة التطبيق: <b dir="ltr">${esc(APP_VERSION.split('-')[0])}</b> <span style="color:#94a3b8" dir="ltr">(${esc(APP_VERSION)})</span></div>
        <div>نسخة الإدارة عند آخر تحيين: <b dir="ltr">${esc(sv || '—')}</b></div>
        <div>${days === null ? 'لم يتم التحيين بعد' : days === 0 ? 'تمّ التحيين اليوم' : 'لم يتم التحيين منذ ' + dayWord(days)}</div>
        <div id="offSiteVer" style="margin-top:4px;color:#64748b">التحقق من وجود تحديث…</div>
      </div>
      <button class="ob l" id="offPin2">🔑 تغيير الرمز السري</button>
      <button class="ob l" id="offFbAny">💬 مقترحات لتحسين عمل التطبيقة${fbDue() ? ' <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#dc2626;vertical-align:middle"></span>' : ''}</button>
      <button class="ob l" id="offOut" style="color:#b91c1c;border-color:#fecaca;background:#fff5f5">⎋ تسجيل الخروج</button>`);
    $('#offX').onclick = close;
    $('#offPin2').onclick = () => changeSecret(false);
    $('#offFbAny').onclick = () => { close(); openFeedback(); };
    $('#offOut').onclick = () => { close(); if (typeof handleLogout === 'function') handleLogout(); };
    siteVersion();
  }
  // v1.22.7: the version on the site against this phone's; «تحديث التطبيق الآن» fetches it and restarts the app
  async function siteVersion() {
    const box = $('#offSiteVer'); if (!box) return;
    let site = '';
    try { const r = await fetch('./release.json?t=' + Date.now(), { cache: 'no-store' }); if (r.ok) site = (JSON.parse(await r.text()).version) || ''; } catch (e) { site = ''; }
    if (!$('#offSiteVer')) return;
    if (!site) { box.textContent = 'لا يمكن التحقق من وجود تحديث الآن (دون اتصال).'; return; }
    if (site === APP_VERSION) { box.innerHTML = 'تطبيقك محدَّث ✓'; return; }
    box.innerHTML = '<span style="color:#b45309;font-weight:700">نسخة جديدة: <b dir="ltr">' + esc(site.split('-')[0]) + '</b></span><div style="margin-top:4px">يُحدَّث التطبيق تلقائياً، دون أي إجراء منك.</div>';
    if (window.WaslKeepCurrent) window.WaslKeepCurrent();
  }
  // v1.28.0: app updates that arrive inside a reply (or alone, as a file or a code), installed with no tap and checked against
  // the release key built into the app; a version that does not start is dropped by itself (sw.js).
  async function reportRelease() { try { if (window.WaslUpdater) await rpc('setRelease', await WaslUpdater.current()); } catch (e) { /* locked or not ready */ } }
  function startUpdater() {
    if (AS || !window.WaslUpdater) return;
    WaslUpdater.init(APP_VERSION);
    reportRelease();
    setTimeout(async () => { try { await rpc('status'); if (await WaslUpdater.confirm()) reportRelease(); } catch (e) { /* did not start well: the next opening counts */ } }, 5000);
    if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'wasl-rolled-back') {
        try { localStorage.setItem('waslRolledBack', JSON.stringify({ version: e.data.version, at: Date.now() })); } catch (x) { /* none */ }
        if (typeof showToast === 'function') showToast('تعذّر تشغيل النسخة الجديدة، فعدنا إلى النسخة السابقة.', 'info');
        reportRelease();
      }
    });
  }
  async function applyUpdate(upd) {
    if (!window.WaslUpdater || AS) return null;
    try {
      const r = await WaslUpdater.install(upd);
      await reportRelease();
      if (window.WaslReloadWhenIdle) window.WaslReloadWhenIdle();
      return { state: 'installed', version: r.version };
    } catch (e) {
      if (e.code === 'SAME' || e.code === 'OLDER') return { state: 'same' };
      console.warn('update not installed:', e.code, e.message);
      try { localStorage.setItem('waslUpdateFail', JSON.stringify({ code: e.code || '', why: String(e.message || '').slice(0, 160), at: Date.now() })); } catch (x) { /* none */ }
      return { state: 'failed', code: e.code };
    }
  }
  function updateNote(u) {
    if (!u) return '';
    if (u.state === 'installed') return '<div class="note" style="border-color:#34d399">✓ تم تحديث التطبيق إلى نسخة جديدة (<b dir="ltr">' + esc(String(u.version).split('-')[0]) + '</b>). تُفتح تلقائياً بعد إغلاق هذه النافذة.<button class="ob" id="offRestart" style="margin-top:8px">فتح النسخة الجديدة الآن</button></div>';
    if (u.state === 'failed') return '<div class="warn">تعذّر تثبيت تحديث التطبيق. يبقى التطبيق على نسخته الحالية، ويصلك التحديث مع الرد القادم.</div>';
    return '';
  }
  async function updateDone(text) {
    const u = await applyUpdate(text);
    show(`<h2>تحديث التطبيق</h2>${u && u.state === 'installed' ? updateNote(u) : u && u.state === 'same' ? '<p>تطبيقك محدَّث ✓</p>' : updateNote(u || { state: 'failed' })}<button class="ob" id="offOk">حسناً</button>`);
    $('#offOk').onclick = close;
    const rs = $('#offRestart'); if (rs) rs.onclick = () => location.reload();
  }
  // v1.26.7: the app keeps itself on the newest version, with no tap. It looks at the site when it opens, when it comes
  // back to the front, when the network returns and every 20 minutes; a new version is installed by the service worker
  // (signed and checked as before) and the app restarts by itself as soon as nobody is typing or in the middle of a screen.
  function keepCurrent() {
    if (AS || !('serviceWorker' in navigator)) return;
    let pending = false, checking = false, hadCtl = !!navigator.serviceWorker.controller;
    const idle = () => { const a = document.activeElement; return !layer && !(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)); };
    const reloadNow = () => {
      try {
        const n = JSON.parse(sessionStorage.getItem('waslAutoReload') || '[]').filter((t) => Date.now() - t < 600000);
        if (n.length >= 2) return;   // never a restart loop
        n.push(Date.now()); sessionStorage.setItem('waslAutoReload', JSON.stringify(n));
      } catch (e) { /* none */ }
      location.reload();
    };
    const tryReload = () => { if (pending && (document.hidden || idle())) reloadNow(); };
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadCtl) pending = true; hadCtl = true; tryReload(); });
    async function check() {
      if (checking) return; checking = true;
      try {
        const r = await fetch('./release.json?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) return;
        const site = (JSON.parse(await r.text()).version) || '';
        if (!site || site === APP_VERSION) { pending = false; return; }
        const reg = await navigator.serviceWorker.getRegistration(); if (!reg) return;
        await reg.update();
        if (!reg.installing && !reg.waiting) {   // nothing new to install: this page is simply older than the active version
          const key = site + '|' + APP_VERSION;
          if (localStorage.getItem('waslAutoTry') !== key) { localStorage.setItem('waslAutoTry', key); pending = true; }
        }
      } catch (e) { /* offline: tried again later */ } finally { checking = false; tryReload(); }
    }
    window.WaslKeepCurrent = check;
    window.WaslReloadWhenIdle = () => { pending = true; tryReload(); };   // v1.28.0: after an update that came in a reply
    document.addEventListener('visibilitychange', () => { if (document.hidden) tryReload(); else check(); });
    window.addEventListener('online', check);
    setInterval(() => { check(); tryReload(); }, 20 * 60 * 1000);
    setInterval(tryReload, 8000);
    setTimeout(check, 3000);
  }
  async function forceUpdate() {
    const b = $('#offUpd'), m = $('#offUpdMsg'), say = (t, bad) => { if (m) { m.textContent = t; m.style.color = bad ? '#b91c1c' : '#475569'; } };
    if (b) b.disabled = true; say('جارٍ التحديث…');
    try { localStorage.removeItem('waslInstallFail'); } catch (e) { /* none */ }
    let reg = null; try { reg = await navigator.serviceWorker.getRegistration(); } catch (e) { reg = null; }
    if (!reg) { location.reload(); return; }
    let done = false;
    const finish = (ok) => { if (done) return; done = true; if (ok) { say('تمّ. يُعاد فتح التطبيق…'); setTimeout(() => location.reload(), 600); } else { say('تعذّر التحديث الآن. أعد المحاولة بعد قليل.', true); if (b) b.disabled = false; } };
    navigator.serviceWorker.addEventListener('controllerchange', () => finish(true), { once: true });
    navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.type === 'wasl-install-failed') { console.warn('update refused:', e.data.why); finish(false); } });
    try { await reg.update(); } catch (e) { finish(false); return; }
    const w = reg.installing || reg.waiting;
    if (w) w.addEventListener('statechange', () => { if (w.state === 'activated') finish(true); else if (w.state === 'redundant') finish(false); });
    setTimeout(() => finish(false), 45000);
  }
  window.WaslAccount = () => openAccount();
  function bindAccount() {
    const a = document.getElementById('userAvatar'); if (!a || a.dataset.acc) return;
    a.dataset.acc = '1'; a.setAttribute('role', 'button'); a.setAttribute('aria-label', 'حسابي');
    a.onclick = () => openAccount();   // v1.22.6: always the account (versions etc.); the suggestions button carries the red dot
    const nm = document.getElementById('userName'); if (nm && !nm.dataset.acc) { nm.dataset.acc = '1'; nm.style.cursor = 'pointer'; nm.onclick = openAccount; }
    fbDot(); setTimeout(fbWeekly, 4000);
  }

  // v1.19.5: once logged in, the PIN typed in the (now hidden) login form is cleared. Left there, Chrome saw every
  // back-button history step taken inside the app as a new login and offered again and again to save the password.
  function clearLoginPin() { const p = $('#loginPinInput'); if (p && p.value) p.value = ''; }
  async function afterLogin() {
    setTimeout(clearLoginPin, 1500);
    setTimeout(updateBadge, 300);
    setTimeout(bindAccount, 1000);
    setTimeout(freshBanner, 900);
    setTimeout(addSpotButton, 750);
    setTimeout(addPlanButton, 850);
    setTimeout(a4Banner, 600);
    setTimeout(addWatchButton, 700);
    setTimeout(areaBanner, 800);
    hookA4Members();
    // the programs screens are drawn later (department switch): add the hint each time they are drawn
    if (typeof renderActivities === 'function' && !renderActivities.__hint) {
      const ra = renderActivities;
      window.renderActivities = function () { const r = ra.apply(this, arguments); setTimeout(areaBanner, 50); return r; };
      window.renderActivities.__hint = true;
    }
    const st = await rpc('status');
    if (st.mustUpgradeSecret) setTimeout(() => changeSecret(true), 400);
  }
  /** A4: on the phone, percentages and lists on request; the full programs view stays on the master. */
  /** A4 on a phone: contribution details and the setup checks stay on the master; T4: no «courses I follow» tab. */
  async function a4Banner() {
    let d; try { d = await rpc('details'); } catch (e) { return; }
    if (!d || d.admin) return;           // the station administrator: every screen, all the data
    if (d.tier === 'A4' && !$('#offA4css')) {
      const css2 = document.createElement('style'); css2.id = 'offA4css'; css2.textContent = '#actContrib,#actAreas,#actReports{display:none!important}'; document.head.appendChild(css2);
    }
    if (d.eduTier === 'T4') {
      // a T4 phone holds its own courses only: the second tab would always be empty
      const tabs = $('#roleWorkspaceTabs'); if (tabs) tabs.style.display = 'none';
      if (typeof switchWorkspaceTab === 'function') switchWorkspaceTab('personal');
    }
  }
  // ---------------------------------------------------------------- «متابعة الفريق» (T3, A3): red flags only
  const sinceTxt = (n) => (n === null || n === undefined ? 'لا شيء بعد' : n === 0 ? 'اليوم' : n === 1 ? 'منذ يوم' : n === 2 ? 'منذ يومين' : 'منذ ' + n + (n <= 10 ? ' أيام' : ' يوماً'));
  async function addWatchButton() {
    let d; try { d = await rpc('details'); } catch (e) { return; }
    const w = d && d.watch; if (!w || $('#offWatchBtn')) return;
    const sync = $('#offSyncBtn'); if (!sync || !sync.parentNode) return;
    const b = document.createElement('button'); b.id = 'offWatchBtn'; b.type = 'button'; b.title = w.act && w.act.tier === 'A4' ? 'لوحة البرامج' : 'متابعة تحت إشرافي';
    b.className = sync.className;
    b.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/></svg><span id="offWatchBadge"></span>';
    b.style.position = 'relative';
    sync.parentNode.insertBefore(b, sync);
    const red = (w.edu ? w.edu.red : 0) + (w.act ? w.act.red : 0);
    const bd = $('#offWatchBadge');
    if (red) { bd.textContent = red > 30 ? '+' : String(red); bd.style.cssText = 'position:absolute;top:2px;left:2px;min-width:16px;height:16px;border-radius:8px;background:#dc2626;color:#fff;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;padding:0 3px'; }
    b.onclick = openWatch;
  }
  function li(t, red) { return '<li style="margin:3px 0' + (red ? ';color:#b91c1c;font-weight:700' : '') + '">' + t + '</li>'; }
  async function openWatch() {
    let d; try { d = await rpc('details'); } catch (e) { return; }
    const w = d.watch; if (!w) return;
    const A4 = !!(w.act && w.act.tier === 'A4');
    let h = '<button class="x" id="offX">×</button><h2>' + (A4 ? 'لوحة البرامج' : 'متابعة تحت إشرافي') + '</h2><p style="font-size:12px;color:#64748b">حتى ' + dayOf(w.asOf) + '، يُحدَّث مع كل أخذ للتحيينات.</p>';
    if (A4) h += await a4Board(w.act, d);
    if (w.edu) {
      const L = w.edu.limits;
      const flagged = w.edu.teachers.filter((t) => t.red), calm = w.edu.teachers.filter((t) => !t.red);
      h += '<h2 style="font-size:15px;margin-top:10px">التعليم</h2>';
      if (!flagged.length) h += '<div class="note">لا ملاحظات.</div>';
      flagged.forEach((t) => {
        const items = [];
        if (t.askUpdate) items.push(li((t.sinceDays === null ? 'لم يصل منه أي تحيين' : 'آخر تحيين منه ' + sinceTxt(t.sinceDays)) + ': اطلب منه التحيينات', true));
        const never = t.courses.filter((c) => c.flags.indexOf('never') !== -1).map((c) => esc(c.label || c.code));
        if (never.length) items.push(li((never.length > 1 ? 'دروس لم تبدأ (لا حصة مسجّلة): ' : 'درس لم يبدأ (لا حصة مسجّلة): ') + never.join('، '), true));
        t.courses.forEach((c) => {
          if (c.flags.indexOf('stopped') !== -1) items.push(li('الدرس ' + esc(c.label || c.code) + ': لا حصة منذ ' + L.STALE_DAYS + ' يوماً، آخر حصة ' + sinceTxt(c.sinceDays) + ' (إن توقف، يحدّث المدرس حالة الدرس)', true));
          if (c.flags.indexOf('notHeld') !== -1) items.push(li('الدرس ' + esc(c.label || c.code) + ': لم يُعقد ' + c.notHeld + ' مرات في ' + L.NOT_HELD_WINDOW + ' يوماً', true));
        });
        if (t.absent.length) items.push(li('غائبون دون اتصال:<ul style="margin:2px 0;padding-right:16px">' + t.absent.map((x) => '<li>' + esc(x.name) + ' — ' + esc(x.course) + ' — ' + x.streak + ' غيابات متتالية</li>').join('') + '</ul>', false));
        h += '<div style="border:1px solid #fecaca;background:#fff7f7;border-radius:14px;padding:10px 12px;margin:8px 0"><b>' + esc(t.name) + '</b><ul style="margin:4px 0;padding-right:16px">' + items.join('') + '</ul></div>';
      });
      if (calm.length) h += '<p style="font-size:12px;color:#047857">دون ملاحظات: ' + calm.map((t) => esc(t.name)).join('، ') + '</p>';
      const declared = [];
      w.edu.teachers.forEach((t) => t.courses.forEach((c) => { if (c.declared === 'متوقف') declared.push(esc(c.label || c.code) + ' (' + esc(t.name) + (c.stopReason ? '، ' + esc(c.stopReason) : '') + ')'); }));
      if (declared.length) h += '<p style="font-size:12px;color:#64748b">دروس متوقفة بإعلان المدرس: ' + declared.join('، ') + '</p>';
    }
    if (w.act) {
      h += A4 ? '<details style="margin-top:12px"><summary style="cursor:pointer;font-size:15px;font-weight:800">كل الصفوف (' + w.act.classes.filter((c) => !c.out).length + ')</summary>' : '<h2 style="font-size:15px;margin-top:12px">البرامج — ' + esc(w.act.month) + '</h2>';
      w.act.classes.forEach((c) => {
        const items = [];
        if (!c.out) items.push(li('درس الصف: ' + (c.lastRoll ? 'آخر حضور ' + sinceTxt(c.sinceDays) : 'لا حضور مسجّل'), c.stopped));
        items.push(li('المساهمة الشهرية: ' + (c.paidPct === null ? 'لا أعضاء في المستوى 7' : c.paidPct + '٪ دفعوا'), !!c.payLate));
        if (c.l7Att !== null && c.l7Att !== undefined) items.push(li('حضور أعضاء المستوى 7 (30 يوماً): ' + c.l7Att + '٪', c.l7Att < 50));
        if (c.absent3 && c.absent3.length) items.push(li('غابوا ' + w.act.limits.ABSENT_LIMIT + ' مرات أو أكثر هذا الشهر: ' + c.absent3.map((x) => esc(x.name) + ' (' + x.n + ')').join('، '), true));
        if (c.notPaid.length) items.push('<li><details><summary style="cursor:pointer;font-weight:700">لم يدفعوا هذا الشهر</summary><ul style="margin:2px 0;padding-right:16px">' + c.notPaid.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul></details></li>');
        if (c.level7.length) items.push('<li><details><summary style="cursor:pointer;font-weight:700">أعضاء المستوى 7</summary><ul style="margin:2px 0;padding-right:16px">' + c.level7.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul></details></li>');
        h += '<div style="border:1px solid ' + (c.red ? '#fecaca;background:#fff7f7' : '#d1fae5;background:#f6fffa') + ';border-radius:14px;padding:10px 12px;margin:8px 0"><b>' + esc(c.label) + '</b><ul style="margin:4px 0;padding-right:16px">' + items.join('') + '</ul></div>';
      });
      if (A4) h += '</details>';
      h += areaHint(d);
    }
    show(h + '<div id="offErr" class="err" style="display:none"></div>');
    $('#offX').onclick = close;
    bindAreaAsk(openWatch);
  }
  /** v1.21.0: the A4's board: the totals, what needs attention, what is coming, and the report. */
  async function a4Board(a, d) {
    const T = a.totals || {}, L = a.limits || {};
    const cls = a.classes.filter((c) => !c.out);
    const tile = (v, t, bad) => '<div style="flex:1;min-width:90px;background:' + (bad ? '#fff7f7' : '#f6fffa') + ';border:1px solid ' + (bad ? '#fecaca' : '#d1fae5') + ';border-radius:14px;padding:8px;text-align:center"><div style="font-size:20px;font-weight:800">' + v + '</div><div style="font-size:11.5px;color:#475569">' + t + '</div></div>';
    const stale = cls.filter((c) => c.stopped);
    let h = '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0">'
      + tile(T.l7Att === null || T.l7Att === undefined ? '—' : T.l7Att + '٪', 'حضور أعضاء المستوى 7 (30 يوماً)', T.l7Att !== null && T.l7Att < 50)
      + tile(T.paidPct === null || T.paidPct === undefined ? '—' : T.paidPct + '٪', 'دفعوا المساهمة هذا الشهر', T.paidPct !== null && T.paidPct < 50)
      + tile(stale.length + ' / ' + cls.length, 'صفوف بلا درس منذ ' + L.STALE_DAYS + ' يوماً', stale.length > 0) + '</div>';
    // what needs attention
    const items = [];
    stale.forEach((c) => items.push(li(esc(c.label) + ': ' + (c.lastRoll ? 'لا درس صف منذ ' + c.sinceDays + ' يوماً' : 'لا حضور مسجّل لدرس الصف'), true)));
    cls.forEach((c) => (c.absent3 || []).forEach((x) => items.push(li(esc(x.name) + ' — ' + esc(c.label) + ': غاب ' + x.n + ' مرات هذا الشهر', true))));
    cls.filter((c) => c.payLate).forEach((c) => items.push(li(esc(c.label) + ': ' + c.paidPct + '٪ فقط دفعوا المساهمة', false)));
    h += '<h2 style="font-size:15px;margin-top:10px">يحتاج انتباهك</h2>' + (items.length ? '<ul style="margin:4px 0;padding-right:16px;font-size:13px">' + items.join('') + '</ul>' : '<div class="note">لا شيء الآن.</div>');
    // v1.21.1: growth and contributions
    const G = a.growth;
    if (G) {
      const GL = G.limits || {};
      const fold = (title, list, row, empty, open) => '<details' + (open ? ' open' : '') + ' style="margin-top:10px"><summary style="cursor:pointer;font-size:15px;font-weight:800">' + title + ' (' + list.length + ')</summary>'
        + (list.length ? '<ul style="margin:4px 0;padding-right:16px;font-size:13px">' + list.slice(0, 60).map((x) => '<li style="margin:3px 0">' + row(x) + '</li>').join('') + '</ul>' : '<div class="note">' + empty + '</div>') + '</details>';
      h += fold('قريبون من المستوى 7', G.close, (x) => esc(x.name) + ' — ' + esc(x.cls) + ' — <b>' + x.att + '٪</b>',
        'لا أحد الآن.', true) + '<div style="font-size:11.5px;color:#64748b">أعضاء المستوى 6 الذين حضروا ' + GL.CLOSE_PCT + '٪ أو أكثر من دروسهم في ' + GL.CLOSE_DAYS + ' يوماً.</div>';
      h += fold('يتراجع حضورهم', G.fading, (x) => esc(x.name) + ' — ' + esc(x.cls) + ' — <span style="color:#b91c1c;font-weight:700">' + x.before + '٪ ← ' + x.now + '٪</span>',
        'لا أحد الآن.', true) + '<div style="font-size:11.5px;color:#64748b">أعضاء المستوى 7: حضورهم في درس الصف آخر 30 يوماً أقل بـ' + GL.FADE_DROP + ' نقطة أو أكثر من الأشهر الثلاثة قبلها.</div>';
      const C = G.contrib, mx = 100;
      h += '<h2 style="font-size:15px;margin-top:12px">المساهمة الشهرية (المستوى 7)</h2><div style="display:flex;gap:6px;align-items:flex-end;height:90px;margin:6px 0">'
        + C.trend.map((t) => '<div style="flex:1;text-align:center;font-size:10.5px"><div style="font-weight:800">' + (t.pct === null ? '—' : t.pct + '٪') + '</div><div style="height:' + Math.max(2, Math.round(55 * (t.pct || 0) / mx)) + 'px;background:#1e382b;border-radius:4px 4px 0 0"></div><div style="color:#64748b">' + esc(t.month.slice(5)) + '</div></div>').join('') + '</div>'
        + '<ul style="margin:4px 0;padding-right:16px;font-size:13px">' + li('أعلنوا مساهمة: ' + (C.promisedPct === null ? '—' : C.promisedPct + '٪') + ' من أعضاء المستوى 7') + li('المدفوع هذا الشهر من المبلغ المعلن: ' + (C.paidOfPromised === null ? '—' : C.paidOfPromised + '٪')) + '</ul>'
        + fold('أعلنوا ولم يدفعوا منذ 3 أشهر', C.unpaid3, (x) => esc(x.name) + ' — ' + esc(x.cls), 'لا أحد.', false);
    }
    // what is coming: the plan, next 3 weeks
    try {
      const today = (a.asOf || new Date().toISOString()).slice(0, 10), end = new Date(Date.now() + 21 * 86400e3).toISOString().slice(0, 10);
      const r = await LocalBackend.call({ action: 'planList' });
      const up = ((r && r.items) || []).filter((x) => x.from && x.from >= new Date().toISOString().slice(0, 10) && x.from <= end).sort((x, y) => (x.from < y.from ? -1 : 1));
      h += '<h2 style="font-size:15px;margin-top:12px">القادم (3 أسابيع)</h2>' + (up.length ? '<ul style="margin:4px 0;padding-right:16px;font-size:13px">' + up.slice(0, 20).map((x) => '<li style="margin:3px 0"><b>' + dayOf(x.from) + '</b> — ' + esc(x.title || x.type || '') + ((x.centres || []).length ? ' <small style="color:#64748b">(' + esc((x.centres || []).join('، ')) + ')</small>' : '') + '</li>').join('') + '</ul>' : '<div class="note">لا أنشطة في الأسابيع الثلاثة القادمة.' + (r && r.draft ? ' خطة السنة لم تُعتمد بعد.' : '') + '</div>');
      void today;
    } catch (e) { /* no plan */ }
    if (d && d.prog) h += '<button class="ob l" id="offA4Report" style="margin-top:10px">تقرير البرامج (30 يوماً)</button>';
    setTimeout(() => { const b = $('#offA4Report'); if (b) b.onclick = openDetails; }, 0);
    return h;
  }
  /** A3: what is not on the phone, and the 7-day request for the missing levels (v1.26.9: at the bottom of the classes screen). */
  function areaLevels(ref) { const m = /^L([1-7])-([1-7])$/.exec(String(ref || '')); return m ? [Number(m[1]), Number(m[2])] : [1, 7]; }
  function areaWords(ref) { const r = areaLevels(ref); return r[0] === r[1] ? 'المستوى ' + r[0] : r[0] === 1 && r[1] === 7 ? 'كل المستويات' : 'من المستوى ' + r[0] + ' إلى ' + r[1]; }
  function areaHint(d, sfx) {
    sfx = sfx || '';
    const w = d.watch, hid = w && w.act && w.act.hidden;
    if (!d.canArea || !hid) return '';
    const gs = (d.grants || []).filter((x) => x.kind === 'area'), asked = d.asked.filter((a) => a.kind === 'area');
    let h = '';
    gs.forEach((g) => { h += '<div class="note" style="margin-bottom:8px">' + areaWords(g.ref) + ': قائمتهم الكاملة على هاتفك حتى ' + dayOf(g.until) + '.</div>'; });
    asked.forEach((a) => { h += '<div class="note" style="margin-bottom:8px">طلب ' + areaWords(a.ref) + ' يُرسل مع التحيينات القادمة.</div>'; });
    if (!hid.pct && !gs.length && !asked.length) return '';
    const opt = (n, sel) => '<option value="' + n + '"' + (n === sel ? ' selected' : '') + '>' + n + '</option>';
    const range = [1, 2, 3, 4, 5, 6, 7];
    h += '<div class="warn"><b>القائمة الكاملة</b><div style="margin-top:4px">' + (hid.pct ? hid.pct + '٪ من أفراد الصفوف التي تحت إشرافك غير ظاهرين على هاتفك. ' : '') + 'اختر المستويات التي تريدها، وتبقى على هاتفك 7 أيام.</div>' +
      '<div style="display:flex;gap:8px;align-items:center;margin-top:8px"><label style="flex:1;font-size:12px">من المستوى<select id="offAreaFrom' + sfx + '" style="width:100%;padding:8px;border-radius:10px;border:1px solid #d5e0da;background:#fff;font-family:inherit">' + range.map((n) => opt(n, 1)).join('') + '</select></label>' +
      '<label style="flex:1;font-size:12px">إلى المستوى<select id="offAreaTo' + sfx + '" style="width:100%;padding:8px;border-radius:10px;border:1px solid #d5e0da;background:#fff;font-family:inherit">' + range.map((n) => opt(n, 7)).join('') + '</select></label></div>' +
      '<button class="ob" id="offAskArea' + sfx + '" style="margin-top:8px">طلب القائمة لمدة 7 أيام</button></div>';
    return h;
  }
  function bindAreaAsk(after, sfx) {
    sfx = sfx || '';
    const b = $('#offAskArea' + sfx); if (!b) return;
    b.onclick = async () => {
      const f = Number($('#offAreaFrom' + sfx).value), t = Number($('#offAreaTo' + sfx).value);
      if (f > t) return errBox('اختر مستوى البداية أصغر من مستوى النهاية.');
      const r = await LocalBackend.call({ action: 'requestDetails', kind: 'area', ref: 'L' + f + '-' + t });
      if (r && r.success) { updateBadge(); after(); } else errBox((r && r.error) || 'تعذّر الطلب');
    };
  }
  /** A3: at the bottom of the classes screen, so nobody takes the list for complete. */
  async function areaBanner() {
    let d; try { d = await rpc('details'); } catch (e) { return; }
    const html = d ? areaHint(d, 'Top') : '';
    let el = $('#offAreaHint');
    const main = $('#actMain'); if (!main) return;
    if (!html) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'offAreaHint'; el.style.marginTop = '14px'; }
    if (el.parentNode !== main || main.lastElementChild !== el) main.appendChild(el);
    el.innerHTML = html;
    bindAreaAsk(areaBanner, 'Top');
  }
  function addSyncButton() {
    const hdr = document.querySelector('#appShell header .flex.items-center.gap-1\\.5');
    if (!hdr || $('#offSyncBtn')) return;
    const b = document.createElement('button');
    b.id = 'offSyncBtn'; b.type = 'button'; b.title = 'المزامنة';
    b.className = 'p-2.5 rounded-xl text-slate-600 hover:text-olive-700 hover:bg-slate-200/60 transition-all cursor-pointer';
    b.innerHTML = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7h11m0 0l-3-3m3 3l-3 3M20 17H9m0 0l3-3m-3 3l3 3"/></svg><span id="offSyncBadge"></span>';
    b.onclick = openSync;
    hdr.insertBefore(b, hdr.firstChild);
  }
  async function prepareLogin(st) {
    const email = $('#loginEmailInput');
    // one phone = one person: the e-mail is not asked, only the PIN
    if (email) { email.value = st.email; email.readOnly = true; const box = email.parentElement && email.parentElement.parentElement; if (box) box.style.display = 'none'; }
    const pin = $('#loginPinInput');
    try { if (pin && localStorage.getItem('offPinKind') === 'text') pin.setAttribute('inputmode', 'text'); } catch (e) { /* none */ }
    const form = document.querySelector('#loginScreen form');
    if (form && !$('#offForgot')) {
      const f = document.createElement('div');
      f.innerHTML = '<button type="button" id="offForgot">نسيت الرمز السري؟</button><div id="offForgotNote" style="display:none">راجع مسؤولك ليعيد تسجيل هذا الهاتف.<br>ما أرسلته من قبل محفوظ ويعود إليك بعد التسجيل.</div>';
      form.parentNode.insertBefore(f, form.nextSibling);
      $('#offForgot').onclick = () => { const n = $('#offForgotNote'); n.style.display = n.style.display === 'none' ? 'block' : 'none'; };
    }
    if (!standalone() && !$('#offTabWarn')) {
      const w = document.createElement('div'); w.id = 'offTabWarn';
      w.textContent = 'افتح التطبيق من أيقونته على الشاشة الرئيسية، لا من المتصفح.';
      document.body.insertBefore(w, document.body.firstChild);
    }
  }

  // ---------------------------------------------------------------- no big numbers on screen
  // Rule: a count above 30 is not shown in the app's screens (percentages, dates, times, phone numbers and ids are untouched).
  // the 30 rule (counts above 30 hidden): shared/count-cap.js
  const capText = (t) => window.CountCap.capText(t);
  function watchCounts() { window.CountCap.watch(document.getElementById('appShell')); }
  window.__offlineCapText = capText;

  // ---------------------------------------------------------------- automatic lock
  const loggedIn = () => typeof AppState !== 'undefined' && !!AppState.currentUser;
  window.__offlineLoggedIn = loggedIn;
  let lastUse = Date.now(), hiddenAt = 0;
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, () => { lastUse = Date.now(); }, { passive: true }));
  async function lockNow() {
    if (AS) return;
    try { await rpc('lock'); } catch (e) { /* already */ }
    close();
    if (typeof handleLogout === 'function' && loggedIn()) handleLogout(false);
  }
  setInterval(() => { if (!document.hidden && Date.now() - lastUse > IDLE_MS && loggedIn()) lockNow(); }, 15000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (hiddenAt && Date.now() - hiddenAt > HIDDEN_MS && loggedIn()) lockNow();
    else lastUse = Date.now();   // back within the time: the time away does not count as idle
  });

  // ---------------------------------------------------------------- start
  // ---------------------------------------------------------------- on the master station, as a chosen person
  async function startAsStation() {
    const st0 = document.createElement('style');
    st0.textContent = '#offSyncBtn{display:none!important}#offAsBar{position:sticky;top:0;z-index:95;background:#7c2d12;color:#fff;font:700 13px Tajawal,sans-serif;padding:8px 12px;display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap;text-align:center}#offAsBar b{color:#fde68a}#offAsBar button{border:0;border-radius:999px;padding:4px 14px;background:#fff;color:#7c2d12;font:800 12px Tajawal,sans-serif;cursor:pointer}#offAsBar small{font-weight:500;opacity:.9}';
    document.head.appendChild(st0);
    let st;
    try { st = await rpc('status'); }
    catch (e) { document.body.insertAdjacentHTML('afterbegin', '<div id="offAsBar">' + esc(e.message) + '</div>'); return; }
    const bar = document.createElement('div'); bar.id = 'offAsBar';
    bar.innerHTML = st.admin
      ? '<span><b>' + esc(st.name) + '</b>: كل الصلاحيات على كل البيانات</span><small>كل تعديل يُحفظ في المحطة مباشرة، ويصل الهواتف مع مزامنتها القادمة.</small><button type="button" id="offAsEnd">إنهاء</button>'
      : '<span>على المحطة، باسم <b>' + esc(st.name) + '</b> <small dir="ltr">' + esc(st.email) + '</small></span><small>كل تعديل يُحفظ في المحطة مباشرة باسمه، ويصل هاتفه مع مزامنته القادمة.</small><button type="button" id="offAsEnd">إنهاء</button>';
    if (st.admin) bar.style.background = '#1e382b';
    document.body.insertBefore(bar, document.body.firstChild);
    $('#offAsEnd').onclick = () => { try { window.close(); } catch (e) { /* not opened by script */ } setTimeout(() => { location.href = '/'; }, 150); };
    if (typeof window.handleLogout === 'function' && !window.handleLogout.__offline) {
      const orig = window.handleLogout;
      window.handleLogout = function () { close(); const r = orig.apply(this, arguments); setTimeout(() => { location.href = '/'; }, 200); return r; };
      window.handleLogout.__offline = true;
    }
    // signed in at once: the station is already unlocked with its passphrase
    const e = $('#loginEmailInput'), p = $('#loginPinInput');
    if (e && p && typeof submitEmailPinLogin === 'function') { e.value = st.email; p.value = 'station'; submitEmailPinLogin(); }
  }

  function startFailed(e) {
    show(`<h2>تعذّر فتح التطبيق</h2><p>أغلق التطبيق وافتحه من جديد. إن تكرّر هذا، امسح بيانات الموقع من إعدادات المتصفح ثم افتح الرابط من جديد.</p>
      <div class="hint" dir="ltr" style="word-break:break-all">${esc(String((e && e.message) || e || '').slice(0, 160))}</div>
      <button class="ob" id="offRetry">إعادة المحاولة</button>`);
    $('#offRetry').onclick = () => location.reload();
  }
  async function start() {
    if (window.WaslDemoReady) await window.WaslDemoReady;   // board demo only: the demo page chooses the person first
    keepCurrent();
    startUpdater();
    if (AS) { addSyncButton(); watchCounts(); return startAsStation(); }
    addSyncButton();
    watchCounts();
    { const em = $('#loginEmailInput'), box = em && em.parentElement && em.parentElement.parentElement; if (box) box.style.display = 'none'; }   // Wasl never asks for the e-mail
    // every way out of the app (button, expired session) also closes the phone's data
    if (typeof window.handleLogout === 'function' && !window.handleLogout.__offline) {
      const orig = window.handleLogout;
      window.handleLogout = function () { rpc('lock').catch(() => {}); close(); return orig.apply(this, arguments); };
      window.handleLogout.__offline = true;
    }
    let st;
    // v1.23.2: never fall back silently to the bare sign-in screen (it asks for an e-mail Wasl never uses)
    try { st = await rpc('status'); } catch (e) { return startFailed(e); }
    if (st.state !== 'enrolled') return onboarding(st);
    prepareLogin(st);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
