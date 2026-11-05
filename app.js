/* Conversation page: read-only view of every lead and each lead's SMS thread.
   Backend: Supabase (phone OTP auth, views `lead_list` + `conversation`, Realtime on base tables).
   Every message body is untrusted lead input: it is only ever written with textContent. */
(function () {
  'use strict';

  var L = window.CVLib;
  var cfg = window.CV_CONFIG || {};
  var host = location.hostname;
  var isLocal = location.protocol === 'file:' || host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  var qs = new URLSearchParams(location.search);
  var MOCK = isLocal && qs.get('mock') === '1';
  var TARGET_KEY = 'cv_target_lead';
  var RESEND_SECONDS = 60;

  function $(id) { return document.getElementById(id); }
  var el = {
    topbar: $('topbar'), back: $('btn-back'), title: $('title'), subtitle: $('subtitle'),
    live: $('live'), liveText: $('live-text'), menuBtn: $('btn-menu'), menu: $('menu'), signout: $('btn-signout'),
    signin: $('screen-signin'), list: $('screen-list'), thread: $('screen-thread'),
    formPhone: $('form-phone'), phone: $('phone'), phoneErr: $('phone-error'), btnSend: $('btn-send'),
    formCode: $('form-code'), code: $('code'), codePhone: $('code-phone'), codeErr: $('code-error'), codeNote: $('code-note'),
    btnVerify: $('btn-verify'), btnResend: $('btn-resend'), btnChange: $('btn-change'), configErr: $('config-error'),
    listScroll: $('list-scroll'), listLoading: $('list-loading'), leadList: $('lead-list'), listEmpty: $('list-empty'), listErr: $('list-error'),
    strip: $('strip'), stripChip: $('strip-chip'), stripTime: $('strip-time'),
    threadScroll: $('thread-scroll'), threadLoading: $('thread-loading'), threadBox: $('thread'), threadEmpty: $('thread-empty'),
    threadErr: $('thread-error'), pill: $('new-pill')
  };

  var S = {
    api: null,
    signedIn: false,
    leads: [],
    listLoaded: false,
    thread: { id: null, lead: null, rows: [], loaded: false, sig: '', count: 0 },
    live: 'off',
    stopLive: null,
    seq: { list: 0, thread: 0 },
    phone: null,
    resendTimer: null,
    resendAt: 0,
    refreshTimer: null,
    retryTimer: null,
    busy: false,
    screen: ''
  };

  /* ---------- small utils ---------- */

  function store(op, key, val) {
    try {
      if (op === 'get') return sessionStorage.getItem(key);
      if (op === 'set') sessionStorage.setItem(key, val);
      if (op === 'del') sessionStorage.removeItem(key);
    } catch (e) { /* storage can be blocked: the page still works */ }
    return null;
  }

  function show(node, on) { node.hidden = !on; }

  function setText(node, text) {
    node.textContent = text || '';
    node.hidden = !text;
  }

  function make(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  /* ---------- API layer ---------- */

  function makeRealApi() {
    var client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      realtime: { params: { eventsPerSecond: 5 } }
    });

    function ok(r) { if (r.error) throw r.error; return r.data; }

    return {
      getSession: function () {
        return client.auth.getSession().then(function (r) { return r.data && r.data.session; });
      },
      onAuth: function (cb) { client.auth.onAuthStateChange(function (ev, session) { cb(ev, session); }); },
      sendCode: function (phone) {
        return client.auth.signInWithOtp({ phone: phone, options: { shouldCreateUser: false } });
      },
      verify: function (phone, token) {
        return client.auth.verifyOtp({ phone: phone, token: token, type: 'sms' });
      },
      signOut: function () { return client.auth.signOut({ scope: 'local' }); },
      fetchList: function () {
        return client.from('lead_list').select('*')
          .order('last_activity_at', { ascending: false, nullsFirst: false }).limit(1000).then(ok);
      },
      fetchThread: function (id) {
        return Promise.all([
          client.from('lead_list').select('*').eq('lead_id', id).maybeSingle().then(ok),
          client.from('conversation').select('*').eq('lead_id', id)
            .order('at', { ascending: true }).limit(2000).then(ok)
        ]).then(function (r) { return { lead: r[0], rows: r[1] }; });
      },
      // Payloads are never trusted: any event just triggers a refetch.
      subscribe: function (onEvent, onStatus) {
        var ch = client.channel('cv-live')
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, onEvent)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'processed_messages' }, onEvent)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, onEvent)
          .subscribe(function (status) { onStatus(status); });
        return function () { client.removeChannel(ch); };
      }
    };
  }

  function loadMock() {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'mock.js';
      s.onload = function () { resolve(window.CV_MOCK_API(qs)); };
      s.onerror = function () { reject(new Error('mock.js missing')); };
      document.head.appendChild(s);
    });
  }

  /* ---------- screens ---------- */

  function setScreen(name) {
    S.screen = name;
    show(el.signin, name === 'signin');
    show(el.list, name === 'list');
    show(el.thread, name === 'thread');
    show(el.topbar, name !== 'signin');
    show(el.back, name === 'thread');
    if (name === 'list') {
      el.title.textContent = 'Leads';
      setText(el.subtitle, '');
    }
    closeMenu();
  }

  function showSignin() {
    setScreen('signin');
  }

  /* ---------- live status ---------- */

  function setLive(state) {
    S.live = state;
    el.live.className = 'live ' + (state === 'on' ? 'on' : state === 'retry' ? 'retry' : '');
    el.liveText.textContent = state === 'on' ? 'Live' : state === 'retry' ? 'Reconnecting' : 'Offline';
  }

  function startLive() {
    stopLive();
    setLive('retry');
    S.stopLive = S.api.subscribe(
      function () { scheduleRefresh(400); },
      function (status) {
        if (status === 'SUBSCRIBED') { setLive('on'); scheduleRefresh(0); }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setLive('retry');
        else if (status === 'CLOSED') setLive(S.signedIn ? 'retry' : 'off');
      }
    );
  }

  function stopLive() {
    if (S.stopLive) { try { S.stopLive(); } catch (e) { /* ignore */ } }
    S.stopLive = null;
    setLive('off');
  }

  /* ---------- refresh (debounced) ---------- */

  function scheduleRefresh(delay) {
    clearTimeout(S.refreshTimer);
    S.refreshTimer = setTimeout(function () {
      if (!S.signedIn) return;
      refreshList();
      if (S.screen === 'thread' && S.thread.id) refreshThread();
    }, delay);
  }

  function retryLater() {
    if (S.retryTimer) return;
    S.retryTimer = setTimeout(function () { S.retryTimer = null; scheduleRefresh(0); }, 10000);
  }

  function isAuthFailure(e) {
    var msg = String((e && e.message) || '').toLowerCase();
    return (e && (e.status === 401 || e.code === 'PGRST301')) || /jwt/.test(msg);
  }

  function refreshList() {
    var n = ++S.seq.list;
    return S.api.fetchList().then(function (rows) {
      if (n !== S.seq.list || !S.signedIn) return;
      S.leads = L.sortLeads(rows);
      S.listLoaded = true;
      setText(el.listErr, '');
      renderList();
    }).catch(function (e) {
      if (n !== S.seq.list) return;
      if (!S.listLoaded) {
        show(el.listLoading, false);
        setText(el.listErr, isAuthFailure(e) ? 'Your session ran out. Sign out and sign in again.' : "Couldn't load your leads. Trying again…");
      }
      retryLater();
    });
  }

  function refreshThread() {
    var id = S.thread.id;
    var n = ++S.seq.thread;
    return S.api.fetchThread(id).then(function (res) {
      if (n !== S.seq.thread || id !== S.thread.id || !S.signedIn) return;
      S.thread.lead = res.lead || null;
      S.thread.rows = res.rows || [];
      S.thread.loaded = true;
      setText(el.threadErr, '');
      renderThread();
    }).catch(function (e) {
      if (n !== S.seq.thread || id !== S.thread.id) return;
      if (!S.thread.loaded) {
        show(el.threadLoading, false);
        setText(el.threadErr, isAuthFailure(e) ? 'Your session ran out. Sign out and sign in again.' : "Couldn't load this conversation. Trying again…");
      }
      retryLater();
    });
  }

  /* ---------- list ---------- */

  function renderList() {
    show(el.listLoading, false);
    var leads = S.leads;
    show(el.listEmpty, leads.length === 0);
    show(el.leadList, leads.length > 0);
    var frag = document.createDocumentFragment();
    leads.forEach(function (lead) {
      var a = make('a', 'lead-row');
      a.href = '#/lead/' + encodeURIComponent(lead.lead_id);
      var st = L.statusInfo(lead.status);
      a.appendChild(make('span', 'lead-name', lead.display_name || 'Unnamed lead'));
      a.appendChild(make('span', 'lead-when', L.fmtAgo(lead.last_activity_at)));
      var meta = make('span', 'lead-meta');
      meta.appendChild(make('span', '', lead.event_date ? 'Event ' + L.fmtEventDate(lead.event_date) : 'No event date'));
      a.appendChild(meta);
      a.appendChild(make('span', 'chip tone-' + st.tone, st.label));
      frag.appendChild(a);
    });
    el.leadList.replaceChildren(frag);
  }

  function showList() {
    setScreen('list');
    S.thread.id = null;
    show(el.listLoading, !S.listLoaded);
    if (S.listLoaded) renderList();
    refreshList();
  }

  /* ---------- thread ---------- */

  function isNearBottom() {
    var s = el.threadScroll;
    return s.scrollHeight - s.scrollTop - s.clientHeight < 100;
  }

  function scrollToBottom() {
    el.threadScroll.scrollTop = el.threadScroll.scrollHeight;
    requestAnimationFrame(function () { el.threadScroll.scrollTop = el.threadScroll.scrollHeight; });
  }

  function renderThreadHeader() {
    var lead = S.thread.lead;
    el.title.textContent = (lead && lead.display_name) || 'Conversation';
    setText(el.subtitle, lead && lead.event_date ? 'Event ' + L.fmtEventDate(lead.event_date) : '');
    if (!lead) { show(el.strip, false); return; }
    var st = L.statusInfo(lead.status);
    el.strip.className = 'strip tone-' + st.tone;
    el.stripChip.className = 'chip tone-' + st.tone;
    el.stripChip.textContent = st.label;
    el.stripTime.textContent = lead.status_at ? L.fmtStamp(lead.status_at) : '';
    show(el.strip, true);
  }

  function bubble(m) {
    var out = m.direction === 'out';
    var owner = m.audience === 'owner';
    var row = make('div', 'row ' + (out ? 'out' : 'in') + (owner ? ' owner' : ''));
    var b = make('div', 'bubble');
    var label = L.kindLabel(m.kind);
    if (owner) label = label ? 'To you: ' + label : 'To you';
    if (label) b.appendChild(make('div', 'label', label));
    b.appendChild(make('p', 'text', m.body == null ? '' : String(m.body)));
    var t = make('time', 'stamp', L.fmtStamp(m.at));
    t.dateTime = new Date(m.at).toISOString();
    b.appendChild(t);
    row.appendChild(b);
    return row;
  }

  function renderThread() {
    renderThreadHeader();
    var rows = L.visibleMessages(S.thread.rows);
    show(el.threadLoading, false);
    if (!S.thread.lead && rows.length === 0) {
      show(el.threadBox, false);
      show(el.threadEmpty, false);
      setText(el.threadErr, "We can't find that lead. Go back to your list and pick one.");
      return;
    }
    var sig = rows.map(function (r) { return r.msg_id + ':' + String(r.body == null ? '' : r.body).length; }).join('|');
    var first = S.thread.sig === '' && !el.threadBox.hasChildNodes();
    if (sig === S.thread.sig && !first) return;

    var wasNear = first || isNearBottom();
    var prevTop = el.threadScroll.scrollTop;
    var grew = rows.length > S.thread.count;
    var frag = document.createDocumentFragment();
    var prev = null;
    rows.forEach(function (m) {
      if (!prev || !L.sameDay(prev.at, m.at)) frag.appendChild(make('div', 'day', L.fmtDay(m.at)));
      frag.appendChild(bubble(m));
      prev = m;
    });
    el.threadBox.replaceChildren(frag);
    show(el.threadBox, rows.length > 0);
    show(el.threadEmpty, rows.length === 0);
    S.thread.sig = sig;
    S.thread.count = rows.length;

    if (wasNear) { scrollToBottom(); show(el.pill, false); }
    else {
      el.threadScroll.scrollTop = prevTop;
      if (grew) show(el.pill, true);
    }
  }

  function showThread(id) {
    setScreen('thread');
    if (S.thread.id !== id) {
      S.thread = { id: id, lead: null, rows: [], loaded: false, sig: '', count: 0 };
      el.threadBox.replaceChildren();
      show(el.threadBox, false);
      show(el.threadEmpty, false);
      show(el.strip, false);
      show(el.pill, false);
      setText(el.threadErr, '');
      show(el.threadLoading, true);
      var cached = S.leads.filter(function (l) { return l.lead_id === id; })[0];
      el.title.textContent = (cached && cached.display_name) || 'Conversation';
      setText(el.subtitle, cached && cached.event_date ? 'Event ' + L.fmtEventDate(cached.event_date) : '');
    } else if (S.thread.loaded) {
      renderThread();
    }
    refreshThread();
  }

  /* ---------- routing ---------- */

  function route() {
    var r = L.parseRoute(location.hash);
    if (!S.signedIn) {
      if (r.name === 'lead') store('set', TARGET_KEY, r.id);
      showSignin();
      return;
    }
    var target = store('get', TARGET_KEY);
    if (target) {
      store('del', TARGET_KEY);
      if (r.name === 'list' && L.isUuid(target)) { location.replace('#/lead/' + target); return; }
    }
    if (r.name === 'lead') showThread(r.id); else showList();
  }

  /* ---------- auth + sign-in UI ---------- */

  function onSignedIn() {
    if (S.signedIn) return;
    S.signedIn = true;
    startLive();
    route();
  }

  function clearStoredTargets() {
    try {
      var drop = [];
      for (var i = 0; i < sessionStorage.length; i++) {
        var k = sessionStorage.key(i);
        if (k && k.indexOf('cv_') === 0) drop.push(k);
      }
      drop.forEach(function (k) { sessionStorage.removeItem(k); });
    } catch (e) { /* storage blocked: nothing to clear */ }
  }

  function onSignedOut() {
    S.signedIn = false;
    clearStoredTargets();
    stopLive();
    clearTimeout(S.refreshTimer);
    S.seq.list++; S.seq.thread++;
    S.leads = []; S.listLoaded = false;
    S.thread = { id: null, lead: null, rows: [], loaded: false, sig: '', count: 0 };
    el.leadList.replaceChildren(); el.threadBox.replaceChildren();
    show(el.listLoading, true);
    resetSignin();
    route();
  }

  function formatPhone(e164) {
    var m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164 || '');
    return m ? '+1 (' + m[1] + ') ' + m[2] + '-' + m[3] : e164;
  }

  function resetSignin() {
    clearInterval(S.resendTimer);
    S.phone = null;
    el.phone.value = ''; el.code.value = '';
    setText(el.phoneErr, ''); setText(el.codeErr, ''); setText(el.codeNote, '');
    show(el.formPhone, true); show(el.formCode, false);
    el.btnSend.disabled = false; el.btnVerify.disabled = false;
  }

  function startResendTimer() {
    clearInterval(S.resendTimer);
    S.resendAt = Date.now() + RESEND_SECONDS * 1000;
    function tick() {
      var left = Math.ceil((S.resendAt - Date.now()) / 1000);
      if (left <= 0) {
        clearInterval(S.resendTimer);
        el.btnResend.disabled = false;
        el.btnResend.textContent = 'Text me a new code';
      } else {
        el.btnResend.disabled = true;
        el.btnResend.textContent = 'Text a new code in ' + left + ' s';
      }
    }
    tick();
    S.resendTimer = setInterval(tick, 1000);
  }

  function showCodeStep(phone) {
    S.phone = phone;
    el.codePhone.textContent = formatPhone(phone);
    show(el.formPhone, false); show(el.formCode, true);
    setText(el.codeErr, ''); setText(el.codeNote, '');
    el.code.value = '';
    startResendTimer();
    setTimeout(function () { try { el.code.focus(); } catch (e) { /* ignore */ } }, 50);
  }

  function sendCode(phone, isResend) {
    if (S.busy) return;
    S.busy = true;
    var errBox = isResend ? el.codeErr : el.phoneErr;
    setText(errBox, ''); setText(el.codeNote, '');
    el.btnSend.disabled = true;
    if (isResend) el.btnResend.disabled = true;
    Promise.resolve(S.api.sendCode(phone)).then(function (r) {
      if (r && r.error) throw r.error;
      if (isResend) { startResendTimer(); setText(el.codeNote, 'New code sent.'); }
      else showCodeStep(phone);
    }).catch(function (e) {
      setText(errBox, L.friendlyAuthError(e, 'send'));
      if (isResend) el.btnResend.disabled = false;
    }).then(function () {
      S.busy = false; el.btnSend.disabled = false;
    });
  }

  function verifyCode() {
    if (S.busy || !S.phone) return;
    var token = el.code.value.replace(/\D/g, '');
    if (token.length !== 6) { setText(el.codeErr, 'Enter the 6-digit code from the text.'); return; }
    S.busy = true;
    setText(el.codeErr, '');
    el.btnVerify.disabled = true;
    Promise.resolve(S.api.verify(S.phone, token)).then(function (r) {
      if (r && r.error) throw r.error;
      // The auth listener flips the page to signed in; this covers a listener that arrives late.
      setTimeout(onSignedIn, 0);
    }).catch(function (e) {
      setText(el.codeErr, L.friendlyAuthError(e, 'verify'));
      el.code.value = '';
      try { el.code.focus(); } catch (x) { /* ignore */ }
    }).then(function () {
      S.busy = false; el.btnVerify.disabled = false;
    });
  }

  function handleAuthEvent(ev) {
    if (ev === 'SIGNED_IN') onSignedIn();
    else if (ev === 'SIGNED_OUT' && S.signedIn) onSignedOut();
  }

  /* ---------- menu ---------- */

  function closeMenu() {
    el.menu.hidden = true;
    el.menuBtn.setAttribute('aria-expanded', 'false');
  }

  function bindEvents() {
    window.addEventListener('hashchange', route);

    el.back.addEventListener('click', function () { location.hash = '#/'; });

    el.menuBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = el.menu.hidden;
      el.menu.hidden = !open;
      el.menuBtn.setAttribute('aria-expanded', String(open));
      if (open) el.signout.focus();
    });
    document.addEventListener('click', function (e) {
      if (!el.menu.hidden && !el.menu.contains(e.target)) closeMenu();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !el.menu.hidden) { closeMenu(); el.menuBtn.focus(); }
    });
    el.signout.addEventListener('click', function () {
      closeMenu();
      Promise.resolve(S.api.signOut()).catch(function () { /* local sign-out below still runs */ }).then(function () {
        if (S.signedIn) onSignedOut();
      });
    });

    el.formPhone.addEventListener('submit', function (e) {
      e.preventDefault();
      var p = L.normalizePhone(el.phone.value);
      if (!p) { setText(el.phoneErr, 'Enter a 10-digit Canadian mobile number, or a full number starting with +.'); return; }
      sendCode(p, false);
    });
    el.formCode.addEventListener('submit', function (e) { e.preventDefault(); verifyCode(); });
    el.code.addEventListener('input', function () {
      el.code.value = el.code.value.replace(/\D/g, '').slice(0, 6);
      if (el.code.value.length === 6) verifyCode();
    });
    el.btnResend.addEventListener('click', function () { if (S.phone) sendCode(S.phone, true); });
    el.btnChange.addEventListener('click', function () {
      clearInterval(S.resendTimer);
      S.phone = null;
      setText(el.codeErr, ''); setText(el.codeNote, '');
      show(el.formCode, false); show(el.formPhone, true);
      el.phone.focus();
    });

    el.pill.addEventListener('click', function () { scrollToBottom(); show(el.pill, false); });
    el.threadScroll.addEventListener('scroll', function () {
      if (!el.pill.hidden && isNearBottom()) show(el.pill, false);
    }, { passive: true });

    // Phones background tabs and drop sockets: catch up the moment the page is back.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && S.signedIn) scheduleRefresh(0);
    });
    window.addEventListener('online', function () { if (S.signedIn) scheduleRefresh(0); });

    // Safety net if Realtime is down, and keeps "2 min ago" honest.
    setInterval(function () {
      if (!S.signedIn || document.visibilityState !== 'visible') return;
      if (S.live !== 'on') scheduleRefresh(0);
      else if (S.screen === 'list' && S.listLoaded) renderList();
    }, 30000);
  }

  /* ---------- start ---------- */

  function configMissing() {
    return !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || /__SUPABASE/.test(cfg.SUPABASE_URL + cfg.SUPABASE_ANON_KEY);
  }

  function start() {
    // Never render inside a frame (clickjacking). A meta CSP cannot set frame-ancestors.
    if (window.top !== window.self) {
      document.documentElement.hidden = true;
      try { window.top.location = window.self.location; } catch (e) { /* cross-origin top: stay hidden */ }
      return;
    }
    bindEvents();
    if (!MOCK && (configMissing() || !window.supabase)) {
      showSignin();
      show(el.formPhone, false);
      setText(el.configErr, window.supabase ? 'This page is not set up yet.' : "The page couldn't load its sign-in library. Check your connection and reload.");
      return;
    }
    (MOCK ? loadMock() : Promise.resolve(makeRealApi())).then(function (api) {
      S.api = api;
      api.onAuth(function (ev) { setTimeout(function () { handleAuthEvent(ev); }, 0); });
      return api.getSession();
    }).then(function (session) {
      if (session) { S.signedIn = true; startLive(); }
      route();
      if (MOCK && !session && qs.get('screen') === 'code') showCodeStep('+14165550123');
    }).catch(function () {
      showSignin();
      setText(el.phoneErr, "Couldn't start the page. Reload and try again.");
    });
  }

  start();
})();
