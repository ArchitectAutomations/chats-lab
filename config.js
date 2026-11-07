/* HTTPS only: a page served over plain HTTP could be rewritten on the way. This runs first, before any other script. */
if (location.protocol === 'http:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
  location.replace('https://' + location.host + location.pathname + location.search + location.hash);
}
/* Public by design: the project URL and the publishable (anon) key. Row access is enforced
   by RLS, so these two values are safe to ship in the page. Replace the placeholders at deploy. */
window.CV_CONFIG = {
  SUPABASE_URL: 'https://cypvadpdtwtdymabtzfh.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN5cHZhZHBkdHd0ZHltYWJ0emZoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM4MzY1NTQsImV4cCI6MjEwOTQxMjU1NH0.B_hFSZNNfu5TfT5hQYIgyOC8ETFGtS_9QWDsHOoy-jU'
};

/* ==================================================================
   PER-CLIENT SETTINGS (CV_CUSTOM)
   Everything that differs between clients lives here, nowhere else.
   Leave a line out (or empty) and the page uses the default shown.
   Value-tier dollar thresholds are NOT here: they live in the
   database (cv_config value_tier_high_min / value_tier_medium_min).
   ================================================================== */
window.CV_CUSTOM = {
  // The app's one name: sign-in screen, browser tab, home-screen icon and the top of the More tab. '' = "Leads".
  businessName: "Mobile Mixology (lab)",
  // Home-screen icon label, 12 characters at most. '' = the business name, shortened at a word edge.
  shortName: "MM Leads",

  // Colours, rule 60 / 30 / 10: primary (page, header, menu) 60%, secondary (rows, cards, tiles,
  // sheet) 30%, accent (buttons, active tab, live dot, bars, links, focus) 10%. Hex only (#rgb / #rrggbb).
  // Shades, text colours and tints are worked out from these three; any of them can also be set here
  // (primaryDeep, onPrimary, mutedOnPrimary, secondaryDeep, onSecondary, mutedOnSecondary, accentStrong,
  // accentLight, accentTint, accentInk, onAccent, dangerOnPrimary, dangerOnSecondary).
  // A new palette must be re-checked for WCAG AA contrast (see the note at the top of styles.css).
  theme: {
    primary: '#1F3D2B',    // forest green
    secondary: '#E8DCC4',  // sand beige
    accent: '#8B5CF6'      // electric purple
  },

  // Money and time.
  locale: 'en-CA',
  currency: 'CAD',
  timeZone: 'America/Toronto',

  // Features: true = on, false = off (an off feature is not shown at all, nowhere on the page).
  // Left out = on. Tabs: followups, calendar, quote, metrics. 'value' = the Lead value section of Metrics. Parts of other screens:
  // search (top of Leads), notes (on a lead's record), push ("Alerts on this phone" under More),
  // addLead (the "+ Add lead" button on Leads; the database has its own switch, cv_config add_lead_enabled).
  // Hours a "Needs you" lead may wait before its wait turns red with "· overdue" (1–720; default 24, Kevin 11-06).
  waitWarnHours: 24,
  features: { followups: true, calendar: true, quote: true, value: true, metrics: true, search: true, notes: true, push: true, addLead: true },

  // Bottom bar and More: which tabs show, in this order (a tab whose feature is off is skipped).
  // 'list', 'followups', 'calendar', 'metrics' sit in the bottom bar; 'quote' sits under More
  // (More itself is always the last slot and also holds Alerts and Sign out).
  tabs: ['list', 'followups', 'calendar', 'quote', 'metrics'],
  tabLabels: { list: 'Leads', followups: 'Follow-ups', calendar: 'Calendar', metrics: 'Metrics', more: 'More', quote: 'Quote calculator' },

  // Status wording on chips, filter chips, the three buttons and the history lines.
  // e.g. contacted: 'Called'. Keys: new, engaged, quoted, handed_off, contacted, booked, lost, opted_out.
  statusLabels: {},

  // Contact buttons on a lead's record, in this order. Known: 'call', 'text', 'email'.
  // Text is always hidden for a lead who opted out.
  contactActions: ['call', 'text', 'email'],

  // Lead value section names. Keys: high, medium, low, none. The money range after each name
  // ("High value · $1,000 and up") comes from the database thresholds, in the locale + currency above.
  tierLabels: { high: 'High value', medium: 'Medium', low: 'Low', none: 'No quote yet' },

  // Reason chips on the "Mark as lost" sheet (also used in history lines and Metrics).
  // Keys are fixed (they are what the database stores): price, date_taken, no_reply, went_elsewhere, other.
  lostReasons: { price: 'Price', date_taken: 'Date taken', no_reply: 'No reply', went_elsewhere: 'Went elsewhere', other: 'Other' },

  // Where a lead you add by hand came from (the four chips on "+ Add lead", and the source line on the record).
  // Keys are fixed (they are what the database stores): instagram, phone_call, referral, other.
  sourceLabels: { instagram: 'Instagram', phone_call: 'Phone call', referral: 'Referral', other: 'Other' },

  // Metrics tab: which blocks show, in this order.
  // Known: 'booked', 'sources', 'open', 'value', 'close_rate', 'lost_reasons', 'speed'. 'value' (Lead value) also needs features.value.
  metrics: ['booked', 'sources', 'open', 'value', 'close_rate', 'lost_reasons', 'speed']
};
