/* Pure helpers for the conversation page. No DOM, no network: unit-tested in
   tools/tests/test_lib.js (node) and loaded by the browser as window.CVLib. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CVLib = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TZ = 'America/Toronto'; // default; configure({ timeZone }) can change it
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  /* ---------- phone ---------- */

  // Canadian default. Returns '+1XXXXXXXXXX' (or another +E.164) or null.
  function normalizePhone(input) {
    if (typeof input !== 'string') return null;
    var s = input.trim();
    if (!s) return null;
    var hasPlus = s.charAt(0) === '+';
    var digits = s.replace(/\D/g, '');
    if (hasPlus) {
      if (digits.length < 8 || digits.length > 15) return null;
      if (digits.charAt(0) === '0') return null;
      if (digits.charAt(0) === '1' && !validNanp(digits.slice(1))) return null;
      return '+' + digits;
    }
    if (digits.length === 11 && digits.charAt(0) === '1') digits = digits.slice(1);
    if (digits.length !== 10) return null;
    if (!validNanp(digits)) return null;
    return '+1' + digits;
  }

  // NANP: area code and exchange both start 2-9.
  function validNanp(ten) {
    return /^[2-9]\d{2}[2-9]\d{6}$/.test(ten);
  }

  function maskPhone(p) {
    var d = String(p || '').replace(/\D/g, '');
    return d.length >= 4 ? '***' + d.slice(-4) : '***';
  }

  /* ---------- time (America/Toronto) ---------- */

  var fmtParts = null;
  var fmtKey = null;
  function partsOf(d) {
    if (!fmtParts) {
      fmtParts = new Intl.DateTimeFormat('en-US', {
        timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true
      });
    }
    var o = {};
    fmtParts.formatToParts(d).forEach(function (p) { o[p.type] = p.value; });
    return {
      y: Number(o.year), m: Number(o.month), d: Number(o.day),
      hour: o.hour, minute: o.minute, period: String(o.dayPeriod || '').toLowerCase().replace(/\./g, '')
    };
  }

  function toDate(v) {
    var d = v instanceof Date ? v : new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  function nowDate(now) { return toDate(now === undefined ? new Date() : now) || new Date(); }

  function dayKey(p) {
    return p.y * 10000 + p.m * 100 + p.d;
  }

  // "Nov 4, 3:12 pm" (adds the year when it is not the current year)
  function fmtStamp(iso, now) {
    var d = toDate(iso);
    if (!d) return '';
    var p = partsOf(d), n = partsOf(nowDate(now));
    var date = MONTHS[p.m - 1] + ' ' + p.d + (p.y !== n.y ? ', ' + p.y : '');
    return date + ', ' + p.hour + ':' + p.minute + ' ' + p.period;
  }

  // Day separator: "Today", "Yesterday", "Wed, Nov 4"
  function fmtDay(iso, now) {
    var d = toDate(iso);
    if (!d) return '';
    var p = partsOf(d), n = partsOf(nowDate(now));
    if (dayKey(p) === dayKey(n)) return 'Today';
    var y = new Date(Date.UTC(n.y, n.m - 1, n.d) - 86400000);
    var yk = y.getUTCFullYear() * 10000 + (y.getUTCMonth() + 1) * 100 + y.getUTCDate();
    if (dayKey(p) === yk) return 'Yesterday';
    var wd = WEEKDAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()];
    return wd + ', ' + MONTHS[p.m - 1] + ' ' + p.d + (p.y !== n.y ? ', ' + p.y : '');
  }

  function sameDay(isoA, isoB) {
    var a = toDate(isoA), b = toDate(isoB);
    if (!a || !b) return false;
    return dayKey(partsOf(a)) === dayKey(partsOf(b));
  }

  // "just now", "2 min ago", "3 h ago", then "Nov 3"
  function fmtAgo(iso, now) {
    var d = toDate(iso);
    if (!d) return '';
    var n = nowDate(now);
    var s = (n.getTime() - d.getTime()) / 1000;
    if (s < 45) return 'just now';
    var min = Math.round(s / 60);
    if (min < 60) return (min < 1 ? 1 : min) + ' min ago';
    var h = Math.floor(s / 3600);
    if (h < 24) return h + ' h ago';
    var p = partsOf(d), np = partsOf(n);
    return MONTHS[p.m - 1] + ' ' + p.d + (p.y !== np.y ? ', ' + p.y : '');
  }

  // 'YYYY-MM-DD' -> "Sat, Nov 14". Parsed by hand so no timezone shift can move the day.
  function fmtEventDate(ymd, now) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
    if (!m) return '';
    var y = Number(m[1]), mo = Number(m[2]), da = Number(m[3]);
    if (mo < 1 || mo > 12) return '';
    var wd = WEEKDAYS[new Date(Date.UTC(y, mo - 1, da)).getUTCDay()];
    var n = partsOf(nowDate(now));
    return wd + ', ' + MONTHS[mo - 1] + ' ' + da + (y !== n.y ? ', ' + y : '');
  }

  /* ---------- per-client settings ----------
     configure(window.CV_CUSTOM) applies the client's wording, money format and time zone.
     Anything left out keeps the default. Called once by app.js before the first render. */

  var CUSTOM = { status: {}, tiers: {}, locale: 'en-CA', currency: 'CAD' };

  function plainMap(o) {
    var out = {};
    if (o && typeof o === 'object') {
      Object.keys(o).forEach(function (k) {
        var v = o[k];
        if (typeof v === 'string' && v.trim()) out[String(k).toLowerCase()] = v.trim();
      });
    }
    return out;
  }

  function configure(c) {
    c = c || {};
    CUSTOM.status = plainMap(c.statusLabels);
    CUSTOM.tiers = plainMap(c.tierLabels);
    CUSTOM.locale = typeof c.locale === 'string' && c.locale ? c.locale : 'en-CA';
    CUSTOM.currency = typeof c.currency === 'string' && /^[A-Za-z]{3}$/.test(c.currency) ? c.currency.toUpperCase() : 'CAD';
    var tz = typeof c.timeZone === 'string' && c.timeZone ? c.timeZone : 'America/Toronto';
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch (e) { tz = 'America/Toronto'; }
    TZ = tz;
    fmtParts = null; fmtWhole = null; fmtCents = null;
    return { locale: CUSTOM.locale, currency: CUSTOM.currency, timeZone: TZ };
  }

  /* ---------- theme (CV_CUSTOM.theme -> CSS variables) ----------
     Only plain hex colours are accepted (#rgb or #rrggbb), so a config typo can never inject CSS.
     Unknown keys are ignored. Returns [cssVariable, value] pairs for app.js to set on <html>. */
  var THEME_VARS = {
    primary: '--primary', secondary: '--secondary', accent: '--accent',
    primaryDeep: '--primary-deep', primaryRaised: '--primary-raised', lineOnPrimary: '--line-on-primary',
    onPrimary: '--on-primary', mutedOnPrimary: '--muted-on-primary',
    secondaryDeep: '--secondary-deep', onSecondary: '--on-secondary', mutedOnSecondary: '--muted-on-secondary',
    accentStrong: '--accent-strong', accentLight: '--accent-light', accentTint: '--accent-tint',
    accentInk: '--accent-ink', accentWash: '--accent-wash', onAccent: '--on-accent',
    dangerOnPrimary: '--danger-on-primary', dangerOnSecondary: '--danger-on-secondary'
  };
  var HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

  function themeVars(theme) {
    var out = [];
    if (!theme || typeof theme !== 'object') return out;
    Object.keys(THEME_VARS).forEach(function (k) {
      var v = theme[k];
      if (typeof v === 'string' && HEX_RE.test(v.trim())) out.push([THEME_VARS[k], v.trim().toLowerCase()]);
    });
    return out;
  }

  /* ---------- labels ---------- */

  var KIND_LABELS = {
    lead_text: '',
    quote: 'Quote',
    ai_reply: 'AI reply',
    re_engage: 'Re-engage reply',
    handoff_ack: 'Handoff reply',
    optout_confirm: 'Opt-out confirm',
    holding_reply: 'Holding reply',
    followup_nudge: 'Day-5 nudge',
    owner_alert: 'Owner alert',
    owner_alert_held: 'Owner alert (held 9am)',
    owner_confirm: 'Owner confirm',
    owner_digest: 'Daily digest',
    backfill: 'Sent earlier'
  };

  function kindLabel(kind) {
    if (Object.prototype.hasOwnProperty.call(KIND_LABELS, kind)) return KIND_LABELS[kind];
    return kind ? String(kind).replace(/_/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); }) : '';
  }

  var STATUS = {
    'new': ['New', 'new'],
    engaged: ['Talking', 'active'],
    quoted: ['Quoted', 'active'],
    handed_off: ['Needs you', 'new'],
    contacted: ['Contacted', 'active'],
    booked: ['Booked', 'booked'],
    lost: ['Lost', 'lost'],
    opted_out: ['Opted out', 'optout']
  };

  function statusInfo(status) {
    var k = String(status || '').toLowerCase();
    if (STATUS[k]) return { label: CUSTOM.status[k] || STATUS[k][0], tone: STATUS[k][1] };
    if (CUSTOM.status[k]) return { label: CUSTOM.status[k], tone: 'neutral' };
    if (!k) return { label: 'No status', tone: 'neutral' };
    return { label: k.replace(/_/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); }), tone: 'neutral' };
  }

  /* ---------- auth errors ---------- */

  function friendlyAuthError(err, stage) {
    var msg = String((err && err.message) || '').toLowerCase();
    var code = String((err && (err.code || err.error_code)) || '').toLowerCase();
    var status = err && err.status;
    if (code === 'otp_disabled' || code === 'user_not_found' || /signups? not allowed|user not found/.test(msg)) {
      return "This number isn't set up for this page.";
    }
    if (status === 429 || code.indexOf('rate_limit') !== -1 || /rate limit|too many|security purposes|after \d+ seconds?/.test(msg)) {
      return 'Too many tries. Wait a minute, then try again.';
    }
    if (/failed to fetch|network|load failed/.test(msg)) {
      return "Can't reach the server. Check your connection and try again.";
    }
    if (stage === 'send') {
      if (code === 'sms_send_failed' || /sms|twilio/.test(msg)) return "We couldn't send the text. Check the number and try again.";
      if (code === 'validation_failed' || /invalid/.test(msg)) return "That doesn't look like a valid phone number.";
    }
    if (stage === 'verify' && (code === 'otp_expired' || /expired|invalid|token/.test(msg))) {
      return "That code didn't work. Check the text and try again, or ask for a new code.";
    }
    return 'Something went wrong. Try again in a moment.';
  }

  /* ---------- lead status: groups, filters, actions ---------- */

  // Which bucket a status belongs to. Anything unknown counts as still open.
  var STATUS_GROUP = {
    'new': 'open', engaged: 'open', quoted: 'open', handed_off: 'open', contacted: 'open',
    booked: 'booked', won: 'booked',
    lost: 'lost', opted_out: 'lost', dormant: 'lost'
  };

  function statusGroup(status) {
    var k = String(status || '').toLowerCase();
    return STATUS_GROUP[k] || 'open';
  }

  function isClosed(status) { return statusGroup(status) !== 'open'; }

  // List filter chips, in display order. 'Needs you' = the bot handed the lead to the owner.
  // The needs / booked / lost chips reuse the status labels, so a client's wording carries through.
  var FILTER_KEYS = ['all', 'needs', 'open', 'booked', 'lost'];
  function filters() {
    return [
      { key: 'all', label: 'All' },
      { key: 'needs', label: statusInfo('handed_off').label },
      { key: 'open', label: 'Open' },
      { key: 'booked', label: statusInfo('booked').label },
      { key: 'lost', label: statusInfo('lost').label }
    ];
  }

  function isFilterKey(key) {
    return FILTER_KEYS.indexOf(key) !== -1;
  }

  function matchesFilter(lead, key) {
    var st = String((lead && lead.status) || '').toLowerCase();
    if (key === 'needs') return st === 'handed_off';
    if (key === 'open' || key === 'booked' || key === 'lost') return statusGroup(st) === key;
    return true;
  }

  function filterLeads(leads, key) {
    return (Array.isArray(leads) ? leads : []).filter(function (l) { return matchesFilter(l, key); });
  }

  function filterCounts(leads) {
    var out = {};
    FILTER_KEYS.forEach(function (k) { out[k] = filterLeads(leads, k).length; });
    return out;
  }

  // The three statuses the owner can set from the page (same as his DONE / BOOKED / LOST texts).
  var ACTION_STATUSES = ['contacted', 'booked', 'lost'];
  function actions() {
    return ACTION_STATUSES.map(function (st) {
      var label = statusInfo(st).label;
      return { status: st, label: label, confirm: 'Mark as ' + label.toLowerCase() };
    });
  }

  // Plain-words question for the confirm sheet.
  function confirmText(name, status) {
    var who = String(name || '').trim() || 'this lead';
    if (ACTION_STATUSES.indexOf(status) === -1) return '';
    var lc = function (st) { return statusInfo(st).label.toLowerCase(); };
    var q = 'Mark ' + who + ' as ' + lc(status) + '?';
    if (status === 'contacted') return q + " They'll get one follow-up text in 5 days unless you mark them " + lc('booked') + ' or ' + lc('lost') + '.';
    return q + " They won't get the day-5 follow-up text.";
  }

  // Can the page offer this change? Mirrors cv_set_lead_status (same rules as the owner's texts):
  // the current status again is a no-op; won / dormant / opted-out leads are locked; a booked or lost
  // lead cannot go back to contacted. Anything else is left to the server to decide.
  var LOCKED = { won: 1, dormant: 1, opted_out: 1 };
  function canSetStatus(current, target) {
    var c = String(current || '').toLowerCase();
    if (!target || c === target) return false;
    if (LOCKED[c]) return false;
    if (target === 'contacted' && (c === 'booked' || c === 'lost')) return false;
    return true;
  }

  // One plain line under the buttons when the page can't change this lead at all.
  function actionsNote(current) {
    var c = String(current || '').toLowerCase();
    if (c === 'opted_out') return 'This lead opted out of texts, so their status is locked.';
    if (c === 'won' || c === 'dormant') return 'This lead is closed, so its status is locked.';
    return '';
  }

  // Postgres exceptions raised by cv_set_lead_status -> plain words.
  // The code is in error.message; for not_allowed the reason is in error.details.
  var NOT_ALLOWED = {
    opted_out: 'This lead opted out of texts, so the page cannot change their status.',
    already_booked: "This lead is already booked, so it can't go back to contacted.",
    already_lost: "This lead is already marked lost, so it can't go back to contacted.",
    closed: "This lead is closed, so its status can't be changed here.",
    not_with_owner: "The assistant is still handling this lead. You can mark it once it's been handed to you."
  };

  function friendlyStatusError(err) {
    var raw = String((err && err.message) || (typeof err === 'string' ? err : '')).trim();
    var msg = raw.toLowerCase();
    var m = /\b(not_owner|bad_status|not_found|not_allowed)\b\s*(?::\s*([^\n]*))?/.exec(msg);
    if (m) {
      if (m[1] === 'not_owner') return "Your sign-in isn't linked to this lead's business. Sign out, then sign in with your own number.";
      if (m[1] === 'bad_status') return "The page sent a status the system doesn't accept. Reload the page and try again.";
      if (m[1] === 'not_found') return "This lead can't be found any more. Go back to your list.";
      var reason = String(m[2] || (err && err.details) || '').trim().toLowerCase().replace(/[.\s]+$/, '');
      var key = reason.replace(/[\s-]+/g, '_');
      if (NOT_ALLOWED[key]) return NOT_ALLOWED[key];
      return reason ? "This change isn't allowed for this lead (" + reason.replace(/_/g, ' ') + ').' : "This change isn't allowed for this lead.";
    }
    var status = err && err.status;
    if (status === 401 || (err && err.code === 'PGRST301') || /jwt/.test(msg)) return 'Your session ran out. Sign out and sign in again.';
    if (/failed to fetch|network|load failed/.test(msg)) return "Can't reach the server. Check your connection and try again.";
    return "Couldn't save that. Try again in a moment.";
  }

  /* ---------- history ---------- */

  var HISTORY_ACTIONS = {
    'new': 'New lead', engaged: 'Started texting', quoted: 'Quoted', handed_off: 'Handed to you',
    contacted: 'Contacted', booked: 'Booked', lost: 'Lost', opted_out: 'Opted out', reopened: 'Reopened'
  };
  var HISTORY_SOURCES = {
    page: 'from the page', sms: 'by text', text: 'by text', owner_sms: 'by text',
    system: 'automatic', auto: 'automatic', workflow: 'automatic', bot: 'automatic'
  };

  function historyLine(h, now) {
    if (!h) return '';
    var a = String(h.action || '').toLowerCase();
    var label = CUSTOM.status[a] || HISTORY_ACTIONS[a] || statusInfo(a).label;
    var s = String(h.source || '').toLowerCase();
    var src = HISTORY_SOURCES[s] || (s ? s.replace(/_/g, ' ') : '');
    return [label, fmtStamp(h.at, now), src].filter(Boolean).join(' \u00b7 ');
  }

  function sortHistory(rows) {
    return (Array.isArray(rows) ? rows : []).filter(Boolean).slice().sort(function (a, b) {
      return new Date(b.at).getTime() - new Date(a.at).getTime();
    });
  }

  /* ---------- money + value tiers ---------- */

  // Cents as an integer, or null when there is no usable amount.
  function toCents(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
    return isFinite(n) ? Math.round(n * 100) : null;
  }

  var fmtWhole = null, fmtCents = null;
  // Dollars in the client's locale (default en-CA / CAD): "$1,250", "$1,250.50". Empty string for no amount.
  function fmtMoney(v) {
    var c = toCents(v);
    if (c === null) return '';
    if (!fmtWhole) {
      var base = { style: 'currency', currency: CUSTOM.currency, currencyDisplay: 'narrowSymbol' };
      try { new Intl.NumberFormat(CUSTOM.locale, base); } catch (e) { CUSTOM.locale = 'en-CA'; }
      fmtWhole = new Intl.NumberFormat(CUSTOM.locale, Object.assign({ minimumFractionDigits: 0, maximumFractionDigits: 0 }, base));
      fmtCents = new Intl.NumberFormat(CUSTOM.locale, Object.assign({ minimumFractionDigits: 2, maximumFractionDigits: 2 }, base));
    }
    return (c % 100 === 0 ? fmtWhole : fmtCents).format(c / 100);
  }

  var TIERS = [
    { key: 'high', label: 'High value' },
    { key: 'medium', label: 'Medium' },
    { key: 'low', label: 'Low' },
    { key: 'none', label: 'No quote yet' }
  ];

  function tierOf(lead) {
    var k = String((lead && lead.value_tier) || '').toLowerCase();
    return TIERS.some(function (t) { return t.key === k; }) ? k : 'none';
  }

  // Sections for the Lead value tab. Totals and counts cover OPEN leads only;
  // closed (booked / lost) leads are listed muted after the open ones when showClosed is on.
  function groupByTier(leads, opts) {
    var showClosed = !!(opts && opts.showClosed);
    var sections = TIERS.map(function (t) {
      return { key: t.key, label: CUSTOM.tiers[t.key] || t.label, open: [], closed: [], count: 0, closedCount: 0, totalCents: 0 };
    });
    var byKey = {};
    sections.forEach(function (s) { byKey[s.key] = s; });
    (Array.isArray(leads) ? leads : []).forEach(function (l) {
      if (!l) return;
      var s = byKey[tierOf(l)];
      if (isClosed(l.status)) { s.closed.push(l); s.closedCount++; return; }
      s.open.push(l);
      s.count++;
      s.totalCents += toCents(l.quote_total) || 0;
    });
    function byQuote(a, b) {
      var d = (toCents(b.quote_total) || 0) - (toCents(a.quote_total) || 0);
      if (d) return d;
      return String(a.event_date || '9999').localeCompare(String(b.event_date || '9999'));
    }
    sections.forEach(function (s) {
      s.open.sort(byQuote);
      s.closed.sort(byQuote);
      s.leads = showClosed ? s.open.concat(s.closed) : s.open.slice();
      s.total = s.totalCents / 100;
    });
    return sections;
  }

  /* ---------- lead record (view lead_detail) ---------- */

  // Display-only Title Case. Words already in mixed case are trusted as typed (McDonald, DeSouza);
  // all-lower / all-caps words are fixed: capital after start, hyphen and apostrophe, plus "Mc".
  function capWord(seg) {
    if (!seg) return seg;
    var s = seg.charAt(0).toUpperCase() + seg.slice(1);
    var mc = /^Mc([a-zà-ÿ])(.+)$/.exec(s);
    if (mc && s.length > 3) s = 'Mc' + mc[1].toUpperCase() + mc[2];
    return s;
  }

  function titleCase(name) {
    var s = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
    if (!s) return '';
    return s.split(' ').map(function (w) {
      var lower = w.toLowerCase(), upper = w.toUpperCase();
      if (w !== lower && w !== upper) return w;
      return lower.split(/([-'’])/).map(function (seg, i) { return i % 2 ? seg : capWord(seg); }).join('');
    }).join(' ');
  }

  // Name to show for a lead row or record. The fallback label "Lead ending 1234" is left alone.
  function displayName(lead) {
    if (!lead) return 'Unnamed lead';
    var full = String(lead.full_name || '').trim();
    if (full) return titleCase(full);
    var d = String(lead.display_name || '').trim();
    if (!d) {
      // lead_detail has no display_name: same fallback lead_list uses ("Lead ending 1234").
      var digits = String(lead.phone || '').replace(/\D/g, '');
      return digits.length >= 4 ? 'Lead ending ' + digits.slice(-4) : 'Unnamed lead';
    }
    return /^Lead ending \d{4}$/.test(d) ? d : titleCase(d);
  }

  // "+14165550123" -> "(416) 555-0123"; other countries stay in E.164; junk -> ''.
  function fmtPhoneNational(p) {
    var n = strictE164(p);
    if (!n) return '';
    var m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(n);
    return m ? '(' + m[1] + ') ' + m[2] + '-' + m[3] : n;
  }

  // Only an already-normalised E.164 string is accepted for links (no spaces, no letters, no scheme tricks).
  function strictE164(p) {
    if (typeof p !== 'string') return null;
    var s = p.trim();
    if (!/^\+[1-9]\d{7,14}$/.test(s)) return null;
    return normalizePhone(s);
  }

  function telHref(p) { var n = strictE164(p); return n ? 'tel:' + n : null; }
  function smsHref(p) { var n = strictE164(p); return n ? 'sms:' + n : null; }

  var EMAIL_RE = /^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
  function validEmail(e) {
    if (typeof e !== 'string') return null;
    var s = e.trim();
    return s.length <= 254 && EMAIL_RE.test(s) && !/\.\./.test(s) ? s : null;
  }
  function mailtoHref(e) { var v = validEmail(e); return v ? 'mailto:' + v : null; }

  // Maps search built from the area text only (city-level in practice), encoded.
  function mapsHref(area) {
    if (typeof area !== 'string') return null;
    var s = area.replace(/\s+/g, ' ').trim();
    if (s.length < 2 || s.length > 120 || /[\u0000-\u001f]/.test(s)) return null;
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(s);
  }

  function isOptedOut(lead) {
    return !!lead && (lead.opted_out === true || String(lead.status || '').toLowerCase() === 'opted_out');
  }

  // Call / Text / Email buttons in the client's order. Text is left out for an opted-out lead.
  var CONTACT_DEFAULT = ['call', 'text', 'email'];
  function contactActions(lead, order) {
    var want = Array.isArray(order) && order.length ? order : CONTACT_DEFAULT;
    var out = [];
    want.forEach(function (k) {
      if (out.some(function (a) { return a.key === k; })) return;
      var href = null, label = '';
      if (k === 'call') { href = telHref(lead && lead.phone); label = 'Call'; }
      else if (k === 'text') { if (isOptedOut(lead)) return; href = smsHref(lead && lead.phone); label = 'Text'; }
      else if (k === 'email') { href = mailtoHref(lead && lead.email); label = 'Email'; }
      if (href) out.push({ key: k, label: label, href: href });
    });
    return out;
  }

  // "just now", "12 min ago", "3 h ago", "1 day ago", "4 days ago"
  function fmtSince(iso, now) {
    var d = toDate(iso);
    if (!d) return '';
    var s = (nowDate(now).getTime() - d.getTime()) / 1000;
    if (s < 45) return 'just now';
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    var days = Math.floor(s / 86400);
    return days + (days === 1 ? ' day' : ' days') + ' ago';
  }

  // "Nov 9" (with the year when it is not this year), Toronto date.
  function fmtShortDate(iso, now) {
    var d = toDate(iso);
    if (!d) return '';
    var p = partsOf(d), n = partsOf(nowDate(now));
    return MONTHS[p.m - 1] + ' ' + p.d + (p.y !== n.y ? ', ' + p.y : '');
  }

  // '19:00:00' -> '7:00 pm'
  function fmtTime(t) {
    var m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
    if (!m) return '';
    var h = Number(m[1]), mi = m[2];
    if (h > 23 || Number(mi) > 59) return '';
    return (h % 12 === 0 ? 12 : h % 12) + ':' + mi + ' ' + (h < 12 ? 'am' : 'pm');
  }

  function fmtTimeRange(start, end) {
    var a = fmtTime(start), b = fmtTime(end);
    if (a && b) return a + '–' + b;
    return a ? 'from ' + a : b ? 'until ' + b : '';
  }

  var FOLLOWUP_DAYS = 5;

  // One plain line under the name: what is happening and what the owner can do.
  function nextAction(lead, now) {
    if (!lead || isOptedOut(lead)) return '';
    var st = String(lead.status || '').toLowerCase();
    var lc = function (k) { return statusInfo(k).label.toLowerCase(); };
    var markWhen = 'Mark ' + lc('booked') + ' or ' + lc('lost') + ' when you know.';
    if (st === 'booked' || st === 'won') {
      var ev = fmtEventDate(lead.event_date, now);
      return ev ? statusInfo('booked').label + ' for ' + ev : statusInfo('booked').label;
    }
    if (st === 'lost') {
      var la = lead.lost_at || lead.status_at;
      return 'Marked ' + lc('lost') + (la ? ' ' + fmtShortDate(la, now) : '');
    }
    if (st === 'handed_off') {
      var since = lead.status_at || lead.created_at;
      return 'Asked for you' + (since ? ' ' + fmtSince(since, now) : '') + ', not ' + lc('contacted') + ' yet';
    }
    if (st === 'contacted') {
      if (lead.nudge_sent_at) return 'Follow-up text sent ' + fmtShortDate(lead.nudge_sent_at, now) + '. ' + markWhen;
      var c = toDate(lead.contacted_at || lead.status_at);
      if (!c) return statusInfo('contacted').label + '. ' + markWhen;
      var due = new Date(c.getTime() + FOLLOWUP_DAYS * 86400000);
      if (due.getTime() > nowDate(now).getTime()) {
        return 'Follow-up text goes out ' + fmtShortDate(due, now) + ' unless you mark ' + lc('booked') + ' or ' + lc('lost');
      }
      return 'Follow-up text is due now unless you mark ' + lc('booked') + ' or ' + lc('lost');
    }
    if (st === 'quoted') {
      var q = toDate(lead.status_at || lead.last_outbound_at);
      var inb = toDate(lead.last_inbound_at);
      if (inb && (!q || inb.getTime() > q.getTime())) return 'They replied ' + fmtSince(inb, now);
      return q ? 'Quote sent ' + fmtSince(q, now) + ', no reply' : 'Quote sent, no reply yet';
    }
    if (st === 'engaged') {
      return 'Texting with the assistant' + (lead.last_inbound_at ? ', last reply ' + fmtSince(lead.last_inbound_at, now) : '');
    }
    if (st === 'new') return 'New lead' + (lead.created_at ? ' ' + fmtSince(lead.created_at, now) : '');
    return '';
  }

  function humanize(v) {
    var s = String(v == null ? '' : v).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  }

  // quote_defer_reasons may be a text[], a jsonb array of strings/objects, or a single string.
  function deferReasons(v) {
    var arr = Array.isArray(v) ? v : (typeof v === 'string' && v.trim() ? v.split(/\s*[;\n]\s*/) : []);
    return arr.map(function (r) {
      if (r && typeof r === 'object') return humanize(r.reason || r.label || r.text || r.code || '');
      return humanize(r);
    }).filter(Boolean);
  }

  // Quote block: line items + subtotal / travel / total, or the "needs your review" state.
  function quoteView(lead) {
    if (!lead) return null;
    var defer = String(lead.quote_status || '').toLowerCase() === 'defer';
    var items = (Array.isArray(lead.quote_line_items) ? lead.quote_line_items : []).filter(function (it) {
      return it && typeof it === 'object' && (it.label || it.detail || it.amount != null);
    }).map(function (it) {
      return { label: String(it.label || '').trim(), detail: String(it.detail || '').trim(), amount: fmtMoney(it.amount) };
    });
    var view = {
      defer: defer,
      reasons: defer ? deferReasons(lead.quote_defer_reasons) : [],
      items: defer ? [] : items,
      subtotal: defer ? '' : fmtMoney(lead.quote_subtotal),
      travel: defer ? '' : (toCents(lead.quote_travel_fee) === 0 ? 'None' : fmtMoney(lead.quote_travel_fee)),
      total: defer ? '' : fmtMoney(lead.quote_total)
    };
    view.empty = !defer && !view.items.length && !view.total && !view.subtotal;
    return view;
  }

  function promoText(lead) {
    var p = lead && lead.promotion;
    if (typeof p === 'string' && p.trim()) return p.trim();
    if (p && typeof p === 'object' && !Array.isArray(p)) {
      var t = p.title || p.name || p.label || p.headline || p.description;
      if (typeof t === 'string' && t.trim()) return t.trim();
    }
    var code = String((lead && lead.promo_code) || '').trim();
    return code && code.toLowerCase() !== 'none' ? code : '';
  }

  var DISTANCE_CHECK_KM = 500;

  // Event facts in display order; a fact with no value is left out entirely.
  function eventFacts(lead, now) {
    if (!lead) return [];
    var out = [];
    function add(key, label, value, extra) {
      if (value === null || value === undefined || value === '') return;
      var f = { key: key, label: label, value: String(value) };
      if (extra) Object.keys(extra).forEach(function (k) { f[k] = extra[k]; });
      out.push(f);
    }
    add('occasion', 'Occasion', String(lead.occasion || '').trim());
    var date = fmtEventDate(lead.event_date, now);
    var time = fmtTimeRange(lead.start_time, lead.end_time);
    add('date', 'Date', date ? date + (time ? ', ' + time : '') : '');
    add('service', 'Service', String(lead.service_hours_label || '').trim());
    var g = Number(lead.guests);
    if (lead.guests !== null && lead.guests !== undefined && isFinite(g) && g > 0) add('guests', 'Guests', String(g));
    var area = String(lead.event_area || '').replace(/\s+/g, ' ').trim();
    if (area) {
      var km = Number(lead.distance_km);
      var hasKm = lead.distance_km !== null && lead.distance_km !== undefined && lead.distance_km !== '' && isFinite(km);
      var kmText = hasKm ? Math.round(km).toLocaleString('en-CA') + ' km away' : '';
      add('area', 'Area', area, {
        href: mapsHref(area),
        note: kmText,
        flag: hasKm && km > DISTANCE_CHECK_KM ? 'Check address: ' + kmText + ' looks wrong' : ''
      });
    }
    if (typeof lead.bar_rental === 'boolean') add('bar', 'Bar rental', lead.bar_rental ? 'Yes' : 'No');
    if (lead.multiple_events === true) add('multi', 'More than one event', String(lead.multi_event_dates || '').trim() || 'Yes, dates not given');
    add('offer', 'Offer', promoText(lead));
    add('form', 'Form', String(lead.form_name || '').replace(/[\s:]+$/, '').trim());
    return out;
  }

  /* ---------- metrics (cv_metrics) ---------- */

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  // Seconds -> "9 sec", "12 min", "3 h 10 min", "2 days", "2 days 3 h". '' for no value.
  function fmtDuration(seconds) {
    var s = num(seconds);
    if (s === null || s < 0) return '';
    if (s < 59.5) return Math.round(s) + ' sec';
    var m = Math.round(s / 60);
    if (m < 60) return m + ' min';
    var h = Math.floor(m / 60), mm = m % 60;
    if (h < 24) return h + ' h' + (mm ? ' ' + mm + ' min' : '');
    var d = Math.floor(h / 24), hh = h % 24;
    return plural(d, 'day', 'days') + (hh ? ' ' + hh + ' h' : '');
  }

  function fmtWaiting(minutes) {
    var m = num(minutes);
    if (m === null) return '';
    return m < 1 ? 'waiting less than a minute' : 'waiting ' + fmtDuration(m * 60);
  }

  // "6 of 10 finished leads booked (60%)", or an em dash when nothing has finished yet.
  function closeRateText(cr) {
    var b = num(cr && cr.booked) || 0, l = num(cr && cr.lost) || 0;
    var done = b + l;
    if (!done) return '\u2014';
    return b + ' of ' + plural(done, 'finished lead', 'finished leads') + ' booked (' + Math.round(b / done * 100) + '%)';
  }

  function firstTextLine(sp) {
    var avg = fmtDuration(sp && sp.first_text_avg_seconds);
    if (!avg) return 'No first replies measured yet.';
    var extra = [];
    var med = fmtDuration(sp.first_text_median_seconds);
    if (med) extra.push('median ' + med);
    var n = num(sp.first_text_sample);
    if (n !== null) extra.push(plural(n, 'lead', 'leads'));
    return 'New leads hear back in ' + avg + ' on average' + (extra.length ? ' (' + extra.join(', ') + ')' : '') + '.';
  }

  function followupLine(sp) {
    var avgMin = num(sp && sp.owner_followup_avg_minutes);
    if (avgMin === null) return 'No hand-offs followed up yet.';
    var extra = [];
    var med = num(sp.owner_followup_median_minutes);
    if (med !== null) extra.push('median ' + fmtDuration(med * 60));
    var n = num(sp.owner_followup_sample);
    if (n !== null) extra.push(plural(n, 'lead', 'leads'));
    return 'You follow up in ' + fmtDuration(avgMin * 60) + ' on average after a hand-off' + (extra.length ? ' (' + extra.join(', ') + ')' : '') + '.';
  }

  var FUNNEL = [
    { key: 'leads', label: 'Leads' },
    { key: 'quoted', label: 'Quoted' },
    { key: 'replied', label: 'Replied' },
    { key: 'handed_off', label: 'Handed to you' },
    { key: 'contacted', label: 'Contacted' },
    { key: 'booked', label: 'Booked' }
  ];

  // Lead journey rows with % of all leads (0-100, whole numbers).
  function funnelRows(f) {
    var total = num(f && f.leads) || 0;
    return FUNNEL.map(function (step) {
      var c = num(f && f[step.key]) || 0;
      var pct = total > 0 ? Math.round(c / total * 100) : 0;
      return { key: step.key, label: step.label, count: c, pct: Math.max(0, Math.min(100, pct)) };
    });
  }

  // "$1,250, 2 jobs" pieces for a {count,total} pair; total '' when there is none.
  function moneyCount(o, one, many) {
    var c = num(o && o.count) || 0;
    var t = num(o && o.total);
    return { money: fmtMoney(t === null ? 0 : t), count: plural(c, one || 'job', many || 'jobs') };
  }

  /* ---------- routes + data ---------- */

  function isUuid(s) { return typeof s === 'string' && UUID_RE.test(s); }

  // '#/' | '' -> list; '#/lead/<uuid>' -> thread; '#/<tab>' -> that tab when it is in `tabs`
  // (default: the built-in 'value' tab); anything else -> list.
  function parseRoute(hash, tabs) {
    var h = String(hash || '');
    var m = /^#\/lead\/([^/?#]+)\/?$/.exec(h);
    if (m && isUuid(m[1])) return { name: 'lead', id: m[1].toLowerCase() };
    var t = /^#\/([a-z][a-z0-9-]*)\/?$/.exec(h);
    var known = Array.isArray(tabs) ? tabs : ['value'];
    if (t && t[1] !== 'lead' && known.indexOf(t[1]) !== -1) return { name: t[1] };
    return { name: 'list' };
  }

  // The owner's own DONE/BOOKED/LOST texts (owner -> system, direction 'in') are shown only
  // in the status strip, never as bubbles. Sorted oldest first.
  function visibleMessages(rows) {
    return (Array.isArray(rows) ? rows : [])
      .filter(function (r) { return r && !(r.audience === 'owner' && r.direction === 'in'); })
      .slice()
      .sort(function (a, b) {
        var ta = new Date(a.at).getTime(), tb = new Date(b.at).getTime();
        if (ta !== tb) return ta - tb;
        return String(a.msg_id).localeCompare(String(b.msg_id));
      });
  }

  function sortLeads(rows) {
    return (Array.isArray(rows) ? rows : []).slice().sort(function (a, b) {
      var ta = a.last_activity_at ? new Date(a.last_activity_at).getTime() : -Infinity;
      var tb = b.last_activity_at ? new Date(b.last_activity_at).getTime() : -Infinity;
      return tb - ta;
    });
  }

  return {
    TZ: TZ,
    normalizePhone: normalizePhone,
    maskPhone: maskPhone,
    fmtStamp: fmtStamp,
    fmtDay: fmtDay,
    sameDay: sameDay,
    fmtAgo: fmtAgo,
    fmtEventDate: fmtEventDate,
    kindLabel: kindLabel,
    statusInfo: statusInfo,
    friendlyAuthError: friendlyAuthError,
    statusGroup: statusGroup,
    isClosed: isClosed,
    configure: configure,
    themeVars: themeVars,
    titleCase: titleCase,
    displayName: displayName,
    fmtPhoneNational: fmtPhoneNational,
    telHref: telHref,
    smsHref: smsHref,
    mailtoHref: mailtoHref,
    validEmail: validEmail,
    mapsHref: mapsHref,
    isOptedOut: isOptedOut,
    contactActions: contactActions,
    fmtSince: fmtSince,
    fmtShortDate: fmtShortDate,
    fmtTime: fmtTime,
    fmtTimeRange: fmtTimeRange,
    nextAction: nextAction,
    deferReasons: deferReasons,
    quoteView: quoteView,
    promoText: promoText,
    eventFacts: eventFacts,
    filters: filters,
    isFilterKey: isFilterKey,
    matchesFilter: matchesFilter,
    filterLeads: filterLeads,
    filterCounts: filterCounts,
    actions: actions,
    confirmText: confirmText,
    canSetStatus: canSetStatus,
    actionsNote: actionsNote,
    friendlyStatusError: friendlyStatusError,
    historyLine: historyLine,
    sortHistory: sortHistory,
    toCents: toCents,
    fmtMoney: fmtMoney,
    fmtDuration: fmtDuration,
    fmtWaiting: fmtWaiting,
    closeRateText: closeRateText,
    firstTextLine: firstTextLine,
    followupLine: followupLine,
    funnelRows: funnelRows,
    moneyCount: moneyCount,
    plural: plural,
    TIERS: TIERS,
    tierOf: tierOf,
    groupByTier: groupByTier,
    isUuid: isUuid,
    parseRoute: parseRoute,
    visibleMessages: visibleMessages,
    sortLeads: sortLeads
  };
});
