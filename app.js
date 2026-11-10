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

  /* ---------- diagnostics for Help & support (installed first, so an early error is caught) ----------
     Two small ring buffers (page errors, failed calls): at most 10 each, 30 minutes, kept in sessionStorage so a reload in the
     same tab keeps them. Only the words L.diagFromError / L.diagCall produce: never bodies, arguments, tokens or customer data. */
  var DIAG_KEY = 'cv_diag';
  var diag = { errors: [], calls: [] };
  try {
    var savedDiag = JSON.parse(sessionStorage.getItem(DIAG_KEY) || 'null');
    if (savedDiag && Array.isArray(savedDiag.errors) && Array.isArray(savedDiag.calls)) diag = { errors: savedDiag.errors, calls: savedDiag.calls };
  } catch (e) { /* storage blocked or old value: start empty (memory only) */ }
  function diagSave() { try { sessionStorage.setItem(DIAG_KEY, JSON.stringify(diag)); } catch (e) { /* memory only */ } }
  function diagNoteError(entry) { diag.errors = L.diagPush(diag.errors, entry); diagSave(); }
  function diagNoteCall(name, err) { diag.calls = L.diagPush(diag.calls, L.diagCall(name, err)); diagSave(); }
  function diagClear() { diag = { errors: [], calls: [] }; try { sessionStorage.removeItem(DIAG_KEY); } catch (e) { /* ignore */ } }
  window.addEventListener('error', function (ev) { try { diagNoteError(L.diagFromError(ev)); } catch (e) { /* never throw from the error handler */ } });
  window.addEventListener('unhandledrejection', function (ev) { try { diagNoteError(L.diagFromRejection(ev)); } catch (e) { /* never throw */ } });
  // Every backend call goes through one wrapper that records FAILURES only: the call's name, a status and a short code word.
  var API_NAMES = {
    fetchList: 'lead_list', fetchThread: 'lead_detail', searchLeads: 'lead_detail', optedOutPhones: 'lead_detail', fetchFollowUps: 'follow_ups',
    setStatus: 'cv_set_lead_status', addLead: 'cv_add_lead', addNote: 'cv_add_note', deleteNote: 'cv_delete_note', metrics: 'cv_metrics', forecast: 'cv_forecast', pastEvents: 'cv_past_events',
    quote: 'cv-quote', pushConfig: 'cv_push_config', pushSubscribe: 'cv_push_subscribe', pushUnsubscribe: 'cv_push_unsubscribe', pushTest: 'cv_push_test',
    supportConfig: 'cv_support_config', supportSubmit: 'cv_support_submit', supportList: 'cv_support_list', exportLeads: 'cv_export_leads', ask: 'cv-ask', askConfig: 'cv_ask_config', team: 'cv-team', sendCode: 'auth', verify: 'auth', myRole: 'cv_my_role'
  };
  function trackApi(api) {
    Object.keys(API_NAMES).forEach(function (k) {
      var fn = api[k];
      if (typeof fn !== 'function') return;
      api[k] = function () {
        var p;
        try { p = fn.apply(api, arguments); } catch (e) { diagNoteCall(API_NAMES[k], e); throw e; }
        return Promise.resolve(p).then(function (v) {
          if (API_NAMES[k] === 'auth' && v && v.error) diagNoteCall('auth', v.error);
          return v;
        }, function (e) { diagNoteCall(API_NAMES[k], e); throw e; });
      };
    });
    return api;
  }
  applyTheme(custom.theme);
  var host = location.hostname;
  var isLocal = location.protocol === 'file:' || host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  var qs = new URLSearchParams(location.search);
  var MOCK = isLocal && qs.get('mock') === '1';
  // Mock mode sets a business name so the real brand path (More heading) runs in mock too, and a missing element would throw visibly.
  // Mock only: ?team=on forces the Team feature on (it is off in config.js until Kevin rules), for screenshots and tests.
  if (MOCK && qs.get('team') === 'on') custom.features = Object.assign({}, custom.features, { team: true });
  if (MOCK && qs.get('quote_send') === 'on') custom.features = Object.assign({}, custom.features, { quoteSend: true });
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
     The bottom bar shows Leads / Follow-ups / Calendar / Metrics + More; Ask your CRM, Quote calculator, Help & support and Download spreadsheet live under More; Lead value is a section inside Metrics
     (L.tabPlan decides, from CV_CUSTOM.tabs and the feature switches). */
  var TABS = [
    { route: 'list', href: '#/', label: 'Leads', show: showList, icon: 'M12 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM5 19.5c.6-3.3 3.3-5 7-5s6.4 1.7 7 5' },
    { route: 'followups', href: '#/followups', label: 'Follow-ups', show: showFollowUps, icon: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 7.5V12l3 2' },
    { route: 'calendar', href: '#/calendar', label: 'Calendar', show: showCalendar, icon: 'M4 6h16v14H4zM4 10.5h16M8.5 3.5v5M15.5 3.5v5' },
    { route: 'metrics', href: '#/metrics', label: 'Metrics', show: showMetrics, icon: 'M5 20v-8M12 20V5M19 20v-5M3 20h18' },
    { route: 'ask', href: '#/ask', label: 'Ask your CRM', show: showAsk, icon: 'M4 5.5h16v10.5H10l-4.5 3.5V16H4zM10 9.2a2 2 0 1 1 2.8 1.8c-.5.3-.8.6-.8 1.2M12 13.6v.2' },
    { route: 'quote', href: '#/quote', label: 'Quote calculator', show: showQuote, icon: 'M7 3.5h10v17H7zM9.5 7h5M9.5 11h1M13.5 11h1M9.5 14.5h1M13.5 14.5h1M9.5 18h5' },
    { route: 'support', href: '#/support', label: 'Help & support', show: showSupport, icon: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM9.6 9.6a2.4 2.4 0 1 1 3.5 2.1c-.7.4-1.1.9-1.1 1.7M12 16.6v.2' },
    { route: 'export', href: '#/export', label: 'Download spreadsheet', show: showExport, icon: 'M12 4v11M7 10l5 5 5-5M5 20h14' },
    { route: 'team', href: '#/team', label: 'Team', show: showTeam, icon: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3.5 19c.5-3 2.6-4.5 5.5-4.5s5 1.5 5.5 4.5M16 11a2.5 2.5 0 1 0 0-5M17.5 14.7c1.8.4 2.8 1.7 3 4.3' },
    { route: 'more', href: '#/more', label: 'More', show: showMore, icon: 'M5 12h2M11 12h2M17 12h2' }
  ];

  // Feature switches (CV_CUSTOM.features): an off feature is not shown anywhere. Leads ('list') and More are always on.
  // Who is signed in, from cv_my_role (set once the answer is in). role '' = not asked yet: the owner's page, exactly as before.
  // state: idle | checking | ready | removed | error. Nothing but 'ready' unlocks the page.
  var ACCESS = { role: '', perms: {}, state: 'idle', seq: 0, lastCheck: 0, errorText: '' };
  function isStaff() { return ACCESS.role === 'staff'; }
  function feature(key) { return L.roleFeatureOn(ACCESS.role, ACCESS.perms, custom.features, key); }
  function tabByRoute(r) { return TABS.filter(function (x) { return x.route === r; })[0]; }

  // The client's bar and More list (CV_CUSTOM.tabs order, labels from CV_CUSTOM.tabLabels).
  var PLAN, BAR, MORE_ITEMS, NAV, TAB_ROUTES, HAS_FOLLOWUPS, HAS_SEARCH, HAS_NOTES, HAS_PUSH, HAS_ADD;
  function labelled(route) {
    var t = tabByRoute(route);
    var labels = custom.tabLabels || {};
    var label = typeof labels[route] === 'string' && labels[route].trim() ? labels[route].trim() : t.label;
    return { route: t.route, href: t.href, label: label, show: t.show, icon: t.icon };
  }
  // Worked out again once cv_my_role has answered (a staff member gets fewer tabs and switches).
  function computeNav() {
    PLAN = L.tabPlan(custom.tabs, feature);
    BAR = PLAN.bar.concat(['more']).map(labelled);
    MORE_ITEMS = PLAN.more.map(labelled);
    // Every screen the router can open (bar tabs, More and the tools under it).
    NAV = BAR.concat(MORE_ITEMS);
    TAB_ROUTES = NAV.map(function (n) { return n.route; });
    HAS_FOLLOWUPS = TAB_ROUTES.indexOf('followups') !== -1;
    HAS_SEARCH = feature('search');
    HAS_NOTES = feature('notes');
    HAS_PUSH = feature('push');
    HAS_ADD = feature('addLead');
  }
  computeNav();

  function $(id) { return document.getElementById(id); }
  var el = {
    app: $('app'), main: $('main'), tabbar: $('tabbar'), tabbarList: $('tabbar-list'), signout: $('btn-signout'),
    more: $('screen-more'), moreList: $('more-list'), moreBrand: $('more-brand'),
    needs: $('needs'), needsTitle: $('needs-title'), needsCount: $('needs-count'), needsList: $('needs-list'), filterNote: $('filter-note'),
    alerts: $('alerts'), alertsText: $('alerts-text'), alertsOn: $('alerts-on'), alertsRow: $('alerts-row'),
    alertsHead: $('alerts-h'), alertsInfo: $('alerts-info'), alertsSum: $('alerts-sum'), alertsBody: $('alerts-body'), alertsTest: $('alerts-test'), alertsOff: $('alerts-off'), alertsMsg: $('alerts-msg'),
    topbar: $('topbar'), back: $('btn-back'), title: $('title'), subtitle: $('subtitle'),
    live: $('live'), liveText: $('live-text'),
    roleScreen: $('screen-role'), roleTitle: $('role-title'), roleText: $('role-text'), roleRetry: $('role-retry'), roleSignout: $('role-signout'),
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
    qAddBox: $('q-add-box'), qAdd: $('q-add'), qAddNote: $('q-add-note'), qAddErr: $('q-add-err'),
    recMyQuote: $('rec-myquote'), mqStatus: $('mq-status'), mqBody: $('mq-body'), mqNote: $('mq-note'), mqSend: $('mq-send'), mqResend: $('mq-resend'), mqErr: $('mq-error'),
    quote: $('screen-quote'), qForm: $('q-form'), qStale: $('q-stale'), qGuests: $('q-guests'), qHours: $('q-hours'), qBarBox: $('q-bar-box'), qBarNote: $('q-bar-note'),
    qCity: $('q-city'), qKmBox: $('q-km-box'), qKm: $('q-km'), qDate: $('q-date'), qOccasion: $('q-occasion'), qPromo: $('q-promo'), qOccasionPick: $('q-occasion-pick'), qPromoPick: $('q-promo-pick'), qPromoGives: $('q-promo-gives'), qMore: $('q-more'),
    qErr: $('q-error'), qSubmit: $('q-submit'), qResult: $('q-result'), qResultH: $('q-result-h'), qResultBody: $('q-result-body'),
    qCopy: $('q-copy'), qNew: $('q-new'), qCopied: $('q-copied'), searchWrap: $('search-wrap'),
    askScreen: $('screen-ask'), askScroll: $('ask-scroll'), askThread: $('ask-thread'), askStarters: $('ask-starters'), askForm: $('ask-form'), askInput: $('ask-input'),
    askSend: $('ask-send'), askCount: $('ask-count'),
    exportScreen: $('screen-export'), exGroup: $('ex-group'), exDates: $('ex-dates'), exFrom: $('ex-from'), exTo: $('ex-to'), exMake: $('ex-make'),
    exStatus: $('ex-status'), exSave: $('ex-save'), exHint: $('ex-hint'), exError: $('ex-error'),
    teamScreen: $('screen-team'), tmOff: $('tm-off'), tmForm: $('tm-form'), tmName: $('tm-name'), tmPhone: $('tm-phone'), tmErrName: $('tm-err-name'), tmErrPhone: $('tm-err-phone'),
    tmFull: $('tm-full'), tmError: $('tm-error'), tmAdd: $('tm-add'), tmDone: $('tm-done'), tmLink: $('tm-link'), tmCopy: $('tm-copy'), tmCopyMsg: $('tm-copy-msg'),
    tmListLoading: $('tm-list-loading'), tmList: $('tm-list'), tmListEmpty: $('tm-list-empty'), tmListError: $('tm-list-error'), tmReload: $('tm-reload'), tmRowMsg: $('tm-row-msg'),
    teamConfirm: $('team-confirm'), teamConfirmText: $('team-confirm-text'), teamConfirmYes: $('team-confirm-yes'), teamConfirmNo: $('team-confirm-no'),
    support: $('screen-support'), spOff: $('sp-off'), spContact: $('sp-contact'), spCall: $('sp-call'), spCallLabel: $('sp-call-label'),
    spText: $('sp-text'), spTextLabel: $('sp-text-label'), spForm: $('sp-form'), spKinds: $('sp-kinds'), spMessage: $('sp-message'),
    spCount: $('sp-count'), spLead: $('sp-lead'), spLeadText: $('sp-lead-text'), spLeadRemove: $('sp-lead-remove'), spInclude: $('sp-include'),
    spIncludeRow: $('sp-include-row'), spUrgentRow: $('sp-urgent-row'), spUrgent: $('sp-urgent'), spDisclose: $('sp-disclose'), spNoSend: $('sp-nosend'), spSendLabel: $('sp-send-label'), spLede: $('sp-lede'), spFormH: $('sp-form-h'),
    spError: $('sp-error'), spSend: $('sp-send'), spDone: $('sp-done'), spListLoading: $('sp-list-loading'), spList: $('sp-list'),
    spListEmpty: $('sp-list-empty'), spListError: $('sp-list-error'),
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
    eventMoreBtn: $('event-more-btn'), recEmail: $('rec-email'), recPhoneRow: $('rec-phone-row'),
    recQuote: $('rec-quote'), quoteBody: $('quote-body'), recOthers: $('rec-others'), othersList: $('others-list'), recShared: $('rec-shared'), sharedList: $('shared-list'),
    convo: $('convo'), convoScroll: $('convo-scroll'),
    convoOpen: $('convo-open'), convoFull: $('convo-full'), convoFullClose: $('convo-full-close'), convoFullScroll: $('convo-full-scroll'), fullThread: $('full-thread'), fullEmpty: $('full-empty'), fullSysFold: $('full-sys-fold'),
    actions: $('actions'), actionsNote: $('actions-note'), actionErr: $('action-error'), history: $('history'), historyMore: $('history-more'),
    threadScroll: $('thread-scroll'), threadLoading: $('thread-loading'), threadBox: $('thread'), threadEmpty: $('thread-empty'),
    threadErr: $('thread-error'), pill: $('new-pill'),
    confirm: $('confirm'), confirmText: $('confirm-text'), confirmYes: $('confirm-yes'), confirmAlt: $('confirm-alt'), confirmNote: $('confirm-note'), confirmNo: $('confirm-no')
  };

  // From this width the record shows the conversation and the details side by side, each scrolling on its own.
  var split = window.matchMedia('(min-width: 1200px)');

  function emptyThread(id) {
    return { id: id || null, lead: null, rows: [], history: null, loaded: false, sig: '', count: 0, sysOpen: false };
  }

  var S = {
    api: null,
    base: null,          // the owner API map; the staff map is picked from it once cv_my_role says staff
    signedIn: false,
    leads: [],
    listLoaded: false,
    listError: '',
    thread: emptyThread(),
    live: 'off',
    liveTimer: null,
    stopLive: null,
    seq: { list: 0, thread: 0, metrics: 0, forecast: 0, followups: 0, pastEvents: 0 },
    metrics: null,
    forecast: null, // cv_forecast() JSON; null = not loaded or failed (the block stays hidden)
    metricsError: '',
    followUps: null,     // follow_ups rows once loaded
    followUpsError: '',
    pastEvents: null,    // cv_past_events() JSON; null = not loaded or failed (the section stays hidden)
    pastBusy: '',        // lead id being saved from the Did-these-happen list
    pastErr: '',
    pastLatest: null,    // newest in-flight cv_past_events fetch (older ones wait for it)
    pastScroll: false,   // 'Review them' link: scroll to the section once it is drawn
    search: { q: '', rows: null, error: '', seq: 0, timer: null },  // memory only: never URL / storage
    cal: null,           // { y, m, sel } month on screen and picked day
    showPossible: false,
    noteBusy: false,
    quote: { busy: false, seq: 0, view: null, req: null, raw: null, pending: null, fromLead: null, backTo: null, pre: null, added: false, adding: false, refused: false },
    quoteSendBusy: false,
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
    pendingToken: null,  // which saveStatus call owns it
    confirming: null,    // status waiting in the confirm sheet
    historyOpen: false,
    addBusy: false,
    toastTimer: null,
    quotePrefill: null,  // L.quotePrefill(lead) + fromLead + backTo: a lead's price link -> the quote calculator, used once
    nav: { cur: '', from: '', lead: null },  // screen before More / Help, and the lead record Help was reached from (same session)
    team: { view: null, listErr: '', listSeq: 0, addBusy: false, busy: {}, confirmPhone: '', confirmName: '', loading: false },  // Team: memory only
    support: { cfg: null, cfgState: 'idle', key: null, busy: false, removeLead: false, rows: null, listErr: false, listSeq: 0, cfgSeq: 0 },
    ask: { cfg: null, cfgState: 'idle', cfgSeq: 0, cfgPromise: null, items: [], questions: [], busy: false, seq: 0, waitTimer: null },  // Ask your CRM: memory only, never stored
    exp: { busy: false, seq: 0, prepared: null },  // spreadsheet download: the file made by tap 1, kept in memory for tap 2
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
  var DETAIL_SOURCE = ',source,manual_source,auto_texts,quote_received,followup_possible,no_followup,owner_quote';
  // 024: the other people on this lead's number; dropped again (first fallback) if the view does not have it yet.
  var DETAIL_SHARED = ',phone_shared';
  var SEARCH_BASE = 'lead_id,full_name,phone,email,status,event_date,quote_total,last_activity_at,status_at,guests';
  var SEARCH_COLUMNS = SEARCH_BASE + ',source,manual_source'; // sql/011 columns on lead_detail; the search falls back without them
  var FOLLOWUP_COLUMNS = 'lead_id,display_name,status,event_date,quote_total,follow_up_type,due_at,sent_at,reason';

  function makeRealApi() {
    var client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      realtime: { params: { eventsPerSecond: 5 } }
    });

    // The HTTP status rides along on the error so a failed call can be recorded for Help & support (status + code word only).
    function quoteSendCall(body) {
      return client.functions.invoke('cv-quote-send', { body: body }).then(function (r) {
        if (!r.error) return r.data;
        var ctx = r.error.context;
        if (ctx && typeof ctx.json === 'function') {
          return ctx.json().catch(function () { return {}; }).then(function (b) {
            throw { status: ctx.status, error: (b && b.error) || '', details: b && b.details };
          });
        }
        throw { status: 0, error: 'network', details: '' };
      });
    }

    function ok(r) {
      if (r.error) { if (r.status && typeof r.error === 'object' && r.error.status === undefined) { try { r.error.status = r.status; } catch (e) { /* frozen: no status */ } } throw r.error; }
      return r.data;
    }

    var api = {
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
      // sql/017: who is this? -> { role: 'owner' | 'staff' | 'none', perms: { name: boolean } }. Asked once, right after sign-in.
      myRole: function () { return client.rpc('cv_my_role').then(ok); },
      // No owner-readable business name in the data contract yet: the nav shows "Leads".
      businessName: function () { return Promise.resolve(null); },
      fetchList: function () {
        return client.from('lead_list').select('*')
          .order('last_activity_at', { ascending: false, nullsFirst: false }).limit(1000).then(ok);
      },
      fetchThread: function (id) {
        return Promise.all([
          // lead_detail (explicit columns); falls back to lead_list if the view is not there yet.
          client.from('lead_detail').select(DETAIL_COLUMNS + DETAIL_EXTRA + DETAIL_SOURCE + DETAIL_SHARED).eq('lead_id', id).maybeSingle().then(function (rs) {
            if (!rs.error) return rs.data;
            return client.from('lead_detail').select(DETAIL_COLUMNS + DETAIL_EXTRA + DETAIL_SOURCE).eq('lead_id', id).maybeSingle().then(function (r0) {
              if (!r0.error) return r0.data;
              return client.from('lead_detail').select(DETAIL_COLUMNS + DETAIL_EXTRA).eq('lead_id', id).maybeSingle().then(function (r) {
                if (!r.error) return r.data;
                return client.from('lead_detail').select(DETAIL_COLUMNS).eq('lead_id', id).maybeSingle().then(function (r2) {
                  if (!r2.error) return r2.data;
                  return client.from('lead_list').select('*').eq('lead_id', id).maybeSingle().then(ok);
                });
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
      // Ask your CRM (Edge Function cv-ask, read only). Errors are thrown as { status, error, details } like quote above.
      ask: function (body) {
        return client.functions.invoke('cv-ask', { body: body }).then(function (r) {
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
      // sql/023: the owner's saved price. Sending goes through the Edge Function; errors are thrown as { status, error, details } like quote above.
      addLeadQuote: function (id, quote) { return client.rpc('cv_add_lead_quote', { p_lead_id: id, p_quote: quote }).then(ok); },
      quotePreview: function (id, resend) { return quoteSendCall({ action: 'preview', lead_id: id, resend: !!resend }); },
      quoteSend: function (a) {
        var body = { action: 'send', lead_id: a.lead_id, hash: a.hash, resend: !!a.resend };
        body.expected_total = a.expected_total;   // the owner_quote.total the owner was looking at; the server refuses a mismatch
        if (a.resend) body.expected_count = a.expected_count;
        return quoteSendCall(body);
      },
      askConfig: function () { return client.rpc('cv_ask_config').then(ok); },
      // Team (Edge Function cv-team, owner only): list / add / remove / retry_cleanup. Errors are thrown as { status, error, details }.
      team: function (body) {
        return client.functions.invoke('cv-team', { body: body }).then(function (r) {
          if (!r.error) return r.data;
          var ctx = r.error.context;
          if (ctx && typeof ctx.json === 'function') {
            return ctx.json().catch(function () { return {}; }).then(function (b) {
              // A gateway 401 is { code, message }, not our { error }: a 401 always means signed out.
              throw { status: ctx.status, error: ctx.status === 401 ? 'not_signed_in' : (b && b.error) || '', details: b && b.details };
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
      forecast: function () { return client.rpc('cv_forecast').then(ok); },
      pastEvents: function () { return client.rpc('cv_past_events', { p_limit: 50 }).then(ok); },
      // Push alerts (owner-only RPCs). Every call is soft-failed by the caller.
      pushConfig: function () { return client.rpc('cv_push_config').then(ok); },
      pushSubscribe: function (k, ua) {
        return client.rpc('cv_push_subscribe', { p_endpoint: k.endpoint, p_p256dh: k.p256dh, p_auth: k.auth, p_user_agent: ua }).then(ok);
      },
      pushUnsubscribe: function (endpoint) { return client.rpc('cv_push_unsubscribe', { p_endpoint: endpoint }).then(ok); },
      pushTest: function () { return client.rpc('cv_push_test').then(ok); },
      // Help & support (owner-only RPCs, sql/012): config, send, the owner's own requests.
      supportConfig: function () { return client.rpc('cv_support_config').then(ok); },
      supportSubmit: function (args) { return client.rpc('cv_support_submit', args).then(ok); },
      supportList: function () { return client.rpc('cv_support_list').then(ok); },
      // Spreadsheet download (owner-only RPC, sql/013): rows only; labels and CSV are built in lib.js.
      exportLeads: function (args) { return client.rpc('cv_export_leads', args).then(ok); },
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

    // The staff API map (sql/017, sql/018), beside the owner one above. Staff read ONLY through the cv_staff_* functions: they have no
    // access to the tables or views, no price, no metrics, no Realtime. Each function returns the same shapes the page already draws
    // (money and owner-only columns are simply not there). Text the server hid is shown exactly as sent.
    api.staffMap = function () {
      return {
        getSession: api.getSession, onAuth: api.onAuth, sendCode: api.sendCode, verify: api.verify, signOut: api.signOut, myRole: api.myRole,
        businessName: api.businessName,
        fetchList: function () { return client.rpc('cv_staff_leads').then(ok); },
        // { lead, thread, history } -> the page's { lead, rows, history }. The server returns null for an unknown lead.
        fetchThread: function (id) {
          return client.rpc('cv_staff_lead', { p_lead_id: id }).then(ok).then(function (r) {
            return { lead: (r && r.lead) || null, rows: (r && r.thread) || [], history: (r && r.history) || null };
          });
        },
        searchLeads: function (q) {
          if (!L.searchFilter(q)) return Promise.resolve([]);
          return client.rpc('cv_staff_search', { p_q: String(q || '').trim() }).then(ok);
        },
        fetchFollowUps: function () { return client.rpc('cv_staff_follow_ups').then(ok); },
        // Same three functions as the owner (sql/018 changed their gate). setStatus sends no amount: staff have no price field.
        setStatus: function (id, status, extra) {
          var args = { p_lead_id: id, p_status: status };
          Object.keys(extra || {}).forEach(function (k) { if (k !== 'p_amount' && extra[k] !== null && extra[k] !== undefined) args[k] = extra[k]; });
          return client.rpc('cv_set_lead_status', args).then(ok);
        },
        addNote: api.addNote,
        deleteNote: api.deleteNote
      };
    };
    return api;
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
      if (n.route === 'support') { li.hidden = true; supportRowNode = li; }  // shown once the database says support is on
      if (n.route === 'ask') { li.hidden = true; askRowNode = li; }  // shown once the database says Ask is on
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
    // Actually leaving the calculator: it opens blank next time. The one exception (sql/023): an unsaved quote made from a lead asks first.
    var signingOut = name === 'signin' || name === 'role';
    var askAdd = S.screen === 'quote' && name !== 'quote' && !signingOut && quoteLeaveAsks();
    if (S.screen === 'quote' && name !== 'quote' && !askAdd) clearQuote();
    var asking = !!S.confirming && S.confirming.kind === 'quote-leave';
    S.screen = name;
    var signedIn = name !== 'signin' && name !== 'role';
    el.app.classList.toggle('signed-in', signedIn);
    show(el.signin, name === 'signin');
    show(el.roleScreen, name === 'role');
    show(el.list, name === 'list');
    show(el.metrics, name === 'metrics');
    show(el.followups, name === 'followups');
    if (name !== 'followups') { S.pastScroll = false; S.pastErr = ''; }
    show(el.calendar, name === 'calendar');
    show(el.quote, name === 'quote');
    show(el.more, name === 'more');
    show(el.support, name === 'support');
    show(el.teamScreen, name === 'team');
    show(el.askScreen, name === 'ask');
    show(el.exportScreen, name === 'export');
    show(el.thread, name === 'thread');
    show(el.topbar, signedIn);
    show(el.tabbar, signedIn && PLAN.showBar);
    // Back arrow on a lead record and on the tools under More; every other screen is a tab with a plain title.
    var sub = name === 'thread' || name === 'quote' || name === 'support' || name === 'export' || name === 'ask' || name === 'team';
    show(el.back, sub);
    if (name === 'quote' || name === 'support' || name === 'export' || name === 'ask' || name === 'team') el.back.setAttribute('aria-label', 'Back to ' + navFor('more').label.toLowerCase());
    if (name !== 'thread') {
      el.title.textContent = S.tab.label;
      setText(el.subtitle, '');
    }
    // The leave question is still unanswered when Back / Forward / a notification moves the page: it stays up, only the screen behind it changes.
    // Back to the calculator answers it (the quote is still there); signing out drops it.
    if (asking && name === 'quote') closeConfirm();
    else if (asking && signingOut) { closeConfirm(); clearQuote(); }
    else if (!asking && el.confirm.open) el.confirm.close();
    if (askAdd) askAddBeforeLeaving();
    if (el.teamConfirm.open) closeTeamConfirm();
    if (el.addDlg.open) closeAdd();
    if (name !== 'thread') closeFullSilently();
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
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { diagNoteCall('live', { status: 0, code: String(status).toLowerCase() }); setLive('retry'); }
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
      if (!S.signedIn || ACCESS.state !== 'ready') return;
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

  // A staff member whose switch was turned off (or who was removed) while the page was open: ask cv_my_role again, at most once a minute.
  function maybeRecheckAccess(e) {
    if (!isStaff() || ACCESS.state !== 'ready' || Date.now() - ACCESS.lastCheck < 60000) return;
    var msg = String((e && e.message) || '').toLowerCase();
    if ((e && e.code === '42501') || /not_allowed|not_owner/.test(msg)) checkAccess();
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

  // A staff member whose "see leads" switch is off: nothing to fetch (the server would refuse), one plain line instead.
  function leadsBlocked() { return isStaff() && ACCESS.perms.leads_read !== true; }

  function refreshList() {
    var n = ++S.seq.list;
    if (leadsBlocked()) {
      S.leads = []; S.listLoaded = false; S.listError = L.STAFF_NO_LEADS;
      el.leadList.replaceChildren(); renderNeeds([]);
      renderBadge(); renderLeadScreens();
      if (Date.now() - ACCESS.lastCheck >= 60000 && ACCESS.state === 'ready') checkAccess();   // the switch may have been turned back on
      return Promise.resolve();
    }
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
      maybeRecheckAccess(e);
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
      maybeRecheckAccess(e);
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
    if (L.isManual(lead)) a.appendChild(make('span', 'row-tag', isStaff() ? 'Added by hand' : 'Added by you'));
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
    var d = L.dupInfo(S.listLoaded ? S.leads : [], el.addPhone.value, el.addDate.value, S.optedPhones, el.addName.value);
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
    setText(el.addDupSame, L.dupOtherText(d));
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
    loadAskConfig(); // once per sign-in: decides whether the Ask row shows
    refreshFollowUps(); // the held-alert and 9 am text lines in Alerts come from the follow-ups view
  }

  /* ---------- quote calculator ---------- */

  var Q_FIELDS = ['guests', 'service_hours', 'bar_rental', 'event_city', 'distance_km', 'event_date', 'occasion', 'promo_code'];
  var Q_INPUT = { guests: 'qGuests', service_hours: 'qHours', event_city: 'qCity', distance_km: 'qKm', event_date: 'qDate', occasion: 'qOccasion', promo_code: 'qPromo' };

  // Occasion and Promo code are native pick-lists when the client's settings list them (CV_CUSTOM.quoteOccasions / quotePromos),
  // else the plain text boxes. el.qOccasion / el.qPromo always point at whichever control is in use; both give the value the endpoint expects.
  var QP = { occasions: null, promos: null, occasionLabel: null };
  function qOccasionTemp() { return el.qOccasionPick.querySelector('option[data-temp]'); }
  function qOption(value, text) { var o = make('option', '', text); o.value = value; return o; }

  function buildQuotePickers() {
    var occ = L.quoteOccasions(custom);
    QP.occasions = occ;
    var oldOcc = el.qOccasion.value;
    if (occ) {
      var frag = document.createDocumentFragment();
      frag.appendChild(qOption('', 'Pick an occasion'));
      occ.forEach(function (o) { frag.appendChild(qOption(o, o)); });
      el.qOccasionPick.replaceChildren(frag);
      el.qOccasionPick.disabled = false; el.qOccasionPick.hidden = false;
      $('q-occasion').disabled = true; $('q-occasion').hidden = true;
      el.qOccasion = el.qOccasionPick;
      qSetOccasion(oldOcc);
    } else {
      el.qOccasionPick.hidden = true; el.qOccasionPick.disabled = true;
      el.qOccasion = $('q-occasion'); el.qOccasion.hidden = false; el.qOccasion.disabled = false;
    }
    qLabelFor('q-occasion', el.qOccasion.id);

    var promos = L.quotePromos(custom);
    QP.promos = promos;
    var oldPromo = el.qPromo.value;
    if (promos) {
      var pf = document.createDocumentFragment();
      pf.appendChild(qOption('', 'No promo'));
      promos.forEach(function (p) { pf.appendChild(qOption(p.code, p.label)); });
      el.qPromoPick.replaceChildren(pf);
      el.qPromoPick.disabled = false; el.qPromoPick.hidden = false;
      $('q-promo').disabled = true; $('q-promo').hidden = true;
      el.qPromo = el.qPromoPick;
      if (oldPromo && promos.some(function (p) { return p.code === oldPromo; })) el.qPromo.value = oldPromo;
    } else {
      el.qPromoPick.hidden = true; el.qPromoPick.disabled = true;
      el.qPromo = $('q-promo'); el.qPromo.hidden = false; el.qPromo.disabled = false;
    }
    qLabelFor('q-promo', el.qPromo.id);
    qPromoHint();
  }
  function qLabelFor(origId, controlId) {
    var lab = el.qForm.querySelector('label[for="' + origId + '"], label[for="' + origId + '-pick"]');
    if (lab) lab.setAttribute('for', controlId);
  }

  // Show a value in the occasion list. A value that is not one of the choices (an old lead, typed text) is added as its own
  // choice and selected, so it is neither lost nor changed. A match ignoring case picks the listed spelling.
  function qSetOccasion(v) {
    v = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    var t = qOccasionTemp(); if (t) t.remove();
    if (!QP.occasions) { el.qOccasion.value = v; return; }
    if (!v) { el.qOccasionPick.value = ''; return; }
    var hit = QP.occasions.filter(function (o) { return o.toLowerCase() === v.toLowerCase(); })[0];
    if (hit) { el.qOccasionPick.value = hit; return; }
    var o = qOption(v, v + ' (from the lead)'); o.setAttribute('data-temp', '1');
    el.qOccasionPick.appendChild(o);
    el.qOccasionPick.value = v;
  }

  function qPromoHint() {
    var txt = '';
    if (QP.promos && el.qPromo.value) txt = L.promoGives(QP.promos.filter(function (p) { return p.code === el.qPromo.value; })[0]);
    setText(el.qPromoGives, txt);
    show(el.qPromoGives, !!txt);
  }

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

  // The ONE place that empties the calculator: every field, the result, the "Copied" line and the errors.
  // Called when the owner leaves the screen, on "Start a new quote" and on sign-out. Not called on backgrounding or re-render.
  // An unsaved quote made from a lead asks first (setScreen, newQuote). Bumping S.quote.seq makes a late answer to a request sent before this point be ignored.
  function clearQuote() {
    S.quote = { busy: false, seq: S.quote.seq + 1, view: null, req: null, raw: null, pending: null, fromLead: null, backTo: null, pre: null, added: false, adding: false, refused: false };
    el.qForm.reset(); qSetOccasion(''); qPromoHint();
    qBusy(false); qFieldErrors({}); setText(el.qErr, ''); setText(el.qStale, ''); show(el.qKmBox, false);
    el.qMore.open = false;
    el.qCopied.textContent = '';
    setText(el.qAddErr, '');
    renderQuoteResult();
  }

  // A price on screen always belongs to the answers on screen.
  function qSameAnswers(body) {
    var r = L.quoteRequest(qForm());
    return !!body && r.ok && JSON.stringify(r.body) === JSON.stringify(body);
  }

  // Take the price away until it is worked out again for the new answers.
  function qDropPrice() {
    var q = S.quote;
    q.view = null; q.req = null; q.raw = null; q.added = false;
    setText(el.qStale, 'Your answers changed. Tap Get quote for the new price.');
    renderQuoteResult();
  }

  // Any change in the form. While a price is being saved the form is locked; the Add tap already matched what was on screen.
  function qFormEdited(e) {
    var q = S.quote;
    qClearFieldError(e && e.target);
    setText(el.qErr, '');
    if (q.adding) return;
    if (q.busy) {
      if (qSameAnswers(q.pending)) return;
      q.seq++;             // the answer on its way is for the old values
      q.pending = null;
      qBusy(false);
      setText(el.qStale, 'Your answers changed. Tap Get quote for the new price.');
      return;
    }
    if (q.view && !qSameAnswers(q.req)) qDropPrice();
  }

  // The red line under a field goes when that field is changed. A promo can be fixed by changing the event date too.
  function qClearFieldError(target) {
    if (!target) return;
    Q_FIELDS.forEach(function (f) {
      var input = Q_INPUT[f] ? el[Q_INPUT[f]] : null;
      var hit = input ? input === target : target.name === 'q-bar';
      if (!hit && !(f === 'promo_code' && target === el.qDate)) return;
      var p = $('q-err-' + f);
      if (p) setText(p, '');
      var box = input || target;
      if (box.removeAttribute) box.removeAttribute('aria-invalid');
    });
  }

  // "Start a new quote". Not tied to a lead: empties at once. Tied to one: one sheet with all the choices (and it says when a price would be lost).
  function newQuote() {
    var q = S.quote;
    if (q.adding) return;
    if (q.fromLead) { askNewQuote(); return; }
    var back = q.backTo;   // a lead that cannot take a price: Back still goes to it
    clearQuote();
    S.quote.backTo = back;
    qStartTyping();
  }

  function askNewQuote() {
    var q = S.quote, f = q.fromLead;
    var unsaved = quoteLeaveAsks();
    openSheet({ kind: 'quote-new' }, unsaved ? 'This ' + q.view.total + ' price is not on ' + f.name + ' yet. Start a new quote anyway?' : 'Start a new quote?', 'Start again for ' + f.name, 'sheet-plain', el.confirmNo);
    el.confirmAlt.textContent = 'New quote, not for ' + f.name;
    el.confirmAlt.hidden = false;
    el.confirmNo.textContent = 'Keep this quote';
  }

  // again = fill it in from the lead once more and keep the link; otherwise blank, with no link to the lead.
  function startQuoteOver(again) {
    var q = S.quote, f = q.fromLead, back = q.backTo, pre = q.pre;
    clearQuote();
    if (again) {
      S.quote.fromLead = f; S.quote.backTo = back; S.quote.pre = pre;
      if (pre) qFill(pre);
      qRenderLock();
    }
    qBackBar();
    qStartTyping();
  }

  function qStartTyping() {
    try { el.qGuests.focus(); el.qForm.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { /* ignore */ }
  }

  function renderQuoteResult() {
    var v = S.quote.view;
    if (!v) { show(el.qResult, false); renderQuoteAdd(); return; }
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
      [['Subtotal', v.subtotal, ''], ['Travel fee', v.travel, ''], ['Total', v.totalRow, 'is-total']].forEach(function (x) {
        if (!x[1]) return;
        sums.appendChild(make('dt', x[2], x[0])); sums.appendChild(make('dd', x[2], x[1]));
      });
      frag.appendChild(sums);
      if (v.deposit) frag.appendChild(make('p', 'rec-note', 'Deposit to hold the date: ' + v.deposit));
      v.flags.forEach(function (f) { frag.appendChild(make('p', 'rec-note', f)); });
    }
    if (v.promoNote) frag.appendChild(make('p', 'rec-note q-promo-note', v.promoNote));
    var city = S.quote.req && S.quote.req.event_city;
    if (v.distance) frag.appendChild(make('p', 'rec-note q-distance', (city ? city + ' is ' : '') + v.distance + '.'));
    el.qResultBody.replaceChildren(frag);
    show(el.qCopy, !v.defer);
    el.qCopied.textContent = '';
    renderQuoteAdd();
    show(el.qResult, true);
  }

  // sql/023: "Add this quote to Sam". Only from a lead's "Price it in the quote calculator", only after a firm quote.
  function renderQuoteAdd() {
    var q = S.quote, f = q.fromLead, v = q.view;
    var offer = !!f && !!v && !v.defer && !q.added;
    show(el.qAddBox, offer);
    qRenderLock();
    if (!offer) return;
    show(el.qAdd, !q.refused);       // the server said no: only the reason stays
    el.qAdd.textContent = q.adding ? 'Adding\u2026' : 'Add this quote to ' + f.name;
    setText(el.qAddNote, q.refused ? '' : L.quoteAddNote(f.savedTotal, f.maybeSent));
  }

  // While a price is being saved nothing on the calculator can change under it.
  function qRenderLock() {
    var on = !!S.quote.adding;
    el.qAdd.disabled = on;
    el.qAdd.classList.toggle('is-busy', on);
    el.qCopy.disabled = on;
    el.qNew.disabled = on;
    el.qForm.inert = on;
  }

  var QUOTE_ADD_WAIT_MS = 18000;   // an Add with no answer by then frees the sheet and the form (crm-fix-final P1)
  function leaveSheetOpen() { return !!S.confirming && S.confirming.kind === 'quote-leave'; }

  // Saves the quote on screen. The reply belongs to THIS quote: if the owner has started another one or left, it never touches the calculator or moves the page.
  function addQuoteToLead() {
    var q = S.quote, f = q.fromLead;
    if (!f || !q.view || q.view.defer || q.adding || q.refused || q.added || q.busy) return;
    if (!qSameAnswers(q.req)) {     // the page missed a change (a promo that ended, form restore): never save a price that does not match
      // From the leave sheet: Stay, so the owner sees "Your answers changed" and prices it again (never a silent close).
      if (leaveSheetOpen()) { closeConfirm(); stayOnQuote(); }
      qDropPrice();
      return;
    }
    var total = q.view.total;
    var run = q.addRun = {};   // a late answer from an earlier try never touches a newer one
    var timedOut = false;
    q.adding = true;
    setText(el.qAddErr, '');
    if (leaveSheetOpen()) { setText(el.confirmErr, ''); sheetBusy(true, 'Adding\u2026'); }
    renderQuoteAdd();
    // No answer: free the buttons and the form, never claim either way (saving again only replaces the same price).
    var timer = setTimeout(function () {
      if (q !== S.quote || run !== q.addRun || !q.adding) return;
      timedOut = true;
      q.adding = false;
      var msg = "Couldn't confirm it saved. Check the lead before trying again.";
      setText(el.qAddErr, msg);
      if (leaveSheetOpen()) { sheetBusy(false); el.confirmYes.textContent = 'Add'; setText(el.confirmErr, msg); }
      renderQuoteAdd();
    }, QUOTE_ADD_WAIT_MS);
    Promise.resolve().then(function () { return S.api.addLeadQuote(f.id, L.quoteAddArgs(q.raw, q.req)); }).then(function () {
      clearTimeout(timer);
      if (!S.signedIn) return;
      var said = L.quoteSavedLine(f.name, total, f.savedTotal);
      quoteSavedRefresh();
      if (q !== S.quote || run !== q.addRun) { showToast(said); return; }   // left, started over or tried again while it saved: say so, change nothing
      q.added = true;
      q.adding = false;
      setText(el.qAddErr, '');
      renderQuoteAdd();
      showToast(said);
      if (timedOut) { if (leaveSheetOpen()) { closeConfirm(); clearQuote(); } return; }   // a late yes: the owner has moved on, the page does not jump
      if (S.screen === 'quote') { location.hash = '#/lead/' + encodeURIComponent(f.id); return; }   // the lead, with the price on it
      closeConfirm();   // answered from the leave sheet: the owner stays where they were going
      clearQuote();
    }).catch(function (e) {
      clearTimeout(timer);
      if (!S.signedIn) return;
      var msg = L.quoteAddError(e);
      maybeRecheckAccess(e);
      if (q !== S.quote || run !== q.addRun) { showToast(f.name + ': ' + msg); return; }
      q.adding = false;
      q.refused = L.quoteAddRefused(e);
      setText(el.qAddErr, msg);
      if (leaveSheetOpen()) {
        sheetBusy(false);
        if (q.refused) { closeConfirm(); clearQuote(); showToast(f.name + ': ' + msg); return; }   // nothing left to decide
        el.confirmYes.textContent = 'Add';
        setText(el.confirmErr, msg);   // the sheet stays open: the owner can try again
      }
      renderQuoteAdd();
    });
  }

  // The list, follow-ups and an open lead now hold the saved price. (Going to the lead fetches it anyway.)
  function quoteSavedRefresh() {
    Promise.all([refreshList(), refreshFollowUps(), S.screen === 'thread' && S.thread.id ? refreshThread() : null]).catch(function () { /* the next refresh catches up */ });
  }

  // True only for a firm quote from a lead's price link that has not been added and is not being added, and that the server has not refused.
  function quoteLeaveAsks() {
    var q = S.quote;
    return !!q.fromLead && !!q.view && !q.view.defer && !q.added && !q.adding && !q.refused;
  }

  function askAddBeforeLeaving() {
    var q = S.quote, f = q.fromLead;
    openSheet({ kind: 'quote-leave' }, 'Add this ' + q.view.total + ' quote to ' + f.name + ' before leaving?', 'Add', 'sheet-plain', el.confirmYes);
    el.confirmAlt.textContent = 'Leave without adding';
    el.confirmAlt.hidden = false;
    el.confirmNo.textContent = 'Stay';
    setText(el.confirmNote, L.quoteAddNote(f.savedTotal, f.maybeSent));
  }

  // Stay, the backdrop, Esc: back on the calculator with the quote untouched.
  function stayOnQuote() { location.hash = '#/quote'; }

  function submitQuote() {
    var q = S.quote;
    if (q.busy || q.adding) return;
    setText(el.qErr, '');
    setText(el.qStale, '');
    var r = L.quoteRequest(qForm());
    if (!r.ok && r.errors.occasion && QP.occasions) r.errors.occasion = "That occasion can't be used in a quote. Pick one from the list.";
    if (!r.ok) {
      var first = qFieldErrors(r.errors);
      if (first) try { first.focus(); } catch (e) { /* ignore */ }
      return;
    }
    var pp = L.quotePromoProblem(custom, r.body.promo_code, r.body.event_date);
    if (pp) {
      qFieldErrors({ promo_code: pp });
      try { el.qPromo.focus(); } catch (e) { /* ignore */ }
      return;
    }
    qFieldErrors({});
    // The old price goes the moment a new one is asked for: it cannot be added or copied while this runs.
    q.view = null; q.req = null; q.raw = null; q.added = false;
    q.pending = r.body;
    var n = ++q.seq;
    qBusy(true);
    renderQuoteResult();
    Promise.resolve().then(function () { return S.api.quote(r.body); }).then(function (res) {
      if (n !== S.quote.seq) return;
      S.quote.view = L.quoteResult(res, custom);
      S.quote.pending = null;
      S.quote.req = r.body;
      S.quote.raw = res;
      S.quote.added = false;
      // A city the map could not find: offer the distance box.
      if (S.quote.view.needsDistance) show(el.qKmBox, true);
      renderQuoteResult();
      try { el.qResultH.focus(); el.qResult.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { /* ignore */ }
    }).catch(function (e) {
      if (n !== S.quote.seq) return;
      var qe = L.quoteError(e);
      var first = qFieldErrors(qe.fields);
      setText(el.qErr, qe.message);
      S.quote.pending = null;
      S.quote.view = null;
      renderQuoteResult();
      if (first) try { first.focus(); } catch (x) { /* ignore */ }
    }).then(function () { if (n === S.quote.seq) qBusy(false); });
  }

  // Clipboard API (https / localhost); falls back to a hidden textarea + execCommand.
  function copyQuote() {
    if (!qSameAnswers(S.quote.req)) { qDropPrice(); return; }
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
    // Say explicitly that this is plain text, so no phone files it as a link (a quote is words, never an address).
    var plain = function () { return navigator.clipboard.writeText(text); };
    if (navigator.clipboard && typeof window.ClipboardItem === 'function' && navigator.clipboard.write) {
      try {
        navigator.clipboard.write([new window.ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }) })]).then(done, function () { plain().then(done, fallback); });
      } catch (e) { plain().then(done, fallback); }
    } else if (navigator.clipboard && navigator.clipboard.writeText) plain().then(done, fallback);
    else fallback();
  }

  function showQuote() {
    S.thread.id = null;
    setScreen('quote');
    var pre = S.quotePrefill;
    S.quotePrefill = null;
    if (pre) { S.quote.fromLead = pre.fromLead || null; S.quote.backTo = pre.backTo || null; S.quote.pre = pre; }
    buildQuotePickers();   // the lists are re-read each time: a promo that ended overnight drops out
    if (pre) qFill(pre);
    else if (S.quote.view && !qSameAnswers(S.quote.req)) qDropPrice();   // back on the calculator: a promo dropped from the list changes the answers
    qTypeChanged();
    qBackBar();
    renderQuoteResult();
  }

  // Everything the lead (or its saved price) says, in the fields.
  function qFill(pre) {
    el.qGuests.value = pre.guests || '';
    el.qHours.value = pre.hours || '';
    Array.prototype.forEach.call(el.qForm.querySelectorAll('input[name="q-bar"]'), function (r) {
      r.checked = pre.bar === (r.value === 'yes');
    });
    el.qCity.value = pre.area || '';
    if (pre.km) { show(el.qKmBox, true); el.qKm.value = pre.km; }
    el.qDate.value = pre.date || '';
    qSetOccasion(pre.occasion || '');
    qSetPromo(pre.promo || '');
    if (pre.date || pre.occasion || el.qPromo.value) el.qMore.open = true;   // these live under More: show them filled in
  }

  // A code that is not running today is left out rather than added as a choice.
  function qSetPromo(code) {
    if (!QP.promos) { el.qPromo.value = code; qPromoHint(); return; }
    el.qPromo.value = QP.promos.some(function (p) { return p.code === code; }) ? code : '';
    qPromoHint();
  }

  // From a lead the bar says which lead Back returns to; otherwise the calculator's own title and More.
  function qBackBar() {
    if (S.screen !== 'quote') return;
    var b = S.quote.backTo;
    el.title.textContent = b ? b.name : S.tab.label;
    el.back.setAttribute('aria-label', 'Back to ' + (b ? b.name : navFor('more').label.toLowerCase()));
  }

  /* ---------- Download spreadsheet (More) ----------
     Two taps on purpose: "Make spreadsheet" fetches and builds the file, "Save file" hands it over. On an iPhone or iPad the share
     sheet must be opened inside the tap itself (an awaited fetch uses up the tap), so Save does no waiting before navigator.share. */

  function buildExportGroups() {
    var frag = document.createDocumentFragment();
    L.exportGroups().forEach(function (g) {
      var lab = make('label', 'reason-chip');
      var input = make('input');
      input.type = 'radio'; input.name = 'ex-group'; input.value = g.key;
      if (g.key === 'all') input.checked = true;   // a backup should never be silently partial
      input.addEventListener('change', exportChoiceChanged);
      lab.appendChild(input);
      lab.appendChild(make('span', '', g.label));
      frag.appendChild(lab);
    });
    el.exGroup.replaceChildren(frag);
  }

  function exportGroup() {
    var r = el.exGroup.querySelector('input:checked');
    return r ? r.value : 'all';
  }

  // The prepared file belongs to the choices it was made with: any change drops it, so a stale file is never saved.
  function clearPrepared() {
    S.exp.seq++;
    S.exp.prepared = null;
    setText(el.exStatus, ''); setText(el.exError, ''); setText(el.exHint, '');
    show(el.exSave, false);
    setExportBusy(false);
  }
  function exportChoiceChanged() { clearPrepared(); }

  function setExportBusy(on) {
    S.exp.busy = on;
    el.exMake.disabled = on;
    el.exMake.classList.toggle('is-busy', on);
  }

  function resetExport() {
    clearPrepared();
    el.exFrom.value = ''; el.exTo.value = ''; el.exDates.open = false;
    var all = el.exGroup.querySelector('input[value="all"]');
    if (all) all.checked = true;
  }

  function exportBrand() {
    var own = typeof custom.businessName === 'string' ? custom.businessName.trim() : '';
    return own || (el.moreBrand.textContent || '').trim();
  }

  function makeExport() {
    if (S.exp.busy) return;
    var r = L.exportArgs(exportGroup(), el.exFrom.value, el.exTo.value);
    clearPrepared();
    if (!r.ok) { setText(el.exError, r.error); return; }
    var group = r.args.p_group;
    var n = S.exp.seq;
    setExportBusy(true);
    Promise.resolve().then(function () { return S.api.exportLeads(r.args); }).then(function (env) {
      if (n !== S.exp.seq) return;
      var rows = env && Array.isArray(env.rows) ? env.rows : [];
      var text = L.csvEncode(L.EXPORT_HEADERS(), rows.map(L.exportCells));
      var name = L.exportFileName(exportBrand(), group, L.today().ymd);
      var res = L.exportResult(env, name);
      setText(el.exStatus, res.canSave && res.name ? res.text + ' ' + res.name : res.text);
      if (!res.canSave) return;
      var blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
      var file = null;
      try { file = new File([blob], name, { type: 'text/csv' }); } catch (e) { file = null; }
      var can = false;
      try { can = !!(file && navigator.canShare && navigator.canShare({ files: [file] })); } catch (e2) { can = false; }
      var platform = L.diagDevice(navigator, window).platform;
      // Mock only: ?export_env=iphone pretends to be an iPhone that can share files, for screenshots.
      if (MOCK && qs.get('export_env') === 'iphone') { platform = 'iPhone'; can = !!file; }
      var method = L.exportSaveMethod({ canShareFiles: can, platform: platform });
      S.exp.prepared = { file: file, blob: blob, name: name, method: method };
      setText(el.exHint, method === 'share' ? 'Choose “Save to Files”, or open it in Numbers.' : '');
      show(el.exSave, true);
    }, function (err) {
      if (n !== S.exp.seq) return;
      setText(el.exError, L.exportErrorText(err));
    }).then(function () { if (n === S.exp.seq) setExportBusy(false); });
  }

  function downloadExport(p) {
    var url = URL.createObjectURL(p.blob);
    var a = make('a');
    a.href = url; a.download = p.name; a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  // Runs inside the tap: nothing is awaited before navigator.share() or the link click.
  function saveExport() {
    var p = S.exp.prepared;
    if (!p) return;
    setText(el.exError, '');
    if (p.method !== 'share' || !p.file || typeof navigator.share !== 'function') { downloadExport(p); return; }
    var shared;
    try { shared = navigator.share({ files: [p.file], title: p.name }); } catch (e) { downloadExport(p); return; }
    Promise.resolve(shared).then(null, function (err) {
      var nm = err && err.name;
      if (nm === 'AbortError') return;   // the owner closed the sheet
      if (nm === 'NotAllowedError') { setText(el.exError, 'Tap Save file again.'); return; }
      try { downloadExport(p); } catch (e2) { setText(el.exError, L.exportErrorText(e2)); }
    });
  }

  function showExport() {
    S.thread.id = null;
    setScreen('export');
  }

  /* ---------- Ask your CRM (More) ----------
     Read only: the question goes to the cv-ask Edge Function, the answer comes back as pieces (text, figures, lead chips) that are
     drawn with createElement / textContent only. The conversation is a plain array in memory: never written to storage, gone on
     sign-out or reload. Only the owner's last two QUESTIONS go along with a new one, never the answers. */

  var ASK_WAIT = 'Looking it up…';
  var ASK_WAIT_LONG = 'Still working…';
  var ASK_WAIT_MS = 12000;
  var ASK_KEEP = 60;       // bubbles kept on screen
  var askRowNode = null;   // the More row; hidden until the database says Ask is on

  function askAvailable() {
    return feature('ask') && TAB_ROUTES.indexOf('ask') !== -1 && !!S.api && typeof S.api.ask === 'function' && typeof S.api.askConfig === 'function';
  }
  function askOn() { var a = S.ask; return askAvailable() && a.cfgState === 'ready' && !!a.cfg && a.cfg.enabled === true; }
  function applyAskRow() { if (askRowNode) askRowNode.hidden = !askOn(); }

  // cv_ask_config(): asked once per sign-in, kept for the session. Any error = Ask stays hidden.
  function loadAskConfig() {
    var a = S.ask;
    if (!askAvailable()) { a.cfgState = 'off'; return Promise.resolve(); }
    if (a.cfgState !== 'idle') return a.cfgPromise || Promise.resolve();
    var seq = ++a.cfgSeq;
    a.cfgState = 'loading';
    a.cfgPromise = Promise.resolve().then(function () { return S.api.askConfig(); }).then(function (c) {
      if (seq !== a.cfgSeq) return;
      a.cfg = L.askConfigView(c); a.cfgState = 'ready';
    }, function () {
      if (seq !== a.cfgSeq) return;
      a.cfg = null; a.cfgState = 'failed';
    }).then(function () {
      if (seq !== a.cfgSeq) return;
      applyAskRow();
      if (S.screen === 'ask') { if (askOn()) renderAsk(); else location.replace('#/'); }
    });
    return a.cfgPromise;
  }

  function askLeadName(id) {
    var rows = S.leads || [];
    for (var i = 0; i < rows.length; i++) if (rows[i] && rows[i].lead_id === id) return L.displayName(rows[i]);
    return '';
  }

  function buildAskRow(it) {
    var li = make('li', 'ask-row');
    var b = make('div', 'ask-bubble');
    if (it.role === 'q') {
      li.classList.add('is-q');
      b.textContent = it.text;
    } else if (it.role === 'wait') {
      li.classList.add('is-a', 'is-wait');
      b.textContent = it.text;
    } else if (it.role === 'err') {
      li.classList.add('is-a', 'is-err');
      b.setAttribute('role', 'alert');
      b.textContent = it.text;
    } else {
      li.classList.add('is-a');
      var v = L.askView(it.res, askLeadName);
      var p = make('p', 'ask-text');
      v.parts.forEach(function (part) {
        if (part.t === 'text') p.appendChild(document.createTextNode(part.v));
        else if (part.t === 'fig') p.appendChild(make('strong', 'ask-fig', part.v));
        else if (part.t === 'quote') p.appendChild(make('span', 'ask-quote', '\u201C' + part.v + '\u201D'));
        else {
          var a = make('a', 'ask-chip', part.name);
          a.href = '#/lead/' + part.id;
          a.setAttribute('aria-label', 'Open ' + part.name);
          p.appendChild(a);
        }
      });
      b.appendChild(p);
      if (v.from) b.appendChild(make('span', 'ask-from', v.from));
    }
    li.appendChild(b);
    return li;
  }

  // Draws only what changed, so a screen reader announces a new bubble once and never re-reads the old ones.
  function syncAskThread() {
    var a = S.ask;
    Array.prototype.slice.call(el.askThread.children).forEach(function (n) {
      if (!a.items.some(function (it) { return it.node === n; })) n.remove();
    });
    a.items.forEach(function (it) {
      if (!it.node) it.node = buildAskRow(it);
      if (it.node.parentNode !== el.askThread) el.askThread.appendChild(it.node);
    });
  }

  function renderAskStarters() {
    var frag = document.createDocumentFragment();
    if (!S.ask.items.length) {
      L.askStarters(custom.askStarters).forEach(function (q) {
        var btn = make('button', 'ask-starter', q);
        btn.type = 'button';
        btn.addEventListener('click', function () { el.askInput.value = q; submitAsk(); });
        frag.appendChild(btn);
      });
    }
    el.askStarters.replaceChildren(frag);
  }

  function renderAskCount() {
    var max = S.ask.cfg ? S.ask.cfg.max : L.ASK_MAX_DEFAULT;
    var n = el.askInput.value.length;
    var near = n >= Math.ceil(max * 0.8);
    el.askCount.textContent = near ? n + ' of ' + max : '';
    el.askCount.hidden = !near;
    el.askCount.classList.toggle('is-full', n >= max);
  }

  function sizeAskInput() {
    el.askInput.style.height = 'auto';
    el.askInput.style.height = Math.min(el.askInput.scrollHeight, 120) + 'px';
  }

  function renderAsk() {
    var a = S.ask, on = askOn();
    show(el.askScroll, on); show(el.askForm, on);
    if (!on) return;
    el.askInput.maxLength = a.cfg.max;
    el.askInput.disabled = a.busy;
    el.askSend.disabled = a.busy;
    syncAskThread();
    renderAskStarters();
    renderAskCount();
    sizeAskInput();
    el.askScroll.scrollTop = el.askScroll.scrollHeight;
  }

  function askDropOldBubbles() {
    var a = S.ask;
    while (a.items.length > ASK_KEEP) a.items.shift();
  }

  function submitAsk() {
    var a = S.ask;
    if (a.busy || !askOn()) return;
    var r = L.askRequest(el.askInput.value, a.questions, a.cfg.max);
    if (!r.ok) {
      if (r.error) { a.items.push({ role: 'err', text: r.error }); renderAsk(); }
      return;
    }
    var it = a.items, n = ++a.seq;
    // A retry of a question that just failed replaces the failed try instead of stacking a second copy.
    if (it.length >= 2 && it[it.length - 1].role === 'err' && it[it.length - 2].role === 'q' && it[it.length - 2].text === r.body.question) it.splice(-2, 2);
    it.push({ role: 'q', text: r.body.question });
    var wait = { role: 'wait', text: ASK_WAIT };
    it.push(wait);
    a.busy = true;
    askDropOldBubbles();
    renderAsk();
    clearTimeout(a.waitTimer);
    a.waitTimer = setTimeout(function () {
      if (n !== a.seq || !a.busy || wait.role !== 'wait') return;
      wait.text = ASK_WAIT_LONG;
      if (wait.node) wait.node.firstChild.textContent = ASK_WAIT_LONG;
    }, ASK_WAIT_MS);
    Promise.resolve().then(function () { return S.api.ask(r.body); }).then(function (res) {
      if (n !== a.seq) return;
      wait.role = 'a'; wait.res = res; wait.text = '';
      a.questions.push(r.body.question); a.questions = a.questions.slice(-2);
      el.askInput.value = '';
    }, function (err) {
      if (n !== a.seq) return;
      wait.role = 'err'; wait.text = L.askErrorText(err);  // the question stays in the box
    }).then(function () {
      if (n !== a.seq) return;
      clearTimeout(a.waitTimer);
      if (wait.node) { wait.node.remove(); wait.node = null; }
      a.busy = false;
      renderAsk();
    });
  }

  function showAsk() {
    S.thread.id = null;
    setScreen('ask');
    var a = S.ask;
    if (a.cfgState === 'idle') loadAskConfig();
    if (a.cfgState === 'ready' || a.cfgState === 'failed' || a.cfgState === 'off') {
      if (!askOn()) { location.replace('#/'); return; }
    }
    renderAsk();
  }

  function resetAsk() {
    var a = S.ask;
    clearTimeout(a.waitTimer);
    S.ask = { cfg: null, cfgState: 'idle', cfgSeq: a.cfgSeq + 1, cfgPromise: null, items: [], questions: [], busy: false, seq: a.seq + 1, waitTimer: null };
    el.askThread.replaceChildren(); el.askStarters.replaceChildren();
    el.askInput.value = ''; el.askInput.disabled = false; el.askSend.disabled = false;
    renderAskCount();
    if (askRowNode) askRowNode.hidden = true;
  }

  /* ---------- Team (More, owner only) ----------
     Add a person, see who has access and when they last signed in, remove them. Everything goes through the cv-team Edge Function.
     Rules: one call at a time per button; a slow or failed call never shows success; what the person sees is only ever text set with
     textContent. A late answer (after the 20-second wait) is ignored, and the list is read again so the screen shows the truth. */

  var TEAM_WAIT_MS = 20000;

  function teamAvailable() { return feature('team') && !isStaff() && !!S.api && typeof S.api.team === 'function'; }

  // One cv-team call with a time limit. A timeout rejects as { error: 'timeout' }; the real answer, if it comes later, is dropped.
  function teamCall(body) {
    var timer;
    var wait = new Promise(function (res, rej) { timer = setTimeout(function () { rej({ status: 0, error: 'timeout', details: null }); }, TEAM_WAIT_MS); });
    var call = Promise.resolve().then(function () { return S.api.team(body); });
    return Promise.race([call, wait]).then(function (r) { clearTimeout(timer); return r; }, function (e) { clearTimeout(timer); throw e; });
  }

  function teamShareLink() { return location.origin + location.pathname; }

  function teamAnyBusy() { var T = S.team; return T.addBusy || Object.keys(T.busy).length > 0; }

  function renderTeam() {
    var T = S.team, v = T.view;
    el.tmLink.textContent = teamShareLink();
    setText(el.tmOff, v && !v.enabled ? 'Team access is switched off for now. People you add can’t sign in yet.' : '');
    setText(el.tmFull, v && v.full ? 'Your team is full: ' + v.active + ' of ' + v.max + '. Remove someone to add another person.' : '');
    el.tmAdd.disabled = T.addBusy;
    el.tmAdd.classList.toggle('busy', T.addBusy);
    el.tmName.disabled = T.addBusy; el.tmPhone.disabled = T.addBusy;
    setText(el.tmListError, T.listErr);
    show(el.tmReload, !!T.listErr);
    show(el.tmListLoading, T.loading && !v);
    show(el.tmListEmpty, !!v && v.members.length === 0 && !T.loading);
    show(el.tmList, !!v && v.members.length > 0);
    var frag = document.createDocumentFragment();
    (v ? v.members : []).forEach(function (m) {
      var busy = !!T.busy[m.phone];
      var li = make('li', 'sp-row');
      var top = make('div', 'sp-row-top');
      top.appendChild(make('span', 'sp-kind tm-name', m.name));
      top.appendChild(make('span', 'sp-chip ' + (m.pending ? 'is-pending' : 'is-fixed'), m.pending ? 'Cleanup pending' : 'Active'));
      li.appendChild(top);
      li.appendChild(make('p', 'sp-msg', m.phoneText));
      li.appendChild(make('p', 'sp-meta', m.lastLine));
      var actions = make('div', 'tm-actions');
      var b = make('button', 'tm-btn', busy ? 'Working…' : m.pending ? 'Retry' : 'Remove');
      b.type = 'button'; b.disabled = busy;
      b.setAttribute('aria-label', (m.pending ? 'Retry cleanup for ' : 'Remove ') + m.name);
      b.addEventListener('click', function () { if (m.pending) retryTeam(m.phone, m.name); else openTeamConfirm(m.phone, m.name); });
      actions.appendChild(b);
      li.appendChild(actions);
      frag.appendChild(li);
    });
    el.tmList.replaceChildren(frag);
  }

  function refreshTeam() {
    var T = S.team;
    if (!S.signedIn || !teamAvailable()) return Promise.resolve();
    var n = ++T.listSeq;
    T.loading = true; T.listErr = '';
    renderTeam();
    return teamCall({ action: 'list' }).then(function (res) {
      if (n !== T.listSeq) return;
      var v = L.teamView(res);
      if (!v) { T.listErr = L.teamErrorText({ error: 'network' }, 'list').text; return; }
      T.view = v; T.listErr = '';
    }).catch(function (err) {
      if (n !== T.listSeq) return;
      T.listErr = L.teamErrorText(err, 'list').text;   // old rows stay on screen
    }).then(function () { if (n === T.listSeq) { T.loading = false; if (S.screen === 'team') renderTeam(); } });
  }

  function showTeam() {
    S.thread.id = null;
    setScreen('team');
    if (!teamAvailable()) { location.replace('#/more'); return; }
    renderTeam();
    refreshTeam();
  }

  function clearTeamErrors() {
    setText(el.tmErrName, ''); setText(el.tmErrPhone, ''); setText(el.tmError, '');
    el.tmName.removeAttribute('aria-invalid'); el.tmPhone.removeAttribute('aria-invalid');
  }

  function submitTeamAdd() {
    var T = S.team;
    if (T.addBusy || !teamAvailable()) return;
    clearTeamErrors(); setText(el.tmDone, ''); setText(el.tmRowMsg, '');
    var r = L.teamAddArgs(el.tmName.value, el.tmPhone.value);
    if (!r.ok) {
      var f = r.field === 'name' ? el.tmName : el.tmPhone;
      setText(r.field === 'name' ? el.tmErrName : el.tmErrPhone, r.text);
      f.setAttribute('aria-invalid', 'true'); f.focus();
      return;
    }
    T.addBusy = true; T.listSeq++;   // a list read still on its way must not overwrite what this call is about to change
    renderTeam();
    teamCall(r.body).then(function (res) {
      var line = L.teamAddOutcome(res, r.name);
      if (!line) throw { status: 0, error: 'network', details: null };   // an answer that is not a clear success is never shown as one
      el.tmName.value = ''; el.tmPhone.value = '';
      setText(el.tmDone, line);
      if (res.member && T.view) {   // show them at once; the list read below confirms it
        var m = res.member;
        T.view.members = T.view.members.filter(function (x) { return x.phone !== m.phone; });
        var vv = L.teamView({ enabled: T.view.enabled, max: T.view.max, active: T.view.active + 1, members: [{ phone: m.phone, display_name: m.display_name, state: 'active', last_sign_in_at: null }] });
        if (vv && vv.members[0]) { T.view.members.unshift(vv.members[0]); T.view.active += 1; T.view.full = T.view.max > 0 && T.view.active >= T.view.max; }
      }
    }).catch(function (err) {
      var t = L.teamErrorText(err, 'add');
      if (t.field === 'name') { setText(el.tmErrName, t.text); el.tmName.setAttribute('aria-invalid', 'true'); }
      else if (t.field === 'phone') { setText(el.tmErrPhone, t.text); el.tmPhone.setAttribute('aria-invalid', 'true'); }
      else setText(el.tmError, t.text);
    }).then(function () {
      T.addBusy = false; renderTeam();
      if (S.screen === 'team') refreshTeam();
    });
  }

  function openTeamConfirm(phone, name) {
    var T = S.team;
    if (T.busy[phone]) return;
    T.confirmPhone = phone; T.confirmName = name;
    el.teamConfirmText.textContent = L.teamRemoveText(name);
    el.teamConfirmYes.disabled = false;
    if (typeof el.teamConfirm.showModal === 'function') el.teamConfirm.showModal();
    else el.teamConfirm.setAttribute('open', '');
    try { el.teamConfirmNo.focus(); } catch (e) { /* ignore */ }
  }
  function closeTeamConfirm() {
    if (el.teamConfirm.open) {
      if (typeof el.teamConfirm.close === 'function') el.teamConfirm.close();
      else el.teamConfirm.removeAttribute('open');
    }
  }

  // remove and retry_cleanup share one path: the busy flag is set before the call and cleared only when it settles.
  function runTeamRemoval(action, phone, name) {
    var T = S.team;
    if (T.busy[phone] || !teamAvailable()) return;
    setText(el.tmRowMsg, ''); setText(el.tmListError, ''); setText(el.tmDone, '');
    T.busy[phone] = true; T.listSeq++;
    renderTeam();
    teamCall(L.teamPhoneBody(action, phone)).then(function (res) {
      var o = L.teamRemoveOutcome(res, name);
      if (!o.ok) throw { status: 0, error: 'network', details: null };
      if (T.view) {
        if (o.removed) T.view.members = T.view.members.filter(function (x) { return x.phone !== phone; });
        else T.view.members.forEach(function (x) { if (x.phone === phone) { x.pending = true; x.state = 'cleanup_pending'; x.lastLine = 'Access is closed. Sign-in cleanup is pending.'; } });
        T.view.active = T.view.members.filter(function (x) { return !x.pending; }).length;
        T.view.full = T.view.max > 0 && T.view.active >= T.view.max;
      }
      setText(el.tmRowMsg, o.text);
    }).catch(function (err) {
      setText(el.tmListError, L.teamErrorText(err, action).text);
    }).then(function () {
      delete T.busy[phone]; renderTeam();
      if (S.screen === 'team') refreshTeam();
    });
  }
  function retryTeam(phone, name) { runTeamRemoval('retry_cleanup', phone, name); }

  function copyTeamLink() {
    var link = teamShareLink();
    var done = function (ok) { setText(el.tmCopyMsg, ok ? 'Link copied.' : 'Couldn’t copy. Press and hold the link above to copy it.'); };
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(link).then(function () { done(true); }, function () { done(false); });
    } else done(false);
  }

  function resetTeam() {
    var T = S.team;
    S.team = { view: null, listErr: '', listSeq: T.listSeq + 1, addBusy: false, busy: {}, confirmPhone: '', confirmName: '', loading: false };
    closeTeamConfirm();
    el.tmName.value = ''; el.tmPhone.value = '';
    clearTeamErrors(); setText(el.tmDone, ''); setText(el.tmRowMsg, ''); setText(el.tmListError, ''); setText(el.tmCopyMsg, '');
    el.tmList.replaceChildren();
    renderTeam();
  }

  /* ---------- Help & support (More) ---------- */

  var SUPPORT_REFRESH_MS = 60000;
  var supportRowNode = null;  // the More row; hidden until the database says support is on

  function loadSupportConfig() {
    var sp = S.support;
    if (!feature('support') || !S.api || typeof S.api.supportConfig !== 'function') { sp.cfgState = 'off'; return Promise.resolve(); }
    var seq = ++sp.cfgSeq;
    sp.cfgState = 'loading';
    return Promise.resolve().then(function () { return S.api.supportConfig(); }).then(function (c) {
      if (seq !== sp.cfgSeq) return;
      sp.cfg = L.supportConfigView(c); sp.cfgState = 'ready';
    }, function () {
      if (seq !== sp.cfgSeq) return;
      sp.cfg = null; sp.cfgState = 'failed';  // soft-fail: the More row stays hidden
    }).then(function () {
      if (seq !== sp.cfgSeq) return;
      if (supportRowNode) supportRowNode.hidden = !(sp.cfg && sp.cfg.enabled);
      if (S.screen === 'support') renderSupport();
    });
  }

  function supportLeadActive() { return !!(S.nav.lead && !S.support.removeLead); }

  function buildSupportKinds() {
    var frag = document.createDocumentFragment();
    L.SUPPORT_KINDS.forEach(function (k) {
      var lab = make('label', 'reason-chip');
      var input = make('input');
      input.type = 'radio'; input.name = 'sp-kind'; input.value = k.key;
      input.addEventListener('change', function () { setText(el.spError, ''); });
      lab.appendChild(input);
      lab.appendChild(make('span', '', k.label));
      frag.appendChild(lab);
    });
    el.spKinds.replaceChildren(frag);
  }

  function supportKind() {
    var r = el.spKinds.querySelector('input:checked');
    return r ? r.value : '';
  }

  // Wording by switch state. While send_enabled is false nothing reaches Kevin, so the screen must not say it does.
  var SUPPORT_TEXT = {
    on: { lede: 'Something not working, a question or an idea? Tell Kevin here.', heading: 'Tell Kevin', button: 'Send to Kevin',
      disclose: 'Kevin also gets your screen, phone type, the time and recent page errors. Never your customers’ messages.', noSend: '' },
    off: { lede: 'Something not working, a question or an idea? Write it down here.', heading: 'Write it down', button: 'Save request',
      disclose: 'Your screen, phone type, the time and recent page errors are saved with it. Never your customers’ messages.',
      noSend: 'Kevin isn’t told automatically yet. It’s saved here; call or text him if it can’t wait.' }
  };

  function renderSupportDisclose() {
    var on = !!(S.support.cfg && S.support.cfg.sendEnabled);
    var T = SUPPORT_TEXT[on ? 'on' : 'off'];
    var t = T.disclose;
    if (supportLeadActive() && el.spInclude.checked) t += ' This time also the customer’s name and phone.';
    el.spDisclose.textContent = t;
    setText(el.spNoSend, T.noSend);
    el.spLede.textContent = T.lede; el.spFormH.textContent = T.heading; el.spSendLabel.textContent = T.button;
  }

  function renderSupportCount() {
    var n = el.spMessage.value.length;
    setText(el.spCount, n >= 1800 ? n + ' of 2,000' : '');
  }

  // The whole screen from S.support: contact buttons, form or "off" line, the lead line, the urgent toggle.
  function renderSupport() {
    var sp = S.support;
    var c = sp.cfg;
    var ready = sp.cfgState === 'ready' && c && c.enabled;
    var offText = sp.cfgState === 'loading' || sp.cfgState === 'idle' ? '' :
      (sp.cfgState === 'failed' ? 'Couldn’t load Help right now. Try again in a moment.' : 'Help requests are turned off right now.');
    setText(el.spOff, ready ? '' : offText);
    // Call / Text Kevin: only with a valid number, in the owner's own words from the config (Kevin by default).
    var hasPhone = !!(c && c.phone);
    show(el.spContact, hasPhone);
    if (hasPhone) {
      el.spCall.href = c.callHref; el.spText.href = c.textHref;
      el.spCallLabel.textContent = 'Call ' + c.name; el.spTextLabel.textContent = 'Text ' + c.name;
    } else { el.spCall.removeAttribute('href'); el.spText.removeAttribute('href'); }
    show(el.spForm, !!ready);
    show(el.spUrgentRow, !!(ready && c.sendEnabled));
    var lead = supportLeadActive();
    show(el.spLead, lead && !!ready);
    if (lead) el.spLeadText.textContent = L.supportLeadLine(S.nav.lead.lead) || 'About: this lead';
    renderSupportDisclose();
    renderSupportCount();
    renderSupportList();
  }

  function setSupportBusy(on) {
    S.support.busy = on;
    el.spSend.disabled = on;
    el.spSend.classList.toggle('is-busy', on);
    if (on) el.spSend.setAttribute('aria-busy', 'true'); else el.spSend.removeAttribute('aria-busy');
  }

  function supportError(text) {
    setText(el.spError, text);
    if (text) setText(el.spDone, '');
  }

  // What the page tells Kevin about itself: the exact contract object (L.supportDiagnostics); the server rebuilds it again.
  function collectDiagnostics() {
    return L.supportDiagnostics({
      build: window.CV_BUILD, route: 'support', fromRoute: S.nav.from,
      viewport: { w: window.innerWidth, h: window.innerHeight }, device: L.diagDevice(navigator, window),
      errors: diag.errors, calls: diag.calls
    });
  }

  function submitSupport() {
    var sp = S.support;
    if (sp.busy || !sp.cfg || !sp.cfg.enabled) return;
    if (!sp.key) sp.key = L.newClientKey();   // one key per compose: a retry after a failed send reuses it
    var lead = supportLeadActive() ? S.nav.lead : null;
    var r = L.supportArgs({
      kind: supportKind(), message: el.spMessage.value, urgent: el.spUrgent.checked, sendEnabled: sp.cfg.sendEnabled,
      lead_id: lead ? lead.id : null, include_customer: el.spInclude.checked, client_key: sp.key, diagnostics: collectDiagnostics()
    });
    if (!r.ok) {
      supportError(L.supportErrorText({ message: 'bad_input', details: r.error }).text);
      (r.error === 'kind' ? el.spKinds.querySelector('input') : el.spMessage).focus();
      if (r.error !== 'kind') el.spMessage.setAttribute('aria-invalid', 'true');
      return;
    }
    supportError('');
    setText(el.spDone, '');
    setSupportBusy(true);
    Promise.resolve().then(function () { return S.api.supportSubmit(r.args); }).then(function (res) {
      if (!S.signedIn) return;
      var out = res && typeof res === 'object' ? res : {};
      setText(el.spDone, L.supportConfirm(out.kevin_told, out.ref));
      el.spForm.reset();
      el.spMessage.removeAttribute('aria-invalid');
      sp.key = null;   // the form is cleared: the next compose gets a new key
      renderSupportCount(); renderSupportDisclose();
      try { el.spDone.focus({ preventScroll: false }); } catch (e) { /* focus is a nicety */ }
      refreshSupportList();
    }, function (err) {
      if (!S.signedIn) return;
      var t = L.supportErrorText(err);
      if (t.removeLead) { sp.removeLead = true; el.spInclude.checked = false; renderSupport(); }
      supportError(t.text);   // the form keeps its text and the same client_key
    }).then(function () { setSupportBusy(false); });
  }

  function renderSupportList() {
    var sp = S.support;
    var rows = sp.rows;
    var ready = sp.cfgState === 'ready' && sp.cfg && sp.cfg.enabled;
    show(el.spListLoading, !!ready && rows === null && !sp.listErr);
    setText(el.spListError, ready && sp.listErr ? 'Couldn’t load your requests.' : '');
    show(el.spListEmpty, !!ready && rows !== null && rows.length === 0);
    show(el.spList, !!ready && rows !== null && rows.length > 0);
    document.getElementById('sp-list-h').parentNode.hidden = !ready;
    var frag = document.createDocumentFragment();
    (ready && rows ? rows : []).forEach(function (row) {
      var v = L.supportRow(row);
      var li = make('li', 'sp-row');
      var top = make('div', 'sp-row-top');
      var kind = make('span', 'sp-kind', v.kind);
      if (v.urgent) kind.appendChild(make('span', 'sp-urgent-tag', 'Urgent'));
      top.appendChild(kind);
      top.appendChild(make('span', 'sp-chip is-' + v.tone, v.status));
      li.appendChild(top);
      if (v.first) li.appendChild(make('p', 'sp-msg', v.first));
      if (v.note) li.appendChild(make('p', 'sp-note', v.note));
      li.appendChild(make('p', 'sp-meta', [v.date, v.ref].filter(Boolean).join(' · ')));
      frag.appendChild(li);
    });
    el.spList.replaceChildren(frag);
  }

  function refreshSupportList() {
    var sp = S.support;
    if (!S.signedIn || !S.api || typeof S.api.supportList !== 'function' || !sp.cfg || !sp.cfg.enabled) return;
    var n = ++sp.listSeq;
    Promise.resolve().then(function () { return S.api.supportList(); }).then(function (rows) {
      if (n !== sp.listSeq) return;
      sp.rows = Array.isArray(rows) ? rows : []; sp.listErr = false;
    }, function () {
      if (n !== sp.listSeq) return;
      sp.listErr = true;   // old rows stay on screen
    }).then(function () { if (n === sp.listSeq && S.screen === 'support') renderSupportList(); });
  }

  function showSupport() {
    S.thread.id = null;
    setScreen('support');
    renderSupport();
    var sp = S.support;
    // The config may still be on its way (a direct #/support link); render again when it lands, then load the list.
    (sp.cfgState === 'ready' ? Promise.resolve() : loadSupportConfig()).then(function () {
      if (S.screen === 'support') { renderSupport(); refreshSupportList(); }
    });
    if (sp.cfgState === 'ready') refreshSupportList();
  }

  function resetSupport() {
    var sp = S.support;
    sp.cfgSeq++; sp.listSeq++;
    S.support = { cfg: null, cfgState: 'idle', key: null, busy: false, removeLead: false, rows: null, listErr: false, listSeq: sp.listSeq, cfgSeq: sp.cfgSeq };
    el.spForm.reset(); el.spMessage.removeAttribute('aria-invalid');
    setSupportBusy(false); setText(el.spError, ''); setText(el.spDone, '');
    el.spList.replaceChildren();
    if (supportRowNode) supportRowNode.hidden = true;
    S.nav = { cur: '', from: '', lead: null };
    diagClear();
  }

  // Remember the screen before More / Help (and the lead record it came from) so a request can say where it was sent from.
  function trackNav(name) {
    var group = name === 'more' || name === 'support' || name === 'quote' || name === 'export' || name === 'ask' || name === 'team';
    var prev = S.nav.cur;
    var prevGroup = prev === 'more' || prev === 'support' || prev === 'quote' || prev === 'export' || prev === 'ask' || prev === 'team';
    if (group && !prevGroup) {
      S.nav.from = prev;
      S.nav.lead = prev === 'lead' && S.thread.id ? { id: S.thread.id, lead: S.thread.lead } : null;
      S.support.removeLead = false; el.spInclude.checked = false;
    } else if (!group) { S.nav.from = ''; S.nav.lead = null; }
    S.nav.cur = name;
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
    refreshPastEvents();
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
      maybeRecheckAccess(e);
      retryLater();
    });
  }

  // Did these happen?: its own RPC, soft-failed. Any error hides only this section.
  function pastOn() { return HAS_FOLLOWUPS && feature('pastEvents') && !!S.api.pastEvents; }
  function refreshPastEvents() {
    if (!pastOn()) return Promise.resolve();
    var n = ++S.seq.pastEvents;
    var p = Promise.resolve(S.api.pastEvents()).then(function (r) {
      if (n !== S.seq.pastEvents || !S.signedIn) return;
      S.pastEvents = r || null;
    }, function () {
      if (n !== S.seq.pastEvents) return;
      S.pastEvents = null;
    }).then(function () {
      // Superseded by a newer fetch: wait for the newest one, so a caller (savePast) never settles on an old list.
      // Every fetch swallows its own error, so the newest always resolves; a fetch never waits on itself.
      if (n !== S.seq.pastEvents) return S.pastLatest && S.pastLatest !== p ? S.pastLatest : undefined;
      if (S.screen === 'followups') renderFollowUps();
      else if (S.screen === 'metrics') renderMetrics();
    });
    S.pastLatest = p;
    return p;
  }

  function pastRow(it) {
    var busy = S.pastBusy === it.leadId;
    var li = make('li', 'pe-row' + (busy ? ' is-busy' : ''));
    var a = make('a', 'pe-who');
    a.href = '#/lead/' + encodeURIComponent(it.leadId);
    a.appendChild(make('span', 'pe-name', it.name));
    a.appendChild(make('span', 'pe-meta', it.meta));
    li.appendChild(a);
    var btns = make('div', 'pe-btns');
    [['booked', 'Booked'], ['lost', "Didn't book"]].forEach(function (d) {
      var b = make('button', 'pe-btn pe-' + d[0], d[1]);
      b.type = 'button';
      b.disabled = !!S.pastBusy;
      b.setAttribute('data-pe', it.leadId + ':' + d[0]);
      b.setAttribute('aria-label', d[1] + ': ' + it.name);
      b.addEventListener('click', function () {
        var act = L.actions().filter(function (x) { return x.status === d[0]; })[0];
        if (act) openConfirm(act, it);
      });
      btns.appendChild(b);
    });
    li.appendChild(btns);
    return li;
  }

  // Top of Follow-ups: events that have passed with no outcome yet. Booked / Didn't book reuse the status sheet.
  function pastSection() {
    if (!pastOn()) return null;
    var v = L.pastEventsView(S.pastEvents);
    if (!v) return null;
    var sec = make('section', 'fu-block pe-block');
    sec.id = 'fu-past';
    sec.setAttribute('aria-labelledby', 'fu-past-h');
    var h = make('h2', 'fu-title', 'Did these happen?');
    h.id = 'fu-past-h'; h.tabIndex = -1; h.setAttribute('data-pe', 'head');
    h.appendChild(make('span', 'pe-count', String(v.total)));
    sec.appendChild(h);
    sec.appendChild(make('p', 'fu-rule pe-rule', 'These events have passed. Mark what happened.'));
    if (S.pastErr) { var er = make('p', 'error pe-err', S.pastErr); er.setAttribute('role', 'alert'); sec.appendChild(er); }
    var ul = make('ul', 'fu-list pe-list');
    v.items.forEach(function (it) { ul.appendChild(pastRow(it)); });
    sec.appendChild(ul);
    if (v.more > 0) sec.appendChild(make('p', 'fu-empty pe-more', v.moreText));
    return sec;
  }

  // A redraw replaces every node: put keyboard focus back on the same button / heading (the row may be gone: heading).
  function restorePastFocus(key) {
    if (!key) return;
    var t = null, nodes = el.fuBody.querySelectorAll('[data-pe]');
    for (var i = 0; i < nodes.length; i++) if (nodes[i].getAttribute('data-pe') === key && !nodes[i].disabled) { t = nodes[i]; break; }
    if (!t) t = el.fuBody.querySelector('[data-pe="head"]');
    if (t) try { t.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }

  function scrollToPast() {
    if (!S.pastScroll) return;
    var sec = el.fuBody.querySelector('.pe-block');
    if (!sec) return;
    S.pastScroll = false;
    try { sec.scrollIntoView({ block: 'start' }); sec.querySelector('.fu-title').focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }

  function savePast(it, status, extra) {
    if (S.pastBusy || S.pending) return;
    S.pastBusy = it.leadId; S.pastErr = '';
    renderFollowUps();
    // pastBusy stays set until the refetch has settled: every button stays disabled (also on redraws from realtime),
    // so a saved row can never be tapped again and flip its outcome.
    function settle() {
      S.pastBusy = '';
      if (S.screen === 'followups') {
        renderFollowUps();
        var a = document.activeElement;
        if (!a || a === document.body || a.disabled) {
          var nx = el.fuBody.querySelector('.pe-btn:not([disabled])') || el.fuBody.querySelector('[data-pe="head"]');
          if (nx) try { nx.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
        }
      }
    }
    Promise.resolve().then(function () { return S.api.setStatus(it.leadId, status, extra || {}); }).then(function () {
      return Promise.all([refreshPastEvents(), refreshList(), refreshForecast()]).then(settle, settle);
    }, function (e) {
      S.pastErr = 'Could not save ' + it.name + '. ' + L.friendlyStatusError(e, ACCESS.role);
      return refreshPastEvents().then(settle, settle);
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
    var ae = document.activeElement, keep = ae && ae.getAttribute && el.fuBody.contains(ae) ? ae.getAttribute('data-pe') : null;
    var past = pastSection();
    if (!S.followUps) {
      // A follow-ups load in progress or failed never hides the Did-these-happen list (its own RPC).
      show(el.fuLoading, !S.followUpsError);
      setText(el.fuErr, S.followUpsError);
      if (past) el.fuBody.replaceChildren(past); else el.fuBody.replaceChildren();
      restorePastFocus(keep);
      scrollToPast();
      return;
    }
    show(el.fuLoading, false);
    setText(el.fuErr, '');
    var g = L.groupFollowUps(S.followUps, S.leads);
    var frag = document.createDocumentFragment();
    if (past) frag.appendChild(past);

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
    restorePastFocus(keep);
    scrollToPast();
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
    refreshForecast();
    refreshPastEvents();
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

  // Looking ahead: its own RPC, soft-failed. Any error leaves the block hidden; nothing else on Metrics depends on it.
  function refreshForecast() {
    if (!S.api.forecast || !feature('forecast')) return Promise.resolve();
    var n = ++S.seq.forecast;
    return Promise.resolve(S.api.forecast()).then(function (f) {
      if (n !== S.seq.forecast || !S.signedIn) return;
      S.forecast = f || null;
      if (S.screen === 'metrics') renderMetrics();
    }).catch(function () {
      if (n !== S.seq.forecast) return;
      S.forecast = null;
      if (S.screen === 'metrics') renderMetrics();
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
      var mine = m.open_priced_not_sent || {};
      if (Number(mine.count)) sub += '. ' + L.fmtMoney(mine.total) + ' more priced by you, not sent';
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
  // Looking ahead (feature 'forecast'): booked money by event month and open quotes (both certain); the likely range only when ready.
  METRIC_BLOCKS.forecast = function () {
    var v = L.forecastView(S.forecast);
    if (!v) return null; // off, errored or not loaded yet: no block at all
    var b = block('Looking ahead');
    b.appendChild(make('p', 'm-sub fc-head', 'Already booked, by event month'));
    var ul = make('ul', 'vt-list fc-list');
    v.rows.forEach(function (r) {
      var li = make('li', 'vt-row' + (r.bookedCount ? '' : ' is-zero'));
      li.appendChild(make('span', 'vt-name', r.label));
      var right = make('span', 'vt-right');
      if (r.bookedCount) right.appendChild(make('span', 'vt-money', r.bookedMoney));
      right.appendChild(make('span', 'vt-count', r.bookedCount ? L.plural(r.bookedCount, 'job', 'jobs') : 'Nothing booked'));
      li.appendChild(right);
      ul.appendChild(li);
    });
    var lt = make('li', 'vt-row' + (v.later.bookedCount ? '' : ' is-zero'));
    lt.appendChild(make('span', 'vt-name', 'Later'));
    var lr = make('span', 'vt-right');
    if (v.later.bookedCount) lr.appendChild(make('span', 'vt-money', v.later.bookedMoney));
    lr.appendChild(make('span', 'vt-count', v.later.bookedCount ? L.plural(v.later.bookedCount, 'job', 'jobs') : 'Nothing booked'));
    lt.appendChild(lr);
    ul.appendChild(lt);
    b.appendChild(ul);
    b.appendChild(make('p', 'm-sub fc-head', 'Open quotes for future dates (not weighted)'));
    b.appendChild(make('p', 'm-big fc-open', v.open.count ? v.open.money : '\u2014'));
    b.appendChild(make('p', 'm-sub', v.open.count ? 'across ' + L.plural(v.open.count, 'open quote', 'open quotes') + ', counted in full' : 'No open quotes for future dates.'));
    if (v.noOpenQuotes) {
      // ready, but nothing open to weigh: certain rows only
    } else if (v.ready) {
      b.appendChild(make('p', 'm-sub fc-head', 'Likely still to come'));
      b.appendChild(make('p', 'm-big fc-range', v.range));
      b.appendChild(make('p', 'm-sub', 'Likely, not promised.'));
    } else {
      var note = make('div', 'fc-note');
      v.notReadyLines.forEach(function (t, i) {
        var p = make('p', 'm-line' + (i === 0 ? ' fc-strong' : ''), t);
        if (i === 2 && v.pastCount > 0 && pastOn() && L.pastEventsView(S.pastEvents)) {
          p.appendChild(document.createTextNode(' '));
          var lk = make('button', 'fc-link', 'Review them');
          lk.type = 'button';
          lk.addEventListener('click', function () { S.pastScroll = true; location.hash = '#/followups'; });
          p.appendChild(lk);
        }
        note.appendChild(p);
      });
      b.appendChild(note);
    }
    return b;
  };
  var METRIC_DEFAULT = ['booked', 'sources', 'open', 'value', 'forecast', 'close_rate', 'lost_reasons', 'speed'];

  // CV_CUSTOM.metrics order; unknown names ignored; all blocks when the setting is missing or empty.
  function metricOrder() {
    var want = Array.isArray(custom.metrics) ? custom.metrics : [];
    var out = [];
    want.forEach(function (k) { if (METRIC_BLOCKS[k] && out.indexOf(k) === -1) out.push(k); });
    if (!out.length) out = METRIC_DEFAULT.slice();
    // Lead value is a section of Metrics: it follows the 'value' switch, right after Money on the table.
    out = out.filter(function (k) { return k !== 'value'; });
    out = out.filter(function (k) { return k !== 'forecast' || feature('forecast'); });
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

  // The owner: every button still ahead. Staff: open leads only, and only the buttons whose switch is on.
  function actionsAheadFor(current) { return isStaff() ? L.staffActionsAhead(current, ACCESS.perms) : L.actionsAhead(current); }
  // The status that decides the buttons: the owner's includes the opted-out flag; staff keep the plain status.
  function actionsKeyFor(lead) { return isStaff() ? String((lead && lead.status) || '').toLowerCase() : L.actionsKey(lead); }
  function actionsNoteFor(current) {
    var c = String(current || '').toLowerCase();
    return isStaff() ? L.staffActionsNote(c, ACCESS.perms) : L.actionsNote(c);
  }

  function renderActions() {
    var lead = S.thread.lead;
    var current = actionsKeyFor(lead);
    var ahead = actionsAheadFor(current);
    // Kevin 11-09: the owner always sees Contacted, Booked and Lost together; the current one is marked and cannot be tapped.
    // Staff see only the buttons still ahead (C4). Nothing to offer (locked) hides them all.
    var showAll = !isStaff() && ahead.length > 0;
    L.actions().forEach(function (a) {
      var b = S.actionButtons[a.status];
      var isCurrent = current === a.status;
      var busy = S.pending === a.status;
      b.hidden = !!lead && !showAll && ahead.indexOf(a.status) === -1 && !busy;
      b.disabled = !lead || !L.canSetStatus(current, a.status) || !!S.pending;
      b.classList.toggle('is-current', isCurrent);
      if (isCurrent) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
      b.classList.toggle('is-busy', busy);
      if (busy) b.setAttribute('aria-busy', 'true'); else b.removeAttribute('aria-busy');
      b.title = isCurrent ? 'Already ' + a.label.toLowerCase() : '';
    });
    setText(el.actionsNote, actionsNoteFor(current));
    var count = showAll ? L.actions().length : ahead.length;
    el.actions.hidden = !!lead && count === 0 && !S.pending;
    el.actions.style.gridTemplateColumns = 'repeat(' + Math.max(1, Math.min(3, count || 3)) + ', 1fr)';
  }

  function renderHistory() {
    var all = L.sortHistory((S.thread.history || []).concat(L.ownerQuoteHistory(S.thread.lead)));
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
    el.confirmNo.textContent = 'Cancel';
    el.confirmText.textContent = text;
    el.confirmYes.textContent = yes;
    el.confirm.className = 'sheet ' + cls;
    setText(el.confirmErr, '');
    // Every sheet starts with one button and no note; openConfirm adds the follow-up choice (022).
    el.confirmYes.className = 'btn primary';
    el.confirmAlt.hidden = true;
    sheetBusy(false);
    setText(el.confirmNote, '');
    if (typeof el.confirm.showModal === 'function') el.confirm.showModal();
    else el.confirm.setAttribute('open', '');
    try { (focus || el.confirmNo).focus(); } catch (e) { /* ignore */ }
  }

  // While the sheet's save runs no button can answer it.
  function sheetBusy(on, label) {
    el.confirmYes.disabled = el.confirmAlt.disabled = el.confirmNo.disabled = !!on;
    if (on) el.confirmYes.setAttribute('aria-busy', 'true'); else el.confirmYes.removeAttribute('aria-busy');
    if (label) el.confirmYes.textContent = label;
  }

  // ctx = a row from the Did-these-happen list (the sheet then works on that lead, not the open thread).
  function openConfirm(action, ctx) {
    var lead = ctx ? ctx.lead : S.thread.lead;
    if (!lead || S.pending) return;
    var booked = action.status === 'booked', lost = action.status === 'lost';
    // Booked: final price, filled in from the quote. Lost: a reason is required.
    // Staff never enter a price: no field at all (the owner adds it afterwards).
    var priced = booked && !isStaff();
    show(el.priceBox, priced);
    if (priced) { el.price.value = L.amountInput(L.effectiveTotal(lead)); el.price.removeAttribute('aria-invalid'); }
    show(el.reasonBox, lost);
    if (lost) {
      var checked = el.reasonChips.querySelectorAll('input');
      for (var i = 0; i < checked.length; i++) checked[i].checked = false;
      el.reasonNote.value = '';
      show(el.reasonOther, false);
    }
    // 022: a lead with no quote that could really get the day-5 text: two buttons, neither one the default (focus stays on Cancel).
    var choice = !ctx && !isStaff() ? L.followupChoice(leadName(lead), action.status, lead) : null;
    openSheet({ kind: 'status', status: action.status, ctx: ctx || null, choice: !!choice }, choice ? choice.text : L.confirmText(leadName(lead), action.status, lead, !!ctx), choice ? choice.send : action.confirm,
      'sheet-' + action.status, priced ? el.price : null);
    if (choice) {
      setText(el.confirmNote, choice.note);
      el.confirmYes.className = 'btn choice';
      el.confirmAlt.textContent = choice.none;
      el.confirmAlt.hidden = false;
    }
  }

  function openNoteDelete(noteId) {
    show(el.priceBox, false); show(el.reasonBox, false);
    openSheet({ kind: 'note', id: noteId }, 'Delete this note? It cannot be brought back.', 'Delete note', 'sheet-note');
  }

  // Yes on the sheet: check the extra fields first; the sheet stays open with a plain error if they are wrong.
  function confirmYes() { confirmStatus('send'); }
  function confirmNoFollowup() { confirmStatus('none'); }

  // Both choice buttons land here. closeConfirm clears S.confirming before the save, and saveStatus refuses while one is pending, so a double tap saves once.
  function confirmStatus(followup) {
    var c = S.confirming;
    if (!c) return;
    if (c.kind === 'note') { closeConfirm(); deleteNote(c.id); return; }
    if (c.kind === 'quote-send') { doQuoteSend(c); return; }
    if (c.kind === 'quote-leave') {
      if (S.quote.adding) return;
      if (followup === 'none') { closeConfirm(); clearQuote(); return; }   // Leave without adding: the page is already where the owner was going
      addQuoteToLead();   // the sheet stays open until it is saved
      return;
    }
    if (c.kind === 'quote-new') { closeConfirm(); startQuoteOver(followup !== 'none'); return; }
    var lead = c.ctx ? c.ctx.lead : S.thread.lead;
    var x = isStaff() && c.status === 'booked'
      ? { ok: true, args: {} }
      : L.statusExtras(c.status, { amount: el.price.value, reason: pickedReason(), note: el.reasonNote.value }, lead && L.effectiveTotal(lead));
    if (!x.ok) {
      setText(el.confirmErr, x.error);
      if (x.field === 'amount') { el.price.setAttribute('aria-invalid', 'true'); try { el.price.focus(); } catch (e) { /* ignore */ } }
      else if (x.field === 'reason') { var first = el.reasonChips.querySelector('input'); if (first) try { first.focus(); } catch (e) { /* ignore */ } }
      return;
    }
    closeConfirm();
    if (c.choice) x.args.p_followup = followup; // 022: only a choice sheet ever sends this
    if (c.ctx) savePast(c.ctx, c.status, x.args);
    else saveStatus(c.status, x.args);
  }

  // Cancel, the backdrop, or the close button. For the leave prompt that means "Stay"; never while its save is running.
  function dismissConfirm() {
    var c = S.confirming;
    if (c && c.kind === 'quote-leave' && S.quote.adding) return;
    closeConfirm();
    if (c && c.kind === 'quote-leave') stayOnQuote();
  }

  // The dialog closed by itself (Esc) with its question unanswered. A programmatic close clears S.confirming first; a newer sheet already open is left alone.
  function onConfirmClosed() {
    if (el.confirm.open) return;
    var c = S.confirming;
    S.confirming = null;
    if (c && c.kind === 'quote-leave' && !S.quote.adding) stayOnQuote();
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
    var token = S.pendingToken = {}; // opening another lead frees S.pending: this save must then leave the other lead's save alone
    setText(el.actionErr, '');
    renderActions();
    Promise.resolve().then(function () { return S.api.setStatus(id, status, extra || {}); }).then(function () {
      S.historyOpen = false;
      // This lead's follow-up rows are out of date now: forget them so renderNext cannot repeat an old promise before the refetch lands.
      if (S.followUps) S.followUps = S.followUps.filter(function (r) { return r.lead_id !== id; });
      return Promise.all([refreshThread(), refreshList(), refreshFollowUps()]);
    }).catch(function (e) {
      if (id === S.thread.id) setText(el.actionErr, L.friendlyStatusError(e, ACCESS.role));
      maybeRecheckAccess(e);
      // Refused or failed: the page may be out of date (its chip and buttons). Refetching does not touch the message above.
      if (id === S.thread.id) return Promise.all([refreshThread(), refreshList()]);
    }).then(function () {
      if (S.pendingToken === token) S.pending = null;
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
    show(el.recPhoneRow, !!(phone && tel));
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

  function renderEmail(lead) {
    var e = L.emailLine(lead);
    var node;
    if (e.href) { node = make('a', 'rec-email-link', e.text); node.href = e.href; }
    else node = make('span', e.missing ? 'rec-email-none' : 'rec-email-text', e.text);
    el.recEmail.replaceChildren(node);
    show(el.recEmail, true);
  }

  function renderEvent(lead) {
    var d = L.leadDetails(lead, { staff: isStaff() });
    function fill(dl, facts) {
      dl.replaceChildren();
      facts.forEach(function (f) { fact(dl, f.label, f.value, { href: f.href, external: !!f.href, note: f.note, flag: f.flag }); });
    }
    fill(el.eventFacts, d.key.concat(d.more));
    // In their words: in full when short; a long message opens at its start with Show all (kept open for this lead across refreshes).
    var w = L.wordsView(d.words);
    var open = w.long && S.eventMoreFor === lead.lead_id;
    el.eventDetails.textContent = open || !w.long ? w.full : w.short;
    show(el.eventWords, !!w.full);
    show(el.eventMoreBtn, w.long);
    el.eventMoreBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    el.eventMoreBtn.textContent = open ? 'Show less' : 'Show all';
    if (!open) S.eventMoreFor = null;
    show(el.recEvent, d.key.length > 0 || d.more.length > 0 || !!w.full);
  }

  function toggleEventMore() {
    var lead = S.thread && S.thread.lead;
    if (!lead) return;
    S.eventMoreFor = S.eventMoreFor === lead.lead_id ? null : lead.lead_id;
    renderEvent(lead);
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
      // L.quoteView: no row that repeats one above it (delivery is a line; one line is its own total; Final price only when it differs)
      sum('Subtotal', q.subtotal);
      sum('Travel fee', q.travel);
      sum('Total', q.totalRow, 'is-total');
      sum('Final price', q.final, 'is-final');
      frag.appendChild(sums);
    }
    el.quoteBody.replaceChildren(frag);
    show(el.recQuote, true);
  }

  // sql/023: the price the owner saved on this lead, its send state, and the send button.
  function renderMyQuote(lead) {
    var q = !isStaff() ? L.ownerQuoteView(lead, feature('quote') && L.quoteSendFeatureOn(custom.features)) : null;
    show(el.recMyQuote, !!q);
    if (!q) return;
    setText(el.mqStatus, q.status);
    var frag = document.createDocumentFragment();
    if (q.showDetails) {
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
      [['Subtotal', q.subtotal, ''], ['Travel fee', q.travel, ''], ['Total', q.totalRow, 'is-total']].forEach(function (x) {
        if (!x[1]) return;
        sums.appendChild(make('dt', x[2], x[0])); sums.appendChild(make('dd', x[2], x[1]));
      });
      frag.appendChild(sums);
    }
    el.mqBody.replaceChildren(frag);
    setText(el.mqNote, q.note);
    show(el.mqSend, q.canSend);
    el.mqSend.textContent = q.sendLabel;
    show(el.mqResend, q.canResend);
    el.mqSend.disabled = el.mqResend.disabled = !!S.quoteSendBusy;
  }

  // Step 1: ask the server for the exact text. Step 2: the owner reads it in the sheet and confirms. Nothing goes before that tap.
  function startQuoteSend(resend) {
    var lead = S.thread.lead;
    if (!lead || S.quoteSendBusy) return;
    var id = lead.lead_id;
    var total = lead.owner_quote && lead.owner_quote.total;   // the price on the card right now: the server refuses the send if it has changed
    S.quoteSendBusy = true;
    setText(el.mqErr, '');
    renderMyQuote(lead);
    Promise.resolve().then(function () { return S.api.quotePreview(id, resend); }).then(function (p) {
      S.quoteSendBusy = false;
      if (id !== S.thread.id) return;
      renderMyQuote(S.thread.lead);
      if (!p || typeof p.body !== 'string' || !p.hash) { setText(el.mqErr, 'The text could not be prepared. Nothing went out.'); return; }
      var name = leadName(lead) + (p.to_last4 ? ' at the number ending ' + p.to_last4 : '');
      openSheet({ kind: 'quote-send', resend: !!resend, id: id, hash: p.hash, count: p.send_count, total: total }, resend ? 'Send this quote to ' + name + ' again?' : 'Send this text to ' + name + '?', resend ? 'Yes, send it again' : 'Send it', 'sheet-quote', el.confirmNo);
      setText(el.confirmNote, p.body);
    }).catch(function (e) {
      S.quoteSendBusy = false;
      if (id !== S.thread.id) return;
      renderMyQuote(S.thread.lead);
      setText(el.mqErr, L.quoteSendError(e));
      if (e && e.error === 'not_allowed') refreshThread();   // refused: the card and its button may be out of date (the message above stays)
    });
  }

  function doQuoteSend(c) {
    closeConfirm();
    if (S.quoteSendBusy) return;
    var id = c.id;
    S.quoteSendBusy = true;
    setText(el.mqErr, '');
    renderMyQuote(S.thread.lead);
    Promise.resolve().then(function () { return S.api.quoteSend({ lead_id: id, hash: c.hash, resend: c.resend, expected_count: c.count, expected_total: c.total }); }).then(function () {
      if (id === S.thread.id) setText(el.mqErr, '');
    }).catch(function (e) {
      if (id === S.thread.id) setText(el.mqErr, L.quoteSendError(e));
      maybeRecheckAccess(e);
    }).then(function () {
      S.quoteSendBusy = false;
      S.historyOpen = false;
      return Promise.all([refreshThread(), refreshList(), refreshFollowUps()]);
    });
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
    // 024 + r3: someone else on the same number: one small muted line per person at the bottom, not an event card; the name opens
    // their lead (staff never get the column).
    var shared = L.phoneSharedLines(lead);
    var sf = document.createDocumentFragment();
    shared.forEach(function (o) {
      var li = make('li', 'shared-line');
      li.appendChild(document.createTextNode(o.before));
      if (o.name) {
        var a = make('a', 'shared-name', o.name);
        a.href = '#/lead/' + encodeURIComponent(o.lead_id);
        li.appendChild(a);
      }
      li.appendChild(document.createTextNode(o.after));
      sf.appendChild(li);
    });
    el.sharedList.replaceChildren(sf);
    show(el.recShared, shared.length > 0);
  }

  // Line under the name. A pending automatic follow-up text (follow_ups) gives the exact send time.
  function renderNext() {
    var lead = S.thread.lead;
    if (!lead) return;
    // A booked lead's date and price are already in the job line below: no second sentence (C4).
    var t = L.statusGroup(lead.status) === 'booked' ? '' : L.nextAction(lead, undefined, L.pendingNudge(S.followUps, S.thread.id));
    if (el.recNext.textContent !== t || el.recNext.hidden !== !t) setText(el.recNext, t);
  }

  // One line: where they came from, then (022) "no quote sent yet" when the server says so. Staff never see a form's title (it can hold a price).
  function fillSource(lead) {
    var src = L.sourceLine(lead, { noFormName: isStaff() });
    var nq = isStaff() ? '' : L.noQuoteLine(lead);
    if (!src && !nq) { setText(el.recSource, ''); return; }
    var frag = document.createDocumentFragment();
    if (src) frag.appendChild(document.createTextNode(src));
    if (nq) {
      if (src) frag.appendChild(document.createTextNode(' \u00b7 '));
      frag.appendChild(make('span', 'rec-source-noquote', src ? nq : nq.charAt(0).toUpperCase() + nq.slice(1)));
    }
    el.recSource.replaceChildren(frag);
    el.recSource.hidden = false;
  }

  function renderRecord() {
    var lead = S.thread.lead;
    el.title.textContent = S.tab.label; // the lead's name is the big heading below; the bar says where Back goes
    setText(el.subtitle, '');
    var sections = [el.recHead, el.recContact, el.strip, el.recNotes, el.recEvent, el.recPrice, el.recQuote, el.recOthers, el.recShared, el.recHistory];
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
    // Date and guests live in the Event card; the header keeps the one figure (owner only, staff stay money-free).
    setText(el.recJob, isStaff() ? '' : L.headMoney(lead));
    fillSource(lead);
    setText(el.recNoauto, L.noAutoLine(lead));
    show(el.recHead, true);
    show(el.optoutBanner, L.isOptedOut(lead));
    renderContact(lead);
    renderEmail(lead);
    el.strip.className = 'rec-card strip tone-' + st.tone;
    var lostNote = String(lead.status || '').toLowerCase() === 'lost' ? String(lead.lost_note || '').trim() : '';
    setText(el.stripNote, lostNote ? 'Why: ' + lostNote : '');
    var statusKey = actionsKeyFor(lead);
    setText(el.hStatus, isStaff() && actionsNoteFor(statusKey) && !actionsAheadFor(statusKey).length ? 'Status locked' : L.statusHeading(statusKey));
    renderActions();
    renderHistory();
    // The card is only there while there is something to do or say: buttons ahead, a lost note, or a locked-status note.
    show(el.strip, actionsAheadFor(statusKey).length > 0 || !!lostNote || !!actionsNoteFor(statusKey));
    renderNotes(lead);
    renderEvent(lead);
    renderQuote(lead);
    renderMyQuote(lead);
    // A lead with no price yet can be priced in the calculator; a saved, unsent price can be changed the same way.
    var noQuote = lead.quote_total === null || lead.quote_total === undefined || lead.quote_total === '';
    var mine = lead.owner_quote && typeof lead.owner_quote === 'object' ? lead.owner_quote : null;
    show(el.recPrice, TAB_ROUTES.indexOf('quote') !== -1 && noQuote && (!mine || mine.state === 'saved' || mine.state === 'failed' || mine.state === 'unknown'));
    var myView = L.ownerQuoteView(lead, feature('quote') && L.quoteSendFeatureOn(custom.features));
    el.priceLink.textContent = myView && myView.reprice ? 'Price it again in the quote calculator' : mine ? 'Change this price in the quote calculator' : 'Price it in the quote calculator';
    renderOthers(lead);
  }

  // label: who wrote it (L.bubbleLabels; '' = same sender as the bubble above). Left out (the automatic texts to the owner) = the kind label.
  function bubble(m, label) {
    var out = m.direction === 'out';
    var owner = m.audience === 'owner';
    var row = make('div', 'row ' + (out ? 'out' : 'in') + (owner ? ' owner' : '') + (label === '' ? ' cont' : ''));
    var b = make('div', 'bubble');
    if (label === undefined) label = L.kindLabel(m.kind);
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
    show(el.fullSysFold, n > 0);
    if (!n) return;
    [el.sysFold, el.fullSysFold].forEach(function (b) {
      b.textContent = L.systemFoldText(n, S.thread.sysOpen);
      b.setAttribute('aria-expanded', String(S.thread.sysOpen));
    });
  }

  function sysList(system, id) {
    var list = make('div', 'sys-list');
    list.id = id || 'sys-list';
    system.forEach(function (m) { list.appendChild(bubble(m)); });
    return list;
  }

  function toggleFold() {
    S.thread.sysOpen = !S.thread.sysOpen;
    S.thread.sig = '';
    renderThread();
    // Open: show the automatic texts at the top. The second set runs after any scrollToBottom frame renderThread queued (review r2 M1).
    var s = fullOpen() ? el.convoFullScroll : convoScroller();
    if (S.thread.sysOpen) { s.scrollTop = 0; requestAnimationFrame(function () { s.scrollTop = 0; }); }
    else { s.scrollTop = s.scrollHeight; requestAnimationFrame(function () { s.scrollTop = s.scrollHeight; }); }
    if (!fullOpen()) scrollToBottom();
  }

  // The messages, in chat order, with day pills and (when shown) the automatic texts on top. Used by the box and the full view.
  function threadFrag(parts, sysId) {
    var frag = document.createDocumentFragment();
    if (parts.system.length && S.thread.sysOpen) frag.appendChild(sysList(parts.system, sysId));
    var prev = null;
    var labels = L.bubbleLabels(parts.chat, S.thread.lead);
    parts.chat.forEach(function (m, i) {
      if (!prev || !L.sameDay(prev.at, m.at)) frag.appendChild(make('div', 'day', L.fmtDay(m.at)));
      frag.appendChild(bubble(m, labels[i]));
      prev = m;
    });
    return frag;
  }

  /* ---------- full conversation view (dialog over the lead; the lead page and its scroll stay underneath) ---------- */

  function fullOpen() { return !!(el.convoFull && el.convoFull.open); }

  // Re-draw the full view from the thread; keeps your place unless you were reading at the newest.
  function renderFull(parts) {
    if (!fullOpen()) return;
    var sc = el.convoFullScroll;
    var wasNear = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 100;
    var top = sc.scrollTop;
    var p = parts || L.splitThread(S.thread.rows);
    el.fullThread.replaceChildren(threadFrag(p, 'full-sys-list'));
    show(el.fullEmpty, p.chat.length === 0 && p.system.length === 0);
    if (wasNear) { sc.scrollTop = sc.scrollHeight; requestAnimationFrame(function () { sc.scrollTop = sc.scrollHeight; }); }
    else sc.scrollTop = top;
  }

  function openFull() {
    if (fullOpen() || S.screen !== 'thread' || !S.signedIn || !S.thread.loaded) return;
    if (typeof el.convoFull.showModal === 'function') el.convoFull.showModal();
    else el.convoFull.setAttribute('open', '');
    S.fullPushed = false;
    try { history.pushState({ cvFull: 1 }, '', location.href); S.fullPushed = true; } catch (e) { /* no history entry: Close and Esc still work */ }
    el.fullThread.replaceChildren();
    renderFull();
    el.convoFullScroll.scrollTop = el.convoFullScroll.scrollHeight;
    try { el.convoFullClose.focus(); } catch (e) { /* ignore */ }
  }

  // Close the dialog and give focus back to the Open full button. 'silent' = no history step (route or sign-out already moved us).
  function hideFull() {
    if (!fullOpen()) return;
    if (typeof el.convoFull.close === 'function') el.convoFull.close(); else el.convoFull.removeAttribute('open');
    el.fullThread.replaceChildren();
    try { if (S.screen === 'thread') el.convoOpen.focus(); } catch (e) { /* ignore */ }
  }

  // Close button / Esc: step back through the history entry openFull pushed; popstate then hides the view (same path as the Back gesture).
  function requestCloseFull() {
    if (!fullOpen()) return;
    if (S.fullPushed && history.state && history.state.cvFull) history.back();
    else hideFull();
  }

  function onPopState() {
    var act = L.fullPopAction(fullOpen(), history.state);
    if (act === 'hide') { S.fullPushed = false; hideFull(); }
    else if (act === 'step') history.back();
  }

  function closeFullSilently() { S.fullPushed = false; hideFull(); }

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
    var sig = all.map(function (r) { return r.msg_id + ':' + String(r.body == null ? '' : r.body).length; }).join('|') + (S.thread.sysOpen ? '|open' : '') + '|' + L.bubbleSender({ direction: 'in', audience: 'lead' }, S.thread.lead);
    var first = S.thread.sig === '' && !el.threadBox.hasChildNodes();
    if (sig === S.thread.sig && !first) return;

    // First paint opens at the newest text (like a chat app); later refreshes keep your place unless you were at the bottom.
    var scroller = convoScroller();
    var wasNear = first ? true : isNearBottom();
    var prevTop = scroller.scrollTop;
    var grew = rows.length > S.thread.count;
    el.threadBox.replaceChildren(threadFrag(parts, 'sys-list'));
    renderFull(parts);
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
      closeFullSilently();
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
    if (!S.followUps) refreshFollowUps(); // the line under the name only promises a text that has a follow_ups row
  }

  /* ---------- routing ---------- */

  function route() {
    var r = L.parseRoute(location.hash, TAB_ROUTES);
    if (!S.signedIn) {
      if (r.name === 'lead') store('set', TARGET_KEY, r.id);
      showSignin();
      return;
    }
    if (ACCESS.state !== 'ready') { renderAccess(); return; }   // nothing is drawn until cv_my_role has answered
    var target = store('get', TARGET_KEY);
    if (target) {
      store('del', TARGET_KEY);
      if (r.name === 'list' && L.isUuid(target)) { location.replace('#/lead/' + target); return; }
    }
    trackNav(r.name);
    if (r.name === 'lead') {
      // Coming back from the calculator to the lead it was opened from: Back on the lead goes where it went before (not to the calculator's More tab).
      var from = S.screen === 'quote' ? S.quote.backTo : null;
      if (from && from.id === r.id && from.tab) S.tab = from.tab;
      showThread(r.id);
      return;
    }
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

  /* ---------- who is signed in (cv_my_role) ----------
     Right after sign-in, before anything else loads. Owner: the page exactly as before. Staff: the staff API map, fewer tabs, no
     Realtime (the 30-second refresh and the wake-up catch-up do the work), each switch from cv_my_role honoured.
     'none' = "Your access was removed". A failed call = a retry screen. Anything else (no answer, an unknown role) = a retry
     screen too: the page never opens on a guess. */

  function renderAccess() {
    var st = ACCESS.state;
    setScreen('role');
    if (st === 'removed') {
      el.roleTitle.textContent = 'Your access was removed';
      setText(el.roleText, 'This number no longer has access to these leads. If that is a mistake, ask the owner to add you again.');
    } else if (st === 'error') {
      el.roleTitle.textContent = "Couldn't check your access";
      setText(el.roleText, ACCESS.errorText || "We couldn't check your access just now. Try again in a moment.");
    } else {
      el.roleTitle.textContent = 'Checking your access';
      setText(el.roleText, 'One moment…');
    }
    show(el.roleRetry, st === 'error');
    show(el.roleSignout, st === 'removed' || st === 'error');
  }

  // Nothing of a lead stays in memory or in the page once access is gone.
  function clearLeadData() {
    clearTimeout(S.refreshTimer);
    S.seq.list++; S.seq.thread++; S.seq.followups++;
    S.leads = []; S.listLoaded = false; S.listError = '';
    S.thread = emptyThread(); S.followUps = null; S.followUpsError = '';
    clearSearch();
    el.leadList.replaceChildren(); el.threadBox.replaceChildren(); el.notesList.replaceChildren(); el.fuBody.replaceChildren();
    el.calBody.replaceChildren(); el.calDayList.replaceChildren(); el.searchResults.replaceChildren();
    el.calAgendaWeek.replaceChildren(); el.calAgendaLater.replaceChildren(); el.metricsBody.replaceChildren();
    el.eventFacts.replaceChildren(); el.recEmail.replaceChildren(); S.eventMoreFor = null; el.quoteBody.replaceChildren(); el.othersList.replaceChildren(); el.sharedList.replaceChildren(); el.history.replaceChildren();
    el.recPhone.removeAttribute('href'); el.contactActions.replaceChildren();
    ['recName', 'recNext', 'recJob', 'recSource', 'recNoauto', 'recPhone', 'recEmail', 'eventDetails', 'confirmText', 'confirmNote', 'stripNote', 'actionErr', 'noteErr', 'contactNote']
      .forEach(function (k) { if (el[k]) el[k].textContent = ''; });
    el.noteText.value = ''; syncNoteSave();
    closeConfirm();
    renderBadge(); renderNeeds([]);
  }

  function checkAccess() {
    var n = ++ACCESS.seq;
    ACCESS.lastCheck = Date.now();
    ACCESS.state = 'checking'; ACCESS.errorText = '';
    renderAccess();
    var base = S.base || S.api;
    Promise.resolve().then(function () {
      if (!base || typeof base.myRole !== 'function') throw { status: 500, message: 'no_role_call' };
      return Promise.race([base.myRole(), new Promise(function (_, rej) { setTimeout(function () { rej({ status: 0, message: 'timeout' }); }, 12000); })]);
    }).then(function (res) {
      if (n !== ACCESS.seq || !S.signedIn) return;
      var v = L.roleView(res);
      if (v.state === 'none') { ACCESS.state = 'removed'; clearLeadData(); renderAccess(); return; }
      if (v.state === 'bad') { ACCESS.state = 'error'; ACCESS.errorText = "We couldn't confirm your access. Try again, or sign out."; renderAccess(); return; }
      enterApp(v);
    }, function (e) {
      if (n !== ACCESS.seq || !S.signedIn) return;
      ACCESS.state = 'error'; ACCESS.errorText = L.roleError(e).text;
      renderAccess();
    });
  }

  function enterApp(v) {
    ACCESS.role = v.state; ACCESS.perms = v.perms; ACCESS.state = 'ready';
    S.api = v.state === 'staff' ? trackApi(S.base.staffMap()) : S.base;
    computeNav();
    buildTabbar();
    show(el.searchWrap, HAS_SEARCH);
    S.tab = NAV[0];
    if (v.state === 'staff') setLive('off');   // no Realtime for staff: the server delivers them nothing
    else startLive();
    loadBrand();
    loadPush();
    loadSupportConfig();
    route();
  }

  function beginSession() {
    S.signedIn = true;
    checkAccess();
  }

  function onSignedIn() {
    if (S.signedIn) return;
    beginSession();
  }

  function doSignOut() {
    // This phone stops getting alerts first (while the session can still authorise the call). Soft-fail, 3 s cap, never blocks sign-out.
    Promise.race([dropPushSubscription(), new Promise(function (res) { setTimeout(res, 3000); })])
      .catch(function () { /* sign out anyway */ })
      .then(function () { return S.api.signOut(); }).catch(function () { /* local sign-out below still runs */ }).then(function () {
      if (S.signedIn) onSignedOut();
    });
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
    // Back to the first-screen state: the owner's API map and tabs, nothing asked yet (the next sign-in asks again).
    ACCESS.seq++; ACCESS.role = ''; ACCESS.perms = {}; ACCESS.state = 'idle'; ACCESS.errorText = '';
    if (S.base) S.api = S.base;
    computeNav(); buildTabbar();
    show(el.searchWrap, HAS_SEARCH);
    show(el.alerts, false);
    // Session ended (expiry, other tab): drop this phone's browser subscription locally. The server call may no longer be authorised;
    // a leftover server row is removed on the push service's next 404/410.
    if (P.sub) { try { Promise.resolve(P.sub.unsubscribe()).catch(function () { /* ignore */ }); } catch (e) { /* ignore */ } }
    P.seq++; P.cfg = null; P.sub = null; P.busy = false; P.open = false; pushMsg(''); renderPush();
    clearStoredTargets();
    resetSupport();
    resetExport();
    resetAsk();
    resetTeam();
    stopLive();
    clearTimeout(S.refreshTimer);
    S.seq.list++; S.seq.thread++;
    S.leads = []; S.listLoaded = false; S.listError = '';
    S.thread = emptyThread();
    S.filter = 'open'; S.pending = null; S.tab = NAV[0];
    S.seq.metrics++; S.seq.forecast++; S.seq.pastEvents++; S.pastEvents = null; S.pastBusy = ''; S.pastErr = ''; S.pastScroll = false; S.forecast = null; S.metrics = null; S.metricsError = '';
    S.seq.followups++; S.followUps = null; S.followUpsError = '';
    clearSearch();
    clearQuote();
    S.cal = null; S.showPossible = false;
    clearLeadData();
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
    if (isStaff()) { show(el.alerts, false); return; }   // alerts and the owner's text list are owner-only
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
    window.addEventListener('popstate', onPopState);
    // A reload while the full view was open lands on its history entry with the view closed: step off it (same rule as onPopState), so Back is not a dead step.
    try { if (L.fullPopAction(false, history.state) === 'step') history.back(); } catch (e) { /* ignore */ }
    el.convoOpen.addEventListener('click', openFull);
    el.convoFullClose.addEventListener('click', requestCloseFull);
    el.convoFull.addEventListener('cancel', function (e) { e.preventDefault(); requestCloseFull(); });
    el.fullSysFold.addEventListener('click', toggleFold);

    // Back: from a lead record to the tab it was opened from; from a tool under More to More.
    el.back.addEventListener('click', function () {
      if (S.screen === 'quote' && S.quote.backTo) { location.hash = '#/lead/' + encodeURIComponent(S.quote.backTo.id); return; }
      location.hash = S.screen === 'thread' ? S.tab.href : navFor('more').href;
    });

    el.alertsSum.addEventListener('click', function () { P.open = !P.open; renderPush(); });
    el.alertsOn.addEventListener('click', onAlertsOn);
    el.alertsTest.addEventListener('click', onAlertsTest);
    el.alertsOff.addEventListener('click', onAlertsOff);

    el.signout.addEventListener('click', doSignOut);
    el.roleSignout.addEventListener('click', doSignOut);
    el.roleRetry.addEventListener('click', checkAccess);

    // Status actions
    el.confirmYes.addEventListener('click', confirmYes);
    el.confirmAlt.addEventListener('click', confirmNoFollowup);
    el.price.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); confirmYes(); } });
    el.price.addEventListener('input', function () { el.price.removeAttribute('aria-invalid'); setText(el.confirmErr, ''); });

    // Add a lead (Leads)
    el.btnAdd.addEventListener('click', openAdd);
    el.addForm.addEventListener('submit', function (e) { e.preventDefault(); submitAdd(); });
    el.addCancel.addEventListener('click', closeAdd);
    el.addDlg.addEventListener('click', function (e) { if (e.target === el.addDlg && !S.addBusy) closeAdd(); });
    el.addDlg.addEventListener('cancel', function (e) { if (S.addBusy) e.preventDefault(); });
    el.addPhone.addEventListener('blur', renderAddDup);
    el.addName.addEventListener('blur', function () { if (!el.addDup.hidden) renderAddDup(); });   // 024: the hint depends on the typed first name
    el.addPhone.addEventListener('input', function () { setAddError('phone', ''); });
    el.addDate.addEventListener('change', function () { renderAddDup(); setAddError('event_date', ''); });
    ['addName', 'addGuests', 'addArea', 'addOccasion', 'addEmail'].forEach(function (k) {
      var f = k === 'addName' ? 'name' : k === 'addGuests' ? 'guests' : k === 'addArea' ? 'area' : k === 'addOccasion' ? 'occasion' : 'email';
      el[k].addEventListener('input', function () { setAddError(f, ''); });
    });
    el.qAdd.addEventListener('click', addQuoteToLead);
    el.mqSend.addEventListener('click', function () { startQuoteSend(false); });
    el.mqResend.addEventListener('click', function () { startQuoteSend(true); });
    el.priceLink.addEventListener('click', function () {
      var lead = S.thread.lead;
      S.quotePrefill = lead ? Object.assign(L.quotePrefill(lead), {
        fromLead: L.canAddQuoteToLead(lead) ? { id: lead.lead_id, name: leadName(lead), savedTotal: lead.owner_quote ? L.fmtMoney(lead.owner_quote.total) : '',
          maybeSent: !!lead.owner_quote && (lead.owner_quote.state === 'unknown' || lead.owner_quote.earlier_maybe_sent === true) } : null,
        backTo: { id: lead.lead_id, name: leadName(lead), tab: S.tab }
      }) : null;
    });

    // Search (Leads)
    el.search.addEventListener('input', onSearchInput);
    el.search.addEventListener('keydown', function (e) { if (e.key === 'Escape' && el.search.value) { e.preventDefault(); clearSearch(); } });

    // Quote calculator
    el.qForm.addEventListener('submit', function (e) { e.preventDefault(); submitQuote(); });
    el.qForm.addEventListener('input', qFormEdited);
    el.qForm.addEventListener('change', qFormEdited);
    el.qPromoPick.addEventListener('change', qPromoHint);
    Array.prototype.forEach.call(el.qForm.querySelectorAll('input[name="q-type"]'), function (r) { r.addEventListener('change', qTypeChanged); });
    el.qCopy.addEventListener('click', copyQuote);
    el.qNew.addEventListener('click', newQuote);

    // Download spreadsheet
    el.askForm.addEventListener('submit', function (e) { e.preventDefault(); submitAsk(); });
    el.askInput.addEventListener('input', function () { renderAskCount(); sizeAskInput(); });
    el.askInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submitAsk(); }
    });
    el.exMake.addEventListener('click', makeExport);
    el.exSave.addEventListener('click', saveExport);
    el.exFrom.addEventListener('input', exportChoiceChanged);
    el.exTo.addEventListener('input', exportChoiceChanged);
    el.exFrom.addEventListener('change', exportChoiceChanged);
    el.exTo.addEventListener('change', exportChoiceChanged);

    // Team
    el.tmForm.addEventListener('submit', function (e) { e.preventDefault(); submitTeamAdd(); });
    el.tmName.addEventListener('input', function () { setText(el.tmErrName, ''); el.tmName.removeAttribute('aria-invalid'); });
    el.tmPhone.addEventListener('input', function () { setText(el.tmErrPhone, ''); el.tmPhone.removeAttribute('aria-invalid'); });
    el.tmCopy.addEventListener('click', copyTeamLink);
    el.tmReload.addEventListener('click', function () { refreshTeam(); });
    el.teamConfirmNo.addEventListener('click', closeTeamConfirm);
    el.teamConfirmYes.addEventListener('click', function () {
      var phone = S.team.confirmPhone, name = S.team.confirmName;
      el.teamConfirmYes.disabled = true;   // one tap only
      closeTeamConfirm();
      if (phone) runTeamRemoval('remove', phone, name);
    });
    // Help & support
    el.spForm.addEventListener('submit', function (e) { e.preventDefault(); submitSupport(); });
    el.spMessage.addEventListener('input', function () { renderSupportCount(); el.spMessage.removeAttribute('aria-invalid'); setText(el.spError, ''); });
    el.spInclude.addEventListener('change', renderSupportDisclose);
    el.spLeadRemove.addEventListener('click', function () {
      S.support.removeLead = true; el.spInclude.checked = false; renderSupport(); el.spMessage.focus();
    });

    // Notes
    el.noteSave.addEventListener('click', saveNote);
    el.noteText.addEventListener('input', function () { noteCount(); setText(el.noteErr, ''); });
    el.sysFold.addEventListener('click', toggleFold);
    el.eventMoreBtn.addEventListener('click', toggleEventMore);

    // Calendar
    el.calPrev.addEventListener('click', function () { moveMonth(-1); });
    el.calNext.addEventListener('click', function () { moveMonth(1); });
    el.calPossible.addEventListener('change', function () {
      S.showPossible = el.calPossible.checked;
      store('set', POSSIBLE_KEY, S.showPossible ? '1' : '0');
      renderCalendar();
    });
    el.confirmNo.addEventListener('click', dismissConfirm);
    el.confirm.addEventListener('close', onConfirmClosed);
    el.confirm.addEventListener('cancel', function (e) { if (leaveSheetOpen() && S.quote.adding) e.preventDefault(); });
    // Tap on the dimmed backdrop (the dialog box itself, outside the sheet body) cancels.
    el.confirm.addEventListener('click', function (e) { if (e.target === el.confirm) dismissConfirm(); });
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
      if (document.visibilityState === 'visible' && S.signedIn && ACCESS.state === 'error') { checkAccess(); return; }
      if (document.visibilityState === 'visible' && S.signedIn) { scheduleRefresh(0); if (S.screen === 'support') refreshSupportList(); }
    });
    window.addEventListener('online', function () { if (S.signedIn && ACCESS.state === 'error') checkAccess(); else if (S.signedIn) scheduleRefresh(0); });

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
    // Help: the list of requests refreshes every 60 s while that screen is open (nothing runs on other screens).
    setInterval(function () {
      if (S.signedIn && document.visibilityState === 'visible' && S.screen === 'support') refreshSupportList();
    }, SUPPORT_REFRESH_MS);
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
    buildSupportKinds();
    buildExportGroups();
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
      S.api = S.base = trackApi(api);
      api.onAuth(function (ev) { setTimeout(function () { handleAuthEvent(ev); }, 0); });
      return api.getSession();
    }).then(function (session) {
      if (session) onSignedIn();
      else route();
      if (MOCK && !session && qs.get('screen') === 'code') showCodeStep('+14165550123');
    }).catch(function () {
      showSignin();
      setText(el.phoneErr, "Couldn't start the page. Reload and try again.");
    });
  }

  start();
})();
