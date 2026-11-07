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

  // Like fmtAgo, but an old date reads as a date: "3 h ago", "on Nov 3" (so "Last text on Nov 3", never a bare "Nov 3").
  function fmtAgoOn(iso, now) {
    var t = fmtAgo(iso, now);
    return t && !/ago$|^just now$/.test(t) ? 'on ' + t : t;
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

  var CUSTOM = { status: {}, tiers: {}, lost: {}, locale: 'en-CA', currency: 'CAD', waitWarnHours: 24 };

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
    CUSTOM.lost = plainMap(c.lostReasons);
    var wh = Number(c.waitWarnHours);
    CUSTOM.waitWarnHours = isFinite(wh) && wh >= 1 && wh <= 720 ? wh : 24;
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
    followup_nudge: 'Follow-up text',
    owner_alert: 'Alert for you',
    owner_alert_held: 'Alert held until morning',
    owner_confirm: 'Confirmation',
    owner_digest: 'Your 9 am text',
    backfill: 'You'
  };

  function kindLabel(kind) {
    if (Object.prototype.hasOwnProperty.call(KIND_LABELS, kind)) return KIND_LABELS[kind];
    return kind ? String(kind).replace(/_/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); }) : '';
  }

  var STATUS = {
    'new': ['New', 'active'],
    engaged: ['Talking', 'active'],
    quoted: ['Quoted', 'active'],
    handed_off: ['Needs you', 'needs'],
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
  // 'needs' is still a valid group for the logic (the Needs-you block on Home uses it) but has no chip any more.
  var FILTER_KEYS = ['all', 'needs', 'open', 'booked', 'lost'];
  var CHIP_KEYS = ['open', 'booked', 'lost', 'all'];
  // The four chips on Home, in display order. Open is the default.
  function filters() {
    return [
      { key: 'open', label: 'Open' },
      { key: 'booked', label: statusInfo('booked').label },
      { key: 'lost', label: statusInfo('lost').label },
      { key: 'all', label: 'All' }
    ];
  }

  function isFilterKey(key) {
    return CHIP_KEYS.indexOf(key) !== -1;
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
    return q + " They won't get the next follow-up text.";
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

  // Heading of the status card: plain when the page can't change this lead at all ("Status locked").
  function statusHeading(current) {
    var c = String(current || '').toLowerCase();
    return actionsNote(c) && !actionsAhead(c).length ? 'Status locked' : 'Change status';
  }

  // Postgres exceptions raised by cv_set_lead_status -> plain words.
  // The code is in error.message; for not_allowed the reason is in error.details.
  var NOT_ALLOWED = {
    opted_out: 'This lead opted out of texts, so the page cannot change their status.',
    already_booked: "This lead is already booked, so it can't go back to contacted.",
    already_lost: "This lead is already marked lost, so it can't go back to contacted.",
    closed: "This lead is closed, so its status can't be changed here.",
    not_with_owner: "The assistant is still handling this lead. You can mark it once they've asked for you."
  };

  // bad_input details from cv_set_lead_status (final price / lost reason) -> plain words.
  var BAD_INPUT = {
    amount_out_of_range: 'The final price must be between $0 and $100,000.',
    bad_amount: 'The final price must be between $0 and $100,000.',
    reason_required: 'Pick a reason the lead was lost.',
    bad_reason: 'Pick one of the reasons shown.',
    note_too_long: 'Keep the note under 500 characters.'
  };

  function friendlyStatusError(err) {
    var raw = String((err && err.message) || (typeof err === 'string' ? err : '')).trim();
    var msg = raw.toLowerCase();
    var m = /\b(not_owner|bad_status|not_found|not_allowed|bad_input)\b\s*(?::\s*([^\n]*))?/.exec(msg);
    if (m) {
      if (m[1] === 'bad_input') {
        var why = String(m[2] || (err && err.details) || '').trim().toLowerCase().replace(/[.\s]+$/, '').replace(/[\s-]+/g, '_');
        return BAD_INPUT[why] || 'Check the price or the reason and try again.';
      }
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
    'new': 'New lead', engaged: 'Started texting', quoted: 'Quoted', handed_off: 'Asked for you',
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
    var extra = a === 'booked' ? fmtMoney(h.amount) : a === 'lost' ? lostReasonLabel(h.reason) : '';
    return [label, extra, fmtStamp(h.at, now), src].filter(Boolean).join(' \u00b7 ');
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
  // `nudge` (optional) is the lead's pending auto_nudge row from follow_ups: its exact due time wins.
  function nextAction(lead, now, nudge) {
    if (!lead || isOptedOut(lead)) return '';
    var st = String(lead.status || '').toLowerCase();
    if (nudge && !isClosed(st) && realDate(nudge.due_at) && !realDate(nudge.sent_at)) {
      return 'Follow-up text goes out ' + fmtDueAt(nudge.due_at, now) + ' — ' + fmtCountdown(nudge.due_at, now);
    }
    var lc = function (k) { return statusInfo(k).label.toLowerCase(); };
    var markWhen = 'Mark ' + lc('booked') + ' or ' + lc('lost') + ' when you know.';
    if (st === 'booked' || st === 'won') {
      var ev = fmtEventDate(lead.event_date, now);
      return ev ? statusInfo('booked').label + ' for ' + ev : statusInfo('booked').label;
    }
    if (st === 'lost') {
      var la = lead.lost_at || lead.status_at;
      var why = lostReasonLabel(lead.lost_reason);
      return 'Marked ' + lc('lost') + (la ? ' ' + fmtShortDate(la, now) : '') + (why ? ' \u2014 ' + why : '');
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
    // Date, guests and price live in the record header; service hours and bar rental in the Quote card (UI round 2, C6).
    add('occasion', 'Occasion', String(lead.occasion || '').trim());
    add('time', 'Time', fmtTimeRange(lead.start_time, lead.end_time));
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
    if (lead.multiple_events === true) add('multi', 'More than one event', String(lead.multi_event_dates || '').trim() || 'Yes, dates not given');
    add('offer', 'Offer', promoText(lead));
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

  // Plain sentences: no averages-vs-medians, no sample sizes.
  function firstTextLine(sp) {
    var avg = fmtDuration(sp && sp.first_text_avg_seconds);
    if (!avg) return 'No first replies measured yet.';
    return 'New leads hear back in ' + avg + '.';
  }

  function followupLine(sp) {
    var avgMin = num(sp && sp.owner_followup_avg_minutes);
    if (avgMin === null) return "You haven't followed up with a lead yet.";
    return 'You get back to them in ' + fmtDuration(avgMin * 60) + '.';
  }

  var FUNNEL = [
    { key: 'leads', label: 'Leads' },
    { key: 'quoted', label: 'Quoted' },
    { key: 'replied', label: 'Replied' },
    { key: 'handed_off', label: 'Asked for you' },
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

  /* ---------- feature switches (CV_CUSTOM.features) ---------- */

  // Every feature is on unless the client's settings say exactly false. Off = not shown at all.
  var FEATURES = ['followups', 'calendar', 'notes', 'search', 'quote', 'value', 'metrics', 'push'];
  function featureOn(features, key) {
    return !(features && typeof features === 'object' && features[key] === false);
  }

  /* ---------- push alerts (home-screen app) ---------- */

  // Which Alerts panel state to show. env = { featureOn, serverEnabled, ios, standalone, supported, permission, subscribed }.
  // Returns 'hidden' | 'install' | 'off' | 'on' | 'denied' | 'unsupported'.
  // serverEnabled must be exactly true (unknown or false hides the panel). iPhone Safari outside the home-screen app
  // gets the install steps: iOS only allows alerts from the installed app.
  function pushState(env) {
    env = env || {};
    if (env.featureOn === false || env.serverEnabled !== true) return 'hidden';
    if (env.ios && !env.standalone) return 'install';
    if (!env.supported) return 'unsupported';
    if (env.permission === 'denied') return 'denied';
    if (env.subscribed && env.permission === 'granted') return 'on';
    return 'off';
  }

  var PUSH_TEXT = {
    install: 'On iPhone, alerts only work from the home-screen app. Tap Share, then Add to Home Screen, then open it from your home screen.',
    denied: 'Alerts are blocked for this app. Turn them back on in your phone settings (Notifications), then come back here.',
    unsupported: "This browser can't show alerts. On iPhone, add the page to your home screen and open it from there.",
    on: 'Alerts are on. You get one when a lead needs you.',
    off: 'Get an alert on this phone when a lead needs you.'
  };

  // VAPID public key (base64url) -> Uint8Array for pushManager.subscribe. null when it is not valid base64url.
  function b64urlToBytes(str) {
    if (typeof str !== 'string' || !/^[A-Za-z0-9_-]+={0,2}$/.test(str)) return null;
    var b = str.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
    if (b.length % 4 === 1) return null;
    while (b.length % 4) b += '=';
    var bin = typeof atob === 'function' ? atob(b) : Buffer.from(b, 'base64').toString('binary');
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // A browser PushSubscription -> the three values the server stores. null when anything is missing or the endpoint is not https.
  function pushSubKeys(sub) {
    var j = sub && typeof sub.toJSON === 'function' ? sub.toJSON() : sub;
    var k = j && j.keys;
    if (!j || typeof j.endpoint !== 'string' || !/^https:\/\/[^\s]+$/.test(j.endpoint) || j.endpoint.length > 1000) return null;
    if (!k || typeof k.p256dh !== 'string' || typeof k.auth !== 'string' || !k.p256dh || !k.auth) return null;
    return { endpoint: j.endpoint, p256dh: k.p256dh, auth: k.auth };
  }

  // A same-origin path or "/": one leading "/" (not "//"), no whitespace, control chars or backslash,
  // and it must still resolve to our own origin (the URL parser strips tab/newline, so check the result too).
  function safePath(u) {
    if (typeof u !== 'string' || !/^\/(?!\/)[^\s\\\x00-\x1f\x7f]*$/.test(u)) return '/';
    try { return new URL(u, 'https://own.invalid').origin === 'https://own.invalid' ? u : '/'; } catch (e) { return '/'; }
  }

  // Server push payload -> what the service worker shows. The url must be a same-origin path (no //, no backslash).
  // sw.js carries a copy of this logic (a test checks they agree).
  function pushPayload(p) {
    if (!p || typeof p !== 'object') p = {};
    var url = safePath(p.url);
    return {
      title: typeof p.title === 'string' && p.title ? p.title.slice(0, 80) : 'New lead needs you',
      body: typeof p.body === 'string' ? p.body.slice(0, 200) : '',
      tag: typeof p.tag === 'string' && p.tag ? p.tag.slice(0, 80) : 'lead-alert',
      url: url
    };
  }

  // Plain-words result of "Send test alert" (the RPC answer, or an error).
  function pushTestMessage(r) {
    if (r && r.ok === false) {
      if (r.reason === 'no_subscription') return 'No phone is signed up for alerts yet. Turn alerts on first.';
      if (r.reason === 'too_many') return 'Too many test alerts. Wait a minute and try again.';
      if (r.reason === 'disabled') return 'Alerts are switched off for this account.';
    }
    if (!r || r.ok !== true) return "The test alert didn't go out. Try again in a minute.";
    if (r.queued || (typeof r.sent === 'number' && r.sent > 0)) return 'Test alert sent. It should arrive in a few seconds.';
    return 'No phone is signed up for alerts yet. Turn alerts on first.';
  }

  /* ---------- quote calculator (Edge Function cv-quote) ---------- */

  var PLACE_RE = /^[\p{L}\p{M}0-9 .,'()&\/-]{2,80}$/u;
  var OCCASION_RE = /^[\p{L}\p{M}0-9 .,'()&\/-]{1,60}$/u;
  var QUOTE_HOURS = ['3', '4', '5', '6', '7', '8', 'over_8'];

  function intIn(v, lo, hi) {
    var s = String(v == null ? '' : v).trim();
    if (!/^\d+$/.test(s)) return null;
    var n = Number(s);
    return n >= lo && n <= hi ? n : null;
  }

  // The owner's form -> the request body, checked the same way the endpoint checks it.
  // Empty optional fields are left out (the endpoint refuses unknown or malformed fields).
  // Returns { ok: true, body } or { ok: false, errors: { field: plain words } }.
  function quoteRequest(f) {
    f = f || {};
    var errors = {};
    var body = {};
    var type = f.service_type === 'bar_only' ? 'bar_only' : 'full_service';
    body.service_type = type;
    var full = type === 'full_service';
    var g = String(f.guests == null ? '' : f.guests).trim();
    if (g || full) {
      var gn = intIn(g, 1, 2000);
      if (gn === null) errors.guests = g ? 'Enter a whole number from 1 to 2,000.' : 'Enter the number of guests.';
      else body.guests = gn;
    }
    var h = String(f.service_hours == null ? '' : f.service_hours);
    if (h || full) {
      if (QUOTE_HOURS.indexOf(h) === -1) errors.service_hours = 'Pick how many hours.';
      else body.service_hours = h === 'over_8' ? 'over_8' : Number(h);
    }
    var bar = type === 'bar_only' ? true : f.bar_rental === true ? true : f.bar_rental === false ? false : null;
    if (bar === null) errors.bar_rental = 'Pick yes or no.';
    else body.bar_rental = bar;
    var km = String(f.distance_km == null ? '' : f.distance_km).trim().replace(',', '.');
    if (km) {
      var kn = /^\d+(\.\d+)?$/.test(km) ? Number(km) : NaN;
      if (!(kn >= 0 && kn <= 1000)) errors.distance_km = 'Enter the one-way driving distance, 0 to 1,000 km.';
      else body.distance_km = kn;
    }
    var city = String(f.event_city == null ? '' : f.event_city).replace(/\s+/g, ' ').trim();
    if (city) {
      if (!PLACE_RE.test(city)) errors.event_city = 'Use 2 to 80 letters, numbers, spaces or . , \' ( ) & / -';
      else body.event_city = city;
    } else if (bar && body.distance_km === undefined && !errors.distance_km) {
      errors.event_city = 'Enter the event city (needed for the delivery fee).';
    }
    var date = String(f.event_date == null ? '' : f.event_date).trim();
    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date + 'T00:00:00Z'))) errors.event_date = 'Pick a date.';
      else body.event_date = date;
    }
    var occ = String(f.occasion == null ? '' : f.occasion).replace(/\s+/g, ' ').trim();
    if (occ) {
      if (!OCCASION_RE.test(occ)) errors.occasion = 'Use up to 60 letters, numbers, spaces or . , \' ( ) & / -';
      else body.occasion = occ;
    }
    var promo = String(f.promo_code == null ? '' : f.promo_code).trim().toLowerCase();
    if (promo) {
      if (!/^[a-z0-9_-]{2,32}$/.test(promo)) errors.promo_code = 'Promo codes are 2 to 32 letters, numbers, - or _.';
      else body.promo_code = promo;
    }
    return Object.keys(errors).length ? { ok: false, errors: errors } : { ok: true, body: body };
  }

  // A discount line always reads as money off: "−$100", whichever sign the engine used.
  function signedMoney(v) {
    var c = toCents(v);
    return c === null ? '' : '\u2212' + fmtMoney(Math.abs(c) / 100);
  }

  // Engine response -> what the page prints. No arithmetic: every number is the engine's.
  function quoteResult(r) {
    r = r && typeof r === 'object' ? r : {};
    var defer = String(r.status || '').toLowerCase() !== 'firm' || r.total === null || r.total === undefined;
    var items = [];
    if (!defer) {
      (Array.isArray(r.line_items) ? r.line_items : []).forEach(function (it) {
        if (!it || typeof it !== 'object') return;
        var detail = Array.isArray(it.includes) ? it.includes.filter(function (x) { return typeof x === 'string' && x.trim(); }).join(', ') : String(it.detail || '').trim();
        var hasBase = it.base_amount !== undefined && it.base_amount !== null && toCents(it.discount) !== null && toCents(it.discount) !== 0;
        items.push({ label: String(it.label || '').trim() || 'Item', detail: hasBase ? String(it.base_detail || detail || '').trim() : detail, amount: fmtMoney(hasBase ? it.base_amount : it.amount) });
        if (hasBase) items.push({ label: String(it.discount_label || '').trim() || 'Discount', detail: '', amount: signedMoney(it.discount), discount: true });
      });
    }
    var reasons = (Array.isArray(r.defer_reasons) ? r.defer_reasons : []).filter(function (x) { return typeof x === 'string' && x.trim(); }).map(function (x) { return x.trim(); });
    if (defer && !reasons.length) reasons = deferReasons(r.defer_codes);
    var km = num(r.distance_km);
    return {
      defer: defer,
      reasons: defer ? reasons : [],
      items: items,
      subtotal: defer ? '' : fmtMoney(r.subtotal),
      travel: defer ? '' : (toCents(r.travel_fee) === 0 ? 'None' : fmtMoney(r.travel_fee)),
      total: defer ? '' : fmtMoney(r.total),
      deposit: defer ? '' : fmtMoney(r.deposit),
      distance: km === null ? '' : Math.round(km).toLocaleString('en-CA') + ' km away',
      flags: defer ? [] : (Array.isArray(r.flags) ? r.flags : []).filter(function (x) { return typeof x === 'string' && x.trim(); }),
      needsDistance: String(r.distance_status || '') === 'route_not_found' || (Array.isArray(r.defer_codes) && r.defer_codes.indexOf('missing_distance') !== -1)
    };
  }

  // Plain-text summary for "Copy quote".
  function quoteText(view, req, now) {
    if (!view || view.defer) return '';
    var b = (req && req.body) || req || {};
    var head = [];
    if (b.occasion) head.push(b.occasion);
    if (b.event_date) head.push(fmtEventDate(b.event_date, now));
    if (b.guests) head.push(plural(b.guests, 'guest', 'guests'));
    if (b.service_hours) head.push(b.service_hours === 'over_8' ? 'more than 8 hours' : b.service_hours + ' hours');
    if (b.event_city) head.push(b.event_city + (view.distance ? ' (' + view.distance + ')' : ''));
    var lines = ['Quote' + (head.length ? ': ' + head.join(', ') : '')];
    view.items.forEach(function (it) { lines.push(it.label + (it.detail ? ' (' + it.detail + ')' : '') + ': ' + it.amount); });
    if (view.subtotal) lines.push('Subtotal: ' + view.subtotal);
    if (view.travel) lines.push('Travel fee: ' + view.travel);
    lines.push('Total: ' + view.total);
    if (view.deposit) lines.push('Deposit to hold the date: ' + view.deposit);
    return lines.join('\n');
  }

  // cv-quote errors -> { message, fields }. bad_input details name the fields.
  var QUOTE_FIELD_WORDS = {
    guests: 'Enter a whole number from 1 to 2,000.',
    service_hours: 'Pick how many hours.',
    bar_rental: 'Pick yes or no (bar only always includes the bar).',
    service_type: 'Pick full service or bar only.',
    event_city: 'Check the city: 2 to 80 letters, numbers or spaces.',
    distance_km: 'Enter the one-way driving distance, 0 to 1,000 km.',
    event_date: 'Pick a date.',
    occasion: 'Use up to 60 letters, numbers or spaces.',
    promo_code: 'Promo codes are 2 to 32 letters, numbers, - or _.'
  };
  function quoteError(err) {
    var code = String((err && (err.error || err.code)) || '').toLowerCase();
    var status = err && err.status;
    if (code === 'bad_input') {
      var fields = {};
      var d = err.details;
      if (d && typeof d === 'object' && !Array.isArray(d)) {
        Object.keys(d).forEach(function (k) {
          if (QUOTE_FIELD_WORDS[k]) fields[k] = QUOTE_FIELD_WORDS[k];
        });
      }
      return { message: Object.keys(fields).length ? 'Check the marked fields.' : "The calculator didn't accept that. Reload the page and try again.", fields: fields };
    }
    if (code === 'not_signed_in' || status === 401) return { message: 'Your session ran out. Sign out and sign in again.', fields: {} };
    if (code === 'not_owner' || status === 403) return { message: "Your sign-in isn't linked to this business. Sign out, then sign in with your own number.", fields: {} };
    if (code === 'engine_error' || status === 500 || status === 502 || status === 503 || status === 504) return { message: 'The calculator is not available right now. Try again later.', fields: {} };
    return { message: "Couldn't reach the calculator. Check your connection and try again.", fields: {} };
  }

  /* ---------- final price + lost reason (cv_set_lead_status p_amount / p_reason) ---------- */

  var LOST_REASONS = [
    { key: 'price', label: 'Price' },
    { key: 'date_taken', label: 'Date taken' },
    { key: 'no_reply', label: 'No reply' },
    { key: 'went_elsewhere', label: 'Went elsewhere' },
    { key: 'other', label: 'Other' }
  ];
  var LOST_NOTE_MAX = 500;
  var AMOUNT_MAX = 100000;

  // Chips on the Lost sheet, labels from CV_CUSTOM.lostReasons.
  function lostReasons() {
    return LOST_REASONS.map(function (r) { return { key: r.key, label: CUSTOM.lost[r.key] || r.label }; });
  }
  function lostReasonLabel(key) {
    var k = String(key || '').toLowerCase();
    if (!k) return '';
    var r = lostReasons().filter(function (x) { return x.key === k; })[0];
    return r ? r.label : humanize(k);
  }

  // Money typed by the owner -> { ok, value } (dollars, 2 decimals max) or { ok: false, error }.
  // Accepts "$1,250", "1250.5", "1 250,50"; empty -> { ok: true, value: null }.
  function parseAmount(input) {
    var s = String(input == null ? '' : input).replace(/[$\s\u00a0\u202f]/g, '').replace(/(CAD|USD|C)$/i, '');
    if (!s) return { ok: true, value: null };
    var n = null;
    if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) n = Number(s.replace(/,/g, ''));
    else if (/^\d+,\d{1,2}$/.test(s)) n = Number(s.replace(',', '.'));
    else if (/^\d+(\.\d{1,2})?$/.test(s) || /^\d*\.\d{1,2}$/.test(s)) n = Number(s);
    if (n === null || !isFinite(n)) return { ok: false, error: 'Type the price in dollars, like 1250 or 1250.50.' };
    if (n < 0 || n > AMOUNT_MAX) return { ok: false, error: 'The final price must be between $0 and $100,000.' };
    return { ok: true, value: Math.round(n * 100) / 100 };
  }

  // Plain number for the price box: 1180 -> "1180", 1320.5 -> "1320.50".
  function amountInput(v) {
    var c = toCents(v);
    if (c === null) return '';
    return c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2);
  }

  // Extra RPC args for a status change. Keys with no value are left out, so a plain
  // Contacted call is the same two arguments as before.
  //   booked: p_amount only when the typed price differs from the quote (empty / unchanged -> left out)
  //   lost:   p_reason required; p_reason_note only for 'other' and only when something was typed
  function statusExtras(status, form, quote) {
    form = form || {};
    if (status === 'booked') {
      var a = parseAmount(form.amount);
      if (!a.ok) return { ok: false, error: a.error, field: 'amount' };
      var q = toCents(quote);
      if (a.value === null || (q !== null && Math.round(a.value * 100) === q)) return { ok: true, args: {} };
      return { ok: true, args: { p_amount: a.value } };
    }
    if (status === 'lost') {
      var r = String(form.reason || '').toLowerCase();
      if (!LOST_REASONS.some(function (x) { return x.key === r; })) return { ok: false, error: 'Pick a reason the lead was lost.', field: 'reason' };
      var args = { p_reason: r };
      var note = String(form.note || '').trim();
      if (r === 'other' && note) {
        if (note.length > LOST_NOTE_MAX) return { ok: false, error: 'Keep the note under 500 characters.', field: 'note' };
        args.p_reason_note = note;
      }
      return { ok: true, args: args };
    }
    return { ok: true, args: {} };
  }

  // Status chip with the final price or the lost reason: "Booked · $1,250", "Lost · Price".
  function statusChip(lead) {
    var info = statusInfo(lead && lead.status);
    var st = String((lead && lead.status) || '').toLowerCase();
    var extra = '';
    if (statusGroup(st) === 'booked') extra = fmtMoney(lead.booked_amount);
    else if (st === 'lost') extra = lostReasonLabel(lead.lost_reason);
    return { label: extra ? info.label + ' \u00b7 ' + extra : info.label, tone: info.tone };
  }

  // Money beside a lead: "Quoted $1,180" once a different final price is set, else the quote.
  function quoteMoney(lead) {
    var q = fmtMoney(lead && lead.quote_total);
    var b = toCents(lead && lead.booked_amount);
    if (q && b !== null && statusGroup(lead.status) === 'booked') return 'Quoted ' + q;
    return q;
  }

  // cv_metrics().lost_reasons {reason: count} -> rows, biggest first, with % of all lost.
  function lostReasonRows(obj) {
    var rows = [];
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      Object.keys(obj).forEach(function (k) {
        var c = num(obj[k]);
        if (c !== null && c > 0) rows.push({ key: k, label: k === 'unknown' || k === 'null' || k === '' ? 'No reason given' : lostReasonLabel(k), count: c });
      });
    }
    var total = rows.reduce(function (s, r) { return s + r.count; }, 0);
    rows.forEach(function (r) { r.pct = total ? Math.round(r.count / total * 100) : 0; });
    rows.sort(function (a, b) { return b.count - a.count || a.label.localeCompare(b.label); });
    return rows;
  }

  /* ---------- search (lead_detail, server side) ---------- */

  var SEARCH_MIN = 2;

  // PostgREST or-filter for a search box query, or null when it is too short.
  // `,()*%"\` would break or widen the filter: each becomes `_` (matches exactly one character).
  // Phones match on digits only, so "(416) 555-01" finds +1416555 01xx.
  function searchFilter(q) {
    var raw = String(q == null ? '' : q).replace(/\s+/g, ' ').trim();
    if (raw.length < SEARCH_MIN) return null;
    var safe = raw.slice(0, 80).replace(/[,()*%"\\]/g, '_');
    var parts = ['full_name.ilike.*' + safe + '*', 'email.ilike.*' + safe + '*'];
    var digits = raw.replace(/\D/g, '');
    if (digits.length >= 3) parts.push('phone.ilike.*' + digits.slice(0, 15) + '*');
    return parts.join(',');
  }

  /* ---------- calendar ---------- */

  var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(y, m, d) { return y + '-' + pad2(m) + '-' + pad2(d); }

  // Today's date in the client's time zone as {y, m (1-12), d, ymd}.
  function today(now) {
    var p = partsOf(nowDate(now));
    return { y: p.y, m: p.m, d: p.d, ymd: ymd(p.y, p.m, p.d) };
  }

  function shiftMonth(y, m, delta) {
    var i = y * 12 + (m - 1) + delta;
    return { y: Math.floor(i / 12), m: (i % 12 + 12) % 12 + 1 };
  }

  function monthTitle(y, m) { return MONTH_NAMES[m - 1] + ' ' + y; }

  // Weeks (Sunday first) covering month m (1-12) of year y: each day {ymd, d, inMonth}.
  function monthGrid(y, m) {
    var first = new Date(Date.UTC(y, m - 1, 1));
    var start = new Date(first.getTime() - first.getUTCDay() * 86400000);
    var days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    var cells = Math.ceil((first.getUTCDay() + days) / 7) * 7;
    var weeks = [];
    for (var i = 0; i < cells; i++) {
      var d = new Date(start.getTime() + i * 86400000);
      if (i % 7 === 0) weeks.push([]);
      weeks[weeks.length - 1].push({ ymd: ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()), d: d.getUTCDate(), inMonth: d.getUTCMonth() === m - 1 });
    }
    return weeks;
  }

  // Events by day from lead_list: booked leads always; open leads with a quote when showPossible.
  // Lost / opted-out leads never show. Each day: { booked: [], possible: [] }, biggest money first.
  function eventsByDay(leads, opts) {
    var showPossible = !!(opts && opts.showPossible);
    var out = {};
    (Array.isArray(leads) ? leads : []).forEach(function (l) {
      if (!l || !isUuid(l.lead_id)) return;
      var m = /^(\d{4}-\d{2}-\d{2})/.exec(String(l.event_date || ''));
      if (!m) return;
      var g = statusGroup(l.status);
      var kind = g === 'booked' ? 'booked' : (g === 'open' && showPossible && toCents(l.quote_total) !== null ? 'possible' : '');
      if (!kind) return;
      (out[m[1]] = out[m[1]] || { booked: [], possible: [] })[kind].push(l);
    });
    function money(l) { var b = toCents(l.booked_amount); return b !== null ? b : (toCents(l.quote_total) || 0); }
    Object.keys(out).forEach(function (k) {
      out[k].booked.sort(function (a, b) { return money(b) - money(a); });
      out[k].possible.sort(function (a, b) { return money(b) - money(a); });
    });
    return out;
  }

  // Words for a day button: "Sat, Nov 14: 1 booked, 2 possible" (screen readers).
  function dayLabel(dayYmd, day, now) {
    var bits = [];
    if (day && day.booked.length) bits.push(day.booked.length + ' booked');
    if (day && day.possible.length) bits.push(day.possible.length + ' not booked yet');
    return fmtEventDate(dayYmd, now) + (bits.length ? ': ' + bits.join(', ') : ': nothing');
  }

  /* ---------- notes (lead_detail.notes) ---------- */

  var NOTE_MAX = 2000;

  function sortNotes(notes) {
    return (Array.isArray(notes) ? notes : []).filter(function (n) {
      return n && typeof n === 'object' && n.id != null && String(n.body == null ? '' : n.body).trim();
    }).slice().sort(function (a, b) { return (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0); });
  }

  // Trimmed note body or an error.
  function checkNote(body) {
    var s = String(body == null ? '' : body).trim();
    if (!s) return { ok: false, error: 'Write something first.' };
    if (s.length > NOTE_MAX) return { ok: false, error: 'Keep a note under 2,000 characters.' };
    return { ok: true, body: s };
  }

  /* ---------- value tier ranges (cv_metrics value_tiers) ---------- */

  var TIER_DEFAULT = { high_min: 1000, medium_min: 600 };

  // {high_min, medium_min} from cv_metrics(); the lab defaults when missing or not usable.
  function valueTiers(m) {
    var vt = m && m.value_tiers;
    var hi = num(vt && vt.high_min), med = num(vt && vt.medium_min);
    if (hi === null || med === null || hi <= 0 || med <= 0 || med >= hi) return { high_min: TIER_DEFAULT.high_min, medium_min: TIER_DEFAULT.medium_min };
    return { high_min: hi, medium_min: med };
  }

  // Money range next to a tier title: "$1,000 and up", "$600–$999", "under $600"; '' for 'none'.
  // Whole dollars: the medium tier ends one dollar below the high threshold.
  function tierRange(key, tiers) {
    var t = valueTiers({ value_tiers: tiers });
    if (key === 'high') return fmtMoney(t.high_min) + ' and up';
    if (key === 'medium') return fmtMoney(t.medium_min) + '–' + fmtMoney(Math.ceil(t.high_min) - 1);
    if (key === 'low') return 'under ' + fmtMoney(t.medium_min);
    return '';
  }

  /* ---------- follow-ups (view follow_ups) ---------- */

  // Like toDate, but null / '' / undefined mean "no time" (new Date(null) would be 1970).
  function realDate(v) { return v === null || v === undefined || v === '' ? null : toDate(v); }

  var SENT_WINDOW_DAYS = 14;
  var SOON_MS = 5 * 60000;

  // "Sat, Nov 8 at 10:00 am" in the client's time zone (adds the year when it is not this year).
  function fmtDueAt(iso, now) {
    var d = realDate(iso);
    if (!d) return '';
    var p = partsOf(d), n = partsOf(nowDate(now));
    var wd = WEEKDAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()];
    return wd + ', ' + MONTHS[p.m - 1] + ' ' + p.d + (p.y !== n.y ? ', ' + p.y : '') + ' at ' + p.hour + ':' + p.minute + ' ' + p.period;
  }

  // "10:00 am" in the client's time zone.
  function fmtClock(iso) {
    var d = realDate(iso);
    if (!d) return '';
    var p = partsOf(d);
    return p.hour + ':' + p.minute + ' ' + p.period;
  }

  // Time left until `iso`, from real elapsed time (a DST change never adds or drops an hour):
  // "in 2 days", "in 1 day 3 h", "in 3 h 20 min", "in 12 min"; "any minute now" under 5 min or past due.
  function fmtCountdown(iso, now) {
    var d = realDate(iso);
    if (!d) return '';
    var ms = d.getTime() - nowDate(now).getTime();
    if (ms < SOON_MS) return 'any minute now';
    var min = Math.floor(ms / 60000);
    if (min < 60) return 'in ' + min + ' min';
    var h = Math.floor(min / 60), mm = min % 60;
    if (h < 24) return 'in ' + h + ' h' + (mm ? ' ' + mm + ' min' : '');
    var days = Math.floor(h / 24), hh = h % 24;
    return 'in ' + plural(days, 'day', 'days') + (hh ? ' ' + hh + ' h' : '');
  }

  function fuType(r) { return String((r && r.follow_up_type) || '').toLowerCase(); }
  function timeOf(v) { var d = realDate(v); return d ? d.getTime() : null; }

  // When the lead asked for the owner: the row's own asked_at if the view has one, else the lead's
  // status_at while it is handed off (from lead_list). null when unknown.
  function askedAt(row, leads) {
    if (row && realDate(row.asked_at)) return row.asked_at;
    var lead = (Array.isArray(leads) ? leads : []).filter(function (l) { return l && l.lead_id === row.lead_id; })[0];
    if (lead && String(lead.status || '').toLowerCase() === 'handed_off' && realDate(lead.status_at)) return lead.status_at;
    return null;
  }

  // Splits follow_ups rows into the tab's blocks:
  //   needs      owner_callback, oldest ask first (unknown ask time last)
  //   scheduled  auto_nudge not sent yet with a due time, soonest first (past due stays: "any minute now")
  //   sent       auto_nudge sent in the last 14 days, newest first
  //   held       held_alert rows (earliest release first)
  //   digest     owner_digest rows: leads listed in the owner's 9:00 am "still open" text
  //   other      any other type, shown generically with its reason
  function groupFollowUps(rows, leads, now) {
    var n = nowDate(now).getTime();
    var out = { needs: [], scheduled: [], sent: [], held: [], digest: [], other: [] };
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      if (!r || !isUuid(r.lead_id)) return;
      var type = fuType(r);
      if (type === 'owner_callback') {
        out.needs.push(Object.assign({}, r, { asked_at: askedAt(r, leads) }));
      } else if (type === 'auto_nudge') {
        var sent = timeOf(r.sent_at);
        if (sent !== null) { if (n - sent <= SENT_WINDOW_DAYS * 86400000) out.sent.push(r); }
        else if (timeOf(r.due_at) !== null) out.scheduled.push(r);
      } else if (type === 'held_alert') {
        out.held.push(r);
      } else if (type === 'owner_digest') {
        out.digest.push(r);
      } else {
        out.other.push(r);
      }
    });
    function asc(key) {
      return function (a, b) {
        var ta = timeOf(a[key]), tb = timeOf(b[key]);
        if (ta === null && tb === null) return 0;
        if (ta === null) return 1;
        if (tb === null) return -1;
        return ta - tb;
      };
    }
    out.needs.sort(asc('asked_at'));
    out.scheduled.sort(asc('due_at'));
    out.held.sort(asc('due_at'));
    out.digest.sort(asc('due_at'));
    out.sent.sort(function (a, b) { return timeOf(b.sent_at) - timeOf(a.sent_at); });
    return out;
  }

  // Menu badge: leads that asked for the owner and are still waiting.
  function followUpBadge(rows) {
    return (Array.isArray(rows) ? rows : []).filter(function (r) { return fuType(r) === 'owner_callback' && r && isUuid(r.lead_id); }).length;
  }

  // The lead's next unsent automatic follow-up text, or null.
  function pendingNudge(rows, leadId) {
    var mine = (Array.isArray(rows) ? rows : []).filter(function (r) {
      return r && r.lead_id === leadId && fuType(r) === 'auto_nudge' && timeOf(r.sent_at) === null && timeOf(r.due_at) !== null;
    });
    mine.sort(function (a, b) { return timeOf(a.due_at) - timeOf(b.due_at); });
    return mine[0] || null;
  }

  // "Goes out Sat, Nov 8 at 10:00 am"
  function nudgeLine(r, now) { var w = fmtDueAt(r && r.due_at, now); return w ? 'Goes out ' + w : ''; }
  // "Sent Nov 3 · 3 days ago"
  function sentLine(r, now) {
    var d = fmtShortDate(r && r.sent_at, now);
    return d ? 'Sent ' + d + ' · ' + fmtSince(r.sent_at, now) : '';
  }
  // "Asked for you 2 days ago"; the reason when the time is unknown.
  function askedLine(r, now) {
    if (r && realDate(r.asked_at)) return 'Asked for you ' + fmtSince(r.asked_at, now);
    return humanize(r && r.reason) || 'Asked for you';
  }
  // "2 alerts will reach you at 9:00 am"
  function heldLine(held) {
    var list = Array.isArray(held) ? held : [];
    if (!list.length) return '';
    var at = fmtClock(list[0].due_at) || '9:00 am';
    return plural(list.length, 'alert', 'alerts') + ' will reach you at ' + at;
  }
  // "3 open leads will be in your 9:00 am summary text"
  function digestLine(rows) {
    var list = Array.isArray(rows) ? rows : [];
    if (!list.length) return '';
    var at = fmtClock(list[0].due_at) || '9:00 am';
    return plural(list.length, 'open lead', 'open leads') + ' will be in your ' + at + ' text';
  }

  /* ---------- home: the Needs-you block, chips and counts ---------- */

  // "less than a minute", "12 min", "3 h", "3 h 20 min", "2 days"
  function waitSpan(seconds) {
    if (seconds < 60) return 'less than a minute';
    var m = Math.floor(seconds / 60);
    if (m < 60) return m + ' min';
    var h = Math.floor(m / 60), mm = m % 60;
    if (h < 24) return h + ' h' + (mm ? ' ' + mm + ' min' : '');
    return plural(Math.floor(h / 24), 'day', 'days');
  }

  // "Waiting 3 h 20 min" since `iso`; '' when there is no time.
  function waitingFor(iso, now) {
    var d = realDate(iso);
    if (!d) return '';
    return 'Waiting ' + waitSpan(Math.max(0, (nowDate(now).getTime() - d.getTime()) / 1000));
  }

  // True once a lead has waited longer than the warning threshold (CV_CUSTOM.waitWarnHours, default 24 h).
  // The one place the warning colour is used; the page always pairs it with a clock icon and the words.
  function waitLate(iso, now) {
    var d = realDate(iso);
    if (!d) return false;
    return nowDate(now).getTime() - d.getTime() > CUSTOM.waitWarnHours * 3600000;
  }

  // The customer's latest text for a Needs-you row: whitespace collapsed, at most 140 characters, '' when there is none.
  // (lead_list.last_in_body; a longer value is cut at 140 with an ellipsis. The caller must use textContent only.)
  var LAST_TEXT_MAX = 140;
  function lastTextPreview(lead) {
    var v = lead && lead.last_in_body;
    if (v === null || v === undefined) return '';
    var t = String(v).replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
    if (t.length <= LAST_TEXT_MAX) return t;
    return t.slice(0, LAST_TEXT_MAX - 1).replace(/\s+$/, '') + '\u2026';
  }

  // Leads waiting on the owner, longest-waiting first (unknown time last). Opted-out leads never show.
  // Each row: { lead, since, waiting }. The time is status_at (when it was handed over), else last activity.
  function needsYou(leads, now) {
    var rows = (Array.isArray(leads) ? leads : []).filter(function (l) {
      return l && String(l.status || '').toLowerCase() === 'handed_off' && !isOptedOut(l);
    }).map(function (l) {
      var since = realDate(l.status_at) ? l.status_at : (realDate(l.last_activity_at) ? l.last_activity_at : (realDate(l.created_at) ? l.created_at : null));
      return { lead: l, since: since, waiting: waitingFor(since, now), late: waitLate(since, now) };
    });
    rows.sort(function (a, b) {
      var ta = timeOf(a.since), tb = timeOf(b.since);
      if (ta === null && tb === null) return 0;
      if (ta === null) return 1;
      if (tb === null) return -1;
      return ta - tb;
    });
    return rows;
  }

  // Home: { needs: rows for the block, rest: leads under the chips }. The block always shows everyone waiting;
  // the Open and All lists leave those leads out so nobody is drawn twice.
  function homeView(leads, key, now) {
    var needs = needsYou(leads, now);
    var inBlock = {};
    needs.forEach(function (r) { inBlock[r.lead.lead_id] = true; });
    var rest = filterLeads(leads, key);
    if (key === 'open' || key === 'all') rest = rest.filter(function (l) { return !inBlock[l.lead_id]; });
    return { needs: needs, rest: rest };
  }

  // Chip counts match the rows under each chip.
  function homeCounts(leads, now) {
    var c = filterCounts(leads);
    var n = needsYou(leads, now).length;
    return { open: Math.max(0, c.open - n), booked: c.booked, lost: c.lost, all: Math.max(0, c.all - n) };
  }

  // "Sat, Nov 14", "40 guests", "$650": the job in three bits. money:false leaves the price out.
  // A booked lead shows its final price, anyone else the quote.
  function jobBits(lead, opts) {
    if (!lead) return [];
    var bits = [];
    if (!(opts && opts.date === false)) bits.push(fmtEventDate(lead.event_date, opts && opts.now) || 'No event date');
    var g = Number(lead.guests);
    if (lead.guests !== null && lead.guests !== undefined && lead.guests !== '' && isFinite(g) && g > 0) bits.push(plural(g, 'guest', 'guests'));
    if (!(opts && opts.money === false)) {
      var money = statusGroup(lead.status) === 'booked' && toCents(lead.booked_amount) !== null ? fmtMoney(lead.booked_amount) : fmtMoney(lead.quote_total);
      if (money) bits.push(money);
    }
    return bits;
  }

  /* ---------- one lead row for every list (UI round 2, R1) ---------- */

  // name + ONE price on top; date and guests; chip and "last text 15 min ago" last.
  // A booked lead shows its final price only (never "Quoted $..."); a lead waiting on the owner carries a wait cue.
  // The chip never repeats the booked price: it is already the price on top.
  function rowView(lead, now, opts) {
    if (!lead) return null;
    var st = String(lead.status || '').toLowerCase();
    var info = statusInfo(st);
    var chipLabel = statusChip(lead).label;
    if (statusGroup(st) === 'booked') chipLabel = info.label;
    var money = statusGroup(st) === 'booked' && toCents(lead.booked_amount) !== null ? fmtMoney(lead.booked_amount) : fmtMoney(lead.quote_total);
    var needs = st === 'handed_off' && !isOptedOut(lead);
    var since = realDate(lead.status_at) ? lead.status_at : null; // never guess a wait from other times
    var lastText = realDate(lead.last_in_at) ? 'Last text ' + fmtAgoOn(lead.last_in_at, now) : '';
    return {
      name: displayName(lead),
      money: money,
      job: jobBits(lead, { money: false, now: now, date: !(opts && opts.noDate) }).join(' \u00b7 '),
      chip: { label: chipLabel, tone: info.tone },
      when: lastText || (realDate(lead.last_activity_at) ? 'Active ' + fmtAgoOn(lead.last_activity_at, now) : ''),
      needs: needs,
      wait: needs && since ? { text: waitingFor(since, now), late: waitLate(since, now) } : null,
      said: lastTextPreview(lead)
    };
  }

  // The status buttons still ahead of this lead (the current one and anything not allowed are left out).
  function actionsAhead(current) {
    var cur = String(current || '').toLowerCase();
    return actions().filter(function (a) { return canSetStatus(cur, a.status); }).map(function (a) { return a.status; });
  }

  /* ---------- UI round 3: calendar agenda, follow-up groups, Metrics sections ---------- */

  function ymdNum(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000 : null;
  }

  var AGENDA_DAYS = 7;       // "This week" = today and the next 6 days
  var AGENDA_LATER_MAX = 5;  // "Later" shows only the next few events
  // The calendar's list above the grid. Booked events always; not-booked-yet ones only with opts.showPossible.
  // Past days are left out. { thisWeek: [item], later: [item] }; item = { lead, ymd, kind, wd, day, mon, when }.
  // `when` = "Today" / "Tomorrow" / weekday.
  function weekAgenda(leads, opts, now) {
    var days = eventsByDay(leads, opts);
    var t = ymdNum(today(now).ymd);
    var out = { thisWeek: [], later: [] };
    Object.keys(days).sort().forEach(function (k) {
      var n = ymdNum(k);
      if (n === null || n < t) return;
      var wd = WEEKDAYS[new Date(n * 86400000).getUTCDay()];
      var mo = MONTHS[Number(k.slice(5, 7)) - 1];
      var when = n === t ? 'Today' : (n === t + 1 ? 'Tomorrow' : wd);
      var list = days[k].booked.map(function (l) { return [l, 'booked']; }).concat(days[k].possible.map(function (l) { return [l, 'possible']; }));
      list.forEach(function (p) {
        var item = { lead: p[0], ymd: k, kind: p[1], wd: wd, day: String(Number(k.slice(8, 10))), mon: mo, when: when };
        (n - t < AGENDA_DAYS ? out.thisWeek : out.later).push(item);
      });
    });
    out.later = out.later.slice(0, AGENDA_LATER_MAX);
    return out;
  }

  // One agenda row's words: who, guests, price, chip. The date is the row's left block, so it is not repeated.
  function agendaView(item, now) {
    var rv = rowView(item.lead, now, { noDate: true });
    var guests = jobBits(item.lead, { money: false, date: false, now: now }).join(' · ');
    var chip = item.kind === 'possible' ? { label: 'Not booked yet', tone: 'active' } : rv.chip;
    return { name: rv.name, money: rv.money, line: guests, chip: chip };
  }

  // Which Follow-ups group a due time falls in: Today (also anything overdue), This week (next 7 days), Later.
  function fuBucket(iso, now) {
    var d = realDate(iso);
    if (!d) return 'later';
    var n = nowDate(now);
    var pd = partsOf(d), pn = partsOf(n);
    var dn = Date.UTC(pd.y, pd.m - 1, pd.d) / 86400000, tn = Date.UTC(pn.y, pn.m - 1, pn.d) / 86400000;
    if (dn <= tn) return 'today';
    return dn - tn < AGENDA_DAYS ? 'week' : 'later';
  }

  var FU_GROUPS = [{ key: 'today', label: 'Today' }, { key: 'week', label: 'This week' }, { key: 'later', label: 'Later' }];
  // Scheduled rows (already soonest first) split into the non-empty groups, in order.
  function groupScheduled(rows, now) {
    var by = { today: [], week: [], later: [] };
    (Array.isArray(rows) ? rows : []).forEach(function (r) { by[fuBucket(r && r.due_at, now)].push(r); });
    return FU_GROUPS.filter(function (g) { return by[g.key].length; }).map(function (g) { return { key: g.key, label: g.label, rows: by[g.key] }; });
  }

  // Lead value inside Metrics: one line per tier (open leads only). No lead lists.
  // [{ key, label, range, count, money }]; money '' for "No quote yet". total = open quoted leads and money.
  function tierLines(leads, tiers) {
    var secs = groupByTier(leads, {});
    var t = valueTiers({ value_tiers: tiers });
    return secs.map(function (s) {
      return { key: s.key, label: s.label, range: tierRange(s.key, t), count: s.count, money: s.key === 'none' ? '' : fmtMoney(s.total) };
    });
  }

  // Close rate as one tile: { pct: "80%", text: "4 of 5 finished leads booked" }; null when nothing has finished.
  function closeRateTile(cr) {
    var b = num(cr && cr.booked) || 0, l = num(cr && cr.lost) || 0;
    var done = b + l;
    if (!done) return null;
    return { pct: Math.round(b / done * 100) + '%', text: b + ' of ' + plural(done, 'finished lead', 'finished leads') + ' booked' };
  }

  /* ---------- bottom bar (CV_CUSTOM.tabs + feature switches) ---------- */

  // Which tabs sit in the bar and which live under More. `want` = CV_CUSTOM.tabs, `on(route)` = feature switch.
  // Leads is always on. Names the page does not know are ignored; an empty or unusable list means "everything on".
  // Bar = Leads, Follow-ups, Calendar, Metrics (config order); More = Quote calculator (+ the fixed Alerts and Sign out). Lead value is a section inside Metrics, not a tab.
  // slots counts the bar tabs plus the More slot; with fewer than 2 the page hides the bar.
  var BAR_TABS = ['list', 'followups', 'calendar', 'metrics'];
  var MORE_TABS = ['quote'];
  function tabPlan(want, on) {
    var isOn = typeof on === 'function' ? on : function () { return true; };
    var known = BAR_TABS.concat(MORE_TABS);
    function usable(r) { return known.indexOf(r) !== -1 && (r === 'list' || isOn(r)); }
    var picked = [];
    (Array.isArray(want) ? want : []).forEach(function (r) { if (usable(r) && picked.indexOf(r) === -1) picked.push(r); });
    if (!picked.length) picked = known.filter(usable);
    var bar = picked.filter(function (r) { return BAR_TABS.indexOf(r) !== -1; });
    var more = picked.filter(function (r) { return MORE_TABS.indexOf(r) !== -1; });
    if (!bar.length) bar = ['list'];
    var slots = bar.length + 1;
    return { bar: bar, more: more, slots: slots, showBar: slots >= 2 };
  }

  /* ---------- conversation: customer thread + folded automatic texts ---------- */

  // Chat order (oldest first). Automatic texts to the owner (alert, digest, confirmation) leave the thread
  // and come back as one list behind a "N automatic texts" line.
  function splitThread(rows) {
    var all = visibleMessages(rows);
    var chat = [], system = [];
    all.forEach(function (m) { (m.audience === 'owner' ? system : chat).push(m); });
    return { chat: chat, system: system };
  }

  function systemFoldText(n, open) {
    return n + ' automatic ' + (n === 1 ? 'text' : 'texts') + ' · ' + (open ? 'hide' : 'show');
  }

  /* ---------- routes + data ---------- */

  function isUuid(s) { return typeof s === 'string' && UUID_RE.test(s); }

  // '#/' | '' -> list; '#/lead/<uuid>' -> thread; '#/<tab>' -> that tab when it is in `tabs`
  // (none when no list is given); anything else -> list.
  function parseRoute(hash, tabs) {
    var h = String(hash || '');
    var m = /^#\/lead\/([^/?#]+)\/?$/.exec(h);
    if (m && isUuid(m[1])) return { name: 'lead', id: m[1].toLowerCase() };
    var t = /^#\/([a-z][a-z0-9-]*)\/?$/.exec(h);
    var known = Array.isArray(tabs) ? tabs : [];
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
    valueTiers: valueTiers,
    tierRange: tierRange,
    fmtDueAt: fmtDueAt,
    fmtClock: fmtClock,
    fmtCountdown: fmtCountdown,
    groupFollowUps: groupFollowUps,
    followUpBadge: followUpBadge,
    pendingNudge: pendingNudge,
    nudgeLine: nudgeLine,
    sentLine: sentLine,
    askedLine: askedLine,
    heldLine: heldLine,
    digestLine: digestLine,
    FEATURES: FEATURES,
    featureOn: featureOn,
    pushState: pushState,
    PUSH_TEXT: PUSH_TEXT,
    b64urlToBytes: b64urlToBytes,
    pushSubKeys: pushSubKeys,
    pushPayload: pushPayload,
    pushTestMessage: pushTestMessage,
    quoteRequest: quoteRequest,
    quoteResult: quoteResult,
    quoteText: quoteText,
    quoteError: quoteError,
    lostReasons: lostReasons,
    lostReasonLabel: lostReasonLabel,
    parseAmount: parseAmount,
    amountInput: amountInput,
    statusExtras: statusExtras,
    statusChip: statusChip,
    quoteMoney: quoteMoney,
    lostReasonRows: lostReasonRows,
    searchFilter: searchFilter,
    SEARCH_MIN: SEARCH_MIN,
    today: today,
    fmtAgoOn: fmtAgoOn,
    statusHeading: statusHeading,
    weekAgenda: weekAgenda,
    agendaView: agendaView,
    fuBucket: fuBucket,
    groupScheduled: groupScheduled,
    tierLines: tierLines,
    closeRateTile: closeRateTile,
    shiftMonth: shiftMonth,
    monthTitle: monthTitle,
    monthGrid: monthGrid,
    eventsByDay: eventsByDay,
    dayLabel: dayLabel,
    sortNotes: sortNotes,
    checkNote: checkNote,
    NOTE_MAX: NOTE_MAX,
    LOST_NOTE_MAX: LOST_NOTE_MAX,
    isUuid: isUuid,
    parseRoute: parseRoute,
    visibleMessages: visibleMessages,
    sortLeads: sortLeads,
    waitingFor: waitingFor,
    waitLate: waitLate,
    lastTextPreview: lastTextPreview,
    LAST_TEXT_MAX: LAST_TEXT_MAX,
    rowView: rowView,
    actionsAhead: actionsAhead,
    needsYou: needsYou,
    homeView: homeView,
    homeCounts: homeCounts,
    jobBits: jobBits,
    tabPlan: tabPlan,
    splitThread: splitThread,
    systemFoldText: systemFoldText
  };
});
