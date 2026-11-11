/* HTTPS only: a page served over plain HTTP could be rewritten on the way. This runs first, before any other script. */
if (location.protocol === 'http:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
  location.replace('https://' + location.host + location.pathname + location.search + location.hash);
}
/* Build id: 'dev' in the repo; publish_lab.sh fills it (YYYYMMDD-HHMM-<hash>) so a help request says which version the owner had. */
window.CV_BUILD = "20261110-1934-fb1042f8";
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
  // Left out = on. Tabs: followups, calendar, ask, quote, guide, support, export, metrics. 'value' = the Lead value section of Metrics, 'forecast' = the Looking ahead section of Metrics (the database has its own switch, cv_config forecast_enabled). 'pastEvents' = the "Did these happen?" list at the top of Follow-ups (cv_config past_events_enabled). Parts of other screens:
  // search (top of Leads), notes (on a lead's record), push ("Alerts on this phone" under More),
  // addLead (the "+ Add lead" button on Leads; the database has its own switch, cv_config add_lead_enabled).
  // ask (More > Ask your CRM: questions about your leads answered by AI, read only; the database has its own switch, cv_config ask_enabled).
  // support (More > Help & support: tell Kevin about a problem; the database has its own switch, cv_config support_enabled).
  // export (More > Download spreadsheet: all your leads as a file for Numbers, Excel or Google Sheets; the database has its own switch, cv_config export_enabled).
  // guide (More > How to use the CRM, owner only: short steps for the everyday jobs; each section appears only when the features it describes are on, and it never names a feature that is off).
  // quoteSend (the "Send it to them" button on a lead's saved price). OFF unless exactly true; the database has its own switch, cv_config quote_send_enabled.
  // team (More > Team, owner only: add or remove the people who can read your leads and notes). OFF unless exactly true; leave false until Kevin rules.
  // noQuoteFilter (owner only): the "No quote" chip under the filter chips and the "No quote sent" tag on rows. Same rule as the "without a quote yet" count in Metrics.
  // quoteDraft: the quote calculator keeps an unfinished form on this phone for 12 hours (form fields only, never a name or phone) so an app the phone closed does not lose it.
  // Hours a "Needs you" lead may wait before its wait turns red with "· overdue" (1–720; default 24, Kevin 11-06).
  waitWarnHours: 24,
  // Days after which a saved price on a lead (not sent yet) says how old it is: 7–29, default 21, 0 = never. The server refuses to text a price older than 30 days.
  quoteAgeWarnDays: 21,
  features: { followups: true, calendar: true, quote: true, value: true, metrics: true, forecast: true, pastEvents: true, search: true, notes: true, push: true, addLead: true, support: true, export: true, ask: true, team: false, quoteSend: false, noQuoteFilter: true, quoteDraft: true, guide: true },

  // Quote calculator pick-lists (More details). Leave a list out and that field stays a plain text box.
  // quoteOccasions: exactly the Occasion choices on the client's booking form, same words, same order.
  // (Source: Tally form lb2Jjk / 4aQv1A, "Occasion" dropdown; the form has no "Other" text box, so neither does the page.)
  quoteOccasions: ['Wedding', 'Corporate event', 'Birthday', 'Private party', 'Other'],
  // quotePromos: the client's promo codes, as they are in the database's promotions table (the calculator only applies a code
  // that row is running now). code = what the calculator receives. label + gives = plain words for the owner.
  // from / to = the dates it runs (YYYY-MM-DD in the time zone above; "to" is the first day it no longer works): outside them it is not offered.
  // eventFrom / eventTo = event dates it covers (both included); the page asks for an event date before sending such a code.
  // When David changes a promo's dates or adds a code, change it here too: tools/tests/test_lib.js checks this list against the lab calculator.
  quotePromos: [
    { code: 'barsetup-all', label: 'Free bar setup', gives: 'The bar rental fee is waived when the bar is rented (old booking form)', from: '2026-10-08', to: '2027-01-01' },
    { code: 'bundle700-all', label: '$700 event bundle', gives: '1 bartender for 4 hours, the bar and delivery for $700, 1 to 100 guests, $50 per extra hour up to 8 (new booking form)',
      from: '2026-11-01', to: '2027-02-01', eventFrom: '2026-11-01', eventTo: '2027-01-31' }
  ],

  // Ask your CRM: the starter questions shown under the empty chat (at most 4, each 80 characters at most).
  askStarters: ['How much did I book this month?', 'Who needs me right now?', "What's booked this weekend?", 'Where are my leads coming from?'],

  // Bottom bar and More: which tabs show, in this order (a tab whose feature is off is skipped).
  // 'list', 'followups', 'calendar', 'metrics' sit in the bottom bar; 'ask', 'quote', 'guide', 'support' and 'export' sit under More
  // (More itself is always the last slot and also holds Alerts and Sign out).
  tabs: ['list', 'followups', 'calendar', 'ask', 'quote', 'guide', 'support', 'export', 'metrics', 'team'],
  tabLabels: { list: 'Leads', followups: 'Follow-ups', calendar: 'Calendar', metrics: 'Metrics', more: 'More', ask: 'Ask your CRM', quote: 'Quote calculator', guide: 'How to use the CRM', support: 'Help & support', export: 'Download spreadsheet', team: 'Team' },

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
  // old_lead is the bulk clear's own reason (sql/026): shown on chips, history, Metrics, the spreadsheet; never a chip on the sheet.
  lostReasons: { price: 'Price', date_taken: 'Date taken', no_reply: 'No reply', went_elsewhere: 'Went elsewhere', other: 'Other', old_lead: 'Old lead' },

  // Where a lead you add by hand came from (the four chips on "+ Add lead", and the source line on the record).
  // Keys are fixed (they are what the database stores): instagram, phone_call, referral, other.
  sourceLabels: { instagram: 'Instagram', phone_call: 'Phone call', referral: 'Referral', other: 'Other' },

  // Metrics tab: which blocks show, in this order.
  // Known: 'booked', 'sources', 'open', 'value', 'forecast', 'close_rate', 'lost_reasons', 'speed'. 'value' (Lead value) also needs features.value.
  metrics: ['booked', 'sources', 'open', 'value', 'forecast', 'close_rate', 'lost_reasons', 'speed']
};
