/* Owner page: every lead, each lead's SMS thread, status changes (Contacted / Booked / Lost) and lead value.
   Backend: Supabase (phone OTP auth, views `lead_list` + `conversation` + `lead_history`,
   RPC `cv_set_lead_status`, Realtime on base tables).
   Every message body and lead name is untrusted lead input: it is only ever written with textContent. */
(function () {
  'use strict';

  var L = window.CVLib;
  var cfg = window.CV_CONFIG || {};
  var custom = window.CV_CUSTOM || {};
  L.configure(custom);
  applyTheme(custom.theme);
  var host = location.hostname;
  var isLocal = location.protocol === 'file:' || host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  var qs = new URLSearchParams(location.search);
  var MOCK = isLocal && qs.get('mock') === '1';
  var TARGET_KEY = 'cv_target_lead';
  var FILTER_KEY = 'cv_filter';
  var CLOSED_KEY = 'cv_show_closed';
  var RESEND_SECONDS = 60;
  var HISTORY_SHORT = 2;
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var CONTACT_ICONS = {
    call: 'M6.6 3.5h2.6l1.4 4-2 1.4a12 12 0 0 0 6.5 6.5l1.4-2 4 1.4v2.6a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z',
    text: 'M4 5.5h16v10.5H10l-4.5 3.5V16H4z',
    email: 'M3.5 6h17v12h-17zM3.5 6.5l8.5 6.5 8.5-6.5'
  };

  /* ---------- navigation ----------
     Every tab the page knows. Adding a tab = one line here, plus its <main> screen in index.html and
     its show function; config.js (CV_CUSTOM.tabs / tabLabels) picks which ones show, their order and names.
     `route` is the hash name ('list' is '#/'), `icon` is an SVG path (24x24, stroked). */
  var TABS = [
    { route: 'list', href: '#/', label: 'Leads', show: showList, icon: 'M4 5.5h16v10.5H10l-4.5 3.5V16H4z' },
    { route: 'value', href: '#/value', label: 'Lead value', show: showValue, icon: 'M12 3v18M16.5 7.5c-.6-1.4-2.3-2.3-4.5-2.3-2.6 0-4.5 1.3-4.5 3.2 0 4.3 9 2.3 9 6.6 0 1.9-1.9 3.3-4.5 3.3-2.3 0-4-.9-4.7-2.4' },
    { route: 'metrics', href: '#/metrics', label: 'Metrics', show: showMetrics, icon: 'M5 20v-8M12 20V5M19 20v-5M3 20h18' }
  ];

  // The client's menu: CV_CUSTOM.tabs order (unknown names ignored), labels from CV_CUSTOM.tabLabels.
  // Falls back to every tab when the setting is missing or names nothing usable.
  var NAV = (function () {
    var want = Array.isArray(custom.tabs) ? custom.tabs : [];
    var labels = custom.tabLabels || {};
    var picked = [];
    want.forEach(function (r) {
      var t = TABS.filter(function (x) { return x.route === r; })[0];
      if (t && picked.indexOf(t) === -1) picked.push(t);
    });
    if (!picked.length) picked = TABS.slice();
    return picked.map(function (t) {
      var label = typeof labels[t.route] === 'string' && labels[t.route].trim() ? labels[t.route].trim() : t.label;
      return { route: t.route, href: t.href, label: label, show: t.show, icon: t.icon };
    });
  })();
  var TAB_ROUTES = NAV.map(function (n) { return n.route; });

  function $(id) { return document.getElementById(id); }
  var el = {
    app: $('app'), main: $('main'), nav: $('nav'), navList: $('nav-list'), navBrand: $('nav-brand'), navClose: $('btn-nav-close'),
    scrim: $('scrim'), navBtn: $('btn-nav'), signout: $('btn-signout'),
    topbar: $('topbar'), back: $('btn-back'), title: $('title'), subtitle: $('subtitle'),
    live: $('live'), liveText: $('live-text'),
    signin: $('screen-signin'), list: $('screen-list'), value: $('screen-value'), metrics: $('screen-metrics'), thread: $('screen-thread'),
    metricsBody: $('metrics-body'), metricsLoading: $('metrics-loading'), metricsErr: $('metrics-error'), metricsUpdated: $('metrics-updated'),
    formPhone: $('form-phone'), phone: $('phone'), phoneErr: $('phone-error'), btnSend: $('btn-send'),
    formCode: $('form-code'), code: $('code'), codePhone: $('code-phone'), codeErr: $('code-error'), codeNote: $('code-note'),
    btnVerify: $('btn-verify'), btnResend: $('btn-resend'), btnChange: $('btn-change'), configErr: $('config-error'),
    listScroll: $('list-scroll'), filters: $('filters'), listLoading: $('list-loading'), leadList: $('lead-list'),
    listEmpty: $('list-empty'), filterEmpty: $('filter-empty'), listErr: $('list-error'),
    valueTotal: $('value-total'), showClosed: $('show-closed'), valueLoading: $('value-loading'),
    valueSections: $('value-sections'), valueErr: $('value-error'),
    strip: $('strip'), stripChip: $('strip-chip'), stripTime: $('strip-time'),
    recordLoading: $('record-loading'), recHead: $('rec-head'), recName: $('rec-name'), recNext: $('rec-next'),
    optoutBanner: $('optout-banner'), recContact: $('rec-contact'), contactFacts: $('contact-facts'),
    contactActions: $('contact-actions'), contactNote: $('contact-note'),
    recEvent: $('rec-event'), eventFacts: $('event-facts'), eventWords: $('event-words'), eventDetails: $('event-details'),
    recQuote: $('rec-quote'), quoteBody: $('quote-body'), recOthers: $('rec-others'), othersList: $('others-list'),
    convo: $('convo'),
    actions: $('actions'), actionsNote: $('actions-note'), actionErr: $('action-error'), history: $('history'), historyMore: $('history-more'),
    threadScroll: $('thread-scroll'), threadLoading: $('thread-loading'), threadBox: $('thread'), threadEmpty: $('thread-empty'),
    threadErr: $('thread-error'), pill: $('new-pill'),
    confirm: $('confirm'), confirmText: $('confirm-text'), confirmYes: $('confirm-yes'), confirmNo: $('confirm-no')
  };

  var wide = window.matchMedia('(min-width: 900px)');
  // From this width the record shows the conversation and the details side by side, each scrolling on its own.
  var split = window.matchMedia('(min-width: 1200px)');

  function emptyThread(id) {
    return { id: id || null, lead: null, rows: [], history: null, loaded: false, sig: '', count: 0 };
  }

  var S = {
    api: null,
    signedIn: false,
    leads: [],
    listLoaded: false,
    listError: '',
    thread: emptyThread(),
    live: 'off',
    stopLive: null,
    seq: { list: 0, thread: 0, metrics: 0 },
    metrics: null,
    metricsError: '',
    phone: null,
    resendTimer: null,
    resendAt: 0,
    refreshTimer: null,
    retryTimer: null,
    busy: false,
    screen: '',
    tab: NAV[0],
    filter: 'all',
    showClosed: false,
    navOpen: false,
    pending: null,       // status being saved from the page
    confirming: null,    // status waiting in the confirm sheet
    historyOpen: false,
    actionButtons: {}
  };

  /* ---------- theme ----------
     CV_CUSTOM.theme colours become CSS variables on <html> (CSSOM: allowed under style-src 'self').
     styles.css already holds the default palette, so this only matters for a client with its own. */
  function applyTheme(theme) {
    var pairs = L.themeVars(theme);
    var root = document.documentElement;
    pairs.forEach(function (p) { root.style.setProperty(p[0], p[1]); });
    var bar = pairs.filter(function (p) { return p[0] === '--primary-deep'; })[0] ||
      pairs.filter(function (p) { return p[0] === '--primary'; })[0];
    var meta = document.querySelector('meta[name="theme-color"]');
    if (bar && meta) meta.setAttribute('content', bar[1]);
  }

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

  function icon(d) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '22');
    svg.setAttribute('height', '22');
    svg.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '2');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(p);
    return svg;
  }

  // Title-Cased for display only; the stored name is never changed.
  function leadName(lead) { return L.displayName(lead); }

  /* ---------- API layer ---------- */

  var DETAIL_COLUMNS = [
    'lead_id', 'full_name', 'first_name', 'phone', 'email', 'status', 'status_at', 'opted_out',
    'occasion', 'event_date', 'start_time', 'end_time', 'service_hours_label', 'guests', 'event_area', 'distance_km',
    'bar_rental', 'multiple_events', 'multi_event_dates', 'additional_details', 'promo_code', 'promotion', 'form_name',
    'quote_status', 'quote_subtotal', 'quote_travel_fee', 'quote_total', 'quote_line_items', 'quote_defer_reasons',
    'created_at', 'last_inbound_at', 'last_outbound_at', 'contacted_at', 'booked_at', 'lost_at', 'nudge_sent_at',
    'last_activity_at', 'other_events'
  ].join(',');

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
      // No owner-readable business name in the data contract yet: the nav shows "Leads".
      businessName: function () { return Promise.resolve(null); },
      fetchList: function () {
        return client.from('lead_list').select('*')
          .order('last_activity_at', { ascending: false, nullsFirst: false }).limit(1000).then(ok);
      },
      fetchThread: function (id) {
        return Promise.all([
          // lead_detail (explicit columns); falls back to lead_list if the view is not there yet.
          client.from('lead_detail').select(DETAIL_COLUMNS).eq('lead_id', id).maybeSingle().then(function (r) {
            if (!r.error) return r.data;
            return client.from('lead_list').select('*').eq('lead_id', id).maybeSingle().then(ok);
          }),
          client.from('conversation').select('*').eq('lead_id', id)
            .order('at', { ascending: true }).limit(2000).then(ok),
          // History is extra: if the view is missing or fails, the thread still shows.
          client.from('lead_history').select('*').eq('lead_id', id)
            .order('at', { ascending: false }).limit(50)
            .then(function (r) { return r.error ? null : r.data; }, function () { return null; })
        ]).then(function (r) { return { lead: r[0], rows: r[1], history: r[2] }; });
      },
      setStatus: function (id, status) {
        return client.rpc('cv_set_lead_status', { p_lead_id: id, p_status: status }).then(ok);
      },
      metrics: function () { return client.rpc('cv_metrics').then(ok); },
      // Payloads are never trusted: any event just triggers a refetch.
      subscribe: function (onEvent, onStatus) {
        var ch = client.channel('cv-live')
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, onEvent)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'processed_messages' }, onEvent)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, onEvent)
          .subscribe(function (status) { onStatus(status); });
        // Own channel, so a problem with lead_events can never take the main live feed down.
        var ev = client.channel('cv-live-events')
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lead_events' }, onEvent)
          .subscribe();
        return function () { client.removeChannel(ch); client.removeChannel(ev); };
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

  /* ---------- navigation shell ---------- */

  function navFor(route) {
    return NAV.filter(function (n) { return n.route === route; })[0] || NAV[0];
  }

  function buildNav() {
    var frag = document.createDocumentFragment();
    NAV.forEach(function (n) {
      var li = make('li');
      var a = make('a', 'nav-item');
      a.href = n.href;
      a.setAttribute('data-route', n.route);
      a.appendChild(icon(n.icon));
      a.appendChild(make('span', '', n.label));
      a.addEventListener('click', function () { closeNav(false); });
      li.appendChild(a);
      frag.appendChild(li);
    });
    el.navList.replaceChildren(frag);
  }

  function markNav() {
    var items = el.navList.querySelectorAll('.nav-item');
    for (var i = 0; i < items.length; i++) {
      if (items[i].getAttribute('data-route') === S.tab.route) items[i].setAttribute('aria-current', 'page');
      else items[i].removeAttribute('aria-current');
    }
  }

  function setMainInert(on) {
    el.main.inert = on;
    if (on) el.main.setAttribute('inert', ''); else el.main.removeAttribute('inert');
  }

  function openNav() {
    if (wide.matches || S.navOpen) return;
    S.navOpen = true;
    el.nav.classList.add('open');
    show(el.scrim, true);
    setMainInert(true);
    el.navBtn.setAttribute('aria-expanded', 'true');
    var current = el.navList.querySelector('[aria-current="page"]') || el.navList.querySelector('.nav-item');
    setTimeout(function () { try { (current || el.navClose).focus(); } catch (e) { /* ignore */ } }, 30);
  }

  function closeNav(returnFocus) {
    if (!S.navOpen) return;
    S.navOpen = false;
    el.nav.classList.remove('open');
    show(el.scrim, false);
    setMainInert(false);
    el.navBtn.setAttribute('aria-expanded', 'false');
    if (returnFocus) { try { el.navBtn.focus(); } catch (e) { /* ignore */ } }
  }

  // Keep Tab inside the open drawer.
  function trapNavFocus(e) {
    var items = Array.prototype.filter.call(
      el.nav.querySelectorAll('a[href], button:not([disabled])'),
      function (n) { return n.offsetParent !== null; }
    );
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || !el.nav.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !el.nav.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
  }

  /* ---------- screens ---------- */

  function setScreen(name) {
    S.screen = name;
    var signedIn = name !== 'signin';
    el.app.classList.toggle('signed-in', signedIn);
    show(el.nav, signedIn);
    show(el.signin, name === 'signin');
    show(el.list, name === 'list');
    show(el.value, name === 'value');
    show(el.metrics, name === 'metrics');
    show(el.thread, name === 'thread');
    show(el.topbar, signedIn);
    show(el.back, name === 'thread');
    show(el.navBtn, name !== 'thread');
    if (name !== 'thread') {
      el.title.textContent = S.tab.label;
      setText(el.subtitle, '');
    }
    if (el.confirm.open) el.confirm.close();
    markNav();
    if (!signedIn) closeNav(false);
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
      if (S.screen === 'metrics') refreshMetrics();
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

  function renderLeadScreens() {
    if (S.screen === 'list') renderList();
    else if (S.screen === 'value') renderValue();
  }

  function refreshList() {
    var n = ++S.seq.list;
    return S.api.fetchList().then(function (rows) {
      if (n !== S.seq.list || !S.signedIn) return;
      S.leads = L.sortLeads(rows);
      S.listLoaded = true;
      S.listError = '';
      renderLeadScreens();
    }).catch(function (e) {
      if (n !== S.seq.list) return;
      if (!S.listLoaded) {
        S.listError = isAuthFailure(e) ? 'Your session ran out. Sign out and sign in again.' : "Couldn't load your leads. Trying again…";
        renderLeadScreens();
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
      S.thread.history = Array.isArray(res.history) ? res.history : null;
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

  var FILTER_EMPTY = {
    needs: 'Nobody is waiting on you right now.',
    open: 'No open leads right now.',
    booked: 'No booked leads yet.',
    lost: 'No lost leads.'
  };

  function renderFilters() {
    var counts = L.filterCounts(S.leads);
    var frag = document.createDocumentFragment();
    L.filters().forEach(function (f) {
      var b = make('button', 'filter');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(S.filter === f.key));
      b.appendChild(make('span', '', f.label));
      if (S.listLoaded) b.appendChild(make('span', 'filter-count', String(counts[f.key])));
      b.addEventListener('click', function () {
        if (S.filter === f.key) return;
        S.filter = f.key;
        store('set', FILTER_KEY, f.key);
        renderList();
        el.listScroll.scrollTop = 0;
      });
      frag.appendChild(b);
    });
    el.filters.replaceChildren(frag);
  }

  function renderList() {
    renderFilters();
    if (!S.listLoaded) {
      show(el.listLoading, !S.listError);
      setText(el.listErr, S.listError);
      return;
    }
    show(el.listLoading, false);
    setText(el.listErr, '');
    var leads = L.filterLeads(S.leads, S.filter);
    show(el.listEmpty, S.leads.length === 0);
    setText(el.filterEmpty, S.leads.length > 0 && leads.length === 0 ? FILTER_EMPTY[S.filter] || 'No leads here.' : '');
    show(el.leadList, leads.length > 0);
    var frag = document.createDocumentFragment();
    leads.forEach(function (lead) {
      var li = make('li');
      var a = make('a', 'lead-row');
      a.href = '#/lead/' + encodeURIComponent(lead.lead_id);
      var st = L.statusInfo(lead.status);
      a.appendChild(make('span', 'lead-name', leadName(lead)));
      a.appendChild(make('span', 'lead-when', L.fmtAgo(lead.last_activity_at)));
      var meta = make('span', 'lead-meta');
      meta.appendChild(make('span', '', lead.event_date ? 'Event ' + L.fmtEventDate(lead.event_date) : 'No event date'));
      var money = L.fmtMoney(lead.quote_total);
      if (money) meta.appendChild(make('span', 'lead-money', money));
      a.appendChild(meta);
      a.appendChild(make('span', 'chip tone-' + st.tone, st.label));
      li.appendChild(a);
      frag.appendChild(li);
    });
    el.leadList.replaceChildren(frag);
  }

  function showList() {
    S.thread.id = null;
    setScreen('list');
    renderList();
    refreshList();
  }

  /* ---------- lead value ---------- */

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  function valueCard(lead, closed) {
    var li = make('li');
    var a = make('a', 'card' + (closed ? ' is-closed' : ''));
    a.href = '#/lead/' + encodeURIComponent(lead.lead_id);
    var top = make('span', 'card-top');
    top.appendChild(make('span', 'card-name', leadName(lead)));
    var money = L.fmtMoney(lead.quote_total);
    if (money) top.appendChild(make('span', 'card-money', money));
    a.appendChild(top);
    var bits = [];
    bits.push(lead.event_date ? L.fmtEventDate(lead.event_date) : 'No event date');
    if (lead.guests !== null && lead.guests !== undefined && lead.guests !== '') bits.push(plural(Number(lead.guests), 'guest', 'guests'));
    if (lead.event_city) bits.push(String(lead.event_city));
    var bottom = make('span', 'card-bottom');
    bottom.appendChild(make('span', 'card-meta', bits.join(', ')));
    var st = L.statusInfo(lead.status);
    bottom.appendChild(make('span', 'chip tone-' + st.tone, st.label));
    a.appendChild(bottom);
    li.appendChild(a);
    return li;
  }

  function renderValue() {
    if (!S.listLoaded) {
      show(el.valueLoading, !S.listError);
      setText(el.valueErr, S.listError);
      el.valueSections.replaceChildren();
      setText(el.valueTotal, '');
      return;
    }
    show(el.valueLoading, false);
    setText(el.valueErr, '');
    var sections = L.groupByTier(S.leads, { showClosed: S.showClosed });
    var quoted = sections.filter(function (s) { return s.key !== 'none'; });
    var openCents = quoted.reduce(function (sum, s) { return sum + s.totalCents; }, 0);
    var openCount = quoted.reduce(function (sum, s) { return sum + s.count; }, 0);
    setText(el.valueTotal, openCount ? L.fmtMoney(openCents / 100) + ' in open quotes across ' + plural(openCount, 'lead', 'leads') : 'No open quotes right now.');

    var frag = document.createDocumentFragment();
    sections.forEach(function (s) {
      // Nothing to show in this tier: one plain line, no empty frame.
      if (!s.leads.length) {
        frag.appendChild(make('p', 'tier-blank', s.key === 'none' ? 'Every open lead has a quote.' : 'No open leads in ' + s.label + '.'));
        return;
      }
      var sec = make('section', 'tier tier-' + s.key);
      var id = 'tier-' + s.key;
      sec.setAttribute('aria-labelledby', id);
      var head = make('div', 'tier-head');
      var h = make('h2', 'tier-name', s.label);
      h.id = id;
      head.appendChild(h);
      var sum = make('p', 'tier-sum');
      if (s.key !== 'none') sum.appendChild(make('span', 'tier-money', L.fmtMoney(s.total)));
      var countText = plural(s.count, 'open lead', 'open leads');
      if (S.showClosed && s.closedCount) countText += ', ' + s.closedCount + ' closed';
      sum.appendChild(make('span', 'tier-count', countText));
      head.appendChild(sum);
      sec.appendChild(head);
      var ul = make('ul', 'cards');
      s.leads.forEach(function (lead) { ul.appendChild(valueCard(lead, L.isClosed(lead.status))); });
      sec.appendChild(ul);
      frag.appendChild(sec);
    });
    el.valueSections.replaceChildren(frag);
  }

  function showValue() {
    S.thread.id = null;
    setScreen('value');
    el.showClosed.checked = S.showClosed;
    renderValue();
    refreshList();
  }

  /* ---------- metrics ---------- */

  function refreshMetrics() {
    if (!S.api.metrics) return Promise.resolve();
    var n = ++S.seq.metrics;
    return Promise.resolve(S.api.metrics()).then(function (m) {
      if (n !== S.seq.metrics || !S.signedIn) return;
      S.metrics = m || {};
      S.metricsError = '';
      if (S.screen === 'metrics') renderMetrics();
    }).catch(function (e) {
      if (n !== S.seq.metrics) return;
      if (!S.metrics) {
        S.metricsError = isAuthFailure(e) ? 'Your session ran out. Sign out and sign in again.' : "Couldn't load your numbers. Trying again…";
        if (S.screen === 'metrics') renderMetrics();
      }
      retryLater();
    });
  }

  function block(title) {
    var sec = make('section', 'm-block');
    sec.appendChild(make('h2', 'm-title', title));
    return sec;
  }

  function tile(label, pair) {
    var d = make('div', 'm-tile');
    d.appendChild(make('p', 'm-tile-label', label));
    d.appendChild(make('p', 'm-tile-money', pair.money));
    d.appendChild(make('p', 'm-tile-count', pair.count));
    return d;
  }

  // Each block shows real numbers or one plain line; never an empty frame.
  var METRIC_BLOCKS = {
    open: function (m) {
      var open = m.open || {};
      var openCount = Number(open.count) || 0;
      var noQuote = Number(m.open_no_quote) || 0;
      var b = block('Money on the table');
      if (!openCount) {
        b.appendChild(make('p', 'm-line m-empty', noQuote
          ? 'No open quotes yet. ' + L.plural(noQuote, 'open lead is', 'open leads are') + ' waiting on a quote.'
          : 'No open leads right now.'));
        return b;
      }
      b.appendChild(make('p', 'm-big', L.fmtMoney(open.total == null ? 0 : open.total)));
      var sub = 'across ' + L.plural(openCount, 'open lead', 'open leads');
      if (noQuote) sub += ', plus ' + noQuote + ' more without a quote yet';
      b.appendChild(make('p', 'm-sub', sub));
      return b;
    },
    booked: function (m) {
      var bk = m.booked || {};
      var b = block('Money booked');
      if (!(Number(bk.all_time && bk.all_time.count) > 0)) {
        b.appendChild(make('p', 'm-line m-empty', 'Nothing booked yet.'));
        return b;
      }
      var tiles = make('div', 'm-tiles');
      tiles.appendChild(tile('This month', L.moneyCount(bk.this_month)));
      tiles.appendChild(tile('Last month', L.moneyCount(bk.last_month)));
      tiles.appendChild(tile('All time', L.moneyCount(bk.all_time)));
      b.appendChild(tiles);
      var avg = L.fmtMoney(bk.avg_job);
      if (avg) b.appendChild(make('p', 'm-sub', 'Average job: ' + avg));
      return b;
    },
    close_rate: function (m) {
      var b = block('Close rate');
      b.appendChild(make('p', 'm-line', L.closeRateText(m.close_rate)));
      return b;
    },
    speed: function (m) {
      var b = block('Speed');
      var sp = m.speed || {};
      if (sp.first_text_avg_seconds == null && sp.owner_followup_avg_minutes == null) {
        b.appendChild(make('p', 'm-line m-empty', 'No reply times measured yet.'));
        return b;
      }
      b.appendChild(make('p', 'm-line', L.firstTextLine(sp)));
      b.appendChild(make('p', 'm-line', L.followupLine(sp)));
      return b;
    },
    journey: function (m) {
      var b = block('Lead journey');
      if (!(Number(m.funnel && m.funnel.leads) > 0)) {
        b.appendChild(make('p', 'm-line m-empty', 'No leads yet.'));
        return b;
      }
      var ol = make('ol', 'funnel');
      L.funnelRows(m.funnel).forEach(function (r) {
        var li = make('li', 'funnel-row');
        var top = make('div', 'funnel-top');
        top.appendChild(make('span', 'funnel-label', r.label));
        top.appendChild(make('span', 'funnel-num', r.count + (r.key === 'leads' ? '' : ' (' + r.pct + '%)')));
        li.appendChild(top);
        var track = make('div', 'funnel-track');
        var bar = make('div', 'funnel-bar');
        bar.style.width = r.pct + '%'; // CSSOM, allowed under style-src 'self'
        track.appendChild(bar);
        li.appendChild(track);
        ol.appendChild(li);
      });
      b.appendChild(ol);
      return b;
    },
    waiting: function (m) {
      var b = block('Waiting on you');
      var waiting = (Array.isArray(m.waiting) ? m.waiting : []).filter(function (w) { return w && L.isUuid(w.lead_id); })
        .slice().sort(function (x, y) { return (Number(y.waiting_minutes) || 0) - (Number(x.waiting_minutes) || 0); });
      if (!waiting.length) {
        b.appendChild(make('p', 'm-line m-empty', 'Nothing waiting on you.'));
        return b;
      }
      var ul = make('ul', 'waiting');
      waiting.forEach(function (w) {
        var li = make('li');
        var a = make('a', 'waiting-row');
        a.href = '#/lead/' + encodeURIComponent(w.lead_id);
        a.appendChild(make('span', 'waiting-name', leadName(w)));
        a.appendChild(make('span', 'waiting-time', L.fmtWaiting(w.waiting_minutes)));
        li.appendChild(a);
        ul.appendChild(li);
      });
      b.appendChild(ul);
      return b;
    }
  };
  var METRIC_DEFAULT = ['open', 'booked', 'close_rate', 'speed', 'journey', 'waiting'];

  // CV_CUSTOM.metrics order; unknown names ignored; all blocks when the setting is missing or empty.
  function metricOrder() {
    var want = Array.isArray(custom.metrics) ? custom.metrics : [];
    var out = [];
    want.forEach(function (k) { if (METRIC_BLOCKS[k] && out.indexOf(k) === -1) out.push(k); });
    return out.length ? out : METRIC_DEFAULT.slice();
  }

  function renderMetrics() {
    var m = S.metrics;
    if (!m) {
      show(el.metricsLoading, !S.metricsError);
      setText(el.metricsErr, S.metricsError);
      show(el.metricsBody, false);
      setText(el.metricsUpdated, '');
      return;
    }
    show(el.metricsLoading, false);
    setText(el.metricsErr, '');
    var frag = document.createDocumentFragment();
    metricOrder().forEach(function (key) { frag.appendChild(METRIC_BLOCKS[key](m)); });

    el.metricsBody.replaceChildren(frag);
    show(el.metricsBody, true);
    var when = m.generated_at ? L.fmtStamp(m.generated_at) : '';
    setText(el.metricsUpdated, when ? 'Updated ' + when : '');
  }

  function showMetrics() {
    S.thread.id = null;
    setScreen('metrics');
    renderMetrics();
    refreshMetrics();
  }

  /* ---------- thread: status actions + history ---------- */

  function buildActions() {
    var frag = document.createDocumentFragment();
    L.actions().forEach(function (a) {
      var b = make('button', 'action action-' + a.status);
      b.type = 'button';
      b.appendChild(make('span', 'spinner'));
      b.appendChild(make('span', 'action-label', a.label));
      b.addEventListener('click', function () { openConfirm(a); });
      S.actionButtons[a.status] = b;
      frag.appendChild(b);
    });
    el.actions.replaceChildren(frag);
  }

  function renderActions() {
    var lead = S.thread.lead;
    var current = String((lead && lead.status) || '').toLowerCase();
    L.actions().forEach(function (a) {
      var b = S.actionButtons[a.status];
      var isCurrent = current === a.status;
      var busy = S.pending === a.status;
      b.disabled = !lead || !L.canSetStatus(current, a.status) || !!S.pending;
      b.classList.toggle('is-current', isCurrent);
      b.classList.toggle('is-busy', busy);
      if (busy) b.setAttribute('aria-busy', 'true'); else b.removeAttribute('aria-busy');
      b.title = isCurrent ? 'Already ' + a.label.toLowerCase() : '';
    });
    setText(el.actionsNote, L.actionsNote(current));
  }

  function renderHistory() {
    var all = S.thread.history ? L.sortHistory(S.thread.history) : [];
    var rows = S.historyOpen ? all : all.slice(0, HISTORY_SHORT);
    var frag = document.createDocumentFragment();
    rows.forEach(function (h) {
      var li = make('li', 'history-line', L.historyLine(h));
      frag.appendChild(li);
    });
    el.history.replaceChildren(frag);
    show(el.history, rows.length > 0);
    var extra = all.length - HISTORY_SHORT;
    show(el.historyMore, extra > 0);
    el.historyMore.textContent = S.historyOpen ? 'Show fewer changes' : 'Show all ' + all.length + ' changes';
    el.historyMore.setAttribute('aria-expanded', String(S.historyOpen));
  }

  function openConfirm(action) {
    var lead = S.thread.lead;
    if (!lead || S.pending) return;
    S.confirming = action.status;
    el.confirmText.textContent = L.confirmText(leadName(lead), action.status);
    el.confirmYes.textContent = action.confirm;
    el.confirm.className = 'sheet sheet-' + action.status;
    if (typeof el.confirm.showModal === 'function') el.confirm.showModal();
    else el.confirm.setAttribute('open', '');
    try { el.confirmNo.focus(); } catch (e) { /* ignore */ }
  }

  function closeConfirm() {
    S.confirming = null;
    if (el.confirm.open) {
      if (typeof el.confirm.close === 'function') el.confirm.close();
      else el.confirm.removeAttribute('open');
    }
  }

  // No optimistic UI: spinner on the button, wait for the server, then refetch.
  function saveStatus(status) {
    var id = S.thread.id;
    if (!id || S.pending) return;
    S.pending = status;
    setText(el.actionErr, '');
    renderActions();
    Promise.resolve().then(function () { return S.api.setStatus(id, status); }).then(function () {
      S.historyOpen = false;
      return Promise.all([refreshThread(), refreshList()]);
    }).catch(function (e) {
      if (id === S.thread.id) setText(el.actionErr, L.friendlyStatusError(e));
    }).then(function () {
      S.pending = null;
      if (id === S.thread.id) {
        renderActions();
        // The tapped button may now be disabled: keep keyboard focus inside the strip.
        if (document.activeElement === document.body || (document.activeElement && document.activeElement.disabled)) {
          var next = el.actions.querySelector('button:not([disabled])');
          if (next) { try { next.focus(); } catch (x) { /* ignore */ } }
        }
      }
    });
  }

  /* ---------- thread ---------- */

  // Phones: the whole record scrolls as one. Wide: the conversation column scrolls on its own.
  function convoScroller() { return split.matches ? el.convo : el.threadScroll; }

  function isNearBottom() {
    var s = convoScroller();
    return s.scrollHeight - s.scrollTop - s.clientHeight < 100;
  }

  function scrollToBottom() {
    var s = convoScroller();
    s.scrollTop = s.scrollHeight;
    requestAnimationFrame(function () { s.scrollTop = s.scrollHeight; });
  }

  function fact(dl, label, value, opts) {
    var dt = make('dt', '', label);
    var dd = make('dd');
    if (opts && opts.href) {
      var a = make('a', 'fact-link', value);
      a.href = opts.href;
      if (opts.external) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      dd.appendChild(a);
    } else {
      dd.appendChild(document.createTextNode(value));
    }
    if (opts && opts.note) dd.appendChild(make('span', 'fact-note', opts.note));
    if (opts && opts.flag) dd.appendChild(make('span', 'fact-flag', opts.flag));
    dl.appendChild(dt);
    dl.appendChild(dd);
  }

  function renderContact(lead) {
    var phone = L.fmtPhoneNational(lead.phone);
    var email = L.validEmail(lead.email) || String(lead.email || '').trim();
    el.contactFacts.replaceChildren();
    if (phone) fact(el.contactFacts, 'Phone', phone);
    if (email) fact(el.contactFacts, 'Email', email);
    var actions = L.contactActions(lead, custom.contactActions);
    var frag = document.createDocumentFragment();
    actions.forEach(function (a) {
      var link = make('a', 'contact-btn contact-' + a.key);
      link.href = a.href;
      link.appendChild(icon(CONTACT_ICONS[a.key]));
      link.appendChild(make('span', '', a.label));
      frag.appendChild(link);
    });
    el.contactActions.replaceChildren(frag);
    show(el.contactActions, actions.length > 0);
    setText(el.contactNote, L.isOptedOut(lead) ? 'Texting is off because this person opted out. Calling and email still work.' : '');
    show(el.recContact, !!(phone || email || actions.length));
  }

  function renderEvent(lead) {
    var facts = L.eventFacts(lead);
    el.eventFacts.replaceChildren();
    facts.forEach(function (f) {
      fact(el.eventFacts, f.label, f.value, { href: f.href, external: !!f.href, note: f.note, flag: f.flag });
    });
    var words = String(lead.additional_details || '').trim();
    el.eventDetails.textContent = words;
    show(el.eventWords, !!words);
    show(el.recEvent, facts.length > 0 || !!words);
  }

  function renderQuote(lead) {
    var q = L.quoteView(lead);
    if (!q || q.empty) { el.quoteBody.replaceChildren(); show(el.recQuote, false); return; }
    var frag = document.createDocumentFragment();
    if (q.defer) {
      frag.appendChild(make('p', 'quote-review', 'Needs your review'));
      frag.appendChild(make('p', 'quote-why', q.reasons.length
        ? 'The assistant did not send a price because:' : 'The assistant did not send a price. Check the details and reply to them.'));
      if (q.reasons.length) {
        var ul = make('ul', 'quote-reasons');
        q.reasons.forEach(function (r) { ul.appendChild(make('li', '', r)); });
        frag.appendChild(ul);
      }
    } else {
      if (q.items.length) {
        var items = make('ul', 'quote-items');
        q.items.forEach(function (it) {
          var li = make('li', 'quote-item');
          var txt = make('span', 'qi-text');
          txt.appendChild(make('span', 'qi-label', it.label || 'Item'));
          if (it.detail) txt.appendChild(make('span', 'qi-detail', it.detail));
          li.appendChild(txt);
          li.appendChild(make('span', 'qi-amount', it.amount));
          items.appendChild(li);
        });
        frag.appendChild(items);
      }
      var sums = make('dl', 'quote-sums');
      function sum(label, value, cls) {
        if (!value) return;
        var dt = make('dt', cls || '', label), dd = make('dd', cls || '', value);
        sums.appendChild(dt); sums.appendChild(dd);
      }
      sum('Subtotal', q.subtotal);
      sum('Travel fee', q.travel);
      sum('Total', q.total, 'is-total');
      frag.appendChild(sums);
    }
    el.quoteBody.replaceChildren(frag);
    show(el.recQuote, true);
  }

  function renderOthers(lead) {
    var others = (Array.isArray(lead.other_events) ? lead.other_events : []).filter(function (o) { return o && L.isUuid(o.lead_id); });
    var frag = document.createDocumentFragment();
    others.forEach(function (o) {
      var li = make('li');
      var a = make('a', 'other');
      a.href = '#/lead/' + encodeURIComponent(o.lead_id);
      var top = make('span', 'other-top');
      top.appendChild(make('span', 'other-name', String(o.occasion || '').trim() || 'Event'));
      var money = L.fmtMoney(o.quote_total);
      if (money) top.appendChild(make('span', 'other-money', money));
      a.appendChild(top);
      var bottom = make('span', 'other-bottom');
      bottom.appendChild(make('span', 'other-date', o.event_date ? L.fmtEventDate(o.event_date) : 'No event date'));
      var st = L.statusInfo(o.status);
      bottom.appendChild(make('span', 'chip tone-' + st.tone, st.label));
      a.appendChild(bottom);
      li.appendChild(a);
      frag.appendChild(li);
    });
    el.othersList.replaceChildren(frag);
    show(el.recOthers, others.length > 0);
  }

  function renderRecord() {
    var lead = S.thread.lead;
    el.title.textContent = lead ? leadName(lead) : 'Lead';
    setText(el.subtitle, '');
    var sections = [el.recHead, el.recContact, el.strip, el.recEvent, el.recQuote, el.recOthers];
    if (!lead) {
      sections.forEach(function (n) { show(n, false); });
      show(el.optoutBanner, false);
      show(el.recordLoading, !S.thread.loaded);
      return;
    }
    show(el.recordLoading, false);
    var st = L.statusInfo(lead.status);
    el.recName.textContent = leadName(lead);
    el.stripChip.className = 'chip tone-' + st.tone;
    el.stripChip.textContent = st.label;
    setText(el.recNext, L.nextAction(lead));
    show(el.recHead, true);
    show(el.optoutBanner, L.isOptedOut(lead));
    renderContact(lead);
    el.strip.className = 'rec-card strip tone-' + st.tone;
    setText(el.stripTime, lead.status_at ? 'Current status since ' + L.fmtStamp(lead.status_at) : '');
    renderActions();
    renderHistory();
    show(el.strip, true);
    renderEvent(lead);
    renderQuote(lead);
    renderOthers(lead);
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
    renderRecord();
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

    // First paint: wide screens open the conversation at its latest text; phones open at the name.
    var wasNear = first ? split.matches : isNearBottom();
    var scroller = convoScroller();
    var prevTop = scroller.scrollTop;
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
      scroller.scrollTop = prevTop;
      if (grew && !first) show(el.pill, true);
    }
  }

  function showThread(id) {
    setScreen('thread');
    if (S.thread.id !== id) {
      S.thread = emptyThread(id);
      S.pending = null;
      S.historyOpen = false;
      el.threadBox.replaceChildren();
      show(el.threadBox, false);
      show(el.threadEmpty, false);
      show(el.pill, false);
      setText(el.threadErr, '');
      setText(el.actionErr, '');
      show(el.threadLoading, true);
      renderRecord();
      el.threadScroll.scrollTop = 0;
      el.convo.scrollTop = 0;
      var cached = S.leads.filter(function (l) { return l.lead_id === id; })[0];
      el.title.textContent = cached ? leadName(cached) : 'Lead';
    } else if (S.thread.loaded) {
      renderThread();
    }
    el.back.setAttribute('aria-label', 'Back to ' + S.tab.label.toLowerCase());
    refreshThread();
  }

  /* ---------- routing ---------- */

  function route() {
    var r = L.parseRoute(location.hash, TAB_ROUTES);
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
    closeNav(false);
    if (r.name === 'lead') { showThread(r.id); return; }
    S.tab = navFor(r.name);
    S.tab.show();
  }

  /* ---------- auth + sign-in UI ---------- */

  // CV_CUSTOM.businessName wins; else whatever the backend offers (the mock says "Lab Bar"); else "Leads".
  function loadBrand() {
    var own = typeof custom.businessName === 'string' ? custom.businessName.trim() : '';
    if (own) { el.navBrand.textContent = own; return; }
    Promise.resolve(S.api.businessName ? S.api.businessName() : null).then(function (name) {
      if (S.signedIn) el.navBrand.textContent = (name && String(name).trim()) || 'Leads';
    }).catch(function () { /* keep "Leads" */ });
  }

  function onSignedIn() {
    if (S.signedIn) return;
    S.signedIn = true;
    startLive();
    loadBrand();
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
    S.leads = []; S.listLoaded = false; S.listError = '';
    S.thread = emptyThread();
    S.filter = 'all'; S.showClosed = false; S.pending = null; S.tab = NAV[0];
    S.seq.metrics++; S.metrics = null; S.metricsError = '';
    el.leadList.replaceChildren(); el.threadBox.replaceChildren(); el.valueSections.replaceChildren(); el.metricsBody.replaceChildren();
    el.navBrand.textContent = 'Leads';
    closeConfirm();
    closeNav(false);
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

  /* ---------- events ---------- */

  function bindEvents() {
    window.addEventListener('hashchange', route);

    el.back.addEventListener('click', function () { location.hash = S.tab.href; });

    // Drawer (phones) / sidebar (wide)
    el.navBtn.addEventListener('click', function () { if (S.navOpen) closeNav(true); else openNav(); });
    el.navClose.addEventListener('click', function () { closeNav(true); });
    el.scrim.addEventListener('click', function () { closeNav(true); });
    document.addEventListener('keydown', function (e) {
      if (!S.navOpen) return;
      if (e.key === 'Escape') { e.preventDefault(); closeNav(true); }
      else if (e.key === 'Tab') trapNavFocus(e);
    });
    var onWide = function () { if (wide.matches) closeNav(false); };
    if (wide.addEventListener) wide.addEventListener('change', onWide); else if (wide.addListener) wide.addListener(onWide);

    el.signout.addEventListener('click', function () {
      closeNav(false);
      Promise.resolve(S.api.signOut()).catch(function () { /* local sign-out below still runs */ }).then(function () {
        if (S.signedIn) onSignedOut();
      });
    });

    // Lead value
    el.showClosed.addEventListener('change', function () {
      S.showClosed = el.showClosed.checked;
      store('set', CLOSED_KEY, S.showClosed ? '1' : '0');
      renderValue();
    });

    // Status actions
    el.confirmYes.addEventListener('click', function () {
      var status = S.confirming;
      closeConfirm();
      if (status) saveStatus(status);
    });
    el.confirmNo.addEventListener('click', closeConfirm);
    el.confirm.addEventListener('close', function () { S.confirming = null; });
    // Tap on the dimmed backdrop (the dialog box itself, outside the sheet body) cancels.
    el.confirm.addEventListener('click', function (e) { if (e.target === el.confirm) closeConfirm(); });
    el.historyMore.addEventListener('click', function () {
      S.historyOpen = !S.historyOpen;
      renderHistory();
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
    var onConvoScroll = function () { if (!el.pill.hidden && isNearBottom()) show(el.pill, false); };
    el.threadScroll.addEventListener('scroll', onConvoScroll, { passive: true });
    el.convo.addEventListener('scroll', onConvoScroll, { passive: true });

    // Phones background tabs and drop sockets: catch up the moment the page is back.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && S.signedIn) scheduleRefresh(0);
    });
    window.addEventListener('online', function () { if (S.signedIn) scheduleRefresh(0); });

    // Safety net if Realtime is down, and keeps "2 min ago" honest.
    setInterval(function () {
      if (!S.signedIn || document.visibilityState !== 'visible') return;
      if (S.live !== 'on') scheduleRefresh(0);
      else if (S.listLoaded) renderLeadScreens();
    }, 30000);
  }

  /* ---------- start ---------- */

  function configMissing() {
    return !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || /__SUPABASE/.test(cfg.SUPABASE_URL + cfg.SUPABASE_ANON_KEY);
  }

  function restorePrefs() {
    var f = store('get', FILTER_KEY);
    S.filter = L.isFilterKey(f) ? f : 'all';
    S.showClosed = store('get', CLOSED_KEY) === '1';
  }

  function start() {
    // Never render inside a frame (clickjacking). A meta CSP cannot set frame-ancestors.
    if (window.top !== window.self) {
      document.documentElement.hidden = true;
      try { window.top.location = window.self.location; } catch (e) { /* cross-origin top: stay hidden */ }
      return;
    }
    buildNav();
    buildActions();
    restorePrefs();
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
      if (session) { S.signedIn = true; startLive(); loadBrand(); }
      route();
      if (MOCK && !session && qs.get('screen') === 'code') showCodeStep('+14165550123');
    }).catch(function () {
      showSignin();
      setText(el.phoneErr, "Couldn't start the page. Reload and try again.");
    });
  }

  start();
})();
