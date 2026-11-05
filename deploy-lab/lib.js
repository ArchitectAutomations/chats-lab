/* Pure helpers for the conversation page. No DOM, no network: unit-tested in
   tools/tests/test_lib.js (node) and loaded by the browser as window.CVLib. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CVLib = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TZ = 'America/Toronto';
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
    if (STATUS[k]) return { label: STATUS[k][0], tone: STATUS[k][1] };
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

  /* ---------- routes + data ---------- */

  function isUuid(s) { return typeof s === 'string' && UUID_RE.test(s); }

  // '#/' | '' -> list; '#/lead/<uuid>' -> thread; anything else -> list
  function parseRoute(hash) {
    var m = /^#\/lead\/([^/?#]+)\/?$/.exec(String(hash || ''));
    if (m && isUuid(m[1])) return { name: 'lead', id: m[1].toLowerCase() };
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
    isUuid: isUuid,
    parseRoute: parseRoute,
    visibleMessages: visibleMessages,
    sortLeads: sortLeads
  };
});
