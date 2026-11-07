/* Owner page: every lead, each lead's SMS thread, status changes (Contacted / Booked / Lost), calendar, metrics and the quote calculator.
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
  // Mock mode sets a business name so the real brand path (More heading) runs in mock too, and a missing element would throw visibly.
  if (MOCK && !(typeof custom.businessName === 'string' && custom.businessName.trim())) custom.businessName = 'Mock Bartending Co';
  var TARGET_KEY = 'cv_target_lead';
  var FILTER_KEY = 'cv_filter';
  var POSSIBLE_KEY = 'cv_cal_possible';
  var SEARCH_DEBOUNCE = 250;
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
     `route` is the hash name ('list' is '#/'), `icon` is an SVG path (24x24, stroked).
     The bottom bar shows Leads / Follow-ups / Calendar / Metrics + More; Quote calculator lives under More; Lead value is a section inside Metrics
     (L.tabPlan decides, from CV_CUSTOM.tabs and the feature switches). */
  var TABS = [
    { route: 'list', href: '#/', label: 'Leads', show: showList, icon: 'M12 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM5 19.5c.6-3.3 3.3-5 7-5s6.4 1.7 7 5' },
    { route: 'followups', href: '#/followups', label: 'Follow-ups', show: showFollowUps, icon: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 7.5V12l3 2' },
    { route: 'calendar', href: '#/calendar', label: 'Calendar', show: showCalendar, icon: 'M4 6h16v14H4zM4 10.5h16M8.5 3.5v5M15.5 3.5v5' },
    { route: 'metrics', href: '#/metrics', label: 'Metrics', show: showMetrics, icon: 'M5 20v-8M12 20V5M19 20v-5M3 20h18' },
    { route: 'quote', href: '#/quote', label: 'Quote calculator', show: showQuote, icon: 'M7 3.5h10v17H7zM9.5 7h5M9.5 11h1M13.5 11h1M9.5 14.5h1M13.5 14.5h1M9.5 18h5' },
    { route: 'more', href: '#/more', label: 'More', show: showMore, icon: 'M5 12h2M11 12h2M17 12h2' }
  ];

  // Feature switches (CV_CUSTOM.features): an off feature is not shown anywhere. Leads ('list') and More are always on.
  function feature(key) { return L.featureOn(custom.features, key); }
  function tabByRoute(r) { return TABS.filter(function (x) { return x.route === r; })[0]; }

  // The client's bar and More list (CV_CUSTOM.tabs order, labels from CV_CUSTOM.tabLabels).
  var PLAN = L.tabPlan(custom.tabs, feature);
  function labelled(route) {
    var t = tabByRoute(route);
    var labels = custom.tabLabels || {};
    var label = typeof labels[route] === 'string' && labels[route].trim() ? labels[route].trim() : t.label;
    return { route: t.route, href: t.href, label: label, show: t.show, icon: t.icon };
  }
  var BAR = PLAN.bar.concat(['more']).map(labelled);
  var MORE_ITEMS = PLAN.more.map(labelled);
  // Every screen the router can open (bar tabs, More and the tools under it).
  var NAV = BAR.concat(MORE_ITEMS);
  var TAB_ROUTES = NAV.map(function (n) { return n.route; });
  var HAS_FOLLOWUPS = TAB_ROUTES.indexOf('followups') !== -1;
  var HAS_SEARCH = feature('search');
  var HAS_NOTES = feature('notes');
  var HAS_PUSH = feature('push');
  var HAS_ADD = feature('addLead');

  function $(id) { return document.getElementById(id); }
  var el = {
    app: $('app'), main: $('main'), tabbar: $('tabbar'), tabbarList: $('tabbar-list'), signout: $('btn-signout'),
    more: $('screen-more'), moreList: $('more-list'), moreBrand: $('more-brand'),
    needs: $('needs'), needsTitle: $('needs-title'), needsCount: $('needs-count'), needsList: $('needs-list'), filterNote: $('filter-note'),
    alerts: $('alerts'), alertsText: $('alerts-text'), alertsOn: $('alerts-on'), alertsRow: $('alerts-row'),
    alertsHead: $('alerts-h'), alertsInfo: $('alerts-info'), alertsSum: $('alerts-sum'), alertsBody: $('alerts-body'), alertsTest: $('alerts-test'), alertsOff: $('alerts-off'), alertsMsg: $('alerts-msg'),
    topbar: $('topbar'), back: $('btn-back'), title: $('title'), subtitle: $('subtitle'),
    live: $('live'), liveText: $('live-text'),
    signin: $('screen-signin'), list: $('screen-list'), metrics: $('screen-metrics'), thread: $('screen-thread'),
    search: $('lead-search'), searchBox: $('search-box'), searchStatus: $('search-status'), searchResults: $('search-results'), browseBox: $('browse-box'),
    calendar: $('screen-calendar'), calTitle: $('cal-title'), calPrev: $('cal-prev'), calNext: $('cal-next'), calPossible: $('cal-possible'),
    calLoading: $('cal-loading'), calGrid: $('cal-grid'), calHead: $('cal-head'), calBody: $('cal-body'), calMonthNote: $('cal-month-note'),
    calAgenda: $('cal-agenda'), calAgendaWeek: $('cal-agenda-week'), calAgendaLater: $('cal-agenda-later'), calAgendaEmpty: $('cal-agenda-empty'),
    calDay: $('cal-day'), calDayTitle: $('cal-day-title'), calDayList: $('cal-day-list'), calDayEmpty: $('cal-day-empty'), calErr: $('cal-error'),
    recNotes: $('rec-notes'), notesList: $('notes-list'), noteText: $('note-text'), noteCount: $('note-count'), noteErr: $('note-error'), noteSave: $('note-save'),
    stripNote: $('strip-note'), hStatus: $('h-status'),
    priceBox: $('price-box'), price: $('price'), reasonBox: $('reason-box'), reasonChips: $('reason-chips'), reasonOther: $('reason-other'),
    reasonNote: $('reason-note'), confirmErr: $('confirm-error'),
    quote: $('screen-quote'), qForm: $('q-form'), qGuests: $('q-guests'), qHours: $('q-hours'), qBarBox: $('q-bar-box'), qBarNote: $('q-bar-note'),
    qCity: $('q-city'), qKmBox: $('q-km-box'), qKm: $('q-km'), qDate: $('q-date'), qOccasion: $('q-occasion'), qPromo: $('q-promo'), qMore: $('q-more'),
    qErr: $('q-error'), qSubmit: $('q-submit'), qResult: $('q-result'), qResultH: $('q-result-h'), qResultBody: $('q-result-body'),
    qCopy: $('q-copy'), qCopied: $('q-copied'), searchWrap: $('search-wrap'),
    followups: $('screen-followups'), fuBody: $('fu-body'), fuLoading: $('fu-loading'), fuErr: $('fu-error'),
    metricsBody: $('metrics-body'), metricsLoading: $('metrics-loading'), metricsErr: $('metrics-error'), metricsUpdated: $('metrics-updated'),
    formPhone: $('form-phone'), phone: $('phone'), phoneErr: $('phone-error'), btnSend: $('btn-send'),
    formCode: $('form-code'), code: $('code'), codePhone: $('code-phone'), codeErr: $('code-error'), codeNote: $('code-note'),
    btnVerify: $('btn-verify'), btnResend: $('btn-resend'), btnChange: $('btn-change'), configErr: $('config-error'),
    listScroll: $('list-scroll'), filters: $('filters'), listLoading: $('list-loading'), leadList: $('lead-list'),
    listEmpty: $('list-empty'), filterEmpty: $('filter-empty'), listErr: $('list-error'),
    btnAdd: $('btn-add-lead'), toast: $('toast'),
    addDlg: $('add-lead'), addForm: $('add-form'), addName: $('add-name'), addPhone: $('add-phone'), addDate: $('add-date'),
    addGuests: $('add-guests'), addArea: $('add-area'), addOccasion: $('add-occasion'), addContacted: $('add-contacted'),
    addEmail: $('add-email'), addSourceChips: $('add-source-chips'), addErr: $('add-error'), addSubmit: $('add-submit'), addCancel: $('add-cancel'),
    addDup: $('add-dup'), addDupList: $('add-dup-list'), addDupMore: $('add-dup-more'), addDupSame: $('add-dup-same'), addDupOpt: $('add-dup-opt'),
    recSource: $('rec-source'), recNoauto: $('rec-noauto'), recPrice: $('rec-price'), priceLink: $('price-link'),
    strip: $('strip'), stripChip: $('strip-chip'), sysFold: $('sys-fold'), hNotes: $('h-notes'),
    recordLoading: $('record-loading'), recHead: $('rec-head'), recName: $('rec-name'), recNext: $('rec-next'), recJob: $('rec-job'), recPhone: $('rec-phone'), recHistory: $('rec-history'),
    optoutBanner: $('optout-banner'), recContact: $('rec-contact'),
    contactActions: $('contact-actions'), contactNote: $('contact-note'),
    recEvent: $('rec-event'), eventFacts: $('event-facts'), eventWords: $('event-words'), eventDetails: $('event-details'),
    recQuote: $('rec-quote'), quoteBody: $('quote-body'), recOthers: $('rec-others'), othersList: $('others-list'),
    convo: $('convo'), convoScroll: $('convo-scroll'),
    actions: $('actions'), actionsNote: $('actions-note'), actionErr: $('action-error'), history: $('history'), historyMore: $('history-more'),
    threadScroll: $('thread-scroll'), threadLoading: $('thread-loading'), threadBox: $('thread'), threadEmpty: $('thread-empty'),
    threadErr: $('thread-error'), pill: $('new-pill'),
    confirm: $('confirm'), confirmText: $('confirm-text'), confirmYes: $('confirm-yes'), confirmNo: $('confirm-no')
  };

  // From this width the record shows the conversation and the details side by side, each scrolling on its own.
  var split = window.matchMedia('(min-width: 1200px)');

  function emptyThread(id) {
    return { id: id || null, lead: null, rows: [], history: null, loaded: false, sig: '', count: 0, sysOpen: false };
  }

  var S = {
    api: null,
    signedIn: false,
    leads: [],
    listLoaded: false,
    listError: '',
    thread: emptyThread(),
    live: 'off',
    liveTimer: null,
    stopLive: null,
    seq: { list: 0, thread: 0, metrics: 0, followups: 0 },
    metrics: null,
    metricsError: '',
    followUps: null,     // follow_ups rows once loaded
    followUpsError: '',
    search: { q: '', rows: null, error: '', seq: 0, timer: null },  // memory only: never URL / storage
    cal: null,           // { y, m, sel } month on screen and picked day
    showPossible: false,
    noteBusy: false,
    quote: { busy: false, seq: 0, view: null, req: null },
    phone: null,
    resendTimer: null,
    resendAt: 0,
    refreshTimer: null,
    retryTimer: null,
    busy: false,
    screen: '',
    tab: NAV[0],
    filter: 'open',
    pending: null,       // status being saved from the page
    confirming: null,    // status waiting in the confirm sheet
    historyOpen: false,
    addBusy: false,
    toastTimer: null,
    quotePrefill: null,  // { guests, area } from a lead's record -> the quote calculator, used once
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

  // One icon style everywhere: 24-unit grid, round caps, 1.75 stroke (size is the only thing that varies).
  function icon(d, size) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size || 22));
    svg.setAttribute('height', String(size || 22));
    svg.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '1.75');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(p);
    return svg;
  }

  var ICON_CLOCK = 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 7.5V12l3 2';
  var ICON_PHONE = 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z';
  var ICON_CHECK = 'M5 12.5l4.5 4.5L19 7.5';

  // A status chip: three looks by meaning (tone-needs filled, tone-active outline, booked / lost / optout quiet sand).
  // Booked carries a check so it never relies on colour. Fills `node` (replacing its content).
  function fillChip(node, chip) {
    node.className = 'chip tone-' + chip.tone;
    node.replaceChildren();
    if (chip.tone === 'booked') { var c = icon(ICON_CHECK, 14); c.setAttribute('class', 'chip-icon'); node.appendChild(c); }
    node.appendChild(document.createTextNode(chip.label));
    return node;
  }
  function chipNode(chip) { return fillChip(make('span'), chip); }

  // The wait line of a Needs-you lead: clock + words. Past the threshold it turns red and says "overdue" (never colour alone).
  function waitNode(w) {
    var n = make('span', 'row-wait' + (w.late ? ' is-late' : ''));
    n.appendChild(icon(ICON_CLOCK, 16));
    n.appendChild(make('span', '', w.text + (w.late ? ' \u00b7 overdue' : '')));
    return n;
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
  // Added for final price, lost reason and notes; dropped again if the view does not have them yet.
  var DETAIL_EXTRA = ',booked_amount,lost_reason,lost_note,notes';
  // Added for hand-added leads (sql/011); dropped again if the view does not have them yet.
  var DETAIL_SOURCE = ',source,manual_source,auto_texts';
  var SEARCH_BASE = 'lead_id,full_name,phone,email,status,event_date,quote_total,last_activity_at,status_at,guests';
  var SEARCH_COLUMNS = SEARCH_BASE + ',source,manual_source'; // sql/011 columns on lead_detail; the search falls back without them
  var FOLLOWUP_COLUMNS = 'lead_id,display_name,status,event_date,quote_total,follow_up_type,due_at,sent_at,reason';

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
          client.from('lead_detail').select(DETAIL_COLUMNS + DETAIL_EXTRA + DETAIL_SOURCE).eq('lead_id', id).maybeSingle().then(function (r0) {
            if (!r0.error) return r0.data;
            return client.from('lead_detail').select(DETAIL_COLUMNS + DETAIL_EXTRA).eq('lead_id', id).maybeSingle().then(function (r) {
              if (!r.error) return r.data;
              return client.from('lead_detail').select(DETAIL_COLUMNS).eq('lead_id', id).maybeSingle().then(function (r2) {
                if (!r2.error) return r2.data;
                return client.from('lead_list').select('*').eq('lead_id', id).maybeSingle().then(ok);
              });
            });
          }),
          client.from('conversation').select('*').eq('lead_id', id)
            .order('at', { ascending: true }).limit(2000).then(ok),
          // History is extra: if the view is missing or fails, the thread still shows.
          client.from('lead_history').select('*').eq('lead_id', id)
            .order('at', { ascending: false }).limit(50)
            .then(function (r) { return r.error ? null : r.data; }, function () { return null; })
        ]).then(function (r) { return { lead: r[0], rows: r[1], history: r[2] }; });
      },
      // extra: { p_amount, p_reason, p_reason_note }; only keys with a value are sent.
      setStatus: function (id, status, extra) {
        var args = { p_lead_id: id, p_status: status };
        Object.keys(extra || {}).forEach(function (k) { if (extra[k] !== null && extra[k] !== undefined) args[k] = extra[k]; });
        return client.rpc('cv_set_lead_status', args).then(ok);
      },
      // Server-side search on lead_detail (RLS applies). The filter string comes from L.searchFilter.
      searchLeads: function (q) {
        var f = L.searchFilter(q);
        if (!f) return Promise.resolve([]);
        return client.from('lead_detail').select(SEARCH_COLUMNS + ',booked_amount,lost_reason').or(f)
          .order('last_activity_at', { ascending: false, nullsFirst: false }).limit(25).then(function (r) {
            if (!r.error) return r.data;
            return client.from('lead_detail').select(SEARCH_BASE + ',booked_amount,lost_reason').or(f)
              .order('last_activity_at', { ascending: false, nullsFirst: false }).limit(25).then(function (r2) {
                if (!r2.error) return r2.data;
                return client.from('lead_detail').select(SEARCH_BASE).or(f)
                  .order('last_activity_at', { ascending: false, nullsFirst: false }).limit(25).then(ok);
              });
          });
      },
      // Read-only price check. Non-2xx answers are thrown as { status, error, details } from the JSON body.
      quote: function (body) {
        return client.functions.invoke('cv-quote', { body: body }).then(function (r) {
          if (!r.error) return r.data;
          var ctx = r.error.context;
          if (ctx && typeof ctx.json === 'function') {
            return ctx.json().catch(function () { return {}; }).then(function (b) {
              throw { status: ctx.status, error: (b && b.error) || '', details: b && b.details };
            });
          }
          throw { status: 0, error: String(r.error.name || 'network'), details: String(r.error.message || '') };
        });
      },
      // Owner-only RPC (sql/011): -> [{ lead_id, created }]. args from L.addLeadArgs.
      optedOutPhones: function () {
        return client.from('lead_detail').select('phone').eq('opted_out', true).limit(1000)
          .then(function (r) { return r.error ? [] : (r.data || []).map(function (x) { return x.phone; }); });
      },
      addLead: function (args) { return client.rpc('cv_add_lead', args).then(ok); },
      addNote: function (id, body) { return client.rpc('cv_add_note', { p_lead_id: id, p_body: body }).then(ok); },
      deleteNote: function (noteId) { return client.rpc('cv_delete_note', { p_note_id: noteId }).then(ok); },
      metrics: function () { return client.rpc('cv_metrics').then(ok); },
      // Push alerts (owner-only RPCs). Every call is soft-failed by the caller.
      pushConfig: function () { return client.rpc('cv_push_config').then(ok); },
      pushSubscribe: function (k, ua) {
        return client.rpc('cv_push_subscribe', { p_endpoint: k.endpoint, p_p256dh: k.p256dh, p_auth: k.auth, p_user_agent: ua }).then(ok);
      },
      pushUnsubscribe: function (endpoint) { return client.rpc('cv_push_unsubscribe', { p_endpoint: endpoint }).then(ok); },
      pushTest: function () { return client.rpc('cv_push_test').then(ok); },
      fetchFollowUps: function () {
        return client.from('follow_ups').select(FOLLOWUP_COLUMNS).limit(1000).then(ok);
      },
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
        // Notes on their own channel too.
        var nt = client.channel('cv-live-notes')
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lead_notes' }, onEvent)
          .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'lead_notes' }, onEvent)
          .subscribe();
        return function () { client.removeChannel(ch); client.removeChannel(ev); client.removeChannel(nt); };
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

  /* ---------- navigation shell: the bottom bar ---------- */

  function navFor(route) {
    return NAV.filter(function (n) { return n.route === route; })[0] || NAV[0];
  }

  // Which bar slot lights up: the tab itself, or More for the tools that live under it.
  function barRoute(route) {
    return BAR.some(function (n) { return n.route === route; }) ? route : 'more';
  }

  function buildTabbar() {
    var frag = document.createDocumentFragment();
    BAR.forEach(function (n) {
      var li = make('li');
      var a = make('a', 'tab');
      a.href = n.href;
      a.setAttribute('data-route', n.route);
      a.appendChild(icon(n.icon, 24));
      a.appendChild(make('span', 'tab-label', n.label));
      if (n.route === 'list') {
        // The one badge: how many leads need the owner. Count for the eye, words for screen readers; filled by renderBadge().
        var badge = make('span', 'tab-badge');
        badge.hidden = true;
        var num = make('span', '', '0');
        num.setAttribute('aria-hidden', 'true');
        badge.appendChild(num);
        badge.appendChild(make('span', 'sr-only', ''));
        a.appendChild(badge);
      }
      li.appendChild(a);
      frag.appendChild(li);
    });
    el.tabbarList.replaceChildren(frag);
    // More: the tools under it (Quote calculator). Alerts and Sign out are fixed in index.html.
    var rows = document.createDocumentFragment();
    MORE_ITEMS.forEach(function (n) {
      var li = make('li');
      var a = make('a', 'more-row');
      a.href = n.href;
      a.appendChild(icon(n.icon, 24));
      a.appendChild(make('span', 'more-label', n.label));
      a.appendChild(icon('M9 5l7 7-7 7', 20)).classList.add('more-chev');
      li.appendChild(a);
      rows.appendChild(li);
    });
    el.moreList.replaceChildren(rows);
  }

  function markTabs() {
    var cur = barRoute(S.tab.route);
    var items = el.tabbarList.querySelectorAll('.tab');
    for (var i = 0; i < items.length; i++) {
      if (items[i].getAttribute('data-route') === cur) items[i].setAttribute('aria-current', 'page');
      else items[i].removeAttribute('aria-current');
    }
  }

  /* ---------- screens ---------- */

  function setScreen(name) {
    S.screen = name;
    var signedIn = name !== 'signin';
    el.app.classList.toggle('signed-in', signedIn);
    show(el.signin, name === 'signin');
    show(el.list, name === 'list');
    show(el.metrics, name === 'metrics');
    show(el.followups, name === 'followups');
    show(el.calendar, name === 'calendar');
    show(el.quote, name === 'quote');
    show(el.more, name === 'more');
    show(el.thread, name === 'thread');
    show(el.topbar, signedIn);
    show(el.tabbar, signedIn && PLAN.showBar);
    // Back arrow on a lead record and on the tools under More; every other screen is a tab with a plain title.
    var sub = name === 'thread' || name === 'quote';
    show(el.back, sub);
    if (name === 'quote') el.back.setAttribute('aria-label', 'Back to ' + navFor('more').label.toLowerCase());
    if (name !== 'thread') {
      el.title.textContent = S.tab.label;
      setText(el.subtitle, '');
    }
    if (el.confirm.open) el.confirm.close();
    if (el.addDlg.open) closeAdd();
    show(el.btnAdd, signedIn && name === 'list' && HAS_ADD && !!S.api && typeof S.api.addLead === 'function');
    markTabs();
    if (!signedIn) setLive('off');
    renderConn();
  }

  function showSignin() {
    setScreen('signin');
  }

  /* ---------- live status ---------- */

  // The connection strip only shows when the connection is down for a moment (2.5 s), never as a status light.
  function setLive(state) {
    S.live = state;
    el.liveText.textContent = 'Reconnecting…';
    clearTimeout(S.liveTimer);
    S.liveTimer = null;
    if (state === 'on' || state === 'off') { renderConn(); return; }
    S.liveTimer = setTimeout(function () { S.liveTimer = null; renderConn(); }, 2500);
  }

  function renderConn() {
    var down = S.signedIn && S.live !== 'on' && S.live !== 'off' && !S.liveTimer;
    show(el.live, down);
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
      refreshFollowUps();
      if (S.screen === 'thread' && S.thread.id) refreshThread();
      if (S.screen === 'metrics') refreshMetrics();
      if (S.screen === 'list' && L.searchFilter(S.search.q)) runSearch();
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
    else if (S.screen === 'metrics') renderMetrics(); // lead value comes from the lead list
    else if (S.screen === 'followups') renderFollowUps(); // "asked for you" times come from the lead list
    else if (S.screen === 'calendar') renderCalendar();
  }

  function refreshList() {
    var n = ++S.seq.list;
    return S.api.fetchList().then(function (rows) {
      if (n !== S.seq.list || !S.signedIn) return;
      S.leads = L.sortLeads(rows);
      S.listLoaded = true;
      S.listError = '';
      renderBadge();
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
    open: 'No open leads right now.',
    booked: 'No booked leads yet.',
    lost: 'No lost leads.'
  };

  function renderFilters() {
    var counts = L.homeCounts(S.leads);
    var frag = document.createDocumentFragment();
    L.filters().forEach(function (f) {
      var b = make('button', 'filter');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(S.filter === f.key));
      b.appendChild(make('span', '', f.label));
      if (S.listLoaded) b.appendChild(make('span', 'filter-count', String(counts[f.key])));
      if (f.key === 'lost') b.setAttribute('aria-label', f.label + (S.listLoaded ? ', ' + counts[f.key] : '') + ', includes people who opted out');
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

  // The Needs-you block: the one place on Home for "who is waiting on me", longest wait first.
  // Same row as every list, plus their last text and a Call icon (a separate tap zone; iPhone asks before dialling).
  function renderNeeds(rows) {
    show(el.needs, rows.length > 0);
    if (!rows.length) { el.needsList.replaceChildren(); return; }
    el.needsTitle.textContent = L.statusInfo('handed_off').label;
    el.needsCount.textContent = String(rows.length);
    var frag = document.createDocumentFragment();
    rows.forEach(function (r) {
      var lead = r.lead;
      var tel = L.telHref(lead.phone); // lead_list.phone, strict E.164 only
      var li = make('li', 'need-card');
      li.appendChild(leadRow(lead, { needs: true, call: !!tel }).firstChild);
      if (tel) {
        var call = make('a', 'row-call');
        call.href = tel;
        call.setAttribute('aria-label', 'Call ' + leadName(lead));
        call.appendChild(icon(ICON_PHONE, 22));
        li.appendChild(call);
      }
      frag.appendChild(li);
    });
    el.needsList.replaceChildren(frag);
  }

  function renderList() {
    renderFilters();
    if (!S.listLoaded) {
      show(el.listLoading, !S.listError);
      setText(el.listErr, S.listError);
      renderNeeds([]);
      return;
    }
    show(el.listLoading, false);
    setText(el.listErr, '');
    var view = L.homeView(S.leads, S.filter);
    var leads = view.rest;
    renderNeeds(view.needs);
    show(el.listEmpty, S.leads.length === 0);
    var none = FILTER_EMPTY[S.filter] || 'No leads here.';
    if (view.needs.length && S.filter === 'open') none = 'No other open leads right now.';
    setText(el.filterEmpty, S.leads.length > 0 && leads.length === 0 && !(view.needs.length && S.filter === 'all') ? none : '');
    setText(el.filterNote, S.filter === 'lost' && S.leads.length > 0 ? 'Includes people who opted out.' : '');
    show(el.leadList, leads.length > 0);
    var frag = document.createDocumentFragment();
    leads.forEach(function (lead) { frag.appendChild(leadRow(lead)); });
    el.leadList.replaceChildren(frag);
  }

  // THE lead row (Home, search, Calendar day, Lead value, Follow-ups): name and one price on top, date and guests,
  // then status chip and "last text 15 min ago". opts.needs = Needs-you card (no chip, last text + wait line);
  // opts.lines = extra plain lines under the job line (Follow-ups); opts.quiet = no status chip / time (sent history).
  // Returns an <li>; its first child is the link.
  function leadRow(lead, opts) {
    opts = opts || {};
    var v = L.rowView(lead, undefined, { noDate: !!opts.noDate });
    var li = make('li');
    var a = make('a', 'lead-row' + (opts.needs ? ' is-needs' : '') + (opts.call ? ' has-call' : '') + (opts.cls ? ' ' + opts.cls : ''));
    a.href = '#/lead/' + encodeURIComponent(lead.lead_id);
    var top = make('span', 'row-top');
    top.appendChild(make('span', 'lead-name', v.name));
    if (v.money) top.appendChild(make('span', 'lead-money', v.money));
    a.appendChild(top);
    a.appendChild(make('span', 'row-job', v.job));
    if (L.isManual(lead)) a.appendChild(make('span', 'row-tag', 'Added by you'));
    if (opts.needs && v.said) a.appendChild(make('span', 'row-said', v.said)); // text only, never markup
    (opts.lines || []).forEach(function (ln) {
      if (!ln) return;
      var p = make('span', 'row-line' + (ln.cls ? ' ' + ln.cls : ''), ln.text);
      if (ln.due) p.setAttribute('data-due', ln.due);
      a.appendChild(p);
    });
    if (!opts.quiet) {
      var foot = make('span', 'row-foot');
      if (opts.needs) {
        if (v.wait) foot.appendChild(waitNode(v.wait));
      } else {
        foot.appendChild(chipNode(v.chip));
        // A lead waiting on you (seen in search or the calendar) shows the same wait cue as Home.
        if (v.needs && v.wait) foot.appendChild(waitNode(v.wait));
        else if (v.when) foot.appendChild(make('span', 'lead-when', v.when));
      }
      a.appendChild(foot);
    }
    li.appendChild(a);
    return li;
  }

  /* ---------- add a lead by hand (Leads, "+ Add lead") ----------
     A modal sheet like the status sheet. The server (cv_add_lead) is the authority; L.validateAddLead mirrors its checks.
     Same phone + same date opens the lead on file; same phone + another date is a new event for the same person. */

  var ADD_FIELD_EL = { name: 'addName', phone: 'addPhone', event_date: 'addDate', guests: 'addGuests', area: 'addArea', occasion: 'addOccasion', email: 'addEmail' };

  function buildAddSources() {
    var frag = document.createDocumentFragment();
    L.addLeadSources().forEach(function (r) {
      var lab = make('label', 'reason-chip');
      var input = make('input');
      input.type = 'radio'; input.name = 'add-source'; input.value = r.key;
      input.addEventListener('change', function () { setAddError('source', ''); });
      lab.appendChild(input);
      lab.appendChild(make('span', '', r.label));
      frag.appendChild(lab);
    });
    el.addSourceChips.replaceChildren(frag);
  }

  function addFieldNode(f) { return f === 'source' ? el.addSourceChips.querySelector('input') : el[ADD_FIELD_EL[f]]; }

  function setAddError(field, text) {
    var p = $('add-err-' + field);
    if (p) setText(p, text);
    var input = ADD_FIELD_EL[field] ? el[ADD_FIELD_EL[field]] : null;
    if (input) { if (text) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
  }
  function clearAddErrors() {
    ['name', 'phone', 'source', 'event_date', 'guests', 'area', 'occasion', 'email'].forEach(function (f) { setAddError(f, ''); });
    setText(el.addErr, '');
  }

  function pickedAddSource() {
    var c = el.addSourceChips.querySelector('input:checked');
    return c ? c.value : '';
  }

  function readAddForm() {
    return {
      name: el.addName.value, phone: el.addPhone.value, source: pickedAddSource(), event_date: el.addDate.value,
      guests: el.addGuests.value, area: el.addArea.value, occasion: el.addOccasion.value, email: el.addEmail.value,
      contacted: el.addContacted.checked
    };
  }

  // "Already on file" box under Phone. Uses the lead list already loaded (no extra call).
  function renderAddDup() {
    var d = L.dupInfo(S.listLoaded ? S.leads : [], el.addPhone.value, el.addDate.value, S.optedPhones);
    show(el.addDup, d.matches.length > 0 || d.optedOut);
    if (!d.matches.length) { setText(el.addDupSame, ''); setText(el.addDupMore, ''); setText(el.addDupOpt, d.optedOut ? L.DUP_TEXT.optedOut : ''); el.addDupList.replaceChildren(); return; }
    var frag = document.createDocumentFragment();
    d.shown.forEach(function (l) {
      var li = make('li', 'add-dup-row');
      li.appendChild(make('span', 'add-dup-text', L.dupLine(l)));
      var a = make('a', 'add-dup-open', 'Open');
      a.href = '#/lead/' + encodeURIComponent(l.lead_id);
      a.setAttribute('aria-label', 'Open ' + leadName(l));
      li.appendChild(a);
      frag.appendChild(li);
    });
    el.addDupList.replaceChildren(frag);
    setText(el.addDupMore, d.more ? '+' + d.more + ' more' : '');
    setText(el.addDupSame, d.sameLead ? L.DUP_TEXT.same : L.DUP_TEXT.other);
    setText(el.addDupOpt, d.optedOut ? L.DUP_TEXT.optedOut : '');
  }

  function openAdd() {
    if (!HAS_ADD || !S.signedIn || S.addBusy) return;
    el.addForm.reset();
    clearAddErrors();
    renderAddDup();
    // Numbers that opted out (lead_list cannot say): one lookup per open, the box updates when it lands.
    if (S.api && typeof S.api.optedOutPhones === 'function') {
      Promise.resolve(S.api.optedOutPhones()).then(function (rows) { S.optedPhones = Array.isArray(rows) ? rows : []; renderAddDup(); }, function () { /* the box still works from the list */ });
    }
    if (typeof el.addDlg.showModal === 'function') el.addDlg.showModal();
    else el.addDlg.setAttribute('open', '');
    try { el.addName.focus(); } catch (e) { /* ignore */ }
  }

  function closeAdd() {
    if (el.addDlg.open) {
      if (typeof el.addDlg.close === 'function') el.addDlg.close();
      else el.addDlg.removeAttribute('open');
    }
  }

  function showToast(text) {
    clearTimeout(S.toastTimer);
    setText(el.toast, text);
    S.toastTimer = setTimeout(function () { setText(el.toast, ''); }, 4000);
  }

  function setAddBusy(on) {
    S.addBusy = on;
    el.addSubmit.disabled = on;
    el.addSubmit.classList.toggle('is-busy', on);
    el.addCancel.disabled = on;
  }

  function submitAdd() {
    if (S.addBusy) return;
    clearAddErrors();
    var res = L.validateAddLead(readAddForm());
    if (!res.ok) {
      Object.keys(res.errors).forEach(function (f) { setAddError(f, L.addLeadErrorText(res.errors[f])); });
      var first = addFieldNode(L.addLeadFirstError(res.errors));
      if (first) try { first.focus(); } catch (e) { /* ignore */ }
      return;
    }
    setAddBusy(true);
    Promise.resolve().then(function () { return S.api.addLead(L.addLeadArgs(res.values)); }).then(function (out) {
      var row = Array.isArray(out) ? out[0] : out;
      if (!row || !L.isUuid(row.lead_id)) throw new Error('no lead id');
      setAddBusy(false);
      closeAdd();
      showToast(row.created === false ? 'Already on file: opened it' : 'Lead added');
      refreshList();
      location.hash = '#/lead/' + row.lead_id;
    }).catch(function (e) {
      setAddBusy(false);
      var er = L.addLeadError(e);
      if (er.kind === 'field') {
        setAddError(er.field, er.text);
        var n = addFieldNode(er.field);
        if (n) try { n.focus(); } catch (x) { /* ignore */ }
      } else setText(el.addErr, er.text);
    });
  }

  /* ---------- search (Leads tab) ---------- */

  function searchActive() { return HAS_SEARCH && !!L.searchFilter(S.search.q); }

  function renderSearch() {
    var on = searchActive();
    show(el.searchBox, on);
    show(el.browseBox, !on);
    if (!on) return;
    var rows = S.search.rows;
    if (S.search.error) { setText(el.searchStatus, S.search.error); show(el.searchResults, false); return; }
    if (!rows) { setText(el.searchStatus, 'Searching…'); show(el.searchResults, false); return; }
    var frag = document.createDocumentFragment();
    rows.filter(function (r) { return r && L.isUuid(r.lead_id); }).forEach(function (r) { frag.appendChild(leadRow(r)); });
    el.searchResults.replaceChildren(frag);
    show(el.searchResults, rows.length > 0);
    setText(el.searchStatus, rows.length ? L.plural(rows.length, 'lead matches', 'leads match') + (rows.length >= 25 ? ' (showing the first 25)' : '') : 'No leads match that search.');
  }

  function runSearch() {
    var q = S.search.q;
    var n = ++S.search.seq;
    if (!S.api.searchLeads || !L.searchFilter(q)) return;
    Promise.resolve(S.api.searchLeads(q)).then(function (rows) {
      if (n !== S.search.seq || !S.signedIn) return;
      S.search.rows = Array.isArray(rows) ? rows : [];
      S.search.error = '';
      renderSearch();
    }).catch(function (e) {
      if (n !== S.search.seq) return;
      S.search.rows = null;
      S.search.error = isAuthFailure(e) ? 'Your session ran out. Sign out and sign in again.' : "Couldn't search right now. Try again in a moment.";
      renderSearch();
    });
  }

  function onSearchInput() {
    S.search.q = el.search.value;
    clearTimeout(S.search.timer);
    S.search.rows = null; S.search.error = '';
    S.search.seq++;
    renderSearch();
    if (searchActive()) S.search.timer = setTimeout(runSearch, SEARCH_DEBOUNCE);
  }

  function clearSearch() {
    clearTimeout(S.search.timer);
    S.search = { q: '', rows: null, error: '', seq: S.search.seq + 1, timer: null };
    el.search.value = '';
    el.searchResults.replaceChildren();
    renderSearch();
  }

  function showList() {
    S.thread.id = null;
    setScreen('list');
    renderList();
    renderSearch();
    refreshList();
    if (searchActive()) runSearch();
  }

  /* ---------- More ---------- */

  function showMore() {
    S.thread.id = null;
    setScreen('more');
    renderPush();
    refreshFollowUps(); // the held-alert and 9 am text lines in Alerts come from the follow-ups view
  }

  /* ---------- quote calculator ---------- */

  var Q_FIELDS = ['guests', 'service_hours', 'bar_rental', 'event_city', 'distance_km', 'event_date', 'occasion', 'promo_code'];
  var Q_INPUT = { guests: 'qGuests', service_hours: 'qHours', event_city: 'qCity', distance_km: 'qKm', event_date: 'qDate', occasion: 'qOccasion', promo_code: 'qPromo' };

  function qRadio(name) { var c = el.qForm.querySelector('input[name="' + name + '"]:checked'); return c ? c.value : ''; }

  function qForm() {
    var bar = qRadio('q-bar');
    return {
      service_type: 'full_service', guests: el.qGuests.value, service_hours: el.qHours.value,
      bar_rental: bar === 'yes' ? true : bar === 'no' ? false : null,
      event_city: el.qCity.value, distance_km: el.qKmBox.hidden ? '' : el.qKm.value,
      event_date: el.qDate.value, occasion: el.qOccasion.value, promo_code: el.qPromo.value
    };
  }

  // Bar only always includes the bar: the yes / no question goes away.
  function qTypeChanged() {
    var barOnly = false; // David only offers full service (Kevin, 2026-11-06)
    show(el.qBarBox, !barOnly);
    show(el.qBarNote, barOnly);
  }

  function qFieldErrors(errors) {
    var first = null;
    Q_FIELDS.forEach(function (f) {
      var msg = errors[f] || '';
      var p = $('q-err-' + f);
      if (p) setText(p, msg);
      var input = Q_INPUT[f] ? el[Q_INPUT[f]] : el.qForm.querySelector('input[name="q-bar"]');
      if (input) { if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
      if (msg && !first) first = input;
    });
    if (errors.distance_km) show(el.qKmBox, true);
    var inMore = ['event_date', 'occasion', 'promo_code'].some(function (f) { return errors[f]; });
    if (inMore) el.qMore.open = true;
    return first;
  }

  function qBusy(on) {
    S.quote.busy = on;
    el.qSubmit.disabled = on;
    el.qSubmit.classList.toggle('is-busy', on);
    if (on) el.qSubmit.setAttribute('aria-busy', 'true'); else el.qSubmit.removeAttribute('aria-busy');
  }

  function renderQuoteResult() {
    var v = S.quote.view;
    if (!v) { show(el.qResult, false); return; }
    var frag = document.createDocumentFragment();
    if (v.defer) {
      frag.appendChild(make('p', 'quote-review', 'Needs your review'));
      frag.appendChild(make('p', 'quote-why', v.reasons.length ? 'The calculator did not give a price because:' : 'The calculator did not give a price for these answers.'));
      if (v.reasons.length) {
        var ul = make('ul', 'quote-reasons');
        v.reasons.forEach(function (r) { ul.appendChild(make('li', '', r)); });
        frag.appendChild(ul);
      }
    } else {
      var items = make('ul', 'quote-items');
      v.items.forEach(function (it) {
        var li = make('li', 'quote-item' + (it.discount ? ' is-discount' : ''));
        var txt = make('span', 'qi-text');
        txt.appendChild(make('span', 'qi-label', it.label));
        if (it.detail) txt.appendChild(make('span', 'qi-detail', it.detail));
        li.appendChild(txt);
        li.appendChild(make('span', 'qi-amount', it.amount));
        items.appendChild(li);
      });
      if (v.items.length) frag.appendChild(items);
      var sums = make('dl', 'quote-sums');
      [['Subtotal', v.subtotal, ''], ['Travel fee', v.travel, ''], ['Total', v.total, 'is-total']].forEach(function (x) {
        if (!x[1]) return;
        sums.appendChild(make('dt', x[2], x[0])); sums.appendChild(make('dd', x[2], x[1]));
      });
      frag.appendChild(sums);
      if (v.deposit) frag.appendChild(make('p', 'rec-note', 'Deposit to hold the date: ' + v.deposit));
      v.flags.forEach(function (f) { frag.appendChild(make('p', 'rec-note', f)); });
    }
    var city = S.quote.req && S.quote.req.event_city;
    if (v.distance) frag.appendChild(make('p', 'rec-note q-distance', (city ? city + ' is ' : '') + v.distance + '.'));
    el.qResultBody.replaceChildren(frag);
    show(el.qCopy, !v.defer);
    el.qCopied.textContent = '';
    show(el.qResult, true);
  }

  function submitQuote() {
    if (S.quote.busy) return;
    setText(el.qErr, '');
    var r = L.quoteRequest(qForm());
    if (!r.ok) {
      var first = qFieldErrors(r.errors);
      if (first) try { first.focus(); } catch (e) { /* ignore */ }
      return;
    }
    qFieldErrors({});
    var n = ++S.quote.seq;
    qBusy(true);
    Promise.resolve().then(function () { return S.api.quote(r.body); }).then(function (res) {
      if (n !== S.quote.seq) return;
      S.quote.view = L.quoteResult(res);
      S.quote.req = r.body;
      // A city the map could not find: offer the distance box.
      if (S.quote.view.needsDistance) show(el.qKmBox, true);
      renderQuoteResult();
      try { el.qResultH.focus(); el.qResult.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { /* ignore */ }
    }).catch(function (e) {
      if (n !== S.quote.seq) return;
      var q = L.quoteError(e);
      var first = qFieldErrors(q.fields);
      setText(el.qErr, q.message);
      S.quote.view = null;
      renderQuoteResult();
      if (first) try { first.focus(); } catch (x) { /* ignore */ }
    }).then(function () { if (n === S.quote.seq) qBusy(false); });
  }

  // Clipboard API (https / localhost); falls back to a hidden textarea + execCommand.
  function copyQuote() {
    var text = L.quoteText(S.quote.view, S.quote.req);
    if (!text) return;
    var done = function () { el.qCopied.textContent = 'Copied. Paste it into a text or an email.'; };
    var fail = function () { el.qCopied.textContent = "Couldn't copy here. Select the quote and copy it by hand."; };
    var fallback = function () {
      try {
        var ta = make('textarea');
        ta.value = text; ta.setAttribute('readonly', ''); ta.className = 'sr-only';
        document.body.appendChild(ta); ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) done(); else fail();
      } catch (e) { fail(); }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  function showQuote() {
    S.thread.id = null;
    setScreen('quote');
    var pre = S.quotePrefill;
    S.quotePrefill = null;
    if (pre) {
      el.qGuests.value = pre.guests ? String(pre.guests) : '';
      el.qCity.value = pre.area || '';
    }
    qTypeChanged();
    renderQuoteResult();
  }

  /* ---------- calendar ---------- */

  var WEEK_HEAD = [['Sun', 'Sunday'], ['Mon', 'Monday'], ['Tue', 'Tuesday'], ['Wed', 'Wednesday'], ['Thu', 'Thursday'], ['Fri', 'Friday'], ['Sat', 'Saturday']];
  var CAL_SHOW = 3; // names per day cell on wide screens; the rest is "+N"

  function calState() {
    if (!S.cal) { var t = L.today(); S.cal = { y: t.y, m: t.m, sel: t.ymd }; }
    return S.cal;
  }

  function moveMonth(delta) {
    var c = calState();
    var n = L.shiftMonth(c.y, c.m, delta);
    var t = L.today();
    c.y = n.y; c.m = n.m;
    c.sel = t.y === n.y && t.m === n.m ? t.ymd : n.y + '-' + (n.m < 10 ? '0' : '') + n.m + '-01';
    renderCalendar();
  }

  function calHead() {
    if (el.calHead.childNodes.length) return;
    WEEK_HEAD.forEach(function (w) {
      var th = make('th', '', w[0]);
      th.scope = 'col';
      th.abbr = w[1];
      el.calHead.appendChild(th);
    });
  }

  function renderCalendar() {
    var c = calState();
    el.calTitle.textContent = L.monthTitle(c.y, c.m);
    el.calPossible.checked = S.showPossible;
    if (!S.listLoaded) {
      show(el.calLoading, !S.listError);
      setText(el.calErr, S.listError);
      show(el.calGrid, false); show(el.calDay, false); show(el.calAgenda, false); setText(el.calMonthNote, '');
      return;
    }
    show(el.calLoading, false);
    setText(el.calErr, '');
    renderAgenda();
    calHead();
    var days = L.eventsByDay(S.leads, { showPossible: S.showPossible });
    var today = L.today().ymd;
    // A live refresh rebuilds the grid: put keyboard focus back on the same day.
    var focused = document.activeElement && el.calBody.contains(document.activeElement) ? document.activeElement.getAttribute('data-day') : null;
    var bookedInMonth = 0;
    var frag = document.createDocumentFragment();
    L.monthGrid(c.y, c.m).forEach(function (week) {
      var tr = make('tr');
      week.forEach(function (d) {
        var td = make('td');
        if (!d.inMonth) { td.className = 'is-out'; tr.appendChild(td); return; }
        var day = days[d.ymd];
        if (day) bookedInMonth += day.booked.length;
        var b = make('button', 'cal-cell');
        b.type = 'button';
        b.setAttribute('data-day', d.ymd);
        b.setAttribute('aria-label', L.dayLabel(d.ymd, day));
        b.setAttribute('aria-pressed', String(d.ymd === c.sel));
        if (d.ymd === today) { b.classList.add('is-today'); b.setAttribute('aria-current', 'date'); }
        b.appendChild(make('span', 'cal-num', String(d.d)));
        if (day) {
          var marks = make('span', 'cal-marks');
          var all = day.booked.map(function (l) { return [l, 'is-booked']; }).concat(day.possible.map(function (l) { return [l, 'is-possible']; }));
          all.slice(0, CAL_SHOW).forEach(function (p) {
            var ev = make('span', 'cal-ev ' + p[1]);
            ev.appendChild(make('span', 'cal-ev-name', leadName(p[0])));
            marks.appendChild(ev);
          });
          if (all.length > CAL_SHOW) marks.appendChild(make('span', 'cal-more', '+' + (all.length - CAL_SHOW)));
          b.appendChild(marks);
        }
        b.addEventListener('click', function () { selectDay(d.ymd); });
        td.appendChild(b);
        tr.appendChild(td);
      });
      frag.appendChild(tr);
    });
    el.calBody.replaceChildren(frag);
    show(el.calGrid, true);
    if (focused) { var back = el.calBody.querySelector('[data-day="' + focused + '"]'); if (back) try { back.focus(); } catch (e) { /* ignore */ } }
    setText(el.calMonthNote, bookedInMonth ? '' : 'Nothing booked in ' + L.monthTitle(c.y, c.m).split(' ')[0] + ' yet.');
    renderDay(days);
  }

  // "This week" (and a few "Later") above the grid: who, when, guests, price. Tap = the lead.
  function agendaRow(item) {
    var v = L.agendaView(item);
    var li = make('li');
    var a = make('a', 'ag-row');
    a.href = '#/lead/' + encodeURIComponent(item.lead.lead_id);
    var d = make('span', 'ag-date');
    d.appendChild(make('span', 'ag-wd', item.when));
    d.appendChild(make('span', 'ag-day', item.day));
    d.appendChild(make('span', 'ag-mon', item.mon));
    a.appendChild(d);
    var main = make('span', 'ag-main');
    var top = make('span', 'row-top');
    top.appendChild(make('span', 'lead-name', v.name));
    if (v.money) top.appendChild(make('span', 'lead-money', v.money));
    main.appendChild(top);
    var foot = make('span', 'row-foot');
    if (v.line) foot.appendChild(make('span', 'ag-line', v.line));
    foot.appendChild(chipNode(v.chip));
    main.appendChild(foot);
    a.appendChild(main);
    li.appendChild(a);
    return li;
  }

  function renderAgenda() {
    var ag = L.weekAgenda(S.leads, { showPossible: S.showPossible });
    function fill(ul, items) {
      var f = document.createDocumentFragment();
      items.forEach(function (it) { f.appendChild(agendaRow(it)); });
      ul.replaceChildren(f);
      show(ul.parentNode, items.length > 0);
    }
    fill(el.calAgendaWeek, ag.thisWeek);
    fill(el.calAgendaLater, ag.later);
    setText(el.calAgendaEmpty, ag.thisWeek.length ? '' : 'Nothing this week' + (ag.later.length ? '. The next event is below.' : '.'));
    show(el.calAgenda, true);
  }

  // Picking a day only updates the pressed state and the list, so focus stays on the button.
  function selectDay(dayYmd) {
    calState().sel = dayYmd;
    var cells = el.calBody.querySelectorAll('.cal-cell');
    for (var i = 0; i < cells.length; i++) cells[i].setAttribute('aria-pressed', String(cells[i].getAttribute('data-day') === dayYmd));
    renderDay(L.eventsByDay(S.leads, { showPossible: S.showPossible }));
  }

  function renderDay(days) {
    var sel = calState().sel;
    var day = days[sel];
    var list = day ? day.booked.concat(day.possible) : [];
    el.calDayTitle.textContent = L.fmtEventDate(sel);
    var frag = document.createDocumentFragment();
    list.forEach(function (lead) { frag.appendChild(leadRow(lead, { noDate: true })); }); // the date is the heading above
    el.calDayList.replaceChildren(frag);
    show(el.calDayList, list.length > 0);
    setText(el.calDayEmpty, list.length ? '' : (S.showPossible ? 'No events on this day.' : 'Nothing booked on this day.'));
    show(el.calDay, true);
  }

  function showCalendar() {
    S.thread.id = null;
    setScreen('calendar');
    renderCalendar();
    refreshList();
  }

  /* ---------- follow-ups ---------- */

  function refreshFollowUps() {
    if (!HAS_FOLLOWUPS || !S.api.fetchFollowUps) return Promise.resolve();
    var n = ++S.seq.followups;
    return Promise.resolve(S.api.fetchFollowUps()).then(function (rows) {
      if (n !== S.seq.followups || !S.signedIn) return;
      S.followUps = Array.isArray(rows) ? rows : [];
      S.followUpsError = '';
      if (S.screen === 'followups') renderFollowUps();
      else if (S.screen === 'more') renderPush();
      else if (S.screen === 'thread' && S.thread.lead) renderNext();
    }).catch(function (e) {
      if (n !== S.seq.followups) return;
      if (!S.followUps) {
        S.followUpsError = isAuthFailure(e) ? 'Your session ran out. Sign out and sign in again.' : "Couldn't load your follow-ups. Trying again…";
        if (S.screen === 'followups') renderFollowUps();
      }
      retryLater();
    });
  }

  // The one badge in the page: leads waiting on the owner, on the Leads tab. Counted from the lead list (same leads as the Needs-you block).
  function renderBadge() {
    var count = S.listLoaded ? L.needsYou(S.leads).length : 0;
    var item = el.tabbarList.querySelector('[data-route="list"] .tab-badge');
    if (!item) return;
    item.hidden = !count;
    item.firstChild.textContent = String(count);
    item.lastChild.textContent = ', ' + count + ' waiting on you';
  }

  function fuBlock(title, empty) {
    var sec = make('section', 'fu-block');
    sec.appendChild(make('h2', 'fu-title', title));
    if (empty) sec.appendChild(make('p', 'fu-empty', empty));
    return sec;
  }

  // One tappable row: the shared lead row (details from the lead list when it has them) plus the plain lines given.
  function fuRow(r, lines, opts) {
    var lead = null;
    for (var i = 0; i < S.leads.length; i++) if (S.leads[i] && S.leads[i].lead_id === r.lead_id) { lead = S.leads[i]; break; }
    return leadRow(lead || r, { lines: lines, cls: opts && opts.cls, quiet: !lead || !!(opts && opts.quiet) });
  }

  function renderFollowUps() {
    if (!S.followUps) {
      show(el.fuLoading, !S.followUpsError);
      setText(el.fuErr, S.followUpsError);
      el.fuBody.replaceChildren();
      return;
    }
    show(el.fuLoading, false);
    setText(el.fuErr, '');
    var g = L.groupFollowUps(S.followUps, S.leads);
    var frag = document.createDocumentFragment();

    // 1. Scheduled follow-up texts, soonest first, with a live countdown. (Who is waiting on the owner lives on Home.)
    // Grouped Today / This week / Later; the "how to stop it" rule is said once, under the heading.
    var sched = fuBlock('Scheduled follow-up texts', g.scheduled.length ? '' : 'No follow-up texts scheduled.');
    if (g.scheduled.length) {
      sched.appendChild(make('p', 'fu-rule', 'Marking a lead ' + L.statusInfo('booked').label.toLowerCase() + ' or ' + L.statusInfo('lost').label.toLowerCase() + ' stops its texts.'));
      L.groupScheduled(g.scheduled).forEach(function (grp) {
        var gs = make('section', 'fu-group');
        var gh = make('h3', 'fu-group-h', grp.label);
        gh.appendChild(make('span', 'fu-group-n', String(grp.rows.length)));
        gs.appendChild(gh);
        var us = make('ul', 'fu-list');
        grp.rows.forEach(function (r) {
          us.appendChild(fuRow(r, [
            { text: L.nudgeLine(r) },
            { text: L.fmtCountdown(r.due_at), cls: 'fu-count', due: r.due_at }
          ]));
        });
        gs.appendChild(us);
        sched.appendChild(gs);
      });
    }
    frag.appendChild(sched);

    // 2. (Held alerts and the 9 am summary text live in More > Alerts: see alertInfoLines.)

    // 3. Anything new the backend adds: shown plainly with its reason.
    if (g.other.length) {
      var oth = fuBlock('Other follow-ups');
      var uo = make('ul', 'fu-list');
      g.other.forEach(function (r) {
        var when = r.due_at ? L.fmtDueAt(r.due_at) : '';
        uo.appendChild(fuRow(r, [
          { text: L.kindLabel(r.follow_up_type) + (when ? ' · ' + when : '') },
          r.reason ? { text: String(r.reason), cls: 'fu-meta' } : null
        ]));
      });
      oth.appendChild(uo);
      frag.appendChild(oth);
    }

    // 4. Sent recently (last 14 days).
    var sent = fuBlock('Sent recently', g.sent.length ? '' : 'No follow-up texts sent in the last 14 days.');
    if (g.sent.length) {
      var ust = make('ul', 'fu-list');
      g.sent.forEach(function (r) { ust.appendChild(fuRow(r, [{ text: L.sentLine(r), cls: 'fu-meta' }], { cls: 'is-sent', quiet: true })); });
      sent.appendChild(ust);
    }
    frag.appendChild(sent);

    el.fuBody.replaceChildren(frag);
  }

  // Countdowns change text only, so focus and scroll stay put.
  function tickCountdowns() {
    var spans = el.fuBody.querySelectorAll('[data-due]');
    for (var i = 0; i < spans.length; i++) {
      var t = L.fmtCountdown(spans[i].getAttribute('data-due'));
      if (spans[i].textContent !== t) spans[i].textContent = t;
    }
    if (S.screen === 'thread' && S.thread.lead) renderNext();
  }

  function showFollowUps() {
    S.thread.id = null;
    setScreen('followups');
    renderFollowUps();
    refreshFollowUps();
    refreshList(); // "asked for you" times
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

  function tile(label, pair, lead) {
    var d = make('div', 'm-tile' + (lead ? ' is-lead' : ''));
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
      tiles.appendChild(tile('This month', L.moneyCount(bk.this_month), true));
      tiles.appendChild(tile('Last month', L.moneyCount(bk.last_month)));
      tiles.appendChild(tile('All time', L.moneyCount(bk.all_time)));
      b.appendChild(tiles);
      var avg = L.fmtMoney(bk.avg_job);
      if (avg) b.appendChild(make('p', 'm-sub', 'Average job: ' + avg));
      return b;
    },
    close_rate: function (m) {
      var b = block('Close rate');
      var cr = L.closeRateTile(m.close_rate);
      if (!cr) { b.appendChild(make('p', 'm-line m-empty', 'No finished leads yet.')); return b; }
      var t = make('div', 'm-tile is-rate');
      t.appendChild(make('p', 'm-tile-money', cr.pct));
      t.appendChild(make('p', 'm-tile-count', cr.text));
      b.appendChild(t);
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
    }
  };
  // Lead value (feature switch 'value'): one line per tier, from the lead list. Totals and counts cover open leads only.
  METRIC_BLOCKS.value = function (m) {
    var b = block('Lead value');
    if (!S.listLoaded) { b.appendChild(make('p', 'm-line m-empty', S.listError || 'Loading your leads\u2026')); return b; }
    var lines = L.tierLines(S.leads, m.value_tiers);
    if (!lines.some(function (r) { return r.count; })) { b.appendChild(make('p', 'm-line m-empty', 'No open leads right now.')); return b; }
    var ul = make('ul', 'vt-list');
    lines.forEach(function (r) {
      if (r.key === 'none' && !r.count) return;
      var li = make('li', 'vt-row vt-' + r.key + (r.count ? '' : ' is-zero'));
      var name = make('span', 'vt-name', r.label);
      if (r.range) name.appendChild(make('span', 'vt-range', r.range));
      li.appendChild(name);
      var right = make('span', 'vt-right');
      if (r.money && r.count) right.appendChild(make('span', 'vt-money', r.money));
      right.appendChild(make('span', 'vt-count', L.plural(r.count, 'open lead', 'open leads')));
      li.appendChild(right);
      ul.appendChild(li);
    });
    b.appendChild(ul);
    return b;
  };
  // Where leads come from (cv_metrics().sources, 7 fixed buckets): only buckets with leads. No block at all on an older server.
  METRIC_BLOCKS.sources = function (m) {
    if (!Array.isArray(m.sources)) return null;
    var b = block('Where leads come from');
    var rows = L.sourceRows(m.sources);
    if (!rows.length) { b.appendChild(make('p', 'm-line m-empty', 'No leads yet.')); return b; }
    var ul = make('ul', 'vt-list');
    rows.forEach(function (r) {
      var li = make('li', 'vt-row');
      li.appendChild(make('span', 'vt-name', r.label));
      var right = make('span', 'vt-right');
      right.appendChild(make('span', 'vt-count', L.plural(r.leads, 'lead', 'leads') + ' \u00b7 ' + r.month + ' this month'));
      if (r.booked) right.appendChild(make('span', 'vt-count', r.booked + ' booked' + (r.bookedMoney ? ' (' + r.bookedMoney + ')' : '')));
      li.appendChild(right);
      ul.appendChild(li);
    });
    b.appendChild(ul);
    return b;
  };
  // Why leads were lost (cv_metrics().lost_reasons), biggest first, simple bars.
  METRIC_BLOCKS.lost_reasons = function (m) {
    var b = block('Why leads were lost');
    var rows = L.lostReasonRows(m.lost_reasons);
    if (!rows.length) {
      b.appendChild(make('p', 'm-line m-empty', 'No lost leads with a reason yet.'));
      return b;
    }
    var ol = make('ol', 'funnel');
    rows.forEach(function (r) {
      var li = make('li', 'funnel-row');
      var top = make('div', 'funnel-top');
      top.appendChild(make('span', 'funnel-label', r.label));
      top.appendChild(make('span', 'funnel-num', r.count + ' (' + r.pct + '%)'));
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
  };
  var METRIC_DEFAULT = ['booked', 'sources', 'open', 'value', 'close_rate', 'lost_reasons', 'speed'];

  // CV_CUSTOM.metrics order; unknown names ignored; all blocks when the setting is missing or empty.
  function metricOrder() {
    var want = Array.isArray(custom.metrics) ? custom.metrics : [];
    var out = [];
    want.forEach(function (k) { if (METRIC_BLOCKS[k] && out.indexOf(k) === -1) out.push(k); });
    if (!out.length) out = METRIC_DEFAULT.slice();
    // Lead value is a section of Metrics: it follows the 'value' switch, right after Money on the table.
    out = out.filter(function (k) { return k !== 'value'; });
    if (feature('value')) { var oi = out.indexOf('open'); out.splice(oi === -1 ? out.length : oi + 1, 0, 'value'); }
    return out;
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
    metricOrder().forEach(function (key) { var blk = METRIC_BLOCKS[key](m); if (blk) frag.appendChild(blk); });

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
    if (feature('value')) refreshList(); // the lead value lines are counted from the lead list
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
    // Only the buttons still ahead are shown (C4): the current status is on the chip above, not repeated here.
    var ahead = L.actionsAhead(current);
    L.actions().forEach(function (a) {
      var b = S.actionButtons[a.status];
      var isCurrent = current === a.status;
      var busy = S.pending === a.status;
      b.hidden = !!lead && ahead.indexOf(a.status) === -1 && !busy;
      b.disabled = !lead || !L.canSetStatus(current, a.status) || !!S.pending;
      b.classList.toggle('is-current', isCurrent);
      b.classList.toggle('is-busy', busy);
      if (busy) b.setAttribute('aria-busy', 'true'); else b.removeAttribute('aria-busy');
      b.title = isCurrent ? 'Already ' + a.label.toLowerCase() : '';
    });
    setText(el.actionsNote, L.actionsNote(current));
    var count = ahead.length;
    el.actions.hidden = !!lead && count === 0 && !S.pending;
    el.actions.style.gridTemplateColumns = 'repeat(' + Math.max(1, Math.min(3, count || 3)) + ', 1fr)';
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
    show(el.recHistory, all.length > 0);
    var extra = all.length - HISTORY_SHORT;
    show(el.historyMore, extra > 0);
    el.historyMore.textContent = S.historyOpen ? 'Show fewer changes' : 'Show all ' + all.length + ' changes';
    el.historyMore.setAttribute('aria-expanded', String(S.historyOpen));
  }

  // Reason chips for the Lost sheet: real radio buttons (labels from CV_CUSTOM.lostReasons).
  function buildReasons() {
    var frag = document.createDocumentFragment();
    L.lostReasons().forEach(function (r) {
      var lab = make('label', 'reason-chip');
      var input = make('input');
      input.type = 'radio'; input.name = 'lost-reason'; input.value = r.key;
      input.addEventListener('change', function () {
        show(el.reasonOther, r.key === 'other');
        setText(el.confirmErr, '');
      });
      lab.appendChild(input);
      lab.appendChild(make('span', '', r.label));
      frag.appendChild(lab);
    });
    el.reasonChips.replaceChildren(frag);
  }

  function pickedReason() {
    var c = el.reasonChips.querySelector('input:checked');
    return c ? c.value : '';
  }

  function openSheet(kind, text, yes, cls, focus) {
    S.confirming = kind;
    el.confirmText.textContent = text;
    el.confirmYes.textContent = yes;
    el.confirm.className = 'sheet ' + cls;
    setText(el.confirmErr, '');
    if (typeof el.confirm.showModal === 'function') el.confirm.showModal();
    else el.confirm.setAttribute('open', '');
    try { (focus || el.confirmNo).focus(); } catch (e) { /* ignore */ }
  }

  function openConfirm(action) {
    var lead = S.thread.lead;
    if (!lead || S.pending) return;
    var booked = action.status === 'booked', lost = action.status === 'lost';
    // Booked: final price, filled in from the quote. Lost: a reason is required.
    show(el.priceBox, booked);
    if (booked) { el.price.value = L.amountInput(lead.quote_total); el.price.removeAttribute('aria-invalid'); }
    show(el.reasonBox, lost);
    if (lost) {
      var checked = el.reasonChips.querySelectorAll('input');
      for (var i = 0; i < checked.length; i++) checked[i].checked = false;
      el.reasonNote.value = '';
      show(el.reasonOther, false);
    }
    openSheet({ kind: 'status', status: action.status }, L.confirmText(leadName(lead), action.status, lead), action.confirm,
      'sheet-' + action.status, booked ? el.price : null);
  }

  function openNoteDelete(noteId) {
    show(el.priceBox, false); show(el.reasonBox, false);
    openSheet({ kind: 'note', id: noteId }, 'Delete this note? It cannot be brought back.', 'Delete note', 'sheet-note');
  }

  // Yes on the sheet: check the extra fields first; the sheet stays open with a plain error if they are wrong.
  function confirmYes() {
    var c = S.confirming;
    if (!c) return;
    if (c.kind === 'note') { closeConfirm(); deleteNote(c.id); return; }
    var lead = S.thread.lead;
    var x = L.statusExtras(c.status, { amount: el.price.value, reason: pickedReason(), note: el.reasonNote.value }, lead && lead.quote_total);
    if (!x.ok) {
      setText(el.confirmErr, x.error);
      if (x.field === 'amount') { el.price.setAttribute('aria-invalid', 'true'); try { el.price.focus(); } catch (e) { /* ignore */ } }
      else if (x.field === 'reason') { var first = el.reasonChips.querySelector('input'); if (first) try { first.focus(); } catch (e) { /* ignore */ } }
      return;
    }
    closeConfirm();
    saveStatus(c.status, x.args);
  }

  function closeConfirm() {
    S.confirming = null;
    if (el.confirm.open) {
      if (typeof el.confirm.close === 'function') el.confirm.close();
      else el.confirm.removeAttribute('open');
    }
  }

  // No optimistic UI: spinner on the button, wait for the server, then refetch.
  function saveStatus(status, extra) {
    var id = S.thread.id;
    if (!id || S.pending) return;
    S.pending = status;
    setText(el.actionErr, '');
    renderActions();
    Promise.resolve().then(function () { return S.api.setStatus(id, status, extra || {}); }).then(function () {
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
          var next = el.actions.querySelector('button:not([disabled]):not([hidden])');
          if (next) { try { next.focus(); } catch (x) { /* ignore */ } }
        }
      }
    });
  }

  /* ---------- notes ---------- */

  function renderNotes(lead) {
    var notes = L.sortNotes(lead.notes);
    var frag = document.createDocumentFragment();
    notes.forEach(function (n) {
      var li = make('li', 'note');
      li.appendChild(make('p', 'note-body', String(n.body)));
      var foot = make('div', 'note-foot');
      var t = make('time', 'note-time', L.fmtStamp(n.created_at));
      if (L.fmtStamp(n.created_at)) t.dateTime = new Date(n.created_at).toISOString();
      foot.appendChild(t);
      if (n.author_is_me === true) {
        var del = make('button', 'note-del', 'Delete');
        del.type = 'button';
        del.setAttribute('aria-label', 'Delete note from ' + L.fmtStamp(n.created_at));
        del.addEventListener('click', function () { openNoteDelete(n.id); });
        foot.appendChild(del);
      }
      li.appendChild(foot);
      frag.appendChild(li);
    });
    el.notesList.replaceChildren(frag);
    show(el.notesList, notes.length > 0);
    show(el.hNotes, notes.length > 0);
    // The notes block needs the backend: no `notes` field on the lead (older view) = no block.
    show(el.recNotes, HAS_NOTES && Array.isArray(lead.notes) && !!S.api.addNote);
  }

  // Save appears only while there is text to save.
  function syncNoteSave() { el.noteSave.hidden = !el.noteText.value.trim(); }

  function noteCount() {
    var left = L.NOTE_MAX - el.noteText.value.length;
    setText(el.noteCount, left <= 200 ? L.plural(left, 'character', 'characters') + ' left' : '');
    syncNoteSave();
  }

  function saveNote() {
    var id = S.thread.id;
    if (!id || S.noteBusy) return;
    var c = L.checkNote(el.noteText.value);
    if (!c.ok) { setText(el.noteErr, c.error); try { el.noteText.focus(); } catch (e) { /* ignore */ } return; }
    S.noteBusy = true;
    el.noteSave.disabled = true;
    setText(el.noteErr, '');
    Promise.resolve(S.api.addNote(id, c.body)).then(function () {
      if (id === S.thread.id) { el.noteText.value = ''; noteCount(); }
      return refreshThread();
    }).catch(function (e) {
      if (id === S.thread.id) setText(el.noteErr, isAuthFailure(e) ? 'Your session ran out. Sign out and sign in again.' : "Couldn't save the note. Try again in a moment.");
    }).then(function () { S.noteBusy = false; el.noteSave.disabled = false; });
  }

  function deleteNote(noteId) {
    var id = S.thread.id;
    setText(el.noteErr, '');
    Promise.resolve(S.api.deleteNote(noteId)).then(function () { return refreshThread(); }).catch(function (e) {
      if (id === S.thread.id) setText(el.noteErr, isAuthFailure(e) ? 'Your session ran out. Sign out and sign in again.' : "Couldn't delete the note. Try again in a moment.");
    }).then(function () { try { el.noteText.focus(); } catch (x) { /* ignore */ } });
  }

  /* ---------- thread ---------- */

  // The conversation is its own scrolling box on every screen size (chat order: oldest at the top, newest at the bottom).
  function convoScroller() { return el.convoScroll; }

  function isNearBottom() {
    var s = convoScroller();
    return s.scrollHeight - s.scrollTop - s.clientHeight < 100;
  }

  // First paint: cap the box to the room left above the tab bar (min 280 px) so the newest text is on screen. It scrolls inside.
  function fitConvo() {
    var s = convoScroller();
    if (!s || !el.tabbar || el.tabbar.hidden || window.matchMedia('(min-width: 1200px)').matches) return;
    s.style.maxHeight = '';
    var room = el.tabbar.getBoundingClientRect().top - s.getBoundingClientRect().top - 12;
    if (room > 0) s.style.maxHeight = Math.max(280, Math.floor(room)) + 'px';
    // No page scroll on open (chair 11-06): the first screen must show who, status and Call/Text (C1).
    // The box is already at its newest message; one short swipe brings it into view.
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

  // Call / Text / Email under the header. The phone number itself is the tappable line in the header; the email sits behind its button.
  function renderContact(lead) {
    var phone = L.fmtPhoneNational(lead.phone);
    var tel = L.telHref(lead.phone);
    if (phone && tel) { el.recPhone.textContent = phone; el.recPhone.href = tel; show(el.recPhone, true); }
    else { el.recPhone.textContent = ''; el.recPhone.removeAttribute('href'); show(el.recPhone, false); }
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
    show(el.recContact, actions.length > 0 || L.isOptedOut(lead));
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
      if (L.statusGroup(lead.status) === 'booked') sum('Final price', L.fmtMoney(lead.booked_amount), 'is-final');
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
      bottom.appendChild(chipNode(L.statusChip(o)));
      a.appendChild(bottom);
      li.appendChild(a);
      frag.appendChild(li);
    });
    el.othersList.replaceChildren(frag);
    show(el.recOthers, others.length > 0);
  }

  // Line under the name. A pending automatic follow-up text (follow_ups) gives the exact send time.
  function renderNext() {
    var lead = S.thread.lead;
    if (!lead) return;
    // A booked lead's date and price are already in the job line below: no second sentence (C4).
    var t = L.statusGroup(lead.status) === 'booked' ? '' : L.nextAction(lead, undefined, L.pendingNudge(S.followUps, S.thread.id));
    if (el.recNext.textContent !== t || el.recNext.hidden !== !t) setText(el.recNext, t);
  }

  function renderRecord() {
    var lead = S.thread.lead;
    el.title.textContent = S.tab.label; // the lead's name is the big heading below; the bar says where Back goes
    setText(el.subtitle, '');
    var sections = [el.recHead, el.recContact, el.strip, el.recNotes, el.recEvent, el.recPrice, el.recQuote, el.recOthers, el.recHistory];
    if (!lead) {
      sections.forEach(function (n) { show(n, false); });
      show(el.optoutBanner, false);
      show(el.recordLoading, !S.thread.loaded);
      return;
    }
    show(el.recordLoading, false);
    var st = L.rowView(lead).chip; // "Booked" (the price is in the job line), "Lost · Price"
    el.recName.textContent = leadName(lead);
    fillChip(el.stripChip, st);
    renderNext();
    setText(el.recJob, L.jobBits(lead).join(' \u00b7 '));
    setText(el.recSource, L.sourceLine(lead));
    setText(el.recNoauto, L.noAutoLine(lead));
    show(el.recHead, true);
    show(el.optoutBanner, L.isOptedOut(lead));
    renderContact(lead);
    el.strip.className = 'rec-card strip tone-' + st.tone;
    var lostNote = String(lead.status || '').toLowerCase() === 'lost' ? String(lead.lost_note || '').trim() : '';
    setText(el.stripNote, lostNote ? 'Why: ' + lostNote : '');
    setText(el.hStatus, L.statusHeading(lead.status));
    renderActions();
    renderHistory();
    // The card is only there while there is something to do or say: buttons ahead, a lost note, or a locked-status note.
    show(el.strip, L.actionsAhead(lead.status).length > 0 || !!lostNote || !!L.actionsNote(String(lead.status || '').toLowerCase()));
    renderNotes(lead);
    renderEvent(lead);
    renderQuote(lead);
    // A lead with no price yet can be priced in the calculator (nothing is saved to the lead in this round).
    show(el.recPrice, TAB_ROUTES.indexOf('quote') !== -1 && (lead.quote_total === null || lead.quote_total === undefined || lead.quote_total === ''));
    renderOthers(lead);
  }

  function bubble(m) {
    var out = m.direction === 'out';
    var owner = m.audience === 'owner';
    var row = make('div', 'row ' + (out ? 'out' : 'in') + (owner ? ' owner' : ''));
    var b = make('div', 'bubble');
    var label = L.kindLabel(m.kind);
    if (label) b.appendChild(make('div', 'label', label));
    b.appendChild(make('p', 'text', m.body == null ? '' : String(m.body)));
    var t = make('time', 'stamp', L.fmtStamp(m.at));
    t.dateTime = new Date(m.at).toISOString();
    b.appendChild(t);
    row.appendChild(b);
    return row;
  }

  // The automatic texts to the owner (alert, 9 am text, confirmation): ONE line beside the Conversation heading
  // ("N automatic texts · show"), so it is in view without scrolling the box. Open, the texts list at the top of the box.
  function renderFold(system) {
    var n = system.length;
    show(el.sysFold, n > 0);
    if (!n) return;
    el.sysFold.textContent = L.systemFoldText(n, S.thread.sysOpen);
    el.sysFold.setAttribute('aria-expanded', String(S.thread.sysOpen));
  }

  function sysList(system) {
    var list = make('div', 'sys-list');
    list.id = 'sys-list';
    system.forEach(function (m) { list.appendChild(bubble(m)); });
    return list;
  }

  function toggleFold() {
    S.thread.sysOpen = !S.thread.sysOpen;
    S.thread.sig = '';
    renderThread();
    // Open: show the automatic texts at the top. The second set runs after any scrollToBottom frame renderThread queued (review r2 M1).
    var s = convoScroller();
    if (S.thread.sysOpen) { s.scrollTop = 0; requestAnimationFrame(function () { s.scrollTop = 0; }); } else scrollToBottom();
  }

  function renderThread() {
    renderRecord();
    var parts = L.splitThread(S.thread.rows);
    var rows = parts.chat;
    renderFold(parts.system);
    show(el.threadLoading, false);
    if (!S.thread.lead && rows.length === 0 && parts.system.length === 0) {
      show(el.threadBox, false);
      show(el.threadEmpty, false);
      setText(el.threadErr, "We can't find that lead. Go back to your list and pick one.");
      return;
    }
    var all = rows.concat(parts.system);
    var sig = all.map(function (r) { return r.msg_id + ':' + String(r.body == null ? '' : r.body).length; }).join('|') + (S.thread.sysOpen ? '|open' : '');
    var first = S.thread.sig === '' && !el.threadBox.hasChildNodes();
    if (sig === S.thread.sig && !first) return;

    // First paint opens at the newest text (like a chat app); later refreshes keep your place unless you were at the bottom.
    var scroller = convoScroller();
    var wasNear = first ? true : isNearBottom();
    var prevTop = scroller.scrollTop;
    var grew = rows.length > S.thread.count;
    var frag = document.createDocumentFragment();
    if (parts.system.length && S.thread.sysOpen) frag.appendChild(sysList(parts.system));
    var prev = null;
    rows.forEach(function (m) {
      if (!prev || !L.sameDay(prev.at, m.at)) frag.appendChild(make('div', 'day', L.fmtDay(m.at)));
      frag.appendChild(bubble(m));
      prev = m;
    });
    el.threadBox.replaceChildren(frag);
    show(el.threadBox, all.length > 0);
    show(el.threadEmpty, rows.length === 0 && parts.system.length === 0);
    S.thread.sig = sig;
    S.thread.count = rows.length;
    if (first) fitConvo();

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
      setText(el.noteErr, '');
      el.noteText.value = ''; syncNoteSave(); show(el.sysFold, false);
      noteCount();
      show(el.threadLoading, true);
      renderRecord();
      el.threadScroll.scrollTop = 0;
      el.convoScroll.scrollTop = 0;
      el.title.textContent = S.tab.label;
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
    if (r.name === 'lead') { showThread(r.id); return; }
    S.tab = navFor(r.name);
    S.tab.show();
  }

  /* ---------- auth + sign-in UI ---------- */

  // One app name (L.appName): sign-in heading and browser tab. Backend-offered names only fill the tab/heading when config has none.
  function applyAppName(name) {
    var n = name || L.appName(custom);
    document.title = n;
    var b = document.getElementById('brand-name');
    if (b) b.textContent = n;
  }

  // CV_CUSTOM.businessName wins; else whatever the backend offers (the mock says "Lab Bar"); else nothing. Shown at the top of More.
  function loadBrand() {
    var own = typeof custom.businessName === 'string' ? custom.businessName.trim() : '';
    if (own) { el.moreBrand.textContent = own; return; }
    Promise.resolve(S.api.businessName ? S.api.businessName() : null).then(function (name) {
      if (S.signedIn) { el.moreBrand.textContent = (name && String(name).trim()) || ''; if (name && String(name).trim()) applyAppName(String(name).trim()); }
    }).catch(function () { /* keep it empty */ });
  }

  function onSignedIn() {
    if (S.signedIn) return;
    S.signedIn = true;
    startLive();
    loadBrand();
    loadPush();
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
    // Session ended (expiry, other tab): drop this phone's browser subscription locally. The server call may no longer be authorised;
    // a leftover server row is removed on the push service's next 404/410.
    if (P.sub) { try { Promise.resolve(P.sub.unsubscribe()).catch(function () { /* ignore */ }); } catch (e) { /* ignore */ } }
    P.seq++; P.cfg = null; P.sub = null; P.busy = false; P.open = false; pushMsg(''); renderPush();
    clearStoredTargets();
    stopLive();
    clearTimeout(S.refreshTimer);
    S.seq.list++; S.seq.thread++;
    S.leads = []; S.listLoaded = false; S.listError = '';
    S.thread = emptyThread();
    S.filter = 'open'; S.pending = null; S.tab = NAV[0];
    S.seq.metrics++; S.metrics = null; S.metricsError = '';
    S.seq.followups++; S.followUps = null; S.followUpsError = '';
    clearSearch();
    S.quote = { busy: false, seq: S.quote.seq + 1, view: null, req: null };
    el.qForm.reset(); qBusy(false); qFieldErrors({}); setText(el.qErr, ''); show(el.qKmBox, false); renderQuoteResult();
    S.cal = null; S.showPossible = false;
    el.calBody.replaceChildren(); el.calDayList.replaceChildren(); el.notesList.replaceChildren(); el.noteText.value = ''; syncNoteSave();
    el.fuBody.replaceChildren();
    renderBadge(); renderNeeds([]);
    el.leadList.replaceChildren(); el.threadBox.replaceChildren(); el.metricsBody.replaceChildren();
    el.moreBrand.textContent = '';
    closeConfirm();
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

  /* ---------- alerts on this phone (push) ---------- */

  // Service worker: registered at page load (harmless when push is off). It only shows notifications; it caches nothing.
  var P = { open: false, cfg: null, sub: null, busy: false, seq: 0, reg: Promise.resolve(null) };
  function registerWorker() {
    if (!('serviceWorker' in navigator)) return;
    P.reg = navigator.serviceWorker.register('sw.js', { scope: '/' }).catch(function () { return null; });
  }

  function pushSupported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
  function pushEnv() {
    var ua = navigator.userAgent || '';
    var ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var standalone = navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    var env = {
      featureOn: HAS_PUSH, serverEnabled: P.cfg ? P.cfg.enabled : null, ios: ios, standalone: standalone,
      supported: pushSupported(), permission: 'Notification' in window ? Notification.permission : 'default', subscribed: !!P.sub
    };
    // Mock mode only: ?pushenv=install|unsupported|denied|off|on pretends to be that phone, for screenshots.
    var m = MOCK && qs.get('pushenv');
    if (m === 'install') { env.ios = true; env.standalone = false; }
    else if (m === 'unsupported') { env.ios = false; env.supported = false; }
    else if (m === 'denied') { env.ios = false; env.supported = true; env.permission = 'denied'; }
    else if (m === 'off') { env.ios = false; env.supported = true; env.permission = 'default'; env.subscribed = false; }
    else if (m === 'on') { env.ios = false; env.supported = true; env.permission = 'granted'; env.subscribed = true; }
    return env;
  }

  function pushMsg(text, bad) {
    setText(el.alertsMsg, text || '');
    el.alertsMsg.classList.toggle('bad', !!bad);
    show(el.alertsMsg, !!text);
  }

  // Plain lines about texts that reach the owner: alerts held until morning, and the 9 am summary text.
  function alertInfoLines() {
    if (!S.followUps) return [];
    var g = L.groupFollowUps(S.followUps, S.leads);
    return [L.heldLine(g.held), L.digestLine(g.digest)].filter(Boolean).map(function (t) { return t + '.'; });
  }

  function renderPush() {
    var st = L.pushState(pushEnv());
    var info = alertInfoLines();
    var f = document.createDocumentFragment();
    info.forEach(function (t) { f.appendChild(make('p', 'alerts-info', t)); });
    el.alertsInfo.replaceChildren(f);
    show(el.alerts, st !== 'hidden' || info.length > 0);
    if (st === 'hidden') {
      // Alerts can't be set up here, but the owner can still see which texts are on the way.
      setText(el.alertsHead, 'Texts to you');
      setText(el.alertsText, ''); show(el.alertsSum, false); show(el.alertsBody, true); show(el.alertsHead, true);
      show(el.alertsOn, false); show(el.alertsRow, false);
      return;
    }
    setText(el.alertsHead, 'Alerts on this phone');
    setText(el.alertsText, L.PUSH_TEXT[st] || '');
    // Switched on: one line ("Alerts on this phone  On"); the text, test button and Turn off open on a tap.
    var on = st === 'on';
    if (!on) P.open = false;
    show(el.alertsSum, on);
    el.alertsSum.setAttribute('aria-expanded', String(on && P.open));
    show(el.alertsBody, !on || P.open);
    show(el.alertsHead, !on);
    show(el.alertsOn, st === 'off');
    show(el.alertsRow, on);
    el.alertsOn.disabled = el.alertsTest.disabled = el.alertsOff.disabled = P.busy;
  }

  function loadPush() {
    P.sub = null;
    if (!HAS_PUSH || !S.api || !S.api.pushConfig) { renderPush(); return; }
    var seq = ++P.seq;
    Promise.resolve().then(function () { return S.api.pushConfig(); })
      .then(function (cfg) { return cfg && typeof cfg === 'object' ? cfg : null; }, function () { return null; })
      .then(function (cfg) {
        if (seq !== P.seq) return;
        P.cfg = cfg;
        if (!cfg || cfg.enabled !== true || !pushSupported()) { renderPush(); return; }
        // Never wait forever on the worker: after 4 s the panel shows as "not subscribed".
        var lookup = P.reg.then(function (reg) { return reg ? reg.pushManager.getSubscription() : null; });
        var giveUp = new Promise(function (res) { setTimeout(function () { res(null); }, 4000); });
        return Promise.race([lookup, giveUp])
          .catch(function () { return null; })
          .then(function (sub) { if (seq === P.seq) { P.sub = sub; renderPush(); } });
      });
  }

  // Sign-out: tell the server, then drop the browser subscription. Resolves whatever happens.
  function dropPushSubscription() {
    if (!HAS_PUSH || !pushSupported()) return Promise.resolve();
    var cur = P.sub ? Promise.resolve(P.sub) : P.reg.then(function (reg) { return reg ? reg.pushManager.getSubscription() : null; });
    return cur.then(function (sub) {
      if (!sub) return null;
      var endpoint = sub.endpoint;
      return Promise.resolve().then(function () { return S.api.pushUnsubscribe(endpoint); }).catch(function () { /* soft */ })
        .then(function () { return sub.unsubscribe(); }).catch(function () { /* soft */ });
    }).catch(function () { /* soft */ });
  }

  function pushBusy(on) { P.busy = on; renderPush(); }

  // Subscribe ONLY from this tap (iOS rule): permission first, with nothing awaited before it.
  function onAlertsOn() {
    if (P.busy || !P.cfg || P.cfg.enabled !== true) return;
    var key = L.b64urlToBytes(P.cfg.vapid_public_key);
    if (!key || !pushSupported()) { pushMsg("Alerts aren't set up right yet. Try again later.", true); return; }
    pushMsg('');
    pushBusy(true);
    var created = null;
    Promise.resolve(Notification.requestPermission()).then(function (perm) {
      if (perm !== 'granted') throw { plain: perm === 'denied' ? '' : 'Alerts stay off until you allow them.' };
      return P.reg;
    }).then(function (reg) {
      if (!reg) throw { plain: "This browser couldn't start alerts. Reload and try again." };
      return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    }).then(function (sub) {
      created = sub;
      var k = L.pushSubKeys(sub);
      if (!k) throw {};
      return S.api.pushSubscribe(k, navigator.userAgent || '');
    }).then(function () {
      P.sub = created;
      pushBusy(false);
      pushMsg('Alerts are on.');
    }).catch(function (e) {
      if (created) { try { created.unsubscribe(); } catch (x) { /* ignore */ } }
      P.sub = null;
      pushBusy(false);
      pushMsg((e && e.plain !== undefined) ? e.plain : "Couldn't turn on alerts. Check your connection and try again.", !(e && e.plain));
    });
  }

  function onAlertsTest() {
    if (P.busy || !S.api.pushTest) return;
    pushMsg('');
    pushBusy(true);
    Promise.resolve().then(function () { return S.api.pushTest(); }).then(function (r) {
      pushBusy(false); pushMsg(L.pushTestMessage(r), !(r && r.ok === true));
    }, function () { pushBusy(false); pushMsg(L.pushTestMessage(null), true); });
  }

  function onAlertsOff() {
    if (P.busy || !P.sub) return;
    var sub = P.sub, endpoint = sub.endpoint;
    pushMsg('');
    pushBusy(true);
    Promise.resolve(sub.unsubscribe()).catch(function () { /* the server call below still runs */ })
      .then(function () { P.sub = null; return S.api.pushUnsubscribe(endpoint); })
      .then(function () { pushBusy(false); pushMsg('Alerts are off on this phone.'); },
        function () { pushBusy(false); pushMsg("Alerts are off on this phone. We couldn't tell the server, so it may still try once.", true); });
  }

  /* ---------- events ---------- */

  function bindEvents() {
    window.addEventListener('hashchange', route);

    // Back: from a lead record to the tab it was opened from; from a tool under More to More.
    el.back.addEventListener('click', function () { location.hash = S.screen === 'thread' ? S.tab.href : navFor('more').href; });

    el.alertsSum.addEventListener('click', function () { P.open = !P.open; renderPush(); });
    el.alertsOn.addEventListener('click', onAlertsOn);
    el.alertsTest.addEventListener('click', onAlertsTest);
    el.alertsOff.addEventListener('click', onAlertsOff);

    el.signout.addEventListener('click', function () {
      // This phone stops getting alerts first (while the session can still authorise the call). Soft-fail, 3 s cap, never blocks sign-out.
      Promise.race([dropPushSubscription(), new Promise(function (res) { setTimeout(res, 3000); })])
        .catch(function () { /* sign out anyway */ })
        .then(function () { return S.api.signOut(); }).catch(function () { /* local sign-out below still runs */ }).then(function () {
        if (S.signedIn) onSignedOut();
      });
    });

    // Status actions
    el.confirmYes.addEventListener('click', confirmYes);
    el.price.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); confirmYes(); } });
    el.price.addEventListener('input', function () { el.price.removeAttribute('aria-invalid'); setText(el.confirmErr, ''); });

    // Add a lead (Leads)
    el.btnAdd.addEventListener('click', openAdd);
    el.addForm.addEventListener('submit', function (e) { e.preventDefault(); submitAdd(); });
    el.addCancel.addEventListener('click', closeAdd);
    el.addDlg.addEventListener('click', function (e) { if (e.target === el.addDlg && !S.addBusy) closeAdd(); });
    el.addDlg.addEventListener('cancel', function (e) { if (S.addBusy) e.preventDefault(); });
    el.addPhone.addEventListener('blur', renderAddDup);
    el.addPhone.addEventListener('input', function () { setAddError('phone', ''); });
    el.addDate.addEventListener('change', function () { renderAddDup(); setAddError('event_date', ''); });
    ['addName', 'addGuests', 'addArea', 'addOccasion', 'addEmail'].forEach(function (k) {
      var f = k === 'addName' ? 'name' : k === 'addGuests' ? 'guests' : k === 'addArea' ? 'area' : k === 'addOccasion' ? 'occasion' : 'email';
      el[k].addEventListener('input', function () { setAddError(f, ''); });
    });
    el.priceLink.addEventListener('click', function () {
      var lead = S.thread.lead;
      S.quotePrefill = lead ? { guests: lead.guests, area: String(lead.event_area || '') } : null;
    });

    // Search (Leads)
    el.search.addEventListener('input', onSearchInput);
    el.search.addEventListener('keydown', function (e) { if (e.key === 'Escape' && el.search.value) { e.preventDefault(); clearSearch(); } });

    // Quote calculator
    el.qForm.addEventListener('submit', function (e) { e.preventDefault(); submitQuote(); });
    Array.prototype.forEach.call(el.qForm.querySelectorAll('input[name="q-type"]'), function (r) { r.addEventListener('change', qTypeChanged); });
    el.qCopy.addEventListener('click', copyQuote);

    // Notes
    el.noteSave.addEventListener('click', saveNote);
    el.noteText.addEventListener('input', function () { noteCount(); setText(el.noteErr, ''); });
    el.sysFold.addEventListener('click', toggleFold);

    // Calendar
    el.calPrev.addEventListener('click', function () { moveMonth(-1); });
    el.calNext.addEventListener('click', function () { moveMonth(1); });
    el.calPossible.addEventListener('change', function () {
      S.showPossible = el.calPossible.checked;
      store('set', POSSIBLE_KEY, S.showPossible ? '1' : '0');
      renderCalendar();
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
    el.convoScroll.addEventListener('scroll', onConvoScroll, { passive: true });

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

    // Follow-up countdowns ("in 1 day 3 h") stay to the minute; text-only updates.
    setInterval(function () {
      if (S.signedIn && document.visibilityState === 'visible') tickCountdowns();
    }, 15000);
    // Once a minute, refetch while the Follow-ups tab is open (a scheduled text may have gone out).
    setInterval(function () {
      if (S.signedIn && document.visibilityState === 'visible' && S.screen === 'followups') refreshFollowUps();
    }, 60000);
  }

  /* ---------- start ---------- */

  function configMissing() {
    return !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || /__SUPABASE/.test(cfg.SUPABASE_URL + cfg.SUPABASE_ANON_KEY);
  }

  function restorePrefs() {
    var f = store('get', FILTER_KEY);
    S.filter = L.isFilterKey(f) ? f : 'open';
    S.showPossible = store('get', POSSIBLE_KEY) === '1';
  }

  function start() {
    // Never render inside a frame (clickjacking). A meta CSP cannot set frame-ancestors.
    if (window.top !== window.self) {
      document.documentElement.hidden = true;
      try { window.top.location = window.self.location; } catch (e) { /* cross-origin top: stay hidden */ }
      return;
    }
    buildTabbar();
    registerWorker();
    buildActions();
    buildReasons();
    buildAddSources();
    show(el.searchWrap, HAS_SEARCH);
    applyAppName();
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
      if (session) { S.signedIn = true; startLive(); loadBrand(); loadPush(); }
      route();
      if (MOCK && !session && qs.get('screen') === 'code') showCodeStep('+14165550123');
    }).catch(function () {
      showSignin();
      setText(el.phoneErr, "Couldn't start the page. Reload and try again.");
    });
  }

  start();
})();
