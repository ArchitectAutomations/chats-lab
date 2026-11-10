/* Pure helpers for the conversation page. No DOM, no network: unit-tested in
   tools/tests/test_lib.js (node) and loaded by the browser as window.CVLib. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CVLib = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TZ = 'America/Toronto'; // default; configure({ timeZone }) can change it
  var SESSION_RAN_OUT = 'Your session ran out. Sign out and sign in again.';
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
    if (v === null || v === undefined || v === '') return null;   // new Date(null) is 1970: never a real time
    var d = v instanceof Date ? v : new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  // A timestamp a person can read as "ago": a real date that is not the epoch (a missing value often arrives as 0 or 1970).
  function realTime(v) { var d = toDate(v); return d && d.getTime() > 86400000 ? d : null; }

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
    var d = realTime(iso);
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

  var CUSTOM = { status: {}, tiers: {}, lost: {}, sources: {}, locale: 'en-CA', currency: 'CAD', waitWarnHours: 24, quoteAgeWarnDays: 21 };

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
    CUSTOM.sources = plainMap(c.sourceLabels);
    var wh = Number(c.waitWarnHours);
    CUSTOM.waitWarnHours = isFinite(wh) && wh >= 1 && wh <= 720 ? wh : 24;
    // Days after which a saved owner price gets an age warning on its card: 0 = off, 7 to 29 whole days, anything else = 21.
    // (The server refuses to text a price older than 30 days, sql/023; the warning comes ahead of that.)
    var qa = c.quoteAgeWarnDays === undefined || c.quoteAgeWarnDays === null || c.quoteAgeWarnDays === '' ? NaN : Number(c.quoteAgeWarnDays);
    CUSTOM.quoteAgeWarnDays = qa === 0 ? 0 : (isFinite(qa) && Math.floor(qa) === qa && qa >= 7 && qa <= 29 ? qa : 21);
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
    backfill: 'Sent'
  };

  function kindLabel(kind) {
    if (Object.prototype.hasOwnProperty.call(KIND_LABELS, kind)) return KIND_LABELS[kind];
    return kind ? String(kind).replace(/_/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); }) : '';
  }

  // Kevin 11-09: who wrote each text, as a small label on the bubble. Customer texts carry the lead's first name ("Customer" when
  // there is none). Every automatic text to the lead is "Assistant" (review r3 item 6). backfill = Twilio history of unknown origin,
  // mostly automatic: "Sent", never "You". A quote text can be the intake quote or one the owner sent from the page: "Quote" says what
  // it is without claiming who. Texts to the owner keep their kind label. The name is shown as text only (it is customer input).
  var ASSISTANT_KINDS = { ai_reply: true, re_engage: true, handoff_ack: true, holding_reply: true, optout_confirm: true, followup_nudge: true };
  var SENDER_MAX = 30;
  function senderFirstName(lead) {
    var n = lead ? (String(lead.first_name || '').trim() || String(lead.full_name || lead.display_name || '').trim()).split(/\s+/)[0] || '' : '';
    n = n.replace(/[\u0000-\u001f\u007f]/g, '');
    if (!n) return 'Customer';
    n = titleCase(n);   // the same casing as the name at the top of the record ("SAMPLE" -> "Sample", "maria" -> "Maria")
    return n.length > SENDER_MAX ? n.slice(0, SENDER_MAX - 1) + '\u2026' : n;
  }
  // D5 (Kevin 11-10): the "Open full" window is titled "Conversation with Sam". No real name on file (nothing, or only the
  // "Lead ending 1234" stand-in) = a plain "Conversation". Text only; the name is customer input, shown with textContent.
  // Controls, soft hyphen, zero-width space, direction marks and bidi overrides/isolates, word joiners, byte-order mark. (ZWJ / ZWNJ stay: emoji and several scripts need them.)
  var INVISIBLE_RE = /[\u0000-\u001f\u007f-\u009f­؜᠎​‎‏‪-‮⁠-⁯﻿]/g;
  var NAME_TITLES = /^(dr|mr|mrs|ms)\.?$/i;
  // The first real word of a name: invisible characters dropped, a leading Dr. / Mr. / Mrs. / Ms. skipped; '' when nothing readable is left.
  function nameWord(raw) {
    var words = String(raw == null ? '' : raw).split(/\s+/).map(function (w) { return w.replace(INVISIBLE_RE, ''); }).filter(Boolean);
    while (words.length && NAME_TITLES.test(words[0])) words.shift();
    var w = words[0] || '';
    return /[\p{L}\p{N}]/u.test(w) ? w : '';
  }
  // Cut by what a person sees as one character (an emoji or an accented letter is never split); older browsers cut by code point.
  function cutGraphemes(str, max) {
    var parts;
    try {
      parts = typeof Intl !== 'undefined' && Intl.Segmenter ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(str), function (x) { return x.segment; }) : Array.from(str);
    } catch (e) { parts = Array.from(str); }
    return parts.length > max ? parts.slice(0, max - 1).join('') + '…' : str;
  }
  function convoTitle(lead) {
    if (!lead) return 'Conversation';
    var cands = [lead.first_name, lead.full_name, lead.display_name];
    for (var i = 0; i < cands.length; i++) {
      var raw = String(cands[i] == null ? '' : cands[i]).trim();
      if (!raw) continue;
      if (/^(Lead ending \d{4}|Unnamed lead)$/i.test(raw)) return 'Conversation';
      var n = nameWord(raw);
      if (n) return 'Conversation with ' + cutGraphemes(titleCase(n), SENDER_MAX);
    }
    return 'Conversation';
  }
  function bubbleSender(m, lead) {
    if (!m) return '';
    if (m.audience === 'owner') return kindLabel(m.kind);   // the automatic texts to the owner: as before
    if (m.direction === 'in') return senderFirstName(lead);
    if (ASSISTANT_KINDS[m.kind] === true) return 'Assistant';
    if (m.kind === 'backfill') return 'Sent';
    return kindLabel(m.kind) || 'Sent';
  }
  // One label per run: a bubble straight after one from the same sender, on the same day, shares the label above it ('').
  function bubbleLabels(chat, lead) {
    var prev = null, prevLabel = '';
    return (Array.isArray(chat) ? chat : []).map(function (m) {
      var label = bubbleSender(m, lead);
      var shared = prev && label === prevLabel && sameDay(prev.at, m.at);
      prev = m; prevLabel = label;
      return shared ? '' : label;
    });
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
  // The contacted / booked / lost chips reuse the status labels, so a client's wording carries through.
  // 'needs' has no chip: it is the full Needs-you list behind "See all" (round 4), remembered like a chip.
  var FILTER_KEYS = ['all', 'needs', 'open', 'contacted', 'booked', 'lost'];
  // 'noquote' (gap 1) is a sixth, page-counted chip shown only when it has leads: it is remembered like the others, so a saved 'noquote' is valid here
  // and app.js falls back to 'open' when the chip is off or empty. It is not in FILTER_KEYS / filterCounts (the server counts those five).
  var CHIP_KEYS = ['open', 'contacted', 'booked', 'lost', 'all', 'noquote'];
  // The five chips on Home, in display order. Open is the default. Contacted (round 4, Kevin 11-09) is the part of Open
  // he has already reached: status contacted (so never booked or lost).
  function filters() {
    return [
      { key: 'open', label: 'Open' },
      { key: 'contacted', label: statusInfo('contacted').label },
      { key: 'booked', label: statusInfo('booked').label },
      { key: 'lost', label: statusInfo('lost').label },
      { key: 'all', label: 'All' }
    ];
  }

  // A remembered list choice: a chip only. The full Needs-you list ("See all") is never remembered across reloads (review r4
  // item 6): a reload always opens on the chips with the Needs-you block on top.
  function isFilterKey(key) {
    return CHIP_KEYS.indexOf(key) !== -1;
  }

  // Gap 1: an open lead the customer has not been quoted. The SAME rule as the Metrics count open_no_quote (sql/005: open = not booked / lost /
  // opted out and opted_out false; no quote_total). A price the owner saved but has not sent (owner_price) does not change that: it is still "no quote sent".
  // lead_list has no opted_out column, and a STOP from a hand-added (or booked / lost) lead keeps its status. The app therefore also gives the numbers
  // lead_detail says opted out (setOptedOutPhones, the lookup Add lead uses), and those leads are never "no quote sent" (Metrics leaves them out too).
  var OPTED_KEYS = {};
  function setOptedOutPhones(phones) {
    var next = {};
    (Array.isArray(phones) ? phones : []).forEach(function (p) { var k = phoneKey(p); if (k) next[k] = true; });
    var changed = Object.keys(next).sort().join(',') !== Object.keys(OPTED_KEYS).sort().join(',');
    OPTED_KEYS = next;
    return changed;
  }
  function noQuoteOpen(lead) {
    if (!lead || statusGroup(lead.status) !== 'open' || isOptedOut(lead)) return false;
    var k = phoneKey(lead.phone);
    if (k && OPTED_KEYS[k]) return false;
    return lead.quote_total === null || lead.quote_total === undefined || lead.quote_total === '';
  }
  // The "No quote sent" tag on a list row: owner only (a staff list has no prices, so every row would match), and only when the row
  // has no money text of its own (a saved price already reads "$X not sent" there).
  // G1 (Kevin 11-10): the tag is for the MAIN LIST (and its No quote filter) only. Search, Calendar, Follow-ups, See all and the Needs-you
  // cards ask without opts.mainList and get nothing. opts: { staff, hasMoney, mainList }.
  function noQuoteTag(lead, opts) {
    var o = opts || {};
    if (o.mainList !== true || o.staff || o.hasMoney || !noQuoteOpen(lead)) return '';
    return 'No quote sent';
  }
  function noQuoteCount(leads) {
    return (Array.isArray(leads) ? leads : []).filter(noQuoteOpen).length;
  }
  // The sixth chip: label "No quote", count from noQuoteCount (page side, over the rows loaded).
  function noQuoteChip() { return { key: 'noquote', label: 'No quote' }; }

  function matchesFilter(lead, key) {
    var st = String((lead && lead.status) || '').toLowerCase();
    if (key === 'noquote') return noQuoteOpen(lead);
    if (key === 'needs') return st === 'handed_off';
    if (key === 'contacted') return st === 'contacted';
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

  // A lead who never agreed to automatic texts (added by hand): auto_texts false. The server never texts these leads on its own.
  // R2 (B6): lead_list and lead_detail both carry auto_texts now, so it decides whenever it is there: a hand-added lead that a website form
  // for the same date upgraded has auto_texts true and is treated like a form lead. Only a read with no auto_texts at all (an older server)
  // falls back to the source.
  function noConsent(lead) {
    if (!lead) return false;
    if (lead.auto_texts === true) return false;
    if (lead.auto_texts === false) return true;
    return lead.source === 'manual';
  }

  // A1 / B2 (Kevin 11-10): the lines about a lead who texted STOP. They say the same thing wherever they show.
  var STOP_NO_FOLLOWUP = "They texted STOP, so they won't get a follow-up text.";
  // B2 (chair, 11-10): the red banner on the record. STOP only stops AUTOMATIC texts; the owner may still text them himself, so his banner says what the system does.
  // Staff keep the old words. The record's "next" line for a STOP lead who waits on the owner is never empty (owner only).
  var STOP_BANNER_OWNER = 'They texted STOP: the system sends them nothing.';
  var STOP_BANNER_STAFF = 'Do not text: this person opted out.';
  function stopBanner(staff) { return staff ? STOP_BANNER_STAFF : STOP_BANNER_OWNER; }
  // Same rule as Needs you (waitsOnOwner): only a STOP lead that really waits on the owner (a hand-added one), never a form lead with just the flag.
  function stopNextLine(lead) {
    return waitsOnOwner(lead) && isOptedOut(lead) ? 'Call or text them yourself.' : '';
  }
  var STOP_PERSONAL_TEXT = 'They texted STOP to your business number. Texts from your own phone are up to you.';

  // WF3 needs the event date to be on or after the day it runs, and marked now it runs at the first 10 am at least 5 days away.
  // WF3 counts 120 real hours (not calendar days), so the clock change in Toronto can move its run day; count the same way.
  function followupMissesEvent(eventDate, now) {
    var ev = /^\d{4}-\d{2}-\d{2}/.exec(String(eventDate || ''));
    if (!ev) return false;
    var p = partsOf(new Date(nowDate(now).getTime() + FOLLOWUP_DAYS * 86400000));
    var beforeTen = p.period === 'am' && (Number(p.hour) % 12) < 10;
    var run = new Date(Date.UTC(p.y, p.m - 1, p.d + (beforeTen ? 0 : 1)));
    return ev[0] < run.toISOString().slice(0, 10);
  }

  // Plain-words question for the confirm sheet. `now` is for tests.
  function confirmText(name, status, lead, plain, now) {
    var who = String(name || '').trim() || 'this lead';
    if (ACTION_STATUSES.indexOf(status) === -1) return '';
    var lc = function (st) { return statusInfo(st).label.toLowerCase(); };
    var q = 'Mark ' + who + ' as ' + lc(status) + '?';
    // A1 (Kevin 11-10): a lead who texted STOP can be marked Contacted by the owner; the sheet says plainly that no follow-up goes to them. Before the
    // booked / lost line (which it adds to) and the no-consent line (the STOP fact matters more to the owner).
    if (status === 'contacted' && isOptedOut(lead)) {
      var gone = lead.status === 'booked' || lead.status === 'lost' ? ' The ' + lc(lead.status) + (lead.status === 'booked' ? ' price' : ' reason') + ' will be cleared.' : '';
      return q + gone + ' ' + STOP_NO_FOLLOWUP;
    }
    if (plain) return q; // no promise about texts: used where the page cannot tell which leads get follow-ups
    // 021: moving a booked or lost lead back uses up the day-5 text and removes what was recorded (sql/021), so the sheet says both. Before the no-consent line: an added lead has a price to lose too.
    if (status === 'contacted' && lead && (lead.status === 'booked' || lead.status === 'lost')) {
      return q + ' The ' + lc(lead.status) + (lead.status === 'booked' ? ' price' : ' reason') + ' will be cleared. No follow-up text will go out.';
    }
    if (status === 'contacted' && noConsent(lead)) return q + ' No automatic texts go to leads you added.';
    if (status === 'contacted') {
      if (lead && followupMissesEvent(lead.event_date, now)) return q + ' No follow-up text will go out.';
      // Contacted or texted before: its one follow-up may be used up, and the page cannot see that. Promise nothing.
      if (lead && (lead.contacted_at || lead.nudge_sent_at)) return q;
      // 022: the server's own answer (lead_detail.followup_possible) beats the promise below; absent (older read, staff) = as before.
      if (lead && lead.followup_possible === false) return q + ' No follow-up text will go out.';
      return q + " They'll get one follow-up text in 5 days unless you mark them " + lc('booked') + ' or ' + lc('lost') + '.';
    }
    if (noConsent(lead)) return q;
    return q + " They won't get the next follow-up text.";
  }

  // The hint under the Final price box of the Booked sheet. Only a price that was really filled in from the quote says so; an empty box says nothing.
  function bookedPriceHint(prefilled) {
    return String(prefilled === null || prefilled === undefined ? '' : prefilled).trim() ? 'From the quote. Change it if the price differs.' : '';
  }

  // 022 + R2 (B5, Kevin 11-10 "C"): the sheet's two buttons on Contacted whenever the server says the lead could really get the day-5 text
  // (lead_detail.followup_possible === true): form and text-first leads, quoted or not. Never for a lead who texted STOP (A1: the sheet says so
  // instead, see confirmText) and never for a hand-added lead with no consent (the server says followup_possible false for both; the checks are
  // belt and braces). The FIRST button (send) is today's behaviour for a quoted lead.
  // The notes describe WF3's actual text (F016_FOLLOWUP_TEMPLATE): it never names a quote or a price.
  // null = no choice: the usual sheet and the usual single button.
  var FOLLOWUP_TEXT_NOTE = "If you send the follow-up, they get one text in 5 days saying you reached out and asking if they'd still like to go ahead. It doesn't mention a quote or a price.";
  function followupChoice(name, status, lead) {
    if (status !== 'contacted' || !lead) return null;
    if (lead.followup_possible !== true || isOptedOut(lead) || noConsent(lead)) return null;
    var who = String(name || '').trim() || 'This lead';
    var lc = statusInfo('contacted').label.toLowerCase();
    var note = lead.quote_received === true
      ? who + ' already has a quote. ' + FOLLOWUP_TEXT_NOTE + " Choose no follow-up if you'd rather chase them yourself."
      : lead.quote_received === false
        ? who + " hasn't received a quote yet. " + FOLLOWUP_TEXT_NOTE
        : FOLLOWUP_TEXT_NOTE.charAt(0).toUpperCase() + FOLLOWUP_TEXT_NOTE.slice(1);
    return {
      text: 'Mark ' + (String(name || '').trim() || 'this lead') + ' as ' + lc + '?',
      note: note,
      send: 'Mark ' + lc + ' and send the follow-up',
      none: 'Mark ' + lc + ', no follow-up'
    };
  }

  // Can the page offer this change? Mirrors cv_set_lead_status (sql/021, 028): the current status again is a no-op;
  // won / dormant leads are locked for everyone; a lead who texted STOP (status opted_out) is locked for staff but open to the OWNER (A1,
  // Kevin 11-10), so the owner's callers pass asOwner = true; everything else is open to the owner, including going back from
  // booked or lost to contacted. Staff have their own stricter rules (staffActionsAhead, cv_set_lead_status). Leaving asOwner out = the
  // locked answer, so a caller that forgets it can only ever offer less.
  var LOCKED = { won: 1, dormant: 1, opted_out: 1 };
  var OWNER_OPEN = { opted_out: 1 };
  function canSetStatus(current, target, asOwner) {
    var c = String(current || '').toLowerCase();
    if (!target || c === target) return false;
    if (LOCKED[c] && !(asOwner === true && OWNER_OPEN[c])) return false;
    return true;
  }

  // The status that decides the owner's buttons: the plain status. (Before R2 the opted-out flag locked the buttons; the owner may now
  // mark a lead who texted STOP, so the flag no longer changes them.) Staff keep reading the plain status (staffActionsAhead).
  function actionsKey(lead) {
    return String((lead && lead.status) || '').toLowerCase();
  }

  // One plain line under the buttons when the page can't change this lead at all. Staff (asOwner not true) are still locked out of a lead who
  // texted STOP; the owner is not (A1).
  function actionsNote(current, asOwner) {
    var c = String(current || '').toLowerCase();
    if (c === 'opted_out' && asOwner !== true) return 'This lead opted out of texts, so their status is locked.';
    if (c === 'won' || c === 'dormant') return 'This lead is closed, so its status is locked.';
    return '';
  }

  // Heading of the status card: plain when the page can't change this lead at all ("Status locked").
  function statusHeading(current, asOwner) {
    var c = String(current || '').toLowerCase();
    return actionsNote(c, asOwner) && !actionsAhead(c, asOwner).length ? 'Status locked' : 'Change status';
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
    note_too_long: 'Keep the note under 500 characters.',
    bad_followup: 'Pick one of the two follow-up choices.',
    followup_only_with_contacted: 'Pick one of the two follow-up choices.'
  };
  // 028 (A1): a stale page asked to send the follow-up to a lead who texted STOP. Nothing was saved; the page refetches after this.
  // The status word is the client's own (statusInfo), not hard-coded.
  function stopRefusalText() {
    return 'They texted STOP, so no follow-up text can be sent to them. The page is up to date now: tap ' + statusInfo('contacted').label + ' again and it will save without one.';
  }

  // Staff-only refusals from cv_set_lead_status (sql/018): plain words.
  var STAFF_ERRORS = {
    staff_no_price: 'Only the owner can enter a final price. Mark the lead booked without one and the owner adds it.',
    staff_open_leads_only: 'Staff can only change a lead that is still open. Ask the owner to change a booked or lost lead.'
  };

  function friendlyStatusError(err, role) {
    var raw = String((err && err.message) || (typeof err === 'string' ? err : '')).trim();
    var msg = raw.toLowerCase();
    var sm = /\b(staff_no_price|staff_open_leads_only)\b/.exec(msg);
    if (sm) return STAFF_ERRORS[sm[1]];
    var m = /\b(not_owner|bad_status|not_found|not_allowed|bad_input)\b\s*(?::\s*([^\n]*))?/.exec(msg);
    if (m) {
      if (m[1] === 'bad_input') {
        var why = String(m[2] || (err && err.details) || '').trim().toLowerCase().replace(/[.\s]+$/, '').replace(/[\s-]+/g, '_');
        if (why === 'opted_out_no_followup') return stopRefusalText();
        return BAD_INPUT[why] || 'Check the price or the reason and try again.';
      }
      if (m[1] === 'not_owner' && role === 'staff') return 'The owner has switched this off for your account.';
      if (m[1] === 'not_owner') return "Your sign-in isn't linked to this lead's business. Sign out, then sign in with your own number.";
      if (m[1] === 'bad_status') return "The page sent a status the system doesn't accept. Reload the page and try again.";
      if (m[1] === 'not_found') return "This lead can't be found any more. Go back to your list.";
      var reason = String(m[2] || (err && err.details) || '').trim().toLowerCase().replace(/[.\s]+$/, '');
      var key = reason.replace(/[\s-]+/g, '_');
      if (NOT_ALLOWED[key]) return NOT_ALLOWED[key];
      return reason ? "This change isn't allowed for this lead (" + reason.replace(/_/g, ' ') + ').' : "This change isn't allowed for this lead.";
    }
    var status = err && err.status;
    if (status === 401 || (err && err.code === 'PGRST301') || /jwt/.test(msg)) return SESSION_RAN_OUT;
    if (/failed to fetch|network|load failed/.test(msg)) return "Can't reach the server. Check your connection and try again.";
    return "Couldn't save that. Try again in a moment.";
  }

  /* ---------- history ---------- */

  var HISTORY_ACTIONS = {
    'new': 'New lead', engaged: 'Started texting', quoted: 'Quoted', handed_off: 'Asked for you',
    contacted: 'Contacted', booked: 'Booked', lost: 'Lost', opted_out: 'Opted out', reopened: 'Reopened',
    quote_priced: 'Priced by you', quote_sent: 'Quote sent'
  };
  var HISTORY_SOURCES = {
    page: 'from the page', sms: 'by text', text: 'by text', owner_sms: 'by text', bulk: 'bulk clear',
    system: 'automatic', auto: 'automatic', workflow: 'automatic', bot: 'automatic'
  };

  // lead_history.no_followup (sql/022): why a page Contacted took the day-5 text away.
  var NO_FOLLOWUP_HISTORY = { chosen: 'No follow-up text (you chose)', no_quote: 'No follow-up text (no quote sent)', opted_out: 'No follow-up text (they texted STOP)' };
  function historyLine(h, now) {
    if (!h) return '';
    var a = String(h.action || '').toLowerCase();
    var label = CUSTOM.status[a] || HISTORY_ACTIONS[a] || statusInfo(a).label;
    var s = String(h.source || '').toLowerCase();
    var src = HISTORY_SOURCES[s] || (s ? s.replace(/_/g, ' ') : '');
    var extra = a === 'booked' || a === 'quote_priced' || a === 'quote_sent' ? fmtMoney(h.amount) : a === 'lost' ? lostReasonLabel(h.reason) : a === 'contacted' ? NO_FOLLOWUP_HISTORY[h.no_followup] || '' : '';
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

  // 023: one value per lead. What the customer was quoted wins; a price the owner saved but has not sent stands in only when there is no quote.
  // Never added on top of anything: every total that uses it uses this one number.
  function effectiveTotal(lead) {
    if (!lead) return null;
    if (lead.quote_total !== null && lead.quote_total !== undefined && lead.quote_total !== '') return lead.quote_total;
    return lead.owner_price !== null && lead.owner_price !== undefined && lead.owner_price !== '' ? lead.owner_price
      : (lead.owner_quote && typeof lead.owner_quote === 'object' && lead.owner_quote.state !== 'sent' ? lead.owner_quote.total : null);
  }

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
      s.totalCents += toCents(effectiveTotal(l)) || 0;
    });
    function byQuote(a, b) {
      var d = (toCents(effectiveTotal(b)) || 0) - (toCents(effectiveTotal(a)) || 0);
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

  // Call / Text / Email buttons in the client's order. B2 (Kevin 11-10): the OWNER's Text button shows for every lead, a lead who texted STOP
  // included (it opens the owner's own Messages app; nothing automatic is sent). Staff keep the old rule (opts.staff): no Text for an opted-out lead.
  var CONTACT_DEFAULT = ['call', 'text', 'email'];
  function contactActions(lead, order, opts) {
    var staff = !!(opts && opts.staff);
    var want = Array.isArray(order) && order.length ? order : CONTACT_DEFAULT;
    var out = [];
    want.forEach(function (k) {
      if (out.some(function (a) { return a.key === k; })) return;
      var href = null, label = '';
      if (k === 'call') { href = telHref(lead && lead.phone); label = 'Call'; }
      else if (k === 'text') { if (staff && isOptedOut(lead)) return; href = smsHref(lead && lead.phone); label = 'Text'; }
      else if (k === 'email') { href = mailtoHref(lead && lead.email); label = 'Email'; }
      if (href) out.push({ key: k, label: label, href: href });
    });
    return out;
  }

  // "just now", "12 min ago", "3 h ago", "1 day ago", "4 days ago"
  function fmtSince(iso, now) {
    var d = realTime(iso);
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
    var d = realTime(iso);
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
  // opts.owner (R2, A1): the owner may mark a lead who texted STOP, so once marked it reads like any lead. Only status opted_out (nothing marked
  // yet) stays empty for him. Staff (no opts) keep the old empty line for every STOP lead.
  function nextAction(lead, now, nudge, opts) {
    if (!lead || (opts && opts.owner === true ? String(lead.status || '').toLowerCase() === 'opted_out' : isOptedOut(lead))) return '';
    var st = String(lead.status || '').toLowerCase();
    if (noConsent(lead)) nudge = null;
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
      // the reason is in the status chip beside it ("Lost · Went elsewhere"): said once (review r3 item 7)
      var la = lead.lost_at || lead.status_at;
      return 'Marked ' + lc('lost') + (la ? ' ' + fmtShortDate(la, now) : '');
    }
    if (st === 'handed_off') {
      var since = lead.status_at || lead.created_at;
      return 'Asked for you' + (since ? ' ' + fmtSince(since, now) : '') + ', not ' + lc('contacted') + ' yet';
    }
    if (st === 'contacted') {
      if (noConsent(lead)) return 'Follow up yourself \u2014 no automatic texts. ' + markWhen;
      if (lead.nudge_sent_at) return 'Follow-up text sent ' + fmtShortDate(lead.nudge_sent_at, now) + '. ' + markWhen;
      // No pending row in follow_ups (WF3's own rules, handled above): no text is coming, or the page does not know yet. Never promise one.
      return statusInfo('contacted').label + '. ' + markWhen;
    }
    if (st === 'quoted') {
      var q = realTime(lead.status_at) || realTime(lead.last_outbound_at);
      var inb = realTime(lead.last_inbound_at);
      if (inb && (!q || inb.getTime() > q.getTime())) return 'They replied ' + fmtSince(inb, now);
      return q ? 'Quote sent ' + fmtSince(q, now) + ', no reply' : 'Quote sent, no reply yet';
    }
    if (st === 'engaged') {
      return 'Texting with the assistant' + (lead.last_inbound_at ? ', last reply ' + fmtSince(lead.last_inbound_at, now) : '');
    }
    if (st === 'new') return 'New lead' + (lead.created_at ? ' ' + fmtSince(lead.created_at, now) : '');
    return '';
  }

  // Back / Forward landed somewhere: what the full conversation view must do. 'hide' = close it (a normal Back).
  // 'step' = this is the leftover history entry of a view that is already closed: go back one more so Back is never a dead step.
  // It cannot loop: 'step' only ever moves backward, every marked entry sits above the plain entry it was pushed from,
  // and at the start of the history back() does nothing and fires no popstate.
  function fullPopAction(viewOpen, state) {
    if (viewOpen) return 'hide';
    return state && state.cvFull ? 'step' : '';
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

  // The sums under a quote's lines, with no row that repeats one above it (Kevin 11-09, review r3 items 1 + 7). The engine puts
  // delivery IN the line items (label "Delivery", amount = what is charged) and leaves it OUT of subtotal (Compute Quote:
  // total = subtotal + travel_fee), so when a line carries it a Subtotal / Travel fee row would count it twice: none then. A travel fee
  // that no line carries (an older stored shape) still shows Subtotal + Travel fee. No travel fee: the subtotal is the total again.
  // One line, no discount, nothing added: that line IS the total, so no Total row. rawItems = the stored / engine line items.
  // Round 4 (review r3 item C): the engine's own delivery line only, label exactly "Delivery" (Owner Quote / Compute Quote,
  // n8n/lab-sub.json travelItem). A line merely containing the word ("Bar delivery", "Travel bar") is not the travel fee, so an
  // old-format quote that has one AND a separate travel fee still shows the fee.
  var TRAVEL_LINE = /^\s*delivery\s*$/i;
  function quoteSums(rawItems, subtotal, travelFee, total) {
    var items = (Array.isArray(rawItems) ? rawItems : []).filter(function (it) { return it && typeof it === 'object'; });
    var inLines = items.some(function (it) { return TRAVEL_LINE.test(String(it.label || '')); });
    var travel = !inLines && toCents(travelFee) !== null && toCents(travelFee) > 0;
    var discounted = items.some(function (it) { var d = toCents(it.discount); return d !== null && d !== 0; });
    var t = toCents(total);
    var oneLine = items.length === 1 && !discounted && !travel && t !== null && toCents(items[0].amount) === t;
    return { subtotal: travel ? fmtMoney(subtotal) : '', travel: travel ? fmtMoney(travelFee) : '', total: oneLine ? '' : fmtMoney(total) };
  }

  // Quote block: line items + the sums (quoteSums), or the "needs your review" state. totalRow = the Total row ('' = not drawn);
  // final = the booked price, only when it differs from the quote total (review r3 item 7).
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
      subtotal: '', travel: '', totalRow: '', final: '',
      total: defer ? '' : fmtMoney(lead.quote_total)
    };
    if (!defer) {
      var sums = quoteSums(lead.quote_line_items, lead.quote_subtotal, lead.quote_travel_fee, lead.quote_total);
      view.subtotal = sums.subtotal; view.travel = sums.travel; view.totalRow = sums.total;
      var b = toCents(lead.booked_amount);
      if (statusGroup(lead.status) === 'booked' && b !== null && b !== toCents(lead.quote_total)) view.final = fmtMoney(lead.booked_amount);
    }
    view.empty = !defer && !view.items.length && !view.total && !fmtMoney(lead.quote_subtotal);
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
    // Kevin 11-09: the Event card holds the WHOLE event (date and guests moved here from the header line); the price stays
    // out (header money line + Quote card). Every form question about the event is here; an empty answer is left out.
    add('date', 'Date', fmtEventDate(lead.event_date, now));
    add('time', 'Time', fmtTimeRange(lead.start_time, lead.end_time));
    var g = Number(lead.guests);
    if (lead.guests !== null && lead.guests !== undefined && lead.guests !== '' && isFinite(g) && g > 0) add('guests', 'Guests', g.toLocaleString('en-CA'));
    add('occasion', 'Occasion', String(lead.occasion || '').trim());
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

  // Lead page header: the email as text (or a plain "No email given"), and the event details split into the ones
  // always shown (key) and the ones behind "More details" (more). Date and guests stay in the job line; the price stays in the
  // quote cards. opts.staff drops everything money-related (the offer / promo) even if a read ever carried it.
  function emailLine(lead) {
    var raw = lead && typeof lead.email === 'string' ? lead.email.trim() : '';
    if (!raw) return { text: 'No email given', href: null, missing: true };
    return { text: raw, href: mailtoHref(raw), missing: false };
  }
  function leadDetails(lead, opts) {
    var out = { key: [], more: [], words: '' };
    if (!lead) return out;
    var staff = !!(opts && opts.staff);
    var facts = eventFacts(lead, opts && opts.now);
    function pick(k) { return facts.filter(function (f) { return f.key === k; }); }
    function one(key, label, value) { return value ? [{ key: key, label: label, value: String(value) }] : []; }
    var hours = String(lead.service_hours_label || '').replace(/\s+/g, ' ').trim();
    var bar = lead.bar_rental === true ? 'Yes' : lead.bar_rental === false ? 'No' : '';
    // One list, in the order an owner plans the job: when, how many, what, how long, where, bar; then extra dates and the offer.
    // Nothing is hidden behind "More details" any more (Kevin 11-09: the card must show the event in its entirety); `more` stays empty.
    out.key = [].concat(pick('date'), pick('time'), pick('guests'), pick('occasion'), one('hours', 'Hours', hours), pick('area'),
      one('bar', 'Bar rental', bar), pick('multi'), staff ? [] : pick('offer'));
    out.words = String(lead.additional_details || '').trim();
    return out;
  }
  // "In their words" on the Event card: in full when short; a long message opens at its first ~300 characters with "Show all".
  var WORDS_SHORT = 300;
  function wordsView(text) {
    var t = String(text == null ? '' : text).trim();
    if (t.length <= WORDS_SHORT + 40) return { full: t, short: t, long: false };
    var cut = t.slice(0, WORDS_SHORT);
    var sp = cut.search(/\s\S*$/);
    return { full: t, short: (sp > WORDS_SHORT - 60 ? cut.slice(0, sp) : cut).replace(/[\s,;:.\-]+$/, '') + '\u2026', long: true };
  }
  // Header money line (owner only): the ONE figure an owner needs before calling, above the fold. The Quote card below has the lines.
  function headMoney(lead) {
    if (!lead) return '';
    // Booked: the booked price, else the quote, as "booked" (what Metrics, Ask and the spreadsheet count; review r3 item 2).
    if (statusGroup(lead.status) === 'booked') {
      var bk = toCents(lead.booked_amount) !== null ? fmtMoney(lead.booked_amount) : fmtMoney(lead.quote_total);
      if (bk) return bk + ' booked';
    }
    var q = fmtMoney(lead.quote_total);
    if (q) return q + ' quoted';
    return quotedOrOwnerMoney(lead);   // a saved price: "$515 not sent", "$515 sending now", "$515 may have gone out"
  }

  /* ---------- metrics (cv_metrics) ---------- */

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  /* ---------- Looking ahead (cv_forecast, sql/015) ---------- */

  var FC_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // 'YYYY-MM' -> 'Nov 2026'; anything else -> ''.
  function forecastMonthLabel(ym) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
    if (!m) return '';
    var i = Number(m[2]) - 1;
    return i >= 0 && i < 12 ? FC_MONTHS[i] + ' ' + m[1] : '';
  }
  function fcPair(o) {
    var c = num(o && o.count) || 0;
    var t = num(o && o.total);
    return { count: c, total: t === null ? 0 : t };
  }
  // Booked money text: "price not set" when jobs are booked but carry no amount (never "$0").
  function fcBooked(p) { return p.count > 0 && !(p.total > 0) ? 'price not set' : fmtMoney(p.total); }
  // The cv_forecast() JSON -> what the block shows, or null when the block must stay hidden (no data, or switched off).
  // Certain numbers always come through; the range only when tracking.ready is true AND every range number is usable.
  // When not ready no percentage and no range is ever put in the model.
  function forecastView(f) {
    if (!f || typeof f !== 'object' || f.enabled === false || !Array.isArray(f.months)) return null;
    var tr = f.tracking || {};
    var rows = f.months.map(function (mo) {
      var b = fcPair(mo && mo.booked), o = fcPair(mo && mo.open);
      return { label: forecastMonthLabel(mo && mo.month), bookedMoney: fcBooked(b), bookedCount: b.count,
        openMoney: fmtMoney(o.total), openCount: o.count };
    });
    var lb = fcPair(f.later && f.later.booked), lo = fcPair(f.later && f.later.open);
    var openCount = lo.count, openTotal = lo.total;
    f.months.forEach(function (mo) { var o = fcPair(mo && mo.open); openCount += o.count; openTotal += o.total; });
    var totals = f.totals || {};
    var low = num(totals.low), high = num(totals.high);
    var ready = tr.ready === true && openCount > 0 && low !== null && high !== null && high >= low;
    var pe = fcPair(f.past_event);
    var cohort = num(tr.cohort) || 0, recorded = num(tr.recorded) || 0;
    var v = {
      rows: rows,
      later: { bookedMoney: fcBooked(lb), bookedCount: lb.count, openMoney: fmtMoney(lo.total), openCount: lo.count },
      open: { money: fmtMoney(openTotal), count: openCount },
      ready: ready,
      range: ready ? fmtMoney(Math.round(low)) + ' to ' + fmtMoney(Math.round(high)) : '', // whole dollars; the contract stays in cents
      noOpenQuotes: tr.ready === true && openCount === 0,
      notReadyLines: []
    };
    if (!ready && !v.noOpenQuotes) {
      v.notReadyLines.push('Not enough history yet to estimate what will book.');
      v.notReadyLines.push('Outcome recorded for ' + recorded + ' of ' + cohort + ' past events.');
      // The sentence agrees with the Did-these-happen list: N = cohort - recorded (same leads cv_past_events returns).
      var n = Math.max(0, cohort - recorded), mt = num(f.past_event && f.past_event.markable_total);
      if (n > 0) {
        v.notReadyLines.push(plural(n, 'open lead has', 'open leads have') + ' an event date that has passed' +
          (mt !== null && mt > 0 ? ' (' + fmtMoney(mt) + ' in quotes)' : '') + '. Marking them Booked or Lost makes this forecast possible.');
      }
    }
    v.pastCount = Math.max(0, cohort - recorded);
    return v;
  }

  /* ---------- Did these happen? (cv_past_events, sql/016) ---------- */

  var PE_FIRST = 10;  // D2 (Kevin 11-10): the first call asks for 10 rows (p_limit 10); "Show more" then adds PE_SHOW at a time
  var PE_SHOW = 50;
  var PE_MAX = 200;   // cv_past_events clamps p_limit to 200
  // The cv_past_events() JSON -> what the section shows, or null when it must stay hidden (no data, switched off, nothing to review).
  // Names are plain text; the database sends no phone, email, address or messages, and none is read here.
  // limit (round 4, D2): how many the owner has asked to see: 10 to start, then 50 more per "Show more" up to 200; canMore = another page exists.
  // topLine / bulkLink (D2): the line at the top of the section, "N passed events." + the link that opens the bulk-clear sheet.
  function pastEventsView(res, limit) {
    if (!res || typeof res !== 'object' || res.enabled === false || !Array.isArray(res.items)) return null;
    var lim = Math.min(PE_MAX, Math.max(PE_FIRST, Math.floor(Number(limit) || 0)));
    var items = [];
    res.items.slice(0, lim).forEach(function (it) {
      if (!it || !isUuid(it.lead_id)) return;
      var q = num(it.quote_total), d = num(it.days_past);
      var date = fmtEventDate(it.event_date);
      var ago = d !== null && d >= 1 ? plural(Math.floor(d), 'day', 'days') + ' ago' : '';
      var quote = q !== null && q > 0 ? fmtMoney(q) : 'No quote';
      items.push({
        leadId: it.lead_id, name: displayName(it), quote: quote,
        meta: [date, ago, quote].filter(Boolean).join(' · '),
        lead: { lead_id: it.lead_id, display_name: it.display_name, quote_total: q, status: it.status }
      });
    });
    if (!items.length) return null;
    var total = num(res.total);
    if (total === null || total < items.length) total = items.length;
    var canMore = total > items.length && items.length >= lim && lim < PE_MAX;
    return { total: total, items: items, more: total - items.length, limit: lim, canMore: canMore,
      topLine: plural(total, 'passed event', 'passed events') + '.', bulkLink: 'Clear old ones in bulk',
      nextLimit: Math.min(PE_MAX, lim + PE_SHOW),
      moreBtn: canMore ? moreLabel(Math.min(PE_SHOW, total - items.length, PE_MAX - lim), total - items.length) : '',
      moreText: (total - items.length) + ' more. They appear here as you mark these.' };
  }

  /* ---------- clear old leads in bulk (round 4, sql/025 cv_bulk_lost*) ---------- */

  var BULK_REASON_KEY = 'old_lead';   // sql/026: the reason cv_bulk_lost writes (no note)
  // The date box's first value: the 1st of last month ("mark everything before October as Lost").
  function bulkDefaultDate(now) {
    var t = today(now), p = shiftMonth(t.y, t.m, -1);
    return ymd(p.y, p.m, 1);
  }
  // The line the last bulk clear leaves at the top of Follow-ups (review r4 item 5): "Marked 97 leads Lost on Nov 9." ('' without a count).
  function bulkUndoLine(marked, at, now) {
    var n = Math.floor(num(marked) || 0);
    if (n <= 0) return '';
    var d = fmtShortDate(at, now);
    return 'Marked ' + plural(n, 'lead', 'leads') + ' ' + statusInfo('lost').label + (d ? ' on ' + d : '') + '.';
  }
  // Review r4 item 2: the leads the server left alone, in plain words ('' when none).
  function bulkLeftText(recent, moreDates) {
    var r = Math.max(0, Math.floor(num(recent) || 0)), m = Math.max(0, Math.floor(num(moreDates) || 0));
    return [r ? plural(r, 'recent one', 'recent ones') + ' left alone (a text, a hand-over or a change in the last 14 days).' : '',
      m ? plural(m, 'lead', 'leads') + ' with more than one event date left alone.' : ''].filter(Boolean).join(' ');
  }
  // 028 (review F3): "Includes N who texted STOP." The server counts the leads it would mark that have the STOP flag (texted_stop). Kevin has not yet
  // ruled whether STOP leads stay in the bulk clear: THIS FUNCTION AND bulkPreviewView's `stopLine` are the whole page side, so ruling them out is
  // one deletion here (the server stops counting them with its own change).
  function bulkStopLine(res) {
    var n = Math.floor(num(res && res.texted_stop) || 0);
    return n > 0 ? 'Includes ' + n.toLocaleString('en-CA') + ' who texted STOP.' : '';
  }
  // cv_bulk_lost_preview JSON -> what the sheet says, or null (switched off / no answer). Names are plain text.
  // fingerprint = the exact set shown (review r4 item 1): no fingerprint, no Mark button.
  function bulkPreviewView(res, now) {
    if (!res || typeof res !== 'object' || res.enabled !== true) return null;
    var n = Math.max(0, Math.floor(num(res.count) || 0)), cap = Math.floor(num(res.cap) || 2000);
    var fp = typeof res.fingerprint === 'string' && /^[0-9a-f]{32}$/.test(res.fingerprint) ? res.fingerprint : '';
    var before = typeof res.before === 'string' ? fmtEventDate(res.before, now) : '';
    var sample = (Array.isArray(res.sample) ? res.sample : []).filter(function (it) { return it && isUuid(it.lead_id); }).map(function (it) {
      return { leadId: it.lead_id, name: displayName(it), meta: [fmtEventDate(it.event_date, now), statusInfo(it.status).label].filter(Boolean).join(' · ') };
    });
    var u = res.undo && typeof res.undo === 'object' && isUuid(res.undo.batch_id) && num(res.undo.can_undo) > 0 ? res.undo : null;
    var tooMany = n > cap || res.too_many === true;
    return {
      count: n, cap: cap, tooMany: tooMany, fingerprint: fp, sample: sample, sampleMore: Math.max(0, n - sample.length),
      left: bulkLeftText(res.left_recent, res.left_more_dates),
      stopLine: n > 0 && !tooMany ? bulkStopLine(res) : '',
      headline: !before ? '' : n === 0 ? 'No open leads have an event before ' + before + '.'
        : plural(n, 'lead', 'leads') + ' with an event before ' + before + ' will be marked ' + statusInfo('lost').label + '.',
      note: n > 0 && !tooMany ? 'No texts are sent. Reason: ' + lostReasonLabel(BULK_REASON_KEY) + '. Booked, lost and future events are left alone. You can undo this.' : '',
      capText: tooMany ? 'That is more than ' + cap.toLocaleString('en-CA') + ' at once. Pick an earlier date and clear them in steps.' : '',
      confirm: n > 0 && !tooMany && fp ? 'Mark ' + plural(n, 'lead', 'leads') + ' ' + statusInfo('lost').label : '',
      undo: u ? { batchId: u.batch_id, count: Math.floor(num(u.can_undo)), at: u.at, text: bulkUndoLine(u.marked, u.at, now) } : null
    };
  }
  var BULK_ERRORS = {
    changed: 'The list changed while you were looking. Check the new count and try again.',
    nothing: 'No leads match that date any more.',
    too_many: 'That is more than 2,000 leads at once. Pick an earlier date and clear them in steps.',
    feature_off: 'This is switched off for your account.',
    already_undone: 'That bulk clear was already undone.',
    not_latest: 'Only the latest bulk clear can be undone.',
    expired: 'A bulk clear can only be undone for 7 days.',
    date: 'Pick a date.', expected: 'Check the count and try again.', fingerprint: 'Check the count and try again.', batch: 'Nothing to undo.'
  };
  function bulkErrorText(e) {
    var msg = String((e && e.message) || '').toLowerCase(), det = String((e && e.details) || '').toLowerCase();
    if (BULK_ERRORS[det]) return BULK_ERRORS[det];
    if (msg === 'not_found') return 'Nothing to undo.';
    if (msg === 'not_owner' || (e && e.code === '42501')) return 'Only the owner can do this.';
    return "Couldn't save that. Nothing was changed. Try again.";
  }
  function bulkDoneText(r) {
    var n = Math.floor(num(r && r.marked) || 0);
    return plural(n, 'lead', 'leads') + ' marked ' + statusInfo('lost').label + '. No texts were sent.';
  }
  function bulkUndoneText(r) {
    var n = Math.floor(num(r && r.restored) || 0), k = Math.floor(num(r && r.skipped) || 0);
    return plural(n, 'lead', 'leads') + ' put back as they were.' + (k > 0 ? ' ' + plural(k, 'lead was', 'leads were') + ' changed since and left alone.' : '');
  }

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

  /* ---------- the owner's saved price on a lead (sql/023) ---------- */

  // Sending is OFF unless CV_CUSTOM.features.quoteSend is exactly true (Kevin has to see the wording first); the database has its own switch.
  function quoteSendFeatureOn(features) { return !!(features && typeof features === 'object' && features.quoteSend === true); }

  var OWNER_QUOTE_BLOCKS = {
    manual: 'You added this lead yourself, so there is no consent on file to text them. Send the price however you normally reach them.',
    opted_out: 'They opted out of texts, so it cannot be texted to them.',
    stop: 'They asked not to be texted, so it cannot be texted to them.',
    no_consent: 'There is no consent on file to text them.',
    bad_phone: "Their number can't be texted from here.",
    demo: 'This is a test lead, so no text can go to it.',
    closed: 'This lead is finished, so no text can go to it.',
    has_quote: 'They already have a quote.',
    event_passed: 'The event date has passed, so it cannot be texted to them.',
    details_changed: 'The event details changed after you priced this.',
    price_old: 'This price is more than 30 days old.',
    rate_changed: 'Your prices changed after this was worked out.'
  };
  // These only matter to a send, so nothing is said about them while sending is off. Re-pricing is the answer to the last three.
  var BLOCK_SEND_ONLY = { event_passed: true, details_changed: true, price_old: true, rate_changed: true };
  var BLOCK_REPRICE = { details_changed: true, price_old: true, rate_changed: true };
  // What the card says about a refused send. A reason this page does not know yet still gets a sentence.
  function ownerBlockNote(block, state, canSend) {
    if (!block || (!canSend && BLOCK_SEND_ONLY[block])) return '';
    var text = OWNER_QUOTE_BLOCKS[block] || (canSend ? "This price can't be texted right now." : '');
    if (!BLOCK_REPRICE[block]) return text;
    return text + (OWNER_REPRICE_STATES[state] ? ' Price it again before sending.' : ' It cannot be sent again as it is.');
  }
  // The states the server lets the owner price again from (sql/023 cv_add_lead_quote; unknown since crm-fix-final N4).
  var OWNER_REPRICE_STATES = { saved: true, failed: true, unknown: true };

  // Gap 3: a saved price that has sat for CV_CUSTOM.quoteAgeWarnDays or more (21 by default, 0 = off). added_at is when it was saved or
  // last re-priced (a little later than the day it was worked out, so the warning leans late, never early). Only an unsent price (saved / failed)
  // and only when the server gave no refusal of its own (that text already speaks). -> { days, text } | null.
  function ownerQuoteAge(o, state, block, canSend, now) {
    var limit = CUSTOM.quoteAgeWarnDays;
    if (!limit || block || (state !== 'saved' && state !== 'failed') || o.sent_at) return null;
    var t = timeOf(o.added_at);
    if (t === null) return null;
    var days = Math.floor((nowDate(now).getTime() - t) / 86400000);
    if (days < limit) return null;
    return { days: days, text: 'Priced ' + plural(days, 'day', 'days') + ' ago. ' + (canSend ? 'Check it before you send it. It cannot be texted after 30 days.' : 'Check it is still right before you use it.') };
  }

  // lead_detail.owner_quote -> what the lead page shows. null = nothing saved.
  function ownerQuoteView(lead, canSend, now) {
    var o = lead && lead.owner_quote;
    if (!o || typeof o !== 'object') return null;
    var state = String(o.state || 'saved');
    var block = o.send_block ? String(o.send_block) : '';
    var count = Number(o.send_count) || 0;   // texts the phone company really accepted; a refused or unconfirmed try is never counted here
    var sentAt = fmtStamp(o.sent_at, now);
    // A resend still going, refused or unconfirmed: the first text reached them, so the card stays "sent" and says what happened to the last one.
    var resend = !!o.sent_at && state !== 'sent' && state !== 'saved';
    var sentLine = 'Priced by you, sent' + (sentAt ? ' ' + sentAt : '') + (count > 1 ? ' (' + count + ' times)' : '');
    var status = 'Priced by you, not sent';
    if (state === 'sent') status = sentLine;
    else if (resend) status = sentLine + (state === 'sending' ? '. Sending it again now.' : state === 'failed' ? '. The last text did not go out.' : '. We could not confirm the last text went out.');
    else if (state === 'sending') status = 'Priced by you, sending now';
    else if (state === 'failed') status = 'Priced by you. The text did not go out.';
    else if (state === 'unknown') status = "Priced by you. We could not confirm the text went out.";
    var items = (Array.isArray(o.line_items) ? o.line_items : []).filter(function (it) { return it && typeof it === 'object'; }).map(function (it) {
      return { label: String(it.label || '').trim(), detail: String(it.detail || '').trim(), amount: fmtMoney(it.amount) };
    });
    var ownerSums = quoteSums(o.line_items, o.subtotal, o.travel_fee, o.total);
    var first = state === 'unknown' ? (resend ? 'It may have gone out. Check the conversation before sending again.' : 'The earlier text may have gone out. Check the conversation before sending or pricing it again.')
      : state === 'sending' ? 'It may already have gone out. Check the conversation.'
      : o.earlier_maybe_sent === true ? 'An earlier text with a price may have gone out. Check the conversation before sending.' : '';
    return {
      state: state, sent: state === 'sent' || resend, status: status, count: count, age: ownerQuoteAge(o, state, block, canSend, now),
      total: fmtMoney(o.total), items: items,
      // the Subtotal / Travel fee / Total rows to draw ('' = left out): quoteSums, so delivery is never counted twice (review r3)
      subtotal: ownerSums.subtotal, travel: ownerSums.travel, totalRow: ownerSums.total,
      // the customer-facing record already holds the price once it is sent: the card then only says when it went
      showDetails: state !== 'sent' && !resend,
      // sending / unknown / an earlier maybe-sent text: it may have reached them, and that is said first whatever else is true
      note: [first, ownerBlockNote(block, resend ? 'sent' : state, !!canSend)].filter(Boolean).join(' '),
      reprice: !!canSend && !!BLOCK_REPRICE[block] && !resend && !!OWNER_REPRICE_STATES[state],
      canSend: !!canSend && !block && !resend && (state === 'saved' || state === 'failed'),
      canResend: !!canSend && !block && (state === 'sent' || state === 'unknown' || (resend && state === 'failed')),
      sendLabel: state === 'failed' ? 'Try sending it again' : 'Send it to them'
    };
  }

  // A lead -> the calculator's fields. A saved price starts from the answers it was worked out with; otherwise whatever the lead holds.
  // "" / null = the lead does not say, the owner picks. Distance is only filled in from a saved price (the calculator works it out from the city).
  function quotePrefill(lead) {
    var o = lead && lead.owner_quote;
    var inp = o && typeof o === 'object' && o.inputs && typeof o.inputs === 'object' && Object.keys(o.inputs).length ? o.inputs : null;
    var text = function (v) { return v === null || v === undefined ? '' : String(v).trim(); };
    if (inp) {
      var promo = text(inp.promo_code).toLowerCase();
      return { guests: text(inp.guests), hours: quoteHoursValue(inp.service_hours), bar: inp.bar_rental === true ? true : inp.bar_rental === false ? false : null,
        area: text(inp.event_city), km: Number(inp.distance_km) > 0 ? text(inp.distance_km) : '', date: dateOnly(inp.event_date), occasion: text(inp.occasion), promo: promo };
    }
    var code = text(lead && lead.promo_code).toLowerCase();
    return { guests: lead && Number(lead.guests) > 0 ? text(lead.guests) : '', hours: quoteHoursValue(lead && lead.service_hours_label),
      // a hand-added lead's "no" is only the column's default, nobody answered it
      bar: lead && lead.bar_rental === true ? true : lead && lead.bar_rental === false && lead.source !== 'manual' ? false : null,
      area: text(lead && lead.event_area), km: '', date: dateOnly(lead && lead.event_date), occasion: text(lead && lead.occasion), promo: code === 'none' ? '' : code };
  }
  function dateOnly(v) { var m = /^\d{4}-\d{2}-\d{2}/.exec(String(v == null ? '' : v)); return m ? m[0] : ''; }
  // 5, "5", "5 hours of bar service", "More than 8 hours" -> the calculator's choice; anything else -> "".
  function quoteHoursValue(v) {
    var s = String(v == null ? '' : v).trim();
    if (/^over_8$|more than|over 8/i.test(s)) return 'over_8';
    var m = /\d+/.exec(s);
    return m && QUOTE_HOURS.indexOf(m[0]) !== -1 ? m[0] : '';
  }
  // The line beside Add: says when it replaces a figure, and which one.
  // maybeSent: the price it replaces had a text that may have gone out (sql/023 unknown, or earlier_maybe_sent).
  function quoteAddNote(savedTotal, maybeSent) {
    return (savedTotal ? 'This replaces the ' + savedTotal + ' you saved on that lead.' : 'It saves this price on the lead.') +
      (maybeSent ? ' The earlier text may have gone out, so check the conversation first.' : '') + ' Nothing is sent to them.';
  }
  // The confirmation after a save.
  function quoteSavedLine(name, total, savedTotal) {
    return 'Saved: ' + total + ' on ' + name + (savedTotal ? ', replacing ' + savedTotal : '') + '. Nothing was sent.';
  }

  // May a calculator result be added to this lead? (The server decides again.)
  function canAddQuoteToLead(lead) {
    if (!lead) return false;
    if (String(lead.quote_status || '').toLowerCase() === 'firm') return false;
    var st = String(lead.status || '').toLowerCase();
    if (st === 'booked' || st === 'lost' || st === 'won' || st === 'dormant' || st === 'opted_out') return false;
    var o = lead.owner_quote;
    // unknown can be priced again (crm-fix-final N4): the note beside Add says the earlier text may have gone out
    return !(o && typeof o === 'object' && (o.state === 'sent' || o.state === 'sending'));
  }

  // Engine response + the request -> cv_add_lead_quote's p_quote. Only what the server accepts; no arithmetic.
  function quoteAddArgs(res, body) {
    var r = res && typeof res === 'object' ? res : {};
    var inputs = r.inputs && typeof r.inputs === 'object' ? r.inputs : (body && typeof body === 'object' ? body : {});
    var promo = r.promotion && typeof r.promotion === 'object' && r.promotion.applied === true ? r.promotion : null;
    return { status: r.status, total: r.total, subtotal: r.subtotal, travel_fee: r.travel_fee, deposit: r.deposit, currency: r.currency || 'CAD',
      rate_card_version: r.rate_card_version || '', computed_at: r.computed_at || '', promo_code: promo ? String(inputs.promo_code || '') : '', promotion: promo,
      line_items: Array.isArray(r.line_items) ? r.line_items : [], inputs: inputs };
  }

  var QUOTE_ADD_ERRORS = { has_firm_quote: 'This lead already has a quote, so this one was not added.', closed: 'This lead is finished, so a price cannot be added.',
    already_sent: 'A price for this lead was already sent.', already_sending: 'A price for this lead is being sent right now.' };
  // The server said this lead cannot take the price (a real quote arrived, the lead closed, it is gone): trying again will not help.
  function quoteAddRefused(e) { return /not_allowed|not_found/.test(String((e && e.message) || '').toLowerCase()); }
  function quoteAddError(e) {
    var msg = String((e && e.message) || '').toLowerCase();
    if (/not_owner/.test(msg)) return "Your sign-in can't change this lead.";
    if (/not_found/.test(msg)) return "This lead can't be found any more.";
    if (/not_allowed/.test(msg)) return QUOTE_ADD_ERRORS[String((e && e.details) || '').trim()] || "This quote can't be added to this lead.";
    return "Couldn't add it. Check your connection and try again.";
  }

  // cv-quote-send errors (thrown as { status, error, details }) -> what the owner reads. Always says whether anything went out.
  var QUOTE_SEND_BLOCKS = { manual: "This lead has no consent on file, so nothing was sent.", opted_out: 'They opted out of texts, so nothing was sent.', stop: 'They asked not to be texted, so nothing was sent.',
    no_consent: 'There is no consent on file, so nothing was sent.', demo: 'This is a test lead, so nothing was sent.', bad_phone: "Their number can't be texted, so nothing was sent.",
    closed: 'This lead is finished, so nothing was sent.', has_quote: 'They already have a quote, so nothing was sent.', already_sent: 'It was already sent. Nothing new went out.',
    already_sending: 'It is sending right now. Nothing new went out.', send_unknown: "We can't tell whether the last text went out, so nothing new was sent. Check the conversation.", too_many: 'This lead has had 3 texts that went out or may have, so nothing new was sent.',
    event_passed: 'The event date has passed, so nothing was sent.', details_changed: 'The event details changed after you priced this, so nothing was sent. Price it again.',
    price_old: 'This price is more than 30 days old, so nothing was sent. Price it again.', rate_changed: 'Your prices changed after this was worked out, so nothing was sent. Price it again.',
    price_changed: 'The price changed after you opened it, so nothing was sent. Look at it again.', no_sender: 'There is no number to send from yet, so nothing was sent.' };
  function quoteSendError(e) {
    var code = String((e && e.error) || '').toLowerCase();
    var d = String((e && e.details) || '').trim();
    if (code === 'not_allowed') return QUOTE_SEND_BLOCKS[d] || 'It could not be sent. Nothing went out.';
    if (code === 'send_off') return 'Sending is switched off. Nothing went out.';
    if (code === 'send_failed') return d === 'opted_out_at_twilio' ? 'They have blocked texts from this number. Nothing went out.' : 'The text could not be sent. Nothing went out.';
    if (code === 'send_unknown') return "We couldn't confirm the text went out. Check the conversation before sending again.";
    if (code === 'changed') return 'The quote changed. Look at the text again before sending.';
    if (code === 'not_owner' || code === 'not_signed_in') return "Your sign-in can't send this. Nothing went out.";
    if (code === 'not_configured') return 'Sending is not set up yet. Nothing went out.';
    return 'The text could not be sent. Nothing went out.';
  }

  // Lines for the lead's history (the send state lives on the saved price, not in lead_events: staff never read it there).
  function ownerQuoteHistory(lead) {
    var o = lead && lead.owner_quote;
    if (!o || typeof o !== 'object') return [];
    var out = [];
    if (o.added_at) out.push({ at: o.added_at, action: 'quote_priced', amount: o.total });
    if (o.sent_at) out.push({ at: o.sent_at, action: 'quote_sent', amount: o.total, source: 'page' });
    return out;
  }

  /* ---------- feature switches (CV_CUSTOM.features) ---------- */

  // Every feature is on unless the client's settings say exactly false. Off = not shown at all.
  var FEATURES = ['followups', 'calendar', 'notes', 'search', 'quote', 'value', 'metrics', 'forecast', 'pastEvents', 'push', 'addLead', 'support', 'export', 'ask', 'guide'];
  function featureOn(features, key) {
    return !(features && typeof features === 'object' && features[key] === false);
  }

  /* ---------- add a lead by hand + repeat customers (session 3, round 1) ---------- */

  // Where a hand-added lead came from. Keys are what the database stores; labels come from CV_CUSTOM.sourceLabels.
  var ADD_SOURCES = [
    { key: 'instagram', label: 'Instagram' },
    { key: 'phone_call', label: 'Phone call' },
    { key: 'referral', label: 'Referral' },
    { key: 'other', label: 'Other' }
  ];
  function addLeadSources() {
    return ADD_SOURCES.map(function (r) { return { key: r.key, label: CUSTOM.sources[r.key] || r.label }; });
  }
  function manualSourceLabel(key) {
    var k = String(key || '').toLowerCase();
    if (!k) return '';
    var r = addLeadSources().filter(function (x) { return x.key === k; })[0];
    return r ? r.label : humanize(k);
  }

  // The same rules as cv_add_lead in the database (sql/011): the server is the authority, this only saves a round trip.
  // Shared test vectors: tools/tests/phone_vectors.json. +1 numbers must be NXX-NXX-XXXX (area code and exchange
  // start 2-9); a literal "(0)" trunk marker is dropped first.
  function normalizeLeadPhone(input) {
    if (typeof input !== 'string') return null;
    var s = input.replace(/\(0\)/, '').trim();
    if (!s) return null;
    var digits = s.replace(/\D/g, '');
    var nat = null, out = null;
    if (s.charAt(0) === '+') {
      if (digits.length >= 8 && digits.length <= 15 && digits.charAt(0) !== '0') out = '+' + digits;
      if (out && digits.charAt(0) === '1') nat = digits.slice(1);
    } else if (digits.length === 10) { out = '+1' + digits; nat = digits; }
    else if (digits.length === 11 && digits.charAt(0) === '1') { out = '+' + digits; nat = digits.slice(1); }
    if (!out) return null;
    if (nat !== null && !/^[2-9][0-9]{2}[2-9][0-9]{6}$/.test(nat)) return null;
    return out;
  }

  // Text typed into the form: control and invisible direction characters out, spaces collapsed, trimmed, blank = null.
  function cleanText(v) {
    if (v === null || v === undefined) return null;
    var s = String(v).replace(/[\t\r\n]/g, ' ').replace(/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim();
    return s ? s : null;
  }

  var ADD_LEAD_ERRORS = {
    name_required: 'Add a name.',
    name_too_long: 'Keep the name under 120 characters.',
    bad_phone: 'Enter a phone number with area code, like (416) 555-0123.',
    bad_source: 'Pick where they came from.',
    bad_email: "That email doesn't look right.",
    bad_date: 'Pick a date between 2020 and five years from now.',
    bad_guests: 'Guests must be a whole number from 1 to 5000.',
    area_too_long: 'Keep the area under 120 characters.',
    occasion_too_long: 'Keep the occasion under 80 characters.'
  };
  var ADD_LEAD_FIELD = {
    name_required: 'name', name_too_long: 'name', bad_phone: 'phone', bad_source: 'source', bad_email: 'email',
    bad_date: 'event_date', bad_guests: 'guests', area_too_long: 'area', occasion_too_long: 'occasion'
  };
  // Order the checks run (and the first bad field gets the focus): the form's order, then the rest.
  var ADD_LEAD_ORDER = ['name', 'phone', 'source', 'event_date', 'guests', 'area', 'occasion', 'email'];

  // form = { name, phone, source, event_date, guests, area, occasion, email, contacted } (strings from the inputs).
  // -> { ok, errors: { field: code }, values: { name, phone (E.164), source, event_date, guests, area, occasion, email, contacted } }
  function validateAddLead(form, now) {
    var f = form || {};
    var errors = {};
    var v = {
      name: cleanText(f.name), phone: null, source: String(f.source || '').toLowerCase(),
      event_date: cleanText(f.event_date), guests: null, area: cleanText(f.area), occasion: cleanText(f.occasion),
      email: cleanText(f.email), contacted: f.contacted === true
    };
    if (!v.name) errors.name = 'name_required';
    else if (v.name.length > 120) errors.name = 'name_too_long';
    v.phone = normalizeLeadPhone(String(f.phone == null ? '' : f.phone));
    if (!v.phone) errors.phone = 'bad_phone';
    if (!ADD_SOURCES.some(function (r) { return r.key === v.source; })) errors.source = 'bad_source';
    if (v.email && (v.email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email))) errors.email = 'bad_email';
    if (v.event_date) {
      var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.event_date);
      var okDate = false;
      if (m) {
        var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
        var real = new Date(Date.UTC(y, mo - 1, d));
        var t = today(now);
        okDate = real.getUTCFullYear() === y && real.getUTCMonth() === mo - 1 && real.getUTCDate() === d &&
          v.event_date >= '2020-01-01' && v.event_date <= ymd(t.y + 5, t.m, t.d);
      }
      if (!okDate) errors.event_date = 'bad_date';
    }
    var g = cleanText(f.guests);
    if (g !== null) {
      if (/^\d{1,4}$/.test(g) && Number(g) >= 1 && Number(g) <= 5000) v.guests = Number(g);
      else errors.guests = 'bad_guests';
    }
    if (v.area && v.area.length > 120) errors.area = 'area_too_long';
    if (v.occasion && v.occasion.length > 80) errors.occasion = 'occasion_too_long';
    return { ok: Object.keys(errors).length === 0, errors: errors, values: v };
  }
  function addLeadFirstError(errors) {
    for (var i = 0; i < ADD_LEAD_ORDER.length; i++) if (errors && errors[ADD_LEAD_ORDER[i]]) return ADD_LEAD_ORDER[i];
    return '';
  }
  function addLeadErrorText(code) { return ADD_LEAD_ERRORS[code] || "Check this and try again."; }

  // Validated values -> RPC arguments. Only filled fields are sent.
  function addLeadArgs(values) {
    var a = { p_name: values.name, p_phone: values.phone, p_source: values.source };
    if (values.email) a.p_email = values.email;
    if (values.event_date) a.p_event_date = values.event_date;
    if (values.guests !== null && values.guests !== undefined) a.p_guests = values.guests;
    if (values.area) a.p_area = values.area;
    if (values.occasion) a.p_occasion = values.occasion;
    if (values.contacted) a.p_contacted = true;
    return a;
  }

  // A cv_add_lead failure -> { kind, field, text }. kind: field | feature_off | not_owner | auth | network | other.
  function addLeadError(err) {
    var raw = String((err && err.message) || (typeof err === 'string' ? err : '')).trim().toLowerCase();
    var det = String((err && err.details) || '').trim().toLowerCase().replace(/[.\s]+$/, '').replace(/[\s-]+/g, '_');
    var m = /\b(not_owner|not_allowed|bad_input)\b\s*(?::\s*([^\n]*))?/.exec(raw);
    if (m) {
      var why = (m[2] ? String(m[2]).trim().toLowerCase().replace(/[.\s]+$/, '').replace(/[\s-]+/g, '_') : '') || det;
      if (m[1] === 'not_owner') return { kind: 'not_owner', field: '', text: "Your sign-in isn't linked to this business. Sign out, then sign in with your own number." };
      if (m[1] === 'not_allowed') {
        if (why === 'feature_off') return { kind: 'feature_off', field: '', text: 'Adding leads is switched off.' };
        return { kind: 'other', field: '', text: "You can't add a lead right now." };
      }
      if (ADD_LEAD_FIELD[why]) return { kind: 'field', field: ADD_LEAD_FIELD[why], text: ADD_LEAD_ERRORS[why] };
      return { kind: 'other', field: '', text: 'Check the details and try again.' };
    }
    var status = err && err.status;
    if (status === 401 || (err && err.code === 'PGRST301') || /jwt/.test(raw)) return { kind: 'auth', field: '', text: 'Your session ran out. Sign out and sign in again.' };
    if (/failed to fetch|network|load failed/.test(raw)) return { kind: 'network', field: '', text: "Can't reach the server. Check your connection and try again." };
    return { kind: 'other', field: '', text: "Couldn't add that lead. Try again in a moment." };
  }

  // The same person across number formats: the digits, with a 10-digit number read as +1 (as other_events does).
  function phoneKey(p) {
    var d = String(p == null ? '' : p).replace(/\D/g, '');
    if (d.length === 10) d = '1' + d;
    return d;
  }
  function dateKey(d) { var m = /^(\d{4}-\d{2}-\d{2})/.exec(String(d || '')); return m ? m[1] : ''; }

  // 024 (Kevin 11-09): the one "same person" rule, as cv_private.same_person: the same number AND (the same email, or the same
  // first name, case-, accent- and punctuation-blind). Two people can share a number (a couple, an office line, a re-used number).
  // PERSON_SPACE / PERSON_STRIP are the SAME text as the two classes in sql/024 cv_private.same_person (test_lib.js asserts it, and
  // tools/tests/person_name_vectors.json runs the same pairs through both; review r3 item 5). Spelled out, never \s or [:punct:].
  var PERSON_SPACE = '[\\t\\n\\v\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+';
  var PERSON_STRIP = '[\\u0021-\\u002F\\u003A-\\u0040\\u005B-\\u0060\\u007B-\\u007E\\u00A1-\\u00BF\\u00D7\\u00F7\\u0300-\\u036F\\u2010-\\u205E]';
  var PERSON_SPACE_RE = new RegExp(PERSON_SPACE, 'g'), PERSON_STRIP_RE = new RegExp(PERSON_STRIP, 'g');
  function personFirstKey(name) {
    var w = (String(name == null ? '' : name).replace(PERSON_SPACE_RE, ' ').replace(/^ +| +$/g, '').split(' ')[0] || '').toLowerCase();
    if (typeof w.normalize === 'function') w = w.normalize('NFD');
    return w.replace(PERSON_STRIP_RE, '');
  }
  function personEmailKey(email) { return String(email == null ? '' : email).replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '').toLowerCase(); }
  // a, b: { phone, email, name } (lead_detail uses full_name, lead_list display_name: pass them as name).
  function samePerson(a, b) {
    if (!a || !b) return false;
    var pa = phoneKey(a.phone);
    if (!pa || pa !== phoneKey(b.phone)) return false;
    var ea = personEmailKey(a.email), na = personFirstKey(a.name);
    return (!!ea && ea === personEmailKey(b.email)) || (!!na && na === personFirstKey(b.name));
  }

  // Leads already on file for the typed phone number, for the duplicate box under Phone.
  // optedPhones (optional): phone numbers known to have opted out. -> { key, matches, shown (max 3), more, sameLead (same date, or both without a date), optedOut }
  // typedName (optional, 024): the name typed in the form. samePerson = a lead on file has that first name (lead_list has no email);
  // null when no name is typed (nothing to tell), so the hint never claims the same person on the number alone.
  function dupInfo(leads, rawPhone, eventDate, optedPhones, typedName) {
    var norm = normalizeLeadPhone(String(rawPhone == null ? '' : rawPhone));
    var out = { phone: norm, matches: [], shown: [], more: 0, sameLead: null, optedOut: false, samePerson: null };
    if (!norm) return out;
    var key = phoneKey(norm);
    var want = dateKey(eventDate);
    out.matches = (Array.isArray(leads) ? leads : []).filter(function (l) { return l && isUuid(l.lead_id) && phoneKey(l.phone) === key; });
    out.shown = out.matches.slice(0, 3);
    out.more = Math.max(0, out.matches.length - 3);
    out.sameLead = out.matches.filter(function (l) { return dateKey(l.event_date) === want; })[0] || null;
    var typed = personFirstKey(typedName);
    out.samePerson = typed ? out.matches.some(function (l) { return personFirstKey(l.display_name) === typed; }) : null;
    // lead_list has no opted_out column, so also check the numbers lead_detail says opted out (optedPhones), booked, lost or manual rows included.
    out.optedOut = out.matches.some(function (l) { return isOptedOut(l); }) ||
      (Array.isArray(optedPhones) ? optedPhones : []).some(function (p) { return phoneKey(p) === key; });
    return out;
  }
  // Which "different date" sentence: the same person only when the typed first name is on one of the matches.
  function dupOtherText(d) {
    if (!d || d.sameLead) return DUP_TEXT.same;
    if (d.samePerson === true) return DUP_TEXT.other;
    return d.samePerson === false ? DUP_TEXT.otherPerson : DUP_TEXT.otherUnknown;
  }
  // 024 + r3 items 7 / 9: lead_detail.phone_shared -> ONE small line per other PERSON on this number (never per lead, never an event
  // of this lead): "Someone else, Casey Lee, also uses this phone number (Sat, Jun 12, 2027; Mar 1, 2027)." phone_shared carries no
  // email, so its leads are grouped by the rule's first-name half (personFirstKey); a lead with no name is its own line. lead_id = that
  // person's first lead in the list (newest first), for the link on the name. An older read without the column shows nothing.
  function phoneSharedLines(lead, now) {
    var list = lead && Array.isArray(lead.phone_shared) ? lead.phone_shared : [];
    var groups = [], byKey = {};
    list.filter(function (o) { return o && isUuid(o.lead_id); }).forEach(function (o) {
      var name = String(o.name == null ? '' : o.name).replace(/\s+/g, ' ').trim();
      if (name.length > 60) name = name.slice(0, 59).trim() + '\u2026';
      var key = personFirstKey(name);
      var g = key && byKey[key];
      if (!g) { g = { lead_id: o.lead_id, name: name, dates: [] }; groups.push(g); if (key) byKey[key] = g; }
      var d = o.event_date ? fmtEventDate(o.event_date, now) : 'no event date';
      if (d && g.dates.indexOf(d) === -1) g.dates.push(d);
    });
    return groups.map(function (g) {
      var before = g.name ? 'Someone else, ' : 'Someone else ';
      var after = (g.name ? ', ' : '') + 'also uses this phone number (' + g.dates.join('; ') + ').';
      return { lead_id: g.lead_id, name: g.name, before: before, after: after, text: before + g.name + after };
    });
  }
  // "Already on file: Pat · Sat, Nov 14 · Asked for you" pieces for one match.
  function dupLine(lead) {
    return [displayName(lead), fmtEventDate(lead.event_date) || 'no date', statusInfo(lead.status).label].join(' · ');
  }
  var DUP_TEXT = {
    same: 'Same date as a lead on file: saving opens that lead (blank details are filled in, nothing is overwritten).',
    other: 'A different date from the leads on file: saving adds a new event for the same person.',
    // 024: the number is on file, but not under the typed first name (or no name typed yet): never claim the same person.
    otherPerson: 'This number is already on file under another name: saving adds a separate lead with this number.',
    otherUnknown: 'A different date from the leads on file: saving adds a new lead with this number.',
    optedOut: 'This number opted out of texts.'
  };

  // Where a lead came from, for the record header (Kevin 11-09: every lead, plain words, never a raw key).
  // leads.source: tally_form (WF1), sms_inbound (first text), manual (+ Add lead), demo-seed (lab data), NULL (old rows). Anything else = not recorded.
  // A lead read that carries no source at all (an older server) shows nothing rather than a false "not recorded".
  // form_name is the Tally form's own title (two forms can be told apart); a title can hold a price, so opts.noFormName (staff) leaves it out.
  function isManual(lead) { return !!lead && lead.source === 'manual'; }
  function formNameBit(lead, opts) {
    if (opts && opts.noFormName) return '';
    var n = String((lead && lead.form_name) || '').replace(/\s+/g, ' ').replace(/[\s:.]+$/, '').trim();
    return n.length > 60 ? n.slice(0, 59).trim() + '…' : n;
  }
  function sourceLine(lead, opts) {
    if (!lead || lead.source === undefined) return '';
    var src = String(lead.source == null ? '' : lead.source).trim().toLowerCase();
    var form = formNameBit(lead, opts);
    if (src === 'manual') {
      var l = manualSourceLabel(lead.manual_source);
      // B6 (Kevin 11-10): a website form for the same date upgraded it (auto_texts true): the story says so.
      var then = lead.auto_texts === true ? ', then website form' : '';
      return l ? 'From: added by you (' + l + ')' + then : 'From: added by you' + then;
    }
    if (src === 'tally_form') return form ? 'From: website form (' + form + ')' : 'From: website form';
    if (src === 'sms_inbound') return form ? 'From: texted in, then website form (' + form + ')' : 'From: texted in';
    if (src === 'demo-seed') return 'From: demo data';
    return 'From: not recorded';
  }
  // 022: lead_detail.quote_received === false only; absent (staff, older read) shows nothing. Text shares the source line.
  var CLOSED_FOR_QUOTE = { booked: 1, lost: 1, won: 1, dormant: 1, opted_out: 1 };
  function noQuoteLine(lead) {
    if (!lead || lead.quote_received !== false) return '';
    return CLOSED_FOR_QUOTE[String(lead.status || '').toLowerCase()] ? 'no quote sent' : 'no quote sent yet';
  }
  var NO_AUTO_TEXT = 'No automatic texts: you contact them yourself.';
  // 022: after the owner's "no follow-up" (or none sent and no quote) the record says plainly that no text will go.
  var NO_FOLLOWUP_LINE = { chosen: 'No follow-up text will go out: you chose not to send one.', no_quote: 'No follow-up text will go out: no quote was sent.', opted_out: 'No follow-up text will go out: they texted STOP.' };
  function noAutoLine(lead) {
    if (!lead) return '';
    if (lead.auto_texts === false) return NO_AUTO_TEXT;
    return NO_FOLLOWUP_LINE[lead.no_followup] || '';
  }

  // cv_metrics().sources -> the buckets that have leads, in the server's order, with plain labels.
  var SOURCE_BUCKETS = { form: 'Your booking form', text: 'Texted you first', other: 'Other' };
  function sourceRows(sources) {
    return (Array.isArray(sources) ? sources : []).filter(function (b) { return b && num(b.leads) > 0; }).map(function (b) {
      var k = String(b.key || '');
      var label = SOURCE_BUCKETS[k];
      if (!label && k.indexOf('manual:') === 0) label = 'Added by you · ' + manualSourceLabel(k.slice(7));
      var booked = num(b.booked) || 0;
      return {
        key: k, label: label || humanize(k), leads: num(b.leads) || 0, month: num(b.leads_this_month) || 0,
        booked: booked, bookedMoney: booked > 0 ? fmtMoney(num(b.booked_total) || 0) : ''
      };
    });
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

  /* ---------- quote calculator draft (gap 2) ----------
     The unfinished calculator form is kept in localStorage so an app the phone killed mid-quote does not lose it. It holds the form
     fields and at most a lead id: NEVER a phone, a name, a message or a price. One key per signed-in user, 12 hours, removed on sign-out,
     on Add / send and whenever the calculator is emptied (app.js clearQuote). It is restored as a plain draft with NO link to the lead. */

  var QDRAFT_PREFIX = 'cv_qdraft_v1:';
  var QDRAFT_TTL_MS = 12 * 3600000;
  function quoteDraftKey(uid) {
    var u = String(uid == null ? '' : uid);
    return /^[A-Za-z0-9_-]{1,64}$/.test(u) ? QDRAFT_PREFIX + u : '';
  }

  // Keep only a field that is the right shape; anything else becomes empty. -> the eight calculator fields, all strings (bar_rental true / false / null).
  function quoteDraftFields(f) {
    f = f && typeof f === 'object' ? f : {};
    var str = function (v) { return typeof v === 'string' || typeof v === 'number' ? String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : ''; };
    var pick = function (v, ok) { var x = str(v); return x && ok(x) ? x : ''; };
    return {
      guests: pick(f.guests, function (x) { return /^\d{1,4}$/.test(x); }),
      service_hours: pick(f.service_hours, function (x) { return QUOTE_HOURS.indexOf(x) !== -1; }),
      bar_rental: f.bar_rental === true ? true : f.bar_rental === false ? false : null,
      event_city: pick(f.event_city, function (x) { return PLACE_RE.test(x); }),
      distance_km: pick(f.distance_km, function (x) { return /^\d{1,4}([.,]\d{1,3})?$/.test(x); }),
      event_date: pick(f.event_date, isYmd),
      occasion: pick(f.occasion, function (x) { return OCCASION_RE.test(x); }),
      promo_code: pick(f.promo_code, function (x) { return PROMO_CODE_RE.test(x.toLowerCase()); }).toLowerCase()
    };
  }
  function quoteDraftBlank(f) {
    var c = quoteDraftFields(f);
    return !c.guests && !c.service_hours && c.bar_rental === null && !c.event_city && !c.distance_km && !c.event_date && !c.occasion && !c.promo_code;
  }

  // form (app.js qForm()) + the lead it was made from (an id or null) -> the string to store, or '' when the form is empty (nothing to keep).
  // A draft made from a lead's "Price it" holds the lead id and NOT the city / area: that comes from the lead (it can be a street address), so on restore
  // it is worked out from the lead again. A plain calculator draft keeps the city the owner typed.
  function quoteDraftPack(form, leadId, now) {
    var lead = isUuid(leadId) ? String(leadId).toLowerCase() : null;
    var f = quoteDraftFields(form);
    if (lead) f.event_city = '';
    if (quoteDraftBlank(f)) return '';
    return JSON.stringify({ v: 1, t: nowDate(now).getTime(), f: f, lead: lead });
  }

  // The stored string -> { pre, lead } for qFill (keys guests / hours / bar / area / km / date / occasion / promo), or null: junk, the wrong shape,
  // older than 12 hours, from the future, or nothing left after the checks. Unknown keys are dropped.
  function quoteDraftRead(raw, now) {
    if (typeof raw !== 'string' || !raw || raw.length > 2000) return null;
    var o;
    try { o = JSON.parse(raw); } catch (e) { return null; }
    if (!o || typeof o !== 'object' || Array.isArray(o) || o.v !== 1 || typeof o.t !== 'number' || !isFinite(o.t)) return null;
    var age = nowDate(now).getTime() - o.t;
    if (age > QDRAFT_TTL_MS || age < -300000) return null;
    if (!o.f || typeof o.f !== 'object' || quoteDraftBlank(o.f)) return null;
    var c = quoteDraftFields(o.f);
    var lead = isUuid(o.lead) ? String(o.lead).toLowerCase() : null;
    if (lead) c.event_city = '';
    if (quoteDraftBlank(c)) return null;
    return { lead: lead,
      pre: { guests: c.guests, hours: c.service_hours, bar: c.bar_rental, area: c.event_city, km: c.distance_km, date: c.event_date, occasion: c.occasion, promo: c.promo_code } };
  }

  /* ---------- quote calculator pick-lists (CV_CUSTOM.quoteOccasions / quotePromos) ----------
     Per client. A client with no list keeps the plain text box. The page never offers a code that is not
     in the client's list, one outside its dates, or one the endpoint would refuse by shape; the endpoint
     still decides what a code does (promo_status in its answer). */

  var PROMO_CODE_RE = /^[a-z0-9_-]{2,32}$/;
  function isYmd(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z')); }

  // The occasion choices, in the client's order: only text the endpoint accepts, no repeats. null = no list (use the text box).
  function quoteOccasions(c) {
    var raw = c && Array.isArray(c.quoteOccasions) ? c.quoteOccasions : null;
    if (!raw) return null;
    var out = [], seen = {};
    raw.forEach(function (x) {
      var s = String(x == null ? '' : x).replace(/\s+/g, ' ').trim();
      if (!s || !OCCASION_RE.test(s) || seen[s.toLowerCase()]) return;
      seen[s.toLowerCase()] = true; out.push(s);
    });
    return out.length ? out : null;
  }

  // One promo entry from the settings -> a clean entry, or null when it is malformed (a malformed entry is never offered).
  // { code, label, gives, from, to (first day it no longer works), eventFrom, eventTo (event dates it covers, both included) }
  function cleanPromo(p) {
    if (!p || typeof p !== 'object') return null;
    var code = String(p.code == null ? '' : p.code).trim().toLowerCase();
    var label = String(p.label == null ? '' : p.label).replace(/\s+/g, ' ').trim();
    if (!PROMO_CODE_RE.test(code) || !label || label.length > 70) return null;
    var e = { code: code, label: label, gives: String(p.gives == null ? '' : p.gives).replace(/\s+/g, ' ').trim().slice(0, 240), from: '', to: '', eventFrom: '', eventTo: '' };
    if (p.from != null && p.from !== '') { if (!isYmd(p.from)) return null; e.from = p.from; }
    if (p.to != null && p.to !== '') { if (!isYmd(p.to)) return null; e.to = p.to; }
    if (e.from && e.to && e.to <= e.from) return null;
    if ((p.eventFrom || p.eventTo)) {
      if (!isYmd(p.eventFrom) || !isYmd(p.eventTo) || p.eventTo < p.eventFrom) return null;
      e.eventFrom = p.eventFrom; e.eventTo = p.eventTo;
    }
    return e;
  }
  // Every well-formed entry, offered or not. null = no list configured.
  function quotePromoList(c) {
    var raw = c && Array.isArray(c.quotePromos) ? c.quotePromos : null;
    if (!raw) return null;
    var out = [], seen = {};
    raw.forEach(function (p) { var e = cleanPromo(p); if (e && !seen[e.code]) { seen[e.code] = true; out.push(e); } });
    return out;
  }
  // The promos to put in the picker today (client time zone): inside their dates only. null = no list (use the text box);
  // [] = a list with nothing running today (the picker shows just "No promo").
  function quotePromos(c, now) {
    var all = quotePromoList(c);
    if (!all) return null;
    var td = today(now).ymd;
    return all.filter(function (e) { return (!e.from || td >= e.from) && (!e.to || td < e.to); });
  }
  // G7 (Kevin 11-10): a promo from a restored draft whose end date (`to`, the first day it no longer works) has passed in the client's
  // time zone -> "That promo has ended." '' for anything else (no list, unknown code, not started yet, no end date, still running).
  var PROMO_ENDED_TEXT = 'That promo has ended.';
  function promoEndedNote(c, code, now) {
    var all = quotePromoList(c);
    var k = String(code == null ? '' : code).trim().toLowerCase();
    if (!all || !k) return '';
    var e = all.filter(function (x) { return x.code === k; })[0];
    return e && e.to && today(now).ymd >= e.to ? PROMO_ENDED_TEXT : '';
  }
  // Is any listed promo given an end date? (The guide only talks about an ended promo for a client that has one.)
  function quotePromosEnd(c) {
    return (quotePromoList(c) || []).some(function (e) { return !!e.to; });
  }
  // What the picker says under the choice: what it gives, then which event dates it covers.
  function promoGives(e) {
    if (!e) return '';
    var parts = ['Code: ' + e.code + '.'];   // the code the owner types in or gives the customer (Kevin 11-09)
    if (e.gives) parts.push(e.gives.replace(/[.\s]+$/, '') + '.');
    if (e.eventFrom) parts.push('Events from ' + longDate(e.eventFrom) + ' to ' + longDate(e.eventTo) + '.');
    return parts.join(' ');
  }
  function longDate(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? MONTH_NAMES[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1] : s; }

  // Same checks the endpoint makes before a coded offer applies, so the owner hears it before the wait. '' = fine.
  // Only for a code in the client's list; an unlisted typed code (text-box clients) is left to the endpoint.
  function quotePromoProblem(c, code, eventDate, now) {
    var all = quotePromoList(c);
    var k = String(code == null ? '' : code).trim().toLowerCase();
    if (!all || !k) return '';
    var e = all.filter(function (x) { return x.code === k; })[0];
    if (!e) return 'That promo is not on the list.';
    var td = today(now).ymd;
    if ((e.from && td < e.from) || (e.to && td >= e.to)) return 'That promo is not running today.';
    if (e.eventFrom) {
      var d = String(eventDate || '').trim();
      if (!d) return 'This offer needs the event date (events ' + longDate(e.eventFrom) + ' to ' + longDate(e.eventTo) + ').';
      if (d < e.eventFrom || d > e.eventTo) return 'This offer covers events ' + longDate(e.eventFrom) + ' to ' + longDate(e.eventTo) + '. Change the event date or pick another promo.';
    }
    return '';
  }

  // An asked-for promo the endpoint did not apply -> one plain sentence, so a missing discount is never silent. '' = nothing to say.
  function promoNote(r, c) {
    var code = String(r && r.inputs && r.inputs.promo_code || '').trim();
    if (!code) return '';
    var hit = (quotePromoList(c) || []).filter(function (e) { return e.code === code.toLowerCase(); })[0];
    var name = hit ? hit.label : 'That promo';
    var st = String(r.promo_status || '');
    if (st === 'matched') {
      var p = r.promotion;
      return p && typeof p === 'object' && p.applied === false ? name + ' does not apply to these answers, so it is not in this price.' : '';
    }
    if (st === 'no_active_match') return name + ' is not running, so it is not in this price.';
    if (st === 'bundle_no_event_date') return name + ' needs an event date, so it is not in this price.';
    if (st === 'bundle_out_of_window') return 'The event date is outside the dates for ' + (hit ? hit.label : 'that promo') + ', so it is not in this price.';
    if (st === 'lookup_failed') return name + ' could not be checked, so it is not in this price. Try again.';
    return '';
  }

  // A discount line always reads as money off: "−$100", whichever sign the engine used.
  function signedMoney(v) {
    var c = toCents(v);
    return c === null ? '' : '\u2212' + fmtMoney(Math.abs(c) / 100);
  }

  // One app name for the sign-in screen, the browser tab and the home-screen icon: the client's business name
  // (CV_CUSTOM.businessName), or "Leads" when none is set. Screen titles inside the app stay plain words.
  var SHORT_NAME_MAX = 12;
  function appName(custom) {
    var n = custom && typeof custom.businessName === 'string' ? custom.businessName.trim() : '';
    return n || 'Leads';
  }
  // Home-screen label, at most 12 characters: CV_CUSTOM.shortName if set, else the app name cut at a word edge
  // (a first word longer than 12 is cut hard). A trailing "(lab)" style bracket is never left dangling.
  function shortName(custom) {
    var s = custom && typeof custom.shortName === 'string' ? custom.shortName.trim() : '';
    var n = s || appName(custom);
    if (n.length <= SHORT_NAME_MAX) return n;
    var cut = n.slice(0, SHORT_NAME_MAX + 1);
    var sp = cut.lastIndexOf(' ');
    var out = sp > 0 ? cut.slice(0, sp) : n.slice(0, SHORT_NAME_MAX);
    return out.replace(/[\s(\[\-,.&+\/:;|]+$/, '') || n.slice(0, SHORT_NAME_MAX);
  }

  // Engine response -> what the page prints. No arithmetic: every number is the engine's.
  function quoteResult(r, custom) {
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
    var shownDiscount = items.some(function (i) { return i.discount; });
    var calcSums = defer ? { subtotal: '', travel: '', total: '' } : quoteSums(r.line_items, r.subtotal, r.travel_fee, r.total);
    var codes = Array.isArray(r.flag_codes) ? r.flag_codes : [];
    // What the customer text's price block is drawn from (Copy): the engine's own line items, only the keys renderPriceBlockSms reads.
    var PB_KEYS = ['label', 'detail', 'amount', 'base_amount', 'base_detail', 'discount', 'discount_kind', 'discount_label', 'includes'];
    var priceItems = defer ? [] : (Array.isArray(r.line_items) ? r.line_items : []).filter(function (it) { return it && typeof it === 'object'; }).map(function (it) {
      var o = {};
      PB_KEYS.forEach(function (k) { if (it[k] !== undefined) o[k] = it[k]; });
      return o;
    });
    return {
      defer: defer,
      priceItems: priceItems,
      priceTotal: defer ? null : r.total,
      currency: typeof r.currency === 'string' && /^[A-Z]{3}$/.test(r.currency) ? r.currency : 'CAD',
      reasons: defer ? reasons : [],
      items: items,
      // the rows to draw under the lines ('' = left out; quoteSums: delivery is a line, never a second Travel fee row). total stays
      // the full figure (Add, the leave warning); totalRow is the Total row.
      subtotal: calcSums.subtotal,
      travel: calcSums.travel,
      total: defer ? '' : fmtMoney(r.total),
      totalRow: calcSums.total,
      deposit: defer ? '' : fmtMoney(r.deposit),
      distance: km === null ? '' : Math.round(km).toLocaleString('en-CA') + ' km away',
      // A flag that only repeats a discount line already printed above it is dropped (matched on the engine's flag code, not its text).
      flags: defer ? [] : (Array.isArray(r.flags) ? r.flags : []).filter(function (x, i) { return typeof x === 'string' && x.trim() && !(shownDiscount && codes[i] === 'delivery_discount_applied'); }),
      promoNote: defer ? '' : promoNote(r, custom),
      needsDistance: String(r.distance_status || '') === 'route_not_found' || (Array.isArray(r.defer_codes) && r.defer_codes.indexOf('missing_distance') !== -1)
    };
  }

  /* ---------- PRICE BLOCK (GENERATED by tools/sync_price_block.mjs from n8n/lab-main.json; do not edit) ---------- */
// --- INLINE START ---
// Mirrors WF1 and compose_reply exactly, so an intake quote and a re-quote read
// identically down to the thousands separator.
function qbMoney(n) {
  return '$' + Number(n).toLocaleString('en-CA', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function qbRound2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// jsonb comes back parsed from the pg driver, but a text column or a driver
// change would hand us a string. Both are cheap to accept; a thrown parse error
// mid-conversation is not.
function qbArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    try { var p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch (e) { return []; }
  }
  return [];
}

// summarizeQuote(lineItems, total) -> the shape every renderer draws.
//
//   items         line items AS DISPLAYED. A discounted line is shown at its
//                 FULL fee with its plain detail, because the discount is
//                 stated on its own line below - showing "$0" AND then waiving
//                 it would be waiving the same money twice.
//   discount      total waived across all line items (0 when nothing applies)
//   discountLabel the "special offer" line, null when there is no discount
//   offers        PROMO-SLOT 2026-09-29: EVERY offer line, in order - one per
//                 campaign promotion (a line item with discount_kind 'promo',
//                 labelled by its promotions row), then the ONE delivery offer,
//                 always LAST. discountLabel is offers[0].label when there is
//                 one offer, 'Special offers' when there are several.
//   grossTotal    what the event costs before the offer  (total + discount)
//   totalLabel    'TOTAL' or 'DISCOUNTED TOTAL'  - always the LAST line (CR12)
//   total         the calculator's own total. NEVER recomputed here.
//
// A line item opts in by carrying `discount` (> 0). The calculator sets it, and
// also sets `base_amount` / `base_detail` so no renderer ever has to do the
// arithmetic or take a substring of a customer-facing string. `base_amount`
// falls back to amount + discount only so an OLD stored quote - a jsonb row
// written before this change - still renders sensibly.
function summarizeQuote(lineItems, total) {
  var items = [];
  var discount = 0;
  var everyDiscountIsAWaiver = true;
  var promoOffers = [];
  var deliveryOff = 0;

  qbArray(lineItems).forEach(function (li) {
    if (!li) return;
    var amount = Number(li.amount);
    var d = Number(li.discount);
    if (Number.isFinite(d) && d > 0) {
      discount = qbRound2(discount + d);
      if (li.discount_kind === 'promo') {
        promoOffers.push({ label: li.discount_label ? 'Special offer - ' + li.discount_label : 'Special offer', amount: d });
      } else {
        deliveryOff = qbRound2(deliveryOff + d);
        if (!(Number.isFinite(amount) && amount === 0)) everyDiscountIsAWaiver = false;
      }
      var base = Number(li.base_amount);
      if (!Number.isFinite(base)) base = qbRound2((Number.isFinite(amount) ? amount : 0) + d);
      items.push({
        label: li.label,
        detail: (li.base_detail === undefined || li.base_detail === null) ? li.detail : li.base_detail,
        amount: base,
      });
    } else {
      items.push(qbWithIncludes({ label: li.label, detail: li.detail, amount: amount }, li));
    }
  });

  var t = Number(total);
  var offers = promoOffers.slice();
  if (deliveryOff > 0) {
    offers.push({
      label: everyDiscountIsAWaiver ? 'Special offer - delivery waived' : 'Special offer - delivery discount',
      amount: deliveryOff,
    });
  }
  return {
    items: items,
    discount: discount,
    discountLabel: offers.length === 1 ? offers[0].label : (offers.length ? 'Special offers' : null),
    offers: offers,
    grossTotal: qbRound2(t + discount),
    totalLabel: discount > 0 ? 'DISCOUNTED TOTAL' : 'TOTAL',
    total: t,
  };
}

// F-028 (Kevin 2026-10-31): THE INCLUDES LIST. A line item may carry
// `includes`, an array of short strings the calculator wrote (the event
// bundle: what its one price covers). summarizeQuote passes it through (only
// when there is one) and every renderer draws it UNDER the line in place of
// the bracketed detail. `detail` stays on the line for any reader that does
// not know includes (the Sheet's Line Items cell, a stored copy, an older
// renderer). No includes -> the line renders exactly as before.
// F-029 (Kevin 2026-11-01): THE OWNER'S LAYOUT. The line itself has no "- " and
// no indent, then a blank line, "Includes:" at column 0 and flat "- " items;
// renderPriceBlockSms closes the list with one blank line when a priced line
// (Additional hours, ...) follows it, so that line is not read as an include.
// GSM-7:
//
//   Event Bundle: $700
//
//   Includes:
//   - Menu/service package (1-100 guests)
//   - 1 bartender x 4 hrs
//   - Portable bar rental with delivery
//
//   - Additional hours (2h x $50/h): $100
function qbIncludes(v) {
  return qbArray(v).filter(function (x) { return typeof x === 'string' && x.trim() !== ''; })
    .map(function (x) { return x.replace(/\s+/g, ' ').trim(); });
}

function qbWithIncludes(item, li) {
  var inc = qbIncludes(li && li.includes);
  if (inc.length) item.includes = inc;
  return item;
}

function qbItemLine(li) {
  var inc = qbIncludes(li.includes);
  if (inc.length) {
    return li.label + ': ' + qbMoney(li.amount) + '\n\nIncludes:\n'
      + inc.map(function (x) { return '- ' + x; }).join('\n');
  }
  return '- ' + li.label + (li.detail ? ' (' + li.detail + ')' : '') + ': ' + qbMoney(li.amount);
}

// The plain-text block. Blank lines are the only layout tool SMS has, so they
// are used deliberately and sparingly: one before the money, one after the
// gross total (F-024, 2026-10-24: the offer reads as a line of its own), and
// one before the anchor. The anchor is ALWAYS the last line of the block.
//
//   - Menu/Service Package (200 guests): $500
//   - Bartending Staff (2 bartenders x 5h @ $85/h): $425
//   - Portable Bar Rental (standard portable bar): $200
//   - Delivery (67 km one way): $80
//
//   Total: $1,205
//
//   Special offer - delivery waived: -$80
//
//   DISCOUNTED TOTAL: $1,125 CAD
function renderPriceBlockSms(lineItems, total, currency) {
  var s = summarizeQuote(lineItems, total);
  // F-029 (Kevin 2026-11-01): one blank line closes an includes list when a
  // priced line follows it (Additional hours, ...), so it is not read as one.
  var lines = [];
  s.items.forEach(function (li, i) {
    lines.push(qbItemLine(li));
    if (i < s.items.length - 1 && qbIncludes(li.includes).length) lines.push('');
  });
  if (lines.length) lines.push('');
  if (s.discount > 0) {
    lines.push('Total: ' + qbMoney(s.grossTotal));
    lines.push('');
    s.offers.forEach(function (o) { lines.push(o.label + ': -' + qbMoney(o.amount)); });
    lines.push('');
  }
  lines.push(s.totalLabel + ': ' + qbMoney(s.total) + ' ' + (currency || 'CAD'));
  return lines.join('\n');
}
// --- INLINE END ---
  /* ---------- END PRICE BLOCK ---------- */

  // Plain-text quote for "Copy quote" (Kevin 11-09): the SAME price block as the customer's quote text (renderPriceBlockSms above,
  // copied verbatim from WF1), so what the owner pastes matches what the system sends. Line 1 is plain words, never "word:"
  // (a phone can file text that starts like a web address as a link); then the event line, the price block, the deposit.
  function quoteText(view, req, now) {
    if (!view || view.defer || !Array.isArray(view.priceItems) || !view.priceItems.length) return '';
    var b = (req && req.body) || req || {};
    var head = [];
    if (b.occasion) head.push(b.occasion);
    if (b.event_date) head.push(fmtEventDate(b.event_date, now));
    if (b.guests) head.push(plural(b.guests, 'guest', 'guests'));
    if (b.service_hours) head.push(b.service_hours === 'over_8' ? 'more than 8 hours' : b.service_hours + ' hours');
    if (b.event_city) head.push(b.event_city + (view.distance ? ' (' + view.distance + ')' : ''));
    // The text must never START like a web address ("Quote: ..." reads as scheme "Quote" and a phone can paste it percent-encoded):
    // line 1 is plain words, line 2 the details, and neither may begin with "word:".
    var lines = ['Your quote'];
    if (head.length) {
      var detail = head.join(', ');
      lines.push(/^[A-Za-z][A-Za-z0-9+.\-]*:/.test(detail) ? 'For ' + detail : detail);
    }
    lines.push('');
    lines.push(renderPriceBlockSms(view.priceItems, view.priceTotal, view.currency));
    if (view.deposit) lines.push('', 'Deposit to hold the date: ' + view.deposit);
    // plain ASCII, as the customer text is (render.js ascii(); review r3 item 8): "Valentine's Cafe", never a curly quote or accent
    return smsAscii(lines.join('\n'));
  }

  // The SAME conversion as ascii() in quote/edge/cv-quote-send/render.js (WF1's ascii()): the text stays GSM-7; a name is flattened,
  // never cut. test_lib.js runs both on the same strings.
  var SMS_TRANSLIT = { '\u00df': 'ss', '\u00e6': 'ae', '\u00c6': 'AE', '\u0153': 'oe', '\u0152': 'OE', '\u00f8': 'o', '\u00d8': 'O', '\u0142': 'l', '\u0141': 'L',
    '\u0111': 'd', '\u0110': 'D', '\u00fe': 'th', '\u00de': 'Th', '\u0131': 'i' };
  function smsAscii(v) {
    var s = String(v === null || v === undefined ? '' : v)
      .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
      .replace(/[\u2013\u2014]/g, '-').replace(/\u2026/g, '...')
      .replace(/[\u00df\u00e6\u00c6\u0153\u0152\u00f8\u00d8\u0142\u0141\u0111\u0110\u00fe\u00de\u0131]/g, function (c) { return SMS_TRANSLIT[c]; });
    if (typeof s.normalize === 'function') s = s.normalize('NFD');
    return s.replace(/[\u0300-\u036f]/g, '').replace(/[^\x00-\x7F]/g, '');
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
      return { message: Object.keys(fields).length ? '' : "The calculator didn't accept that. Reload the page and try again.", fields: fields };
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
  // sql/026: the bulk clear's own reason. Shown wherever a reason is shown (chip, history, Metrics, spreadsheet, Ask), never
  // offered on the Lost sheet (owner or staff): cv_set_lead_status refuses it; only cv_bulk_lost writes it.
  var BULK_REASON = { key: BULK_REASON_KEY, label: 'Old lead' };
  var ALL_LOST_REASONS = LOST_REASONS.concat([BULK_REASON]);
  var LOST_NOTE_MAX = 500;
  var AMOUNT_MAX = 100000;

  // Chips on the Lost sheet, labels from CV_CUSTOM.lostReasons.
  function lostReasons() {
    return LOST_REASONS.map(function (r) { return { key: r.key, label: CUSTOM.lost[r.key] || r.label }; });
  }
  function lostReasonLabel(key) {
    var k = String(key || '').toLowerCase();
    if (!k) return '';
    var r = ALL_LOST_REASONS.filter(function (x) { return x.key === k; })[0];
    return r ? CUSTOM.lost[r.key] || r.label : humanize(k);
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
  // lead_id -> lead, first one wins (a list with a repeat keeps its first row, as a scan would).
  function leadIndex(leads) {
    var out = Object.create(null);
    (Array.isArray(leads) ? leads : []).forEach(function (l) { if (l && l.lead_id && !(l.lead_id in out)) out[l.lead_id] = l; });
    return out;
  }
  function timeOf(v) { var d = realDate(v); return d ? d.getTime() : null; }

  // When the lead asked for the owner: the row's own asked_at if the view has one, else the lead's
  // status_at while it is handed off (from lead_list). null when unknown.
  // leads may be a lead_id -> lead map (groupFollowUps builds one, so 1,000 rows x 5,000 leads is not a scan per row).
  function askedAt(row, leads) {
    if (row && realDate(row.asked_at)) return row.asked_at;
    var lead = leads && !Array.isArray(leads) && typeof leads === 'object' ? leads[row.lead_id]
      : (Array.isArray(leads) ? leads : []).filter(function (l) { return l && l.lead_id === row.lead_id; })[0];
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
    var byId = leadIndex(leads);
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      if (!r || !isUuid(r.lead_id)) return;
      var type = fuType(r);
      if (type === 'owner_callback') {
        out.needs.push(Object.assign({}, r, { asked_at: askedAt(r, byId) }));
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

  // Leads waiting on the owner, NEWEST first (round 4: at 100+ waiting, new ones must not land at the bottom; unknown time last).
  // A lead who texted STOP does not wait on the owner, EXCEPT one the owner added by hand (B2, Kevin 11-10: he may still call or text them from
  // his own phone), exactly cv_list_counts.needs: status handed_off and (not opted out, or source manual). lead_list has no opted_out column, so
  // on list rows the flag is simply unknown (not true) and this reads the status and the source. Each row: { lead, since, waiting, late, fresh, overDay }. The time is status_at (when it was handed
  // over), else last activity. ONE threshold (review r4b): fresh = handed over in the last 24 hours (NEEDS_FRESH_HOURS, the "New"
  // part of See all); overDay = waiting more than that (the "Waiting over a day" part and the "N waiting over a day" line, so the
  // line's number is that part's count); late = the red cue, past CV_CUSTOM.waitWarnHours (24 h by default, so all three agree).
  // A row with no known time is neither fresh nor overDay.
  var NEEDS_FRESH_HOURS = 24;
  // The pill on a See-all row handed over in the last 24 hours: the same words the normal list uses for these leads ("Needs you"),
  // plus how recent. Never the bare word "New", which is also a real status.
  function needsFreshPill() { return statusInfo('handed_off').label + ' \u00b7 last ' + NEEDS_FRESH_HOURS + ' h'; }
  // The block shows the newest 3 as one-line rows (name, how long, a call button; review r4 item 3), about 52 px each, so the
  // block and the filter chips both fit the first screen at 320x568. The full cards are in "See all".
  var NEEDS_SHOW = 3;
  function waitsOnOwner(l) {
    return !!l && String(l.status || '').toLowerCase() === 'handed_off' && (l.opted_out !== true || l.source === 'manual');
  }
  function needsYou(leads, now) {
    var t = nowDate(now).getTime();
    var rows = (Array.isArray(leads) ? leads : []).filter(waitsOnOwner).map(function (l) {
      var since = realDate(l.status_at) ? l.status_at : (realDate(l.last_activity_at) ? l.last_activity_at : (realDate(l.created_at) ? l.created_at : null));
      var at = timeOf(since);
      return { lead: l, since: since, waiting: waitingFor(since, now), late: waitLate(since, now),
        fresh: at !== null && t - at <= NEEDS_FRESH_HOURS * 3600000, overDay: at !== null && t - at > NEEDS_FRESH_HOURS * 3600000 };
    });
    rows.sort(function (a, b) {
      var ta = timeOf(a.since), tb = timeOf(b.since);
      if (ta === null && tb === null) return 0;
      if (ta === null) return 1;
      if (tb === null) return -1;
      return tb - ta;
    });
    return rows;
  }

  // Home (round 4): { needs: the newest NEEDS_SHOW waiting rows for the block, needsAll: every waiting row, rest: the leads under
  // the chip }. A waiting lead is ALSO in Open and All (Kevin 11-09: it must populate the open leads), marked by its wait cue.
  // key 'needs' = "See all": rest is every waiting lead, newest first, and the block steps aside (needs: []).
  // lostPart (optional, D3): under the Lost chip, only that part of it ('real' | 'old' | 'optout'); anything else = the whole chip.
  function homeView(leads, key, now, lostPart) {
    var all = needsYou(leads, now);
    if (key === 'needs') return { needs: [], needsAll: all, rest: all.map(function (r) { return r.lead; }) };
    var rest = filterLeads(leads, key);
    if (key === 'lost' && LOST_PART_KEYS.indexOf(lostPart) !== -1) rest = rest.filter(function (l) { return lostPartOf(l) === lostPart; });
    return { needs: all.slice(0, NEEDS_SHOW), needsAll: all, rest: rest };
  }

  // D3 (Kevin 11-10): under the Lost chip a toggle "Lost / Old lead / Opted out". Which part a lead is in is cv_list_counts' own rule (sql/028):
  //   optout = status opted_out (not marked since), old = status lost with lost_reason old_lead, real = the rest of the lost group (lost, dormant).
  // Precedence: a lead who texted STOP and was cleared as Old lead is under Old lead (its status is lost; lead_list has no STOP column, and the
  // lead page still says they texted STOP). lost_real + lost_old + lost_optout = the Lost chip's count.
  var LOST_PART_KEYS = ['real', 'old', 'optout'];
  function lostPartOf(lead) {
    if (!lead) return null;
    var st = String(lead.status || '').toLowerCase();
    if (statusGroup(st) !== 'lost') return null;
    if (st === 'opted_out') return 'optout';
    if (st === 'lost' && lead.lost_reason === 'old_lead') return 'old';
    return 'real';
  }
  // The three toggle buttons, in order. The first is the Lost chip's own word (a client's wording carries through).
  function lostParts() {
    return [
      { key: 'real', label: statusInfo('lost').label },
      { key: 'old', label: lostReasonLabel('old_lead') },
      { key: 'optout', label: statusInfo('opted_out').label }
    ];
  }
  // Counts for the toggle: the server's (cv_list_counts, past what the page fetched) when all three are good numbers, else the rows here.
  function lostCounts(leads, server) {
    var ok = server && typeof server === 'object' && ['lost_real', 'lost_old', 'lost_optout'].every(function (k) {
      var v = server[k]; return typeof v === 'number' && v >= 0 && Math.floor(v) === v;
    });
    if (ok) return { real: server.lost_real, old: server.lost_old, optout: server.lost_optout };
    var out = { real: 0, old: 0, optout: 0 };
    (Array.isArray(leads) ? leads : []).forEach(function (l) { var k = lostPartOf(l); if (k) out[k]++; });
    return out;
  }
  var LOST_PART_EMPTY = { real: 'No lost leads.', old: 'No old leads.', optout: 'Nobody has opted out.' };

  // Chip counts. The page's own count of the rows it has, unless the server's (cv_list_counts, sql/025) is given: those stay right
  // past what the page fetched. A server count with a missing or bad number is not used at all.
  var COUNT_KEYS = ['open', 'contacted', 'booked', 'lost', 'all'];
  function homeCounts(leads, now, server) {
    if (server && typeof server === 'object' && COUNT_KEYS.every(function (k) { var v = server[k]; return typeof v === 'number' && v >= 0 && Math.floor(v) === v; })) {
      var out = {};
      COUNT_KEYS.forEach(function (k) { out[k] = server[k]; });
      return out;
    }
    var c = filterCounts(leads);
    return { open: c.open, contacted: c.contacted, booked: c.booked, lost: c.lost, all: c.all };
  }

  // The full Needs-you list in parts: handed over in the last 24 hours, then waiting over a day (each newest first), then the
  // rare row with no known time. rows = the rows drawn (a page); all = every waiting row, for the counts in the headings (a page
  // never shrinks a count). "Waiting over a day" counts exactly what needsOverDay counts (review r4b).
  function needsSections(rows, all) {
    var list = Array.isArray(rows) ? rows : [];
    var every = Array.isArray(all) ? all : list;
    function part(key) { return function (r) { return !!r && (key === 'fresh' ? !!r.fresh : key === 'older' ? !!r.overDay : !r.fresh && !r.overDay); }; }
    return [
      { key: 'fresh', label: statusInfo('handed_off').label + ': last ' + NEEDS_FRESH_HOURS + ' hours' },   // the pill's words, never the bare status word "New"
      { key: 'older', label: 'Waiting over a day' },
      { key: 'unknown', label: 'Time not known' }
    ].map(function (s) {
      return { key: s.key, label: s.label, count: every.filter(part(s.key)).length, rows: list.filter(part(s.key)) };
    }).filter(function (s) { return s.rows.length > 0; });
  }

  // "See all 102" under the block, '' when the block already shows everyone.
  function needsMoreText(total) {
    var n = Number(total) || 0;
    return n > NEEDS_SHOW ? 'See all ' + n + ' waiting' : '';
  }

  // Review r4 item 4: when most of the waiting leads are older than a day, the block (newest first) never shows them. One line
  // under it: "97 waiting over a day", '' when every one of them is already in the block. index = the first such row in the full
  // list (newest first), so "See all" can open right there.
  function needsOverDay(all, shown) {
    var list = Array.isArray(all) ? all : [];
    var inBlock = Math.max(0, Math.floor(Number(shown) || 0));
    var n = 0, first = -1, hidden = 0;
    list.forEach(function (r, i) {
      if (!r || !r.overDay) return;
      n++;
      if (first === -1) first = i;
      if (i >= inBlock) hidden++;
    });
    return { count: n, index: first, text: hidden > 0 ? n + ' waiting over a day' : '' };
  }

  // Long lists (round 4): rows are drawn LIST_PAGE at a time with "Show more".
  // -> { rows: the first `shown` (at least one page), left: how many are not drawn, moreText }
  var LIST_PAGE = 50;
  // D4 (Kevin 11-10): ONE "Show more" wording for every list. `btn` = how many the button adds, `left` = how many are not drawn yet.
  // "Show 50 more (133 not shown)"; when the button adds everything that is left, the bracket would repeat itself, so it is dropped ("Show 30 more").
  function moreLabel(btn, left) {
    var b = Math.max(0, Math.floor(Number(btn) || 0)), n = Math.max(0, Math.floor(Number(left) || 0));
    if (!b || !n) return '';
    return 'Show ' + b + ' more' + (n !== b ? ' (' + n + ' not shown)' : '');
  }
  function listPage(rows, shown) {
    var list = Array.isArray(rows) ? rows : [];
    var n = Math.max(LIST_PAGE, Math.floor(Number(shown) || 0));
    var page = list.slice(0, n);
    var left = list.length - page.length;
    return { rows: page, shown: page.length, left: left,
      moreText: moreLabel(Math.min(LIST_PAGE, left), left) };
  }

  // D6 (Kevin 11-10): "Back to top" at the end of a long list. Long = this many rows drawn (about two screens on a phone).
  var BACK_TOP_MIN = 20;
  var BACK_TOP_LABEL = 'Back to top';
  function showBackToTop(drawn) { return Math.floor(Number(drawn) || 0) >= BACK_TOP_MIN; }

  // The page reads lead_list LIST_FETCH rows at a time, up to LIST_CAP. Past that it says so honestly (search still finds anyone).
  var LIST_FETCH = 1000;
  var LIST_CAP = 5000;

  // Review r4 item 7: the PostgREST or-filter for "the rows after this one" in an order of <col> DESC NULLS LAST, <idCol> ASC
  // (keyset paging). Values are checked, never pasted raw: a timestamp of digits and - : . + T Z, a uuid; anything else throws.
  function keysetAfter(col, at, idCol, id) {
    if (!/^[a-z_]+$/.test(col) || !/^[a-z_]+$/.test(idCol) || !isUuid(id)) throw new Error('keyset: bad key');
    if (at === null || at === undefined || at === '') return 'and(' + col + '.is.null,' + idCol + '.gt.' + id + ')';
    var t = String(at);
    if (!/^[0-9TZ:.+ -]{10,40}$/.test(t)) throw new Error('keyset: bad time');
    return col + '.lt."' + t + '",and(' + col + '.eq."' + t + '",' + idCol + '.gt.' + id + '),' + col + '.is.null';
  }
  function listTruncNote(loaded, total) {
    var a = Number(loaded) || 0, b = Number(total) || 0;
    if (!(b > a)) return '';
    return 'Showing your ' + a.toLocaleString('en-CA') + ' most recent leads of ' + b.toLocaleString('en-CA') + '. Search finds any lead.';
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
      var money = statusGroup(lead.status) === 'booked' && toCents(lead.booked_amount) !== null ? fmtMoney(lead.booked_amount) : quotedOrOwnerMoney(lead);
      if (money) bits.push(money);
    }
    return bits;
  }

  // 023: the money beside a lead in a list. A saved price reads as what it is.
  var OWNER_MONEY_WORDS = { sent: '', sending: ' sending now', unknown: ' may have gone out' };
  function quotedOrOwnerMoney(lead) {
    var q = fmtMoney(lead && lead.quote_total);
    if (q) return q;
    // lead_detail has the saved price with its send state; lead_list only the figure.
    var o = lead && lead.owner_quote;
    var saved = o && typeof o === 'object' ? fmtMoney(o.total) : '';
    if (saved) return saved + (OWNER_MONEY_WORDS[String(o.state || 'saved')] || ' not sent');
    var own = fmtMoney(lead && lead.owner_price);
    return own ? own + ' not sent' : '';
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
    var money = statusGroup(st) === 'booked' && toCents(lead.booked_amount) !== null ? fmtMoney(lead.booked_amount) : quotedOrOwnerMoney(lead);
    var needs = waitsOnOwner(lead);
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
  function actionsAhead(current, asOwner) {
    var cur = String(current || '').toLowerCase();
    return actions().filter(function (a) { return canSetStatus(cur, a.status, asOwner); }).map(function (a) { return a.status; });
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
  // Bar = Leads, Follow-ups, Calendar, Metrics (config order); More = Ask your CRM, Quote calculator, How to use the CRM, Help & support, Download spreadsheet (+ the fixed Alerts and Sign out). Lead value is a section inside Metrics, not a tab.
  // slots counts the bar tabs plus the More slot; with fewer than 2 the page hides the bar.
  var BAR_TABS = ['list', 'followups', 'calendar', 'metrics'];
  var MORE_TABS = ['ask', 'quote', 'guide', 'support', 'export', 'team'];
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

  /* ---------- How to use the CRM (More): the guide's words and its filter ----------
     Plain text only. Every section, step and question carries `f`, the flags it needs; it shows only when ALL of them are on
     (guideView: `on(flag)` is the page's own feature check). A section left with no steps is dropped. Words in {braces} are the client's
     own names, filled in here: {tab_<route>} = the tab / More label, {contacted} {booked} {lost} {needs} = the status words ({x_lc} lower case),
     {lost_reasons} and {sources} = the pick-lists. The guide never names a person, and never mentions a feature that is not on. */
  var GUIDE_FLAGS = ['followups', 'calendar', 'metrics', 'quote', 'export', 'ask', 'support', 'supportContact', 'supportNoContact', 'supportSend', 'supportNoSend', 'pastEvents', 'bulk',
    'addLead', 'search', 'push', 'noQuoteFilter', 'quoteDraft', 'quoteAge', 'forecast', 'value', 'quotePromoEnds', 'exportOff'];
  var GUIDE = {
    lede: 'Short steps for the jobs you do most. Tap a heading to open it.',
    quickstart: {
      title: 'Your first day',
      steps: [
        'On {tab_list}, look at {needs} at the top. Tap a name to open the lead.',
        'Tap Call, Text or Email to reach them. Then, under Change status, tap {contacted}.',
        'After the event, under Change status, tap {booked} or {lost}.'
      ]
    },
    sections: [
      { id: 'needs', title: 'See who needs you', f: [], steps: [
        'The {needs} list at the top of {tab_list} shows the newest people waiting and how long each has waited. The wait turns red and says overdue when it runs long.',
        'Tap a name to open the lead, or the phone icon to call. See all, when it shows, lists everyone waiting; tap Back to leads to return.'
      ] },
      { id: 'reply', title: 'Reply to a lead', f: [], steps: [
        'Open the lead and tap Call, Text or Email. Your phone opens its own Phone, Messages or Mail app.',
        'Under Conversation you can read what was said. Tap Open full to read it all, then Close.',
        'After you have reached them, under Change status tap {contacted}, then Mark as {contacted_lc}. Sometimes the box offers two buttons: Mark {contacted_lc} and send the follow-up, or Mark {contacted_lc}, no follow-up. If they texted STOP, no follow-up goes out.'
      ], note: 'You reply in your phone\'s own apps, not here. Someone who texted STOP gets no automatic texts; you can still call or text them.' },
      { id: 'outcome', title: 'Mark a lead {booked} or {lost}', f: [], steps: [
        'Open the lead. Under Change status, tap {booked} or {lost}. A box opens.',
        'For {booked}, check the Final price (it starts from the quote, if there is one). For {lost}, pick Why was it lost? ({lost_reasons}).',
        'Tap Mark as {booked_lc} or Mark as {lost_lc} to confirm.'
      ], note: 'Even small jobs count: it keeps your records right.' },
      { id: 'find', title: 'Find a lead', f: [], steps: [
        'On {tab_list}, tap a button near the top to narrow the list: Open, {contacted}, {booked}, {lost} or All. The number on a button counts its leads.',
        { t: 'Or type a name, phone number or email in the search box at the top (Search name, phone or email).', f: ['search'] },
        { t: 'The No quote button lists open leads with no quote yet. Their rows say No quote sent (this list only).', f: ['noQuoteFilter'] },
        { t: 'Open one and tap Price it in the quote calculator.', f: ['noQuoteFilter', 'quote'] },
        'At the end of longer lists, tap Show more (it reads like Show 50 more) for the next leads, or Back to top.'
      ], note: 'The {lost} button has three parts: {lost}, {old_lead} or {opted_out}.' },
      { id: 'past', title: 'Mark events that already happened', f: ['followups', 'pastEvents'], steps: [
        'Tap {tab_followups}. Did these happen? lists events that have passed with no result recorded.',
        'Tap Booked or Didn\'t book on each. A box asks you to confirm (and why, for Didn\'t book).'
      ] },
      { id: 'add', title: 'Add a lead yourself', f: ['addLead'], steps: [
        'On {tab_list}, tap + Add lead, at the top right.',
        'Fill in the Name and Phone (10 digits), pick Where they came from ({sources}), then any event details you know. Tick Already talked to them if so.',
        'Tap Add lead.'
      ], note: 'No automatic texts go to leads you add, unless they later fill in your form. You contact them yourself.' },
      { id: 'quote', title: 'Make a quote', f: ['quote'], steps: [
        'Tap More, then {tab_quote}.',
        'Fill in Number of guests, How many hours of service, Portable bar required? and Event city. More details (optional) holds the Event date, Occasion and Promo code.',
        'Tap Get quote, then Copy quote, or Start a new quote for the next one.',
        'From a lead\'s Price it link, tap Add this quote to followed by the lead\'s name to save the price there.',
        { t: 'If your phone closes the app on this screen, open {tab_quote} again: your answers come back (Restored your unfinished quote) for up to 12 hours.', f: ['quoteDraft'] },
        { t: 'If a saved promo has ended, the quote says so and leaves the promo blank.', f: ['quoteDraft', 'quotePromoEnds'] },
        { t: 'If you leave the screen yourself, the form is cleared. A form from a lead\'s Price it link comes back only if the app was closed on that screen: open that Price it link again.', f: ['quoteDraft'] },
        { t: 'A saved price you never used shows how old it is after a few weeks (Priced 23 days ago). On the lead, tap Change this price in the quote calculator and work it out again.', f: ['quoteAge'] }
      ], note: { t: 'Names and phone numbers are never kept.', f: ['quoteDraft'] } },
      { id: 'calendar', title: 'Check your calendar', f: ['calendar'], steps: [
        'Tap {tab_calendar}. This week and Later list coming events; the month grid shows booked ones. Switch on Include leads not booked yet to add the rest.',
        'Tap a day, then a lead, to open it.'
      ] },
      { id: 'metrics', title: 'See your numbers', f: ['metrics'], steps: [
        'Tap {tab_metrics}. Scroll through sections such as Money booked, Money on the table, Close rate and Speed.',
        { t: 'Lead value groups your open leads into price bands.', f: ['value'] },
        { t: 'Looking ahead shows bookings by event month, your open quotes at full price, and a likely range once there is enough history.', f: ['forecast'] }
      ], note: 'The numbers are only as good as your records. Mark leads {booked} or {lost}.' },
      { id: 'ask', title: 'Ask your CRM', f: ['ask'], steps: [
        'Tap More, then {tab_ask}. Tap a starter question (they stay after each answer), or type your own in the box at the bottom (Ask a question), then tap Ask.'
      ], note: 'It only reads your leads and never changes anything. Tap a lead name in an answer to open it.' },
      { id: 'alerts', title: 'Turn on alerts on this phone', f: ['push'], steps: [
        'On an iPhone, alerts only work when you open the app from your home screen icon.',
        'Tap More, find Alerts on this phone, tap Turn on alerts and allow notifications. Once on, tap that line to find Send test alert and Turn off.'
      ], note: 'Blocked? Open your phone\'s Settings, then Notifications, and allow this app.' },
      { id: 'export', title: 'Download your leads', f: ['export'], steps: [
        'Tap More, then {tab_export}.',
        'Under Which leads, pick All, Open, {booked} or {lost}. Pick dates (optional) limits it by when the lead came in.',
        'Tap Make spreadsheet, then Save file. It opens in Numbers, Excel or Google Sheets, one row per event.',
        { t: 'If the screen says the download is off, ask for it to be turned on.', f: ['exportOff'] }
      ] },
      { id: 'support', title: 'Write down a help request', f: ['support'], steps: [
        'Tap More, then {tab_support}. Under What is it?, pick Something\'s broken, A question or An idea.',
        { t: 'Write Your message, then tap Send. We get it right away.', f: ['supportSend'] },
        { t: 'Write Your message, then tap Save request. It is saved in this list only and nobody is told automatically yet, so use the Call or Text buttons at the top if it cannot wait.', f: ['supportNoSend', 'supportContact'] },
        { t: 'Write Your message, then tap Save request. It is saved in this list only and nobody is told automatically yet, so contact us directly if it cannot wait.', f: ['supportNoSend', 'supportNoContact'] },
        { t: 'If it cannot wait, the Call and Text buttons at the top reach us.', f: ['supportSend', 'supportContact'] },
        'Your requests, further down, lists each one with its status.'
      ], note: { t: 'Only use the Urgent switch for something that stops you working right now.', f: ['supportSend'] } },
      { id: 'bulk', title: 'Clear out old leads in bulk', f: ['followups', 'pastEvents', 'bulk'], steps: [
        'Tap {tab_followups}, then Clear old ones in bulk, on the top line of Did these happen?',
        'Pick a date under Event before. The box counts the open leads with an event before it. Leads with a text, a hand-over or a change in the last 14 days are left alone, and so are leads with more than one event date.',
        'Tap the button that says, for example, Mark 97 leads {lost}. Nothing is texted to anyone; they are marked {lost} with the reason {old_lead}. Tap Cancel to back out.',
        'Changed your mind? Tap Undo on the line at the top of {tab_followups} (7 days, latest bulk clear only).'
      ] },
      { id: 'install', title: 'Install and sign in', f: [], steps: [
        'Open the app from its icon on your home screen. Not there yet? In Safari tap Share, then Add to Home Screen.',
        'Sign in with your mobile number: tap Text me a code, type the 6-digit code, then tap Sign in.'
      ] }
    ],
    faq: [
      { q: 'I marked the wrong status. Can I change it?', a: 'Yes. On the lead, under Change status, tap the right one. Going back from {booked} or {lost} to {contacted} clears its price or reason. A lead who texted STOP can be marked too.', f: [] },
      { q: 'Did I lose my quote?', a: 'If your phone closed the app while you were on the quote screen, open {tab_quote} again and your answers come back. If you left the screen yourself, the form is cleared.', f: ['quote', 'quoteDraft'] },
      { q: 'How do I sign out?', a: 'Tap More, then Sign out.', f: [] }
    ]
  };
  var GUIDE_TAB_NAMES = { list: 'Leads', followups: 'Follow-ups', calendar: 'Calendar', metrics: 'Metrics', ask: 'Ask your CRM', quote: 'Quote calculator', guide: 'How to use the CRM', support: 'Help & support', export: 'Download spreadsheet' };

  // The guide, filtered: { lede, quickstart: { title, steps } | null, sections: [{ id, title, steps, note }], faq: [{ q, a }] }.
  // on(flag) = the page's own switch check; a flag the page does not answer true for counts as off. opts.tab(route) = the tab label (default: the built-in name).
  function guideView(on, opts) {
    var isOn = typeof on === 'function' ? on : function () { return false; };
    var tabLabel = opts && typeof opts.tab === 'function' ? opts.tab : null;
    function all(flags) { return (Array.isArray(flags) ? flags : []).every(function (f) { return GUIDE_FLAGS.indexOf(f) !== -1 && !!isOn(f); }); }
    function listWords(rows) { return rows.length > 1 ? rows.slice(0, -1).join(', ') + ' or ' + rows[rows.length - 1] : rows.join(''); }
    function words(text) {
      var map = { contacted: statusInfo('contacted').label, booked: statusInfo('booked').label, lost: statusInfo('lost').label, needs: statusInfo('handed_off').label, opted_out: statusInfo('opted_out').label };
      return String(text).replace(/\{([a-z_]+)\}/g, function (m, k) {
        if (k === 'lost_reasons') return listWords(lostReasons().map(function (x) { return x.label; }));
        if (k === 'old_lead') return lostReasonLabel('old_lead');
        if (k === 'sources') return listWords(addLeadSources().map(function (x) { return x.label; }));
        var tab = /^tab_([a-z]+)$/.exec(k);
        if (tab) { var got = tabLabel ? tabLabel(tab[1]) : ''; return (typeof got === 'string' && got.trim()) || GUIDE_TAB_NAMES[tab[1]] || m; }
        var lower = /^([a-z]+)_lc$/.exec(k);
        if (lower && map[lower[1]]) return map[lower[1]].toLowerCase();
        return map[k] || m;
      });
    }
    function steps(list) {
      return (Array.isArray(list) ? list : []).filter(function (x) { return typeof x === 'string' || (x && all(x.f)); })
        .map(function (x) { return words(typeof x === 'string' ? x : x.t); });
    }
    var q = GUIDE.quickstart;
    var out = { lede: GUIDE.lede, quickstart: { title: q.title, steps: steps(q.steps) }, sections: [], faq: [] };
    GUIDE.sections.forEach(function (s) {
      if (!all(s.f)) return;
      var st = steps(s.steps);
      if (!st.length) return;
      var note = s.note && typeof s.note === 'object' ? (all(s.note.f) ? s.note.t : '') : (s.note || '');
      out.sections.push({ id: s.id, title: words(s.title), steps: st, note: note ? words(note) : '' });
    });
    GUIDE.faq.forEach(function (x) { if (all(x.f)) out.faq.push({ q: words(x.q), a: words(x.a) }); });
    if (!out.quickstart.steps.length) out.quickstart = null;
    return out;
  }

  /* ---------- Help & support (session 3, round 2) ---------- */

  // Diagnostics: what the page may tell Kevin about a problem. Contract: HANDOFF / round-2 design, section 3.5.
  // The server rebuilds and re-scrubs it (cv_private.support_clean_diag); this side keeps the same rules so nothing sensitive
  // is even sent. Never: bodies, arguments, message texts, tokens, cookies, storage, full URLs, names, phones, emails.
  var DIAG_MAX = 10;
  var DIAG_MAX_AGE_MS = 30 * 60 * 1000;
  var DIAG_ROUTES = ['list', 'followups', 'calendar', 'metrics', 'more', 'quote', 'support', 'lead', 'signin'];

  // Same rules, same order as cv_private.support_scrub (sql/012b_support_fixes.sql); the shared vectors
  // (tools/tests/support_scrub_vectors.json) lock the two together. A uuid, an ISO date and a build id survive.
  function diagScrub(str, max) {
    var s = String(str === null || str === undefined ? '' : str);
    s = s.replace(/Bearer\s+\S+/gi, '[token]');
    s = s.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]*)?/g, '[token]');
    s = s.replace(/(?<![A-Za-z0-9_])sb_(?:secret|publishable)_[A-Za-z0-9_-]+/gi, '[token]');
    s = s.replace(/(?<![0-9A-Fa-f])(?=[0-9A-Fa-f]*[0-9])[0-9A-Fa-f]{32,}(?![0-9A-Fa-f])/g, '[token]');
    s = s.replace(/(access_token|refresh_token|id_token|client_secret|apikey|api_key|authorization|password|passwd|sessionid|session|secret|signature|token|auth|code|jwt|key|pwd|sig)=[^&\s"']+/gi, '$1=[x]');
    // JSON form, plain or escaped inside a string: "refresh_token":"abc" -> "refresh_token":"[x]" (not "code": PostgREST error codes stay)
    s = s.replace(/(\\?"[A-Za-z0-9_-]*(?:token|key|secret|password|passwd|pwd|auth|authorization|jwt|session|sessionid|sig|signature)\\?"\s*:\s*\\?")[^"\\]*/gi, '$1[x]');
    s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]');
    s = s.replace(/(https?:\/\/[^\s?#"']+)[?#][^\s"']*/g, '$1');
    // Phone: 7+ digits. The look-arounds keep a uuid, an ISO date and a build id whole (shared vectors, support_scrub_vectors.json).
    s = s.replace(/(?<![A-Za-z0-9][.-]?)(?![0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-)\+?\(?[0-9](?:[ .()-]*[0-9]){6,}(?![.-]?[A-Za-z0-9])/g, '[number]');
    // Phones glued to letters: a bare run of 10+ digits (not the tail of a uuid), or a formatted (416) 555-0123.
    s = s.replace(/(?<![0-9])(?<![0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{0,2})[0-9]{10,}/g, '[number]');
    s = s.replace(/(?<![0-9])\(?[0-9]{3}\)?[ .-]?[0-9]{3}[ .-][0-9]{4}(?![0-9])/g, '[number]');
    // Whitespace controls become one space; every other control / bidi / zero-width character is removed.
    s = s.replace(/[\t\n\u000b\f\r]/g, ' ');
    s = s.replace(/[\u0001-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '');
    var n = Number(max);
    return n > 0 ? s.slice(0, n) : s;
  }

  // Append to a ring buffer: entries older than 30 minutes drop out, the newest `max` (10) stay. Returns a new array.
  function diagPush(buf, entry, max, now) {
    var cap = Number(max) > 0 ? Number(max) : DIAG_MAX;
    var t = nowDate(now).getTime();
    var out = (Array.isArray(buf) ? buf : []).concat(entry ? [entry] : []).filter(function (e) {
      var at = e && toDate(e.at);
      return at && t - at.getTime() <= DIAG_MAX_AGE_MS;
    });
    return out.slice(-cap);
  }

  function diagFile(name) {
    var base = String(name || '').split(/[?#]/)[0].split('/').pop();
    return /^[A-Za-z0-9._-]{1,40}$/.test(base) ? base : '';
  }
  function diagSrc(file, line, col) {
    var f = diagFile(file);
    if (!f) return '';
    var l = parseInt(line, 10), c = parseInt(col, 10);
    return f + (l > 0 && l < 1000000 ? ':' + l + (c > 0 && c < 1000000 ? ':' + c : '') : '');
  }

  // window 'error' event -> { at, msg, src }.
  function diagFromError(ev, now) {
    ev = ev || {};
    var raw = ev.message || (ev.error && ev.error.message) || 'error';
    return { at: nowDate(now).toISOString(), msg: diagScrub(raw, 200), src: diagSrc(ev.filename, ev.lineno, ev.colno) };
  }

  // window 'unhandledrejection' event -> { at, msg, src } (src from the Error's stack when it names a file).
  function diagFromRejection(ev, now) {
    var r = ev && ev.reason;
    var raw = r && typeof r === 'object' ? (r.message || r.error || '') : (r === undefined || r === null ? '' : r);
    var src = '';
    var m = r && typeof r.stack === 'string' ? /([A-Za-z0-9._-]+\.js)(?:\?[^\s:)]*)?:(\d+)(?::(\d+))?/.exec(r.stack) : null;
    if (m) src = diagSrc(m[1], m[2], m[3]);
    return { at: nowDate(now).toISOString(), msg: diagScrub(raw || 'unhandled rejection', 200), src: src };
  }

  // A failed call -> { at, name, status, code }. Only the name of the call, the HTTP-ish status and a short code word:
  // never the error message, details, arguments or body.
  function diagCall(name, err, now) {
    var e = err && typeof err === 'object' ? err : {};
    var st = parseInt(e.status !== undefined ? e.status : (e.context && e.context.status), 10);
    if (!(st >= 0 && st <= 599)) st = 0;
    var code = '';
    [e.code, e.error, e.message].forEach(function (c) {
      if (code) return;
      var w = String(c === undefined || c === null ? '' : c).trim();
      if (/^[A-Za-z0-9_]{1,40}$/.test(w) && (c === e.code || /^[a-z_]{1,40}$/.test(w))) code = w;
    });
    var nm = String(name || '').toLowerCase().replace(/[^a-z0-9_.-]/g, '_').slice(0, 40) || 'call';
    return { at: nowDate(now).toISOString(), name: nm, status: st, code: code };
  }

  // navigator + window -> the `device` object. Words only; ua is scrubbed and cut.
  function diagDevice(nav, win) {
    nav = nav || {}; win = win || {};
    var ua = String(nav.userAgent || '');
    var touch = Number(nav.maxTouchPoints) > 1;
    var platform = /iPhone|iPod/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (/Macintosh/.test(ua) && touch) ? 'iPad'
      : /Android/.test(ua) ? 'Android' : /Macintosh|Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Other';
    var browser = /Edg(e|A|iOS)?\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung' : /Firefox|FxiOS/.test(ua) ? 'Firefox'
      : /Chrome|CriOS/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'Other';
    var standalone = nav.standalone === true;
    try { if (!standalone && typeof win.matchMedia === 'function') standalone = !!win.matchMedia('(display-mode: standalone)').matches; } catch (e) { /* keep false */ }
    var lang = String(nav.language || '').trim();
    var tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e2) { tz = ''; }
    return {
      platform: platform, browser: browser, standalone: standalone, online: nav.onLine !== false,
      lang: /^[A-Za-z0-9-]{2,12}$/.test(lang) ? lang : '',
      tz: /^[A-Za-z0-9_\/+-]{1,40}$/.test(tz) ? tz : '',
      ua: diagScrub(ua, 200)
    };
  }

  function diagInt(n, hi) { n = Math.round(Number(n)); return n >= 0 && n <= hi ? n : 0; }
  // A screen the server does not list (Download spreadsheet, 'export') is reported as 'more', where it lives; the server list is untouched this round.
  function diagRoute(r) { return typeof r === 'string' && /^[a-z-]{1,24}$/.test(r) ? (DIAG_ROUTES.indexOf(r) !== -1 ? r : 'more') : ''; }

  // state { build, route, fromRoute, viewport {w,h}, device, errors, calls, now } -> exactly the contract object.
  function supportDiagnostics(state) {
    var s = state || {};
    var d = {
      app_version: /^[A-Za-z0-9._-]{1,40}$/.test(String(s.build || '')) ? String(s.build) : 'dev',
      route: diagRoute(s.route) || 'more'
    };
    var from = diagRoute(s.fromRoute);
    if (from) d.from_route = from;
    d.viewport = { w: diagInt(s.viewport && s.viewport.w, 10000), h: diagInt(s.viewport && s.viewport.h, 10000) };
    d.device = s.device || diagDevice({}, {});
    var t = nowDate(s.now).getTime();
    function live(list) {
      return (Array.isArray(list) ? list : []).filter(function (e) { var a = e && toDate(e.at); return a && t - a.getTime() <= DIAG_MAX_AGE_MS; }).slice(-DIAG_MAX);
    }
    d.errors = live(s.errors).map(function (e) {
      return { at: String(e.at), msg: diagScrub(e.msg, 200), src: /^[A-Za-z0-9._-]{1,40}(:[0-9]{1,6}){0,2}$/.test(String(e.src || '')) ? String(e.src) : '' };
    });
    d.calls = live(s.calls).map(function (e) {
      return { at: String(e.at), name: String(e.name || '').toLowerCase().replace(/[^a-z0-9_.-]/g, '_').slice(0, 40) || 'call',
        status: diagInt(e.status, 599), code: /^[A-Za-z0-9_]{0,40}$/.test(String(e.code || '')) ? String(e.code || '') : '' };
    });
    return d;
  }

  // One key per compose; the same key on every retry makes the server treat a repeat as the same request.
  function newClientKey(cr) {
    cr = cr || (typeof crypto !== 'undefined' ? crypto : null);
    if (cr && typeof cr.randomUUID === 'function') return cr.randomUUID();
    var b = new Array(16);
    if (cr && typeof cr.getRandomValues === 'function') { var u = new Uint8Array(16); cr.getRandomValues(u); b = Array.prototype.slice.call(u); }
    else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    var h = b.map(function (x) { return (x + 256).toString(16).slice(1); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  var SUPPORT_KINDS = [
    { key: 'broken', label: "Something's broken", short: 'Broken' },
    { key: 'question', label: 'A question', short: 'Question' },
    { key: 'idea', label: 'An idea', short: 'Idea' }
  ];
  var SUPPORT_MAX = 2000;
  function supportKindWord(k) { var r = SUPPORT_KINDS.filter(function (x) { return x.key === k; })[0]; return r ? r.short : ''; }

  // The config RPC answer -> what the page shows. enabled / sendEnabled only when exactly true; the phone only when E.164.
  function supportConfigView(cfg) {
    var c = cfg && typeof cfg === 'object' ? cfg : {};
    var name = String(c.contact_name || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 20) || 'Kevin';
    // B2 / B9 (R2): the Call and Text links use the same strict check as every other phone link (strictE164), so a number that is E.164-shaped but not a
    // real one gives no buttons rather than a dead link.
    var phone = typeof c.contact_phone === 'string' && /^\+[1-9][0-9]{7,14}$/.test(c.contact_phone.trim()) && strictE164(c.contact_phone) ? c.contact_phone.trim() : '';
    return { enabled: c.enabled === true, sendEnabled: c.send_enabled === true, name: name, phone: phone,
      callHref: telHref(phone) || '', textHref: smsHref(phone) || '' };
  }

  // Form values -> RPC arguments, or { ok: false, error } with the server's own error words.
  // form: { kind, message, urgent, lead_id, include_customer, client_key, diagnostics, sendEnabled }
  function supportArgs(form) {
    var f = form || {};
    if (!SUPPORT_KINDS.some(function (k) { return k.key === f.kind; })) return { ok: false, error: 'kind' };
    var msg = String(f.message === undefined || f.message === null ? '' : f.message).replace(/\r\n?/g, '\n').trim();
    if (!msg) return { ok: false, error: 'message_empty' };
    if (msg.length > SUPPORT_MAX) return { ok: false, error: 'message_too_long' };
    if (!isUuid(f.client_key)) return { ok: false, error: 'client_key' };
    var lead = isUuid(f.lead_id) ? String(f.lead_id).toLowerCase() : null;
    return { ok: true, args: {
      p_kind: f.kind, p_message: msg, p_urgent: f.urgent === true && f.sendEnabled !== false,
      p_lead_id: lead, p_include_customer: !!(lead && f.include_customer === true),
      p_client_key: String(f.client_key).toLowerCase(), p_diagnostics: f.diagnostics || {}
    } };
  }

  // The line under the form after a send. `told` = kevin_told from the server.
  function supportConfirm(told, ref) {
    var r = String(ref || '');
    switch (told) {
      case 'email': return 'Sent. Kevin has it. Your reference is ' + r + '.';
      case 'text_and_email': return 'Sent. Kevin is getting a text now. Your reference is ' + r + '.';
      case 'email_urgent_limit': return 'Sent as ' + r + '. Kevin gets it by email: you’ve sent 3 urgent requests today. Call him if it can’t wait.';
      case 'off': return 'Saved as ' + r + '. Kevin isn’t told automatically yet: call or text him if it can’t wait.';
      case 'failed': return 'Saved as ' + r + ', but Kevin wasn’t told. Call or text him.';
      default: return 'Sent. Your reference is ' + r + '.';
    }
  }

  // A failed send/list -> { code, text, removeLead }.
  function supportErrorText(err) {
    var e = err && typeof err === 'object' ? err : {};
    var msg = String(e.message || e.error || (typeof err === 'string' ? err : '')).trim().toLowerCase();
    var det = String(e.details || e.detail || '').trim().toLowerCase().replace(/[.\s]+$/, '').replace(/[\s-]+/g, '_');
    var m = /\b(not_owner|disabled|too_many|bad_input)\b\s*(?::\s*([^\n]*))?/.exec(msg);
    var word = m ? m[1] : '';
    if (!word && (e.code === '42501' || e.status === 403)) word = 'not_owner';
    var why = m && m[2] ? String(m[2]).trim().replace(/[.\s]+$/, '').replace(/[\s-]+/g, '_') : det;
    if (word === 'not_owner') return { code: word, text: 'You’re signed out. Sign in again.', removeLead: false };
    if (word === 'disabled') return { code: word, text: 'Help requests are turned off. Call or text Kevin.', removeLead: false };
    if (word === 'too_many') return { code: word, text: 'That’s a lot of requests in a short time. Call or text Kevin instead.', removeLead: false };
    if (word === 'bad_input') {
      if (why === 'message_empty') return { code: why, text: 'Write a message first.', removeLead: false };
      if (why === 'message_too_long') return { code: why, text: 'Keep it under 2,000 characters.', removeLead: false };
      if (why === 'kind') return { code: why, text: 'Pick what it is.', removeLead: false };
      if (why === 'lead' || why === 'include_customer') return { code: 'lead', text: 'That lead is gone; sent without it?', removeLead: true };
    }
    return { code: 'network', text: 'Couldn’t send. Check your connection and try again.', removeLead: false };
  }

  // "Sat 7 Nov" (a year too when it is not this year), in the client's time zone.
  function fmtSupportDate(iso, now) {
    var d = toDate(iso);
    if (!d) return '';
    var p = partsOf(d), n = partsOf(nowDate(now));
    return WEEKDAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()] + ' ' + p.d + ' ' + MONTHS[p.m - 1] + (p.y !== n.y ? ' ' + p.y : '');
  }

  // "About: Sarah · Sat 14 Nov" from a lead record.
  function supportLeadLine(lead, now) {
    if (!lead) return '';
    var first = String(displayName(lead)).split(/\s+/)[0] || '';
    var ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(lead.event_date || ''));
    var date = '';
    if (ymd) {
      var mo = Number(ymd[2]), da = Number(ymd[3]), y = Number(ymd[1]);
      if (mo >= 1 && mo <= 12) {
        date = WEEKDAYS[new Date(Date.UTC(y, mo - 1, da)).getUTCDay()] + ' ' + da + ' ' + MONTHS[mo - 1] + (y !== partsOf(nowDate(now)).y ? ' ' + y : '');
      }
    }
    return 'About: ' + first + (date ? ' · ' + date : '');
  }

  var SUPPORT_STATUS = {
    received: { label: 'Received', tone: 'received' },
    working: { label: 'Working on it', tone: 'working' },
    fixed: { label: 'Fixed', tone: 'fixed' }
  };

  // One row of cv_support_list -> what the list shows (text only; every value is set with textContent).
  function supportRow(row, now) {
    var r = row || {};
    var st = SUPPORT_STATUS[r.status] || SUPPORT_STATUS.received;
    var first = String(r.message || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean)[0] || '';
    var note = String(r.kevin_note || '').trim();
    return {
      kind: supportKindWord(r.kind) || 'Request', first: first, status: st.label, tone: st.tone,
      date: fmtSupportDate(r.created_at, now), note: note ? 'Kevin: ' + note : '',
      ref: /^H-[A-HJ-NP-Z2-9]{4,5}$/.test(String(r.ref || '')) ? String(r.ref) : '', urgent: r.urgent === true
    };
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
  // '#/needs' -> { name: 'list', needs: true }: the full Needs-you list ("See all") has its own history entry, so Back returns to the list.
  function parseRoute(hash, tabs) {
    var h = String(hash || '');
    if (/^#\/needs\/?$/.test(h)) return { name: 'list', needs: true };
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


  /* ---------- spreadsheet download (session 3, round 3) ---------- */

  // The server (cv_export_leads, sql/013) returns plain rows; ALL labels, formatting and CSV escaping live here, so a client's
  // own wording carries through and the injection guard is in exactly one place. Contract: crm-s3-r3-contract.md, sections 2 + 4.
  // Shared test vectors: tools/tests/export_vectors.json.

  // Time zone words for a header: America/Toronto -> "Toronto".
  function tzWord(tz) {
    var last = String(tz || TZ).split('/').pop() || '';
    return last.replace(/_/g, ' ');
  }

  function exportHeaders(tz) {
    var z = tzWord(tz);
    return ['Received (' + z + ' time)', 'Customer #', 'Name', 'Phone', 'Email', 'Status', 'Status changed (' + z + ' time)',
      'Event date', 'Occasion', 'Guests', 'Hours', 'Event city', 'Distance (km)', 'Bar rental', 'Quote', 'Quote total ($)',
      'Quote details', 'Promotion', 'Value', 'Booked for ($)', 'Lost reason', 'Came from', 'Texts', 'Consent', 'Follow-up',
      'Last activity (' + z + ' time)', 'Events for this customer', 'Other dates (from form)', 'Additional details',
      'History', 'Notes', 'Record ID'];
  }

  // 2026-11-07T03:30:00Z -> "2026-11-06 22:30" (24 h, client time zone). '' for nothing or nonsense.
  var fmtExport = null;
  function exportLocal(iso) {
    var d = iso === null || iso === undefined || iso === '' ? null : toDate(iso);
    if (!d) return '';
    if (!fmtExport) fmtExport = { tz: '', f: null };
    if (fmtExport.tz !== TZ) {
      fmtExport.tz = TZ;
      fmtExport.f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    }
    var o = {};
    fmtExport.f.formatToParts(d).forEach(function (p) { o[p.type] = p.value; });
    var hh = o.hour === '24' ? '00' : o.hour;
    return o.year + '-' + o.month + '-' + o.day + ' ' + hh + ':' + o.minute;
  }

  // +14165550123 -> (416) 555-0123. Anything else stays as stored (it is guarded when written). Empty -> ''.
  function exportPhone(e164) {
    var s = String(e164 == null ? '' : e164).trim();
    var m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(s);
    return m ? '(' + m[1] + ') ' + m[2] + '-' + m[3] : s;
  }

  function oneLine(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
  function exportNum(v) {
    if (v === null || v === undefined || v === '') return '';
    var n = Number(v);
    return isFinite(n) ? String(n) : '';
  }
  function exportMoney(v) {
    var c = toCents(v);
    return c === null ? '' : (c / 100).toFixed(2);
  }
  function exportYmd(v) {
    var m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v == null ? '' : v));
    return m ? m[1] : '';
  }
  function exportHours(r) {
    var label = oneLine(r.service_hours_label);
    if (label) return label;
    function hm(t) { var s = oneLine(t); var m = /^(\d{1,2}:\d{2}):\d{2}/.exec(s); return m ? m[1] : s; }
    var a = hm(r.start_time), b = hm(r.end_time);
    return a && b ? a + ' to ' + b : (a || b);
  }
  function exportQuoteWord(st) {
    var k = String(st || '').toLowerCase();
    return k === 'firm' ? 'Priced' : k === 'defer' ? 'Needs your price' : '';
  }
  function exportQuoteDetails(r) {
    if (String(r.quote_status || '').toLowerCase() === 'defer') return deferReasons(r.quote_defer_reasons).join('; ');
    var items = Array.isArray(r.quote_line_items) ? r.quote_line_items : [];
    return items.filter(function (it) { return it && typeof it === 'object'; }).map(function (it) {
      var label = oneLine(it.label), detail = oneLine(it.detail);
      var head = label + (detail ? ' (' + detail + ')' : '');
      var money = fmtMoney(it.amount);
      return head && money ? head + ': ' + money : head || money;
    }).filter(Boolean).join(' | ');
  }
  function exportCameFrom(r) {
    var s = String(r.source || '').toLowerCase();
    if (!s) return '';
    if (s === 'tally_form') return 'Booking form';
    if (s === 'sms_inbound') return 'Texted first';
    if (s === 'demo-seed') return 'Sample (demo)';
    if (s === 'manual') { var m = manualSourceLabel(r.manual_source); return m ? 'Added by you: ' + m : 'Added by you'; }
    return humanize(s.replace(/-/g, ' '));
  }
  function exportLost(r) {
    var key = String(r.lost_reason || '').trim();
    if (!key) return '';
    var label = lostReasonLabel(key);
    var note = oneLine(r.lost_note);
    return key.toLowerCase() === 'other' && note ? label + ': ' + note : label;
  }
  function exportFollowUp(f) {
    if (!f || typeof f !== 'object') return '';
    var type = String(f.type || '').toLowerCase();
    var reason = oneLine(f.reason);
    if (type === 'auto_nudge') {
      if (f.due_at) return 'Automatic text due ' + exportLocal(f.due_at);
      if (f.sent_at) return 'Automatic text sent ' + exportLocal(f.sent_at);
      return reason;
    }
    if (type === 'owner_callback') return reason ? 'You: ' + reason : 'You';
    return reason || humanize(type);
  }
  function exportHistory(r) {
    var h = (Array.isArray(r.history) ? r.history : []).filter(Boolean).map(function (e) {
      var a = String(e.action || '').toLowerCase();
      var label = CUSTOM.status[a] || HISTORY_ACTIONS[a] || statusInfo(a).label;
      var s = String(e.source || '').toLowerCase();
      var src = HISTORY_SOURCES[s] || (s ? s.replace(/_/g, ' ') : '');
      var extra = a === 'booked' ? fmtMoney(e.amount) : a === 'lost' ? lostReasonLabel(e.reason) : '';
      return [exportLocal(e.at), label, extra, src].filter(Boolean).join(' ');
    });
    var more = Number(r.history_more) || 0;
    if (more > 0) h.push('and ' + more + ' older');
    return h.join(' | ');
  }
  function exportNotes(r) {
    var n = (Array.isArray(r.notes) ? r.notes : []).filter(Boolean).map(function (x) {
      return [exportLocal(x.at), oneLine(x.body)].filter(Boolean).join(' ');
    });
    var more = Number(r.notes_more) || 0;
    if (more > 0) n.push('and ' + more + (more === 1 ? ' older note' : ' older notes') + ' in the app');
    return n.join(' | ');
  }
  function exportTier(v) {
    var k = tierOf({ value_tier: v });
    return CUSTOM.tiers[k] || TIERS.filter(function (t) { return t.key === k; })[0].label;
  }

  // One RPC row -> the 32 cells, in header order. kind 't' = text (quoted + guarded when written), 'n' = number (bare).
  function exportCells(row) {
    var r = row || {};
    var t = function (v) { return { v: v == null ? '' : String(v), kind: 't' }; };
    var n = function (v) { return { v: v, kind: 'n' }; };
    var texts = r.opted_out === true ? 'Opted out' : r.auto_texts === false ? 'Off: you contact them' : 'On';
    return [
      t(exportLocal(r.created_at)), n(exportNum(r.customer_no)), t(oneLine(r.name)), t(exportPhone(r.phone)), t(oneLine(r.email)),
      t(r.status ? statusInfo(r.status).label : ''), t(exportLocal(r.status_at)),
      t(exportYmd(r.event_date)), t(oneLine(r.occasion)), n(exportNum(r.guests)), t(exportHours(r)), t(oneLine(r.event_area)),
      n(exportNum(r.distance_km)), t(r.bar_rental === true ? 'Yes' : r.bar_rental === false ? 'No' : ''),
      t(exportQuoteWord(r.quote_status)), n(exportMoney(r.quote_total)), t(exportQuoteDetails(r)), t(promoText(r)), t(exportTier(r.value_tier)),
      n(exportMoney(r.booked_value)), t(exportLost(r)), t(exportCameFrom(r)), t(texts), t(r.consent_basis == null ? '' : r.consent_basis),
      t(exportFollowUp(r.follow_up)), t(exportLocal(r.last_activity_at)), n(exportNum(r.customer_events)),
      t(oneLine(r.multi_event_dates)), t(r.additional_details == null ? '' : r.additional_details),
      t(exportHistory(r)), t(exportNotes(r)), t(r.lead_id == null ? '' : r.lead_id)
    ];
  }

  /* CSV (RFC 4180) with the OWASP CSV-injection guard. The only encoder: the server never escapes. */
  var CSV_GUARD = { '=': 1, '+': 1, '-': 1, '@': 1, '\t': 1, '\n': 1, '＝': 1, '＋': 1, '－': 1, '＠': 1 };
  function csvCell(v, kind) {
    if (v === null || v === undefined || v === '') return '';
    var s = String(v);
    if (kind === 'n' && /^-?[0-9]+(\.[0-9]+)?$/.test(s)) return s; // a number the page's own formatter built; a leading minus is safe here, text keeps the full guard
    s = s.replace(/\r\n?/g, '\n')
      .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
      .replace(/[‎‏‪-‮⁦-⁩]/g, '');
    if (s === '') return '';
    if (CSV_GUARD[s.charAt(0)] === 1) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function csvEncode(headers, rows) {
    var lines = [(headers || []).map(function (h) { return csvCell(h, 't'); }).join(',')];
    (rows || []).forEach(function (cells) {
      lines.push((cells || []).map(function (c) { return csvCell(c && c.v, c && c.kind); }).join(','));
    });
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  // <business>-leads[-open|-booked|-lost]-<YYYY-MM-DD>.csv; letters and digits only, accents folded, at most 40 for the business part.
  function exportFileName(appNameText, group, ymdText) {
    var s = String(appNameText == null ? '' : appNameText).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (s.length > 40) {
      var cut = s.slice(0, 40);
      if (s.charAt(40) !== '-' && cut.lastIndexOf('-') > 0) cut = cut.slice(0, cut.lastIndexOf('-'));
      s = cut.replace(/-+$/, '');
    }
    if (s === 'leads') s = '';
    var g = group === 'open' || group === 'booked' || group === 'lost' ? '-' + group : '';
    return (s ? s + '-' : '') + 'leads' + g + '-' + ymdText + '.csv';
  }

  // iPhone / iPad (Safari and the home-screen app): a download link often does nothing, so the share sheet ("Save to Files") is used.
  function exportSaveMethod(env) {
    var e = env || {};
    return e.canShareFiles && (e.platform === 'iPhone' || e.platform === 'iPad') ? 'share' : 'link';
  }

  // The four choices, labels from the client's status words. All first and pre-selected.
  function exportGroups() {
    var f = filters();
    function lab(k) { return f.filter(function (x) { return x.key === k; })[0].label; }
    return ['all', 'open', 'booked', 'lost'].map(function (k) { return { key: k, label: lab(k) }; });
  }

  // Page choices -> RPC arguments, or { ok: false, error }.
  function exportArgs(group, from, to) {
    var g = String(group || 'all').toLowerCase();
    if (['all', 'open', 'booked', 'lost'].indexOf(g) === -1) return { ok: false, error: exportErrorText({ message: 'bad_input', details: 'group' }) };
    var f = String(from || '').trim(), t = String(to || '').trim();
    var re = /^\d{4}-\d{2}-\d{2}$/;
    if ((f && !re.test(f)) || (t && !re.test(t))) return { ok: false, error: exportErrorText({ message: 'bad_input', details: 'dates' }) };
    var yr = function (x) { return x && (x < '2000-01-01' || x > '2100-12-31' || isNaN(Date.parse(x + 'T00:00:00Z')) || new Date(x + 'T00:00:00Z').toISOString().slice(0, 10) !== x); };
    if (yr(f) || yr(t)) return { ok: false, error: exportErrorText({ message: 'bad_input', details: 'dates_range' }) };
    if (f && t && t < f) return { ok: false, error: exportErrorText({ message: 'bad_input', details: 'dates' }) };
    return { ok: true, args: { p_group: g, p_from: f || null, p_to: t || null } };
  }

  // What the owner reads after "Make spreadsheet": { text, canSave }.
  function exportResult(env, name) {
    var e = env || {};
    var got = Number(e.rows_returned), all = Number(e.rows_matching);
    var rows = Array.isArray(e.rows) ? e.rows.length : 0;
    if (!isFinite(got)) got = rows;
    if (!isFinite(all)) all = got;
    var fmt = function (x) { return Number(x).toLocaleString('en-CA'); };
    if (got === 0) return { text: 'No leads match. Nothing to save.', canSave: false };
    if (e.truncated === true) return { text: 'Only the newest ' + fmt(got) + ' of ' + fmt(all) + ' fit in one file. Pick dates to get the rest.', canSave: true };
    return { text: fmt(got) + (got === 1 ? ' lead ready.' : ' leads ready.'), canSave: true, name: name };
  }

  // D10 (Kevin 11-10): export_enabled is a cv_config row, 'true' = on; anything else or a missing row = off (the same rule cv_export_leads uses).
  // row = { key, value } or null -> { enabled, offText }. A read that FAILED is not an answer: the caller leaves the screen as it was.
  var EXPORT_OFF_TEXT = 'Spreadsheet download is turned off. Ask Kevin.';
  function exportConfigView(row) {
    var on = !!row && typeof row === 'object' && row.value === 'true';
    return { enabled: on, offText: on ? '' : EXPORT_OFF_TEXT };
  }

  function exportErrorText(err) {
    var e = err && typeof err === 'object' ? err : {};
    var msg = String(e.message || e.error || (typeof err === 'string' ? err : '')).trim().toLowerCase();
    var det = String(e.details || e.detail || '').trim().toLowerCase().replace(/[.\s]+$/, '').replace(/[\s-]+/g, '_');
    var m = /\b(not_owner|not_allowed|bad_input)\b\s*(?::\s*([^\n]*))?/.exec(msg);
    var word = m ? m[1] : '';
    if (!word && (e.code === '42501' || e.status === 403)) word = 'not_owner';
    if (!word && (e.status === 401 || e.code === 'PGRST301' || /jwt/.test(msg))) return SESSION_RAN_OUT;
    var why = m && m[2] ? String(m[2]).trim().replace(/[.\s]+$/, '').replace(/[\s-]+/g, '_') : det;
    if (word === 'not_owner') return 'You’re signed out. Sign in again.';
    if (word === 'not_allowed') return EXPORT_OFF_TEXT;
    if (word === 'bad_input' && why === 'dates_range') return 'Pick a real date between 2000 and 2100.';
    if (word === 'bad_input') return why === 'dates' ? 'The end date is before the start date.' : 'Something in the choices isn’t right. Try again.';
    return 'Couldn’t make the file. Check your connection and try again.';
  }

  /* ---------- Ask your CRM (session 3, round 4) ---------- */

  // Contract: .workflow/scratch/crm-s3-r4-contract.md, section 9. The page sends the owner's question (plus the last two QUESTIONS, never answers)
  // to the cv-ask Edge Function and renders the answer it gets back: text pieces, figure pieces (a value the server pulled from the database
  // result, shown here with the page's own money / date / number helpers) and lead pieces (a tappable chip). The model's words are only ever
  // shown as plain text (textContent in app.js): no HTML, no links, no markdown.
  var ASK_MAX_DEFAULT = 300;
  var ASK_HISTORY = 2;
  var ASK_STARTERS = ['How much did I book this month?', 'Who needs me right now?', 'What’s booked this weekend?', 'Where are my leads coming from?'];
  var ASK_STATUSES = ['answered', 'no_data', 'out_of_scope', 'unclear', 'invalid'];
  var ASK_FALLBACK = 'I couldn’t answer that one reliably. Try asking it another way, or check Metrics.';
  var ASK_FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var ASK_KINDS = { auto_text: 'Automatic text', call_back: 'Call back', held_alert: 'Held alert', morning_list: 'Morning list' };
  var ASK_QUOTE_STATES = { priced: 'Priced', needs_price: 'Needs a price' };
  var ASK_WINDOWS = { due_now: 'Due now', next_7_days: 'Next 7 days', later: 'Later', call_backs: 'Call backs', sent_recently: 'Sent recently', all: 'All' };
  // follow_ups.reason keys (sql/014 ask_reason_key) -> plain words.
  var ASK_REASONS = {
    auto_overdue: 'Automatic text is overdue', auto_day5: 'Day-5 follow-up text', auto_sent: 'Day-5 follow-up text sent',
    added_by_you: 'Added by you: contact them yourself', needs_price: 'Needs your price', priced_not_sent: 'Priced by you, not sent yet', priced_maybe_sent: 'Priced by you, may have been sent, check', asked_for_you: 'Asked for you in the chat',
    new_quote_sent: 'Quote sent: waiting for your call', held_overnight: 'Alert held overnight', texted_overnight: 'Texted you overnight',
    morning_list: 'In your morning list', other: 'Other'
  };
  var ASK_SOURCES = { form: 'Your booking form', text: 'Texted you first', manual: 'Added by you' };

  // The text shown on screen is always safe plain text: control characters and direction overrides are dropped.
  function askPlain(v) {
    return String(v === null || v === undefined ? '' : v).replace(/[\u0000-\u0008\u000b-\u001f\u007f‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim();
  }

  // cv_ask_config() -> { enabled, max }. Anything but a real `true` is off.
  function askConfigView(c) {
    var o = c && typeof c === 'object' ? c : {};
    var m = Number(o.max_question_chars);
    return { enabled: o.enabled === true, max: isFinite(m) && m >= 20 && m <= 1000 ? Math.floor(m) : ASK_MAX_DEFAULT };
  }

  // The starter questions under the empty chat: CV_CUSTOM.askStarters (at most 4, each 1..80 characters), else the defaults.
  function askStarters(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (s) {
      var q = typeof s === 'string' ? askPlain(s) : '';
      if (q && q.length <= 80 && out.indexOf(q) === -1 && out.length < 4) out.push(q);
    });
    return out.length ? out : ASK_STARTERS.slice();
  }

  // The body sent to cv-ask. `history` = the owner's earlier questions in this session (newest last); only the last two go along.
  // { ok: true, body } or { ok: false, error } (error '' = nothing to send).
  function askRequest(question, history, max) {
    var lim = isFinite(Number(max)) && Number(max) > 0 ? Math.floor(Number(max)) : ASK_MAX_DEFAULT;
    var q = askPlain(question);
    if (!q) return { ok: false, error: '' };
    if (q.length > lim) return { ok: false, error: 'Please shorten the question.' };
    var prev = (Array.isArray(history) ? history : []).filter(function (x) { return typeof x === 'string'; })
      .map(function (x) { return askPlain(x).slice(0, lim); }).filter(Boolean).slice(-ASK_HISTORY);
    var body = { question: q };
    if (prev.length) body.previous_questions = prev;
    return { ok: true, body: body };
  }

  function askNumber(v, digits) {
    var n = Number(v);
    if (v === null || v === undefined || v === '' || !isFinite(n)) return '';
    var o = { maximumFractionDigits: digits };
    try { return new Intl.NumberFormat(CUSTOM.locale, o).format(n); } catch (e) { return new Intl.NumberFormat('en-CA', o).format(n); }
  }

  // "Sat, Dec 5, 2026": always with the year, because an answer can reach into next year.
  function askDate(ymd) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
    if (!m) return '';
    var y = Number(m[1]), mo = Number(m[2]), da = Number(m[3]);
    if (mo < 1 || mo > 12 || da < 1 || da > 31) return '';
    return WEEKDAYS[new Date(Date.UTC(y, mo - 1, da)).getUTCDay()] + ', ' + MONTHS[mo - 1] + ' ' + da + ', ' + y;
  }

  // A label value (a status, a tier, a lost reason, a source, a follow-up kind, a quote state, a window) -> the page's own wording.
  function askLabel(v) {
    var raw = askPlain(v);
    var k = raw.toLowerCase();
    if (!k) return '';
    if (STATUS[k] || CUSTOM.status[k]) return statusInfo(k).label;
    if (k === 'high' || k === 'medium' || k === 'low' || k === 'none') return CUSTOM.tiers[k] || TIERS.filter(function (t) { return t.key === k; })[0].label;
    if (ALL_LOST_REASONS.some(function (r) { return r.key === k; })) return lostReasonLabel(k);
    if (Object.prototype.hasOwnProperty.call(ASK_SOURCES, k)) return ASK_SOURCES[k];
    if (k.indexOf('manual:') === 0) return 'Added by you · ' + manualSourceLabel(k.slice(7));
    if (Object.prototype.hasOwnProperty.call(ASK_KINDS, k)) return ASK_KINDS[k];
    if (Object.prototype.hasOwnProperty.call(ASK_QUOTE_STATES, k)) return ASK_QUOTE_STATES[k];
    if (Object.prototype.hasOwnProperty.call(ASK_WINDOWS, k)) return ASK_WINDOWS[k];
    if (Object.prototype.hasOwnProperty.call(ASK_REASONS, k)) return ASK_REASONS[k];
    return /^[a-z][a-z0-9_:]*$/.test(raw) ? humanize(raw.replace(/:/g, ' ')) : raw;
  }

  // One figure piece -> the text shown in bold. Unusable values show a dash, never a guess.
  function askFigure(kind, v, now) {
    var out = '';
    switch (kind) {
      case 'money': out = fmtMoney(v); break;
      case 'count': case 'guests': out = askNumber(v, 0); break;
      case 'percent': {
        var n = Number(v) * 100;
        if (v !== null && v !== undefined && v !== '' && isFinite(n)) out = (Math.abs(n - Math.round(n)) < 1e-9 ? askNumber(Math.round(n), 0) : askNumber(Math.round(n * 10) / 10, 1)) + '%';
        break;
      }
      case 'date': out = askDate(v); break;
      case 'datetime': out = fmtDueAt(v, now); break;
      case 'minutes': { var mi = num(v); out = mi === null ? '' : fmtDuration(mi * 60); break; }
      case 'seconds': out = fmtDuration(v); break;
      case 'month': {
        var mm = /^(\d{4})-(\d{2})/.exec(String(v || ''));
        if (mm && Number(mm[2]) >= 1 && Number(mm[2]) <= 12) out = ASK_FULL_MONTHS[Number(mm[2]) - 1] + ' ' + mm[1];
        break;
      }
      case 'label': out = askLabel(v); break;
      default: out = askPlain(v);
    }
    return out || '—';
  }

  // The 200 envelope -> what the bubble shows. `nameFor(id)` may give the page's own name for a lead it has loaded (else the server's name is used).
  // Unknown piece types are dropped; a lead piece needs a real uuid; nothing here is HTML.
  // Two wording fixes, in the page and only in these exact spots (the answer on the server is unchanged):
  //  - a full date after "in" reads "on" ("in Thursday, December 17, 2026" -> "on ..."): only the word right before a date figure;
  //  - exactly 1 before a plural noun from this short list reads singular ("1 leads are" -> "1 lead is"). 0 and 2+ are left as written.
  var ASK_ONE_NOUNS = /^(\s*)(leads|events|quotes|texts|bookings|customers|weddings|messages|guests)(?![\w'’])/i;   // not a possessive ("1 weddings' totals")
  var ASK_ONE_VERBS = { are: 'is', were: 'was', have: 'has', "aren't": "isn't", "weren't": "wasn't", "haven't": "hasn't" };
  function askSingular(txt) {
    var m = ASK_ONE_NOUNS.exec(txt);
    if (!m) return txt;
    var noun = m[2].slice(0, -1);
    var rest = txt.slice(m[0].length);
    var v = /^(\s+)(are|were|have|aren['’]t|weren['’]t|haven['’]t)(?![\w'’])/i.exec(rest);
    if (v) {
      var apos = /['’]/.exec(v[2]);
      var w = ASK_ONE_VERBS[v[2].toLowerCase().replace(/’/, "'")];
      if (apos && apos[0] === '’') w = w.replace("'", '’');
      if (v[2].charAt(0) === v[2].charAt(0).toUpperCase()) w = w.charAt(0).toUpperCase() + w.slice(1);
      rest = v[1] + w + rest.slice(v[0].length);
    }
    return m[1] + noun + rest;
  }
  // "in" before a date reads "on" ("in Thursday..." -> "on Thu, ..."), but not when "in" belongs to a verb ("Check in <date>", "Log in <date>").
  var ASK_PHRASAL_IN = /\b(check|checks|checked|checking|log|logs|logged|logging|sign|signs|signed|signing|fill|fills|filled|filling|turn|turns|turned|drop|drops|dropped|come|comes|came|stay|stays|stayed|move|moves|moved|opt|opts|opted|call|calls|called|get|gets|got|rsvp)\s+in\s*$/i;
  function askView(res, nameFor, now) {
    var r = res && typeof res === 'object' ? res : {};
    var status = ASK_STATUSES.indexOf(r.status) !== -1 ? r.status : 'invalid';
    var parts = [];
    var oneBefore = false;   // the figure just pushed was exactly 1 (count / guests)
    (Array.isArray(r.segments) ? r.segments : []).slice(0, 80).forEach(function (s) {
      if (!s || typeof s !== 'object') return;
      var afterOne = oneBefore;
      oneBefore = false;
      if (s.t === 'text') {
        var txt = String(s.v === null || s.v === undefined ? '' : s.v).replace(/[\u0000-\u0008\u000b-\u001f\u007f‪-‮⁦-⁩]/g, '');
        if (txt && afterOne) txt = askSingular(txt);
        if (txt) parts.push({ t: 'text', v: txt });
      } else if (s.t === 'fig') {
        // Free text from the database (city, occasion, hours, a quote line) is quoted plain text, never styled like a computed figure.
        if (s.kind === 'text') { var q = askPlain(s.v); parts.push(q ? { t: 'quote', v: q } : { t: 'fig', v: '—' }); }
        else {
          var shown = askFigure(s.kind, s.v, now);
          if (s.kind === 'date' && shown !== '—') {
            var prev = parts[parts.length - 1];
            if (prev && prev.t === 'text' && /(^|\s)in\s*$/i.test(prev.v) && !ASK_PHRASAL_IN.test(prev.v)) prev.v = prev.v.replace(/(^|\s)(in)(\s*)$/i, function (_m, a, w, z) { return a + (w === 'IN' ? 'ON' : w.charAt(0) === 'I' ? 'On' : 'on') + z; });
          }
          if ((s.kind === 'count' || s.kind === 'guests') && s.v !== null && s.v !== '' && typeof s.v !== 'boolean' && Number(s.v) === 1) oneBefore = true;
          parts.push({ t: 'fig', v: shown });
        }
      } else if (s.t === 'lead' && isUuid(s.id)) {
        var id = s.id.toLowerCase();
        var own = typeof nameFor === 'function' ? askPlain(nameFor(id)) : '';
        parts.push({ t: 'lead', id: id, name: own || askPlain(s.name) || 'Unnamed lead' });
      }
    });
    if (!parts.length) { parts = [{ t: 'text', v: ASK_FALLBACK }]; if (status === 'answered') status = 'invalid'; }
    var from = (Array.isArray(r.from) ? r.from : []).map(askPlain).filter(Boolean).slice(0, 4).map(function (x) { return x.slice(0, 30); });
    return { status: status, parts: parts, from: from.length ? 'From: ' + from.join(' · ') : '' };
  }

  // The error bubble. `err` is { status, error, details } as unwrapped from the cv-ask response (or a network error).
  var ASK_TOO_MANY = {
    ten_minutes: 'That’s a lot of questions at once. Try again in a few minutes.',
    day: 'You’ve reached today’s question limit. It resets tomorrow.',
    tokens: 'Ask has reached its limit for now. Tell Kevin.',
    budget: 'Ask has reached its limit for now. Tell Kevin.'
  };
  function askErrorText(err) {
    var e = err && typeof err === 'object' ? err : {};
    var word = String(e.error || e.message || (typeof err === 'string' ? err : '')).trim().toLowerCase();
    var det = e.details;
    var detText = det && typeof det === 'object' ? Object.keys(det).join(' ') : String(det === null || det === undefined ? '' : det);
    detText = detText.trim().toLowerCase().replace(/[.\s-]+/g, '_').replace(/^_+|_+$/g, '');
    var m = /\b(not_owner|not_signed_in|not_allowed|too_many|bad_input|not_configured|timeout|provider_error)\b/.exec(word);
    word = m ? m[1] : '';
    if (!word && (e.code === '42501' || e.status === 403)) word = 'not_owner';
    if (!word && (e.status === 401 || e.code === 'PGRST301')) word = 'not_signed_in';
    if (!word && e.status === 429) word = 'too_many';
    if (!word && e.status === 504) word = 'timeout';
    if (word === 'not_owner' || word === 'not_signed_in') return 'You’re signed out. Sign in again.';
    if (word === 'not_allowed') return 'Ask is turned off.';
    if (word === 'too_many') return ASK_TOO_MANY[detText] || ASK_TOO_MANY.ten_minutes;
    if (word === 'bad_input' && detText.indexOf('question_length') !== -1) return 'Please shorten the question.';
    if (word === 'timeout') return 'That took too long. Try a simpler question.';
    if (word === 'not_configured') return 'Ask isn’t set up yet. Tell Kevin.';
    return 'Couldn’t get an answer. Check your connection and try again.';
  }


  /* ---------- staff access (sql/017 cv_my_role, sql/018): who is signed in, and what a staff member may see ---------- */

  // cv_my_role() -> { state, perms }. state: 'owner' | 'staff' | 'none' | 'bad'. 'bad' (null, no role, an unknown role word,
  // a role of the wrong type) must never unlock anything. Only a literal true in perms is a yes.
  function roleView(res) {
    if (!res || typeof res !== 'object' || Array.isArray(res) || typeof res.role !== 'string') return { state: 'bad', perms: {} };
    if (res.role === 'none') return { state: 'none', perms: {} };
    if (res.role !== 'owner' && res.role !== 'staff') return { state: 'bad', perms: {} };
    var perms = {};
    if (res.role === 'staff' && res.perms && typeof res.perms === 'object' && !Array.isArray(res.perms)) {
      Object.keys(res.perms).forEach(function (k) { perms[k] = res.perms[k] === true; });
    }
    return { state: res.role, perms: perms };
  }

  // A failed cv_my_role call -> { kind, text }. Always a retry: a failure is never the "access removed" answer.
  function roleError(err) {
    var msg = String((err && err.message) || (typeof err === 'string' ? err : '')).toLowerCase();
    if (err && (err.status === 401 || err.code === 'PGRST301' || /jwt/.test(msg))) return { kind: 'auth', text: SESSION_RAN_OUT };
    if (!err || err.status === 0 || err.status === undefined || /failed to fetch|network|load failed|timeout/.test(msg)) {
      return { kind: 'network', text: "Can't reach the server. Check your connection and try again." };
    }
    return { kind: 'other', text: "We couldn't check your access just now. Try again in a moment." };
  }

  // Things a staff member never gets, whatever the config says (the server is the real gate; this keeps the page honest).
  var STAFF_BLOCKED = ['metrics', 'forecast', 'value', 'pastEvents', 'quote', 'ask', 'support', 'export', 'addLead', 'push', 'team', 'noQuoteFilter', 'quoteDraft', 'guide'];

  /* ---------- Team (More, owner only): the cv-team Edge Function (team/edge/cv-team) ---------- */

  // Unlike every other feature, Team is OFF unless CV_CUSTOM.features.team is exactly true (Kevin rules before switch-on).
  function teamFeatureOn(features) { return !!(features && typeof features === 'object' && features.team === true); }
  var TEAM_NAME_MAX = 60;

  // Form values -> the exact cv-team add body, or { ok:false, field:'name'|'phone', text }.
  function teamAddArgs(name, phone) {
    var n = String(name === undefined || name === null ? '' : name).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!n) return { ok: false, field: 'name', text: 'Type their name.' };
    if (n.length > TEAM_NAME_MAX) return { ok: false, field: 'name', text: 'Keep the name under 60 characters.' };
    var p = normalizePhone(phone);
    if (!p || !/^\+1[2-9]\d{2}[2-9]\d{6}$/.test(p)) return { ok: false, field: 'phone', text: 'Type a 10-digit phone number, like (416) 555-0123.' };
    return { ok: true, body: { action: 'add', phone: p, display_name: n }, phone: p, name: n };
  }

  // Body for remove / retry_cleanup. The phone must be the +E.164 the list gave back.
  function teamPhoneBody(action, phone) {
    return { action: action, phone: String(phone || '') };
  }

  // A failed cv-team call -> { code, text, field, reload }. `what` = 'add' | 'remove' | 'retry_cleanup' | 'list'.
  // The error arrives as { status, error, details } (the invoke wrapper in app.js); anything unknown reads as a connection problem.
  function teamErrorText(err, what) {
    var e = err && typeof err === 'object' ? err : {};
    var code = String(e.error || e.message || '').trim().toLowerCase();
    var det = e.details;
    var verb = what === 'add' ? 'add them' : what === 'list' ? 'load your team' : 'remove them';
    switch (code) {
      case 'not_signed_in': return { code: code, text: 'You’re signed out. Sign in again.', reload: false };
      case 'not_owner': return { code: code, text: 'Only the owner can manage the team.', reload: false };
      case 'bad_phone': return { code: code, field: 'phone', text: 'That isn’t a usable phone number. Type 10 digits, like (416) 555-0123.', reload: false };
      case 'bad_name': return { code: code, field: 'name', text: 'The name can’t be blank or longer than 60 characters.', reload: false };
      case 'is_owner': return { code: code, field: 'phone', text: 'That number is an owner’s. Owners already have full access, so it can’t be added to the team.', reload: false };
      case 'already_member': return { code: code, field: 'phone', text: 'That number is already on your team.', reload: true };
      case 'team_full': {
        var mx = det && typeof det === 'object' && Number(det.max) > 0 ? Math.floor(Number(det.max)) : 0;
        return { code: code, text: mx ? 'Your team is full: ' + mx + ' people at most. Remove someone first.' : 'Your team is full. Remove someone first.', reload: true };
      }
      case 'cleanup_pending': return { code: code, field: 'phone', text: 'This person’s old sign-in is still being removed. Tap Retry on their row first, then add them again.', reload: true };
      case 'not_found': return { code: code, text: 'That number isn’t on your team any more.', reload: true };
      case 'not_removed': return { code: code, text: 'That person is still on your team. Use Remove first.', reload: true };
      case 'auth_failed': return { code: code, text: 'Couldn’t set up their sign-in, so nobody was added. Try again in a minute.', reload: true };
      case 'engine_error': return { code: code, text: what === 'list' ? 'The database didn’t answer. Try again in a minute.' : 'The database didn’t answer, so nothing was changed. Try again in a minute.', reload: what !== 'list' };
      case 'add_incomplete':
        return { code: code, text: 'Couldn’t set up their sign-in, and the clean-up didn’t finish. They’re in your list but can’t sign in: tap Remove on them to clear it.', reload: true };
      case 'not_configured': return { code: code, text: 'The Team screen isn’t set up properly yet. Tell Kevin.', reload: false };
      case 'bad_origin': case 'method_not_allowed': return { code: code, text: 'Couldn’t ' + verb + ' from this page. Tell Kevin.', reload: false };
      case 'bad_input': return { code: code, text: 'Couldn’t ' + verb + ': something in the request was wrong. Check the name and number.', reload: false };
      case 'timeout': return { code: code, text: what === 'list' ? 'Your team didn’t load in time. Try again.' : 'No answer yet, so we can’t tell if it worked. Check the list below before you try again.', reload: what !== 'list' };
      default: return { code: 'network', text: what === 'list' ? 'Couldn’t load your team. Check your connection and try again.' : 'Couldn’t ' + verb + '. Check your connection, look at the list below, then try again.', reload: what !== 'list' };
    }
  }

  // The confirm sheet for Remove: what happens, plainly.
  function teamRemoveText(name) {
    var n = String(name || '').trim() || 'This person';
    return 'Remove ' + n + '? They lose access right away and can’t open your leads or notes. Their sign-in is deleted, so to bring them back you add them again. Notes they wrote stay on the leads.';
  }

  // The answer of remove / retry_cleanup -> { removed, text } (a state other than removed or cleanup_pending is NOT success).
  function teamRemoveOutcome(res, name) {
    var n = String(name || '').trim() || 'This person';
    var st = res && typeof res === 'object' && res.ok === true ? res.state : '';
    if (st === 'removed') return { ok: true, removed: true, text: n + ' is removed.' };
    if (st === 'cleanup_pending') return { ok: true, removed: false, text: n + ' can no longer get in. Their sign-in couldn’t be deleted yet: tap Retry on their row.' };
    return { ok: false, removed: false, text: '' };
  }

  // The answer of add -> the line to show, or '' when it was not a real success.
  function teamAddOutcome(res, name) {
    if (!res || typeof res !== 'object' || res.ok !== true || !res.member || res.member.state !== 'active') return '';
    var n = String(name || '').trim() || 'They';
    return n + ' is added. No text was sent: send them the link below and tell them to sign in with this number.';
  }

  // cv-team list answer -> what the screen shows, or null when the answer is not the contract shape.
  function teamView(res, now) {
    if (!res || typeof res !== 'object' || !Array.isArray(res.members)) return null;
    var max = Math.floor(Number(res.max)), active = Math.floor(Number(res.active));
    var members = [];
    for (var i = 0; i < res.members.length; i++) {
      var m = res.members[i];
      if (!m || typeof m !== 'object') return null;
      var phone = strictE164(m.phone);
      if (!phone || (m.state !== 'active' && m.state !== 'cleanup_pending')) return null;
      var name = String(m.display_name || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim() || fmtPhoneNational(phone);
      var pending = m.state === 'cleanup_pending';
      var last = m.last_sign_in_at ? fmtSince(m.last_sign_in_at, now) : '';
      var lastLine = pending ? 'Access is closed. Sign-in cleanup is pending.'
        : last ? 'Last signed in ' + last : 'Hasn’t signed in yet';
      members.push({ phone: phone, phoneText: fmtPhoneNational(phone), name: name, state: m.state, pending: pending, lastLine: lastLine });
    }
    var activeN = members.filter(function (x) { return !x.pending; }).length;
    return { enabled: res.enabled === true, max: max > 0 ? max : 0, active: active >= 0 ? active : activeN, members: members,
      full: max > 0 && (active >= 0 ? active : activeN) >= max };
  }

  // Is a page feature on for this role? Owner: the config switch alone, exactly as before. Staff: also each cv_my_role switch.
  function roleFeatureOn(role, perms, features, key) {
    if (!featureOn(features, key)) return false;
    if (key === 'team') return role !== 'staff' && teamFeatureOn(features);   // Team is OFF unless config says exactly true; owner only
    if (role !== 'staff') return true;
    var p = perms || {};
    if (STAFF_BLOCKED.indexOf(key) !== -1) return false;
    if (key === 'followups') return p.followups === true;
    if (key === 'calendar' || key === 'search') return p.leads_read === true;
    if (key === 'notes') return p.notes === true;
    return true;
  }

  // The status buttons a staff member is offered for a lead: only an open lead, only the switches that are on.
  function staffActionsAhead(current, perms) {
    var cur = String(current || '').toLowerCase();
    if (cur === 'booked' || cur === 'lost' || statusGroup(cur) !== 'open') return [];
    var p = perms || {};
    return actionsAhead(cur).filter(function (st) { return p['status_' + st] === true; });
  }

  // One plain line under the buttons for staff; '' when nothing needs saying.
  function staffActionsNote(current, perms) {
    var cur = String(current || '').toLowerCase();
    if (cur === 'booked' || cur === 'lost') return 'Only the owner can change a booked or lost lead.';
    var base = actionsNote(cur);
    if (base) return base;
    if (canSetStatus(cur, 'contacted') || canSetStatus(cur, 'booked') || canSetStatus(cur, 'lost')) {
      if (!staffActionsAhead(cur, perms).length) return 'The owner has switched off status changes for your account.';
    }
    return '';
  }

  // What a staff member with no cv_staff_* access at all sees on Leads.
  var STAFF_NO_LEADS = 'The owner has switched off lead access for your account. Ask them if this is a mistake.';

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
    fullPopAction: fullPopAction,
    deferReasons: deferReasons,
    quoteView: quoteView,
    promoText: promoText,
    eventFacts: eventFacts,
    emailLine: emailLine,
    leadDetails: leadDetails,
    filters: filters,
    isFilterKey: isFilterKey,
    matchesFilter: matchesFilter,
    filterLeads: filterLeads,
    filterCounts: filterCounts,
    noQuoteOpen: noQuoteOpen,
    setOptedOutPhones: setOptedOutPhones,
    noQuoteTag: noQuoteTag,
    noQuoteCount: noQuoteCount,
    noQuoteChip: noQuoteChip,
    promoEndedNote: promoEndedNote,
    quotePromosEnd: quotePromosEnd,
    PROMO_ENDED_TEXT: PROMO_ENDED_TEXT,
    bookedPriceHint: bookedPriceHint,
    needsFreshPill: needsFreshPill,
    quoteDraftKey: quoteDraftKey,
    quoteDraftPack: quoteDraftPack,
    quoteDraftRead: quoteDraftRead,
    quoteDraftBlank: quoteDraftBlank,
    QDRAFT_PREFIX: QDRAFT_PREFIX,
    QDRAFT_TTL_MS: QDRAFT_TTL_MS,
    actions: actions,
    confirmText: confirmText,
    canSetStatus: canSetStatus,
    actionsKey: actionsKey,
    actionsNote: actionsNote,
    friendlyStatusError: friendlyStatusError,
    roleView: roleView,
    roleError: roleError,
    roleFeatureOn: roleFeatureOn,
    teamFeatureOn: teamFeatureOn,
    teamAddArgs: teamAddArgs,
    teamPhoneBody: teamPhoneBody,
    teamErrorText: teamErrorText,
    teamRemoveText: teamRemoveText,
    teamRemoveOutcome: teamRemoveOutcome,
    teamAddOutcome: teamAddOutcome,
    teamView: teamView,
    staffActionsAhead: staffActionsAhead,
    staffActionsNote: staffActionsNote,
    STAFF_NO_LEADS: STAFF_NO_LEADS,
    STAFF_BLOCKED: STAFF_BLOCKED,
    historyLine: historyLine,
    sortHistory: sortHistory,
    toCents: toCents,
    fmtMoney: fmtMoney,
    effectiveTotal: effectiveTotal,
    ownerQuoteView: ownerQuoteView,
    quotePrefill: quotePrefill,
    quoteHoursValue: quoteHoursValue,
    quoteAddNote: quoteAddNote,
    quoteSavedLine: quoteSavedLine,
    quoteAddRefused: quoteAddRefused,
    canAddQuoteToLead: canAddQuoteToLead,
    quoteAddArgs: quoteAddArgs,
    quoteAddError: quoteAddError,
    quoteSendError: quoteSendError,
    quoteSendFeatureOn: quoteSendFeatureOn,
    ownerQuoteHistory: ownerQuoteHistory,
    fmtDuration: fmtDuration,
    fmtWaiting: fmtWaiting,
    closeRateText: closeRateText,
    firstTextLine: firstTextLine,
    followupLine: followupLine,
    funnelRows: funnelRows,
    moneyCount: moneyCount,
    forecastView: forecastView,
    pastEventsView: pastEventsView,
    forecastMonthLabel: forecastMonthLabel,
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
    ADD_SOURCES: ADD_SOURCES,
    addLeadSources: addLeadSources,
    manualSourceLabel: manualSourceLabel,
    normalizeLeadPhone: normalizeLeadPhone,
    cleanText: cleanText,
    validateAddLead: validateAddLead,
    addLeadFirstError: addLeadFirstError,
    addLeadErrorText: addLeadErrorText,
    addLeadArgs: addLeadArgs,
    addLeadError: addLeadError,
    bubbleSender: bubbleSender,
    bubbleLabels: bubbleLabels,
    phoneKey: phoneKey,
    personFirstKey: personFirstKey,
    PERSON_SPACE: PERSON_SPACE,
    PERSON_STRIP: PERSON_STRIP,
    smsAscii: smsAscii,
    quoteSums: quoteSums,
    samePerson: samePerson,
    dupOtherText: dupOtherText,
    phoneSharedLines: phoneSharedLines,
    dupInfo: dupInfo,
    dupLine: dupLine,
    DUP_TEXT: DUP_TEXT,
    isManual: isManual,
    sourceLine: sourceLine,
    noQuoteLine: noQuoteLine,
    followupChoice: followupChoice,
    noAutoLine: noAutoLine,
    NO_AUTO_TEXT: NO_AUTO_TEXT,
    sourceRows: sourceRows,
    pushState: pushState,
    PUSH_TEXT: PUSH_TEXT,
    b64urlToBytes: b64urlToBytes,
    pushSubKeys: pushSubKeys,
    pushPayload: pushPayload,
    pushTestMessage: pushTestMessage,
    appName: appName,
    shortName: shortName,
    quoteRequest: quoteRequest,
    quoteResult: quoteResult,
    quoteOccasions: quoteOccasions,
    quotePromos: quotePromos,
    quotePromoList: quotePromoList,
    quotePromoProblem: quotePromoProblem,
    promoGives: promoGives,
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
    waitsOnOwner: waitsOnOwner,
    noConsent: noConsent,
    lostPartOf: lostPartOf,
    lostParts: lostParts,
    lostCounts: lostCounts,
    LOST_PART_EMPTY: LOST_PART_EMPTY,
    LOST_PART_KEYS: LOST_PART_KEYS,
    STOP_NO_FOLLOWUP: STOP_NO_FOLLOWUP,
    STOP_PERSONAL_TEXT: STOP_PERSONAL_TEXT,
    stopBanner: stopBanner,
    stopNextLine: stopNextLine,
    NEEDS_SHOW: NEEDS_SHOW,
    NEEDS_FRESH_HOURS: NEEDS_FRESH_HOURS,
    needsSections: needsSections,
    needsMoreText: needsMoreText,
    LIST_PAGE: LIST_PAGE,
    moreLabel: moreLabel,
    BACK_TOP_MIN: BACK_TOP_MIN,
    BACK_TOP_LABEL: BACK_TOP_LABEL,
    showBackToTop: showBackToTop,
    convoTitle: convoTitle,
    LIST_FETCH: LIST_FETCH,
    LIST_CAP: LIST_CAP,
    listPage: listPage,
    listTruncNote: listTruncNote,
    keysetAfter: keysetAfter,
    leadIndex: leadIndex,
    BULK_REASON_KEY: BULK_REASON_KEY,
    bulkDefaultDate: bulkDefaultDate,
    bulkPreviewView: bulkPreviewView,
    bulkStopLine: bulkStopLine,
    bulkErrorText: bulkErrorText,
    bulkDoneText: bulkDoneText,
    bulkUndoneText: bulkUndoneText,
    bulkUndoLine: bulkUndoLine,
    bulkLeftText: bulkLeftText,
    homeView: homeView,
    needsOverDay: needsOverDay,
    homeCounts: homeCounts,
    jobBits: jobBits,
    headMoney: headMoney,
    wordsView: wordsView,
    tabPlan: tabPlan,
    GUIDE: GUIDE,
    GUIDE_FLAGS: GUIDE_FLAGS,
    GUIDE_TAB_NAMES: GUIDE_TAB_NAMES,
    guideView: guideView,
    diagScrub: diagScrub,
    diagPush: diagPush,
    diagCall: diagCall,
    diagDevice: diagDevice,
    diagFromError: diagFromError,
    diagFromRejection: diagFromRejection,
    supportDiagnostics: supportDiagnostics,
    newClientKey: newClientKey,
    SUPPORT_KINDS: SUPPORT_KINDS,
    supportConfigView: supportConfigView,
    supportArgs: supportArgs,
    supportConfirm: supportConfirm,
    supportErrorText: supportErrorText,
    fmtSupportDate: fmtSupportDate,
    supportLeadLine: supportLeadLine,
    supportRow: supportRow,
    splitThread: splitThread,
    systemFoldText: systemFoldText,
    EXPORT_HEADERS: exportHeaders,
    exportLocal: exportLocal,
    exportPhone: exportPhone,
    exportCells: exportCells,
    csvCell: csvCell,
    csvEncode: csvEncode,
    exportFileName: exportFileName,
    exportSaveMethod: exportSaveMethod,
    exportGroups: exportGroups,
    exportArgs: exportArgs,
    exportResult: exportResult,
    exportErrorText: exportErrorText,
    exportConfigView: exportConfigView,
    EXPORT_OFF_TEXT: EXPORT_OFF_TEXT,
    ASK_MAX_DEFAULT: ASK_MAX_DEFAULT,
    ASK_FALLBACK: ASK_FALLBACK,
    askConfigView: askConfigView,
    askStarters: askStarters,
    askRequest: askRequest,
    askLabel: askLabel,
    askFigure: askFigure,
    askView: askView,
    askErrorText: askErrorText
  };
});
