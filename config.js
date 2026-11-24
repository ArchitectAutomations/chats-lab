/* HTTPS only: a page served over plain HTTP could be rewritten on the way. This runs first, before any other script. */
if (location.protocol === 'http:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
  location.replace('https://' + location.host + location.pathname + location.search + location.hash);
}
/* Build id: 'dev' in the repo; publish_lab.sh fills it (YYYYMMDD-HHMM-<hash>) so a help request says which version the owner had. */
window.CV_BUILD = "20261124-1734-6bdc9386";
/* Public by design: the project URL and the publishable (anon) key. Row access is enforced
   by RLS, so these two values are safe to ship in the page. Replace the placeholders at deploy. */
window.CV_CONFIG = {
  SUPABASE_URL: 'https://cypvadpdtwtdymabtzfh.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_iRd6r_slmsZhpEvReEYdlQ_QDNZ1Bi3'
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
  // Shades, text colours and tints are fixed hex values in styles.css (:root), tuned to this palette (cream / paper / ink blue); they do NOT follow these three.
  // A client with another palette therefore needs the FULL token set here, not just these three: primaryDeep, primaryRaised, lineOnPrimary, onPrimary, mutedOnPrimary,
  // secondaryDeep, onSecondary, mutedOnSecondary, accentStrong, accentLight, accentTint, accentInk, accentWash, onAccent, dangerOnPrimary, dangerOnSecondary,
  // cardRing, bubbleOut, fieldBorder. Leaving one out keeps the cream default for it.
  // A new palette must be re-checked for WCAG AA contrast (see the note at the top of styles.css).
  theme: {
    primary: '#F3EEE2',    // cream paper
    secondary: '#FBF8F1',  // paper (cards, rows, fields)
    accent: '#2F4A73',     // ink blue
    primaryDeep: '#E9E4D8' // header + bottom bar; also the browser bar colour (app.js sets theme-color from this, else from primary)
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
  // addLeadNoPhone (sql/035 must be applied first; the odd one out: a MISSING value is OFF, only exactly true turns it on): the Phone box of "+ Add lead" may stay blank, and then the name and an email are required (Kevin B9 + F4). The database has its own switch, cv_config add_lead_no_phone. Lab only until Kevin rules.
  // editLead ("Edit details" on a lead's page, owner only: fix the date, guests, times, name, email, area or occasion; the phone too for a lead you added that has no texts yet. Every change is written in the history; the database has its own switch, cv_config edit_lead_enabled, and sql/032 must be applied first).
  // money (sql/033 must be applied first; owner only, staff never see any of it): the Deposit received tick on a Booked lead, "New price from the AI: $X. Update?" on a Booked lead, the "Cancelled after booking" reason with the Amount you kept, and Metrics "Kept from cancellations". Each part also needs the lead to come with the 033 columns, so a lab without 033 shows none of it.
  // hideLead (sql/034 must be applied first; owner only, staff never see it): "Hide this lead" on a lead's page while nothing was ever texted to them (the server says when), and More > Hidden leads to show one again. A hidden lead is in no list, count, search or spreadsheet; its history is kept. The database has its own switch, cv_config hide_lead_enabled.
  // quoteCard (round 1 redesign, Kevin "All A" 11-20): a lead's automatic "Quote" and the owner's "Your price" show as ONE Quote card under the Status card,
  // with the big Total, Change price and the same Send it to them button, confirm sheet and checks as before. false = the two cards exactly as before. Left out = on.
  // today (round 3 redesign, Kevin "All A" 11-20): the Today home screen. On = it is the first bottom-bar tab and where the app opens: the alerts line,
  // Needs you as cards (Call, Text, Open; today's rule), three numbers (owner only: open quotes, this month's events booked, first reply), "Did these happen?"
  // and This week; Metrics then leaves the bar and opens from Today ("All numbers") and from More. false = the page exactly as before (Leads home, today's bar). Left out = on.
  // stages (round 5 redesign, Kevin "All A" 11-21): the five-status switch. On = tabs All open / New / Contacted / Offer sent / Negotiation / Deal closed / Lost / All, five status buttons
  // (Contacted, Offer sent, Negotiation, Deal closed, Lost), the new words ("Deal closed" for "Booked"), and a required final price when the owner moves a lead to Deal closed.
  // OFF unless exactly true (it needs sql 052 + 053 and the round-5 n8n write on that client's side). Left out = off = the page exactly as before.
  // quoteSend (the "Send it to them" button on a lead's saved price). OFF unless exactly true; the database has its own switch, cv_config quote_send_enabled.
  // team (More > Team, owner only: add or remove the people who can read your leads and notes). OFF unless exactly true; leave false until Kevin rules.
  // noQuoteFilter (owner only): the "No quote" chip under the filter chips and the "No quote sent" tag on rows. Same rule as the "without a quote yet" count in Metrics.
  // quoteDraft: the quote calculator keeps an unfinished form on this phone for 12 hours (form fields only, never a name or phone) so an app the phone closed does not lose it.
  // Hours a "Needs you" lead may wait before its wait turns red with "· overdue" (1–720; default 24, Kevin 11-06).
  waitWarnHours: 24,
  // Days after which a saved price on a lead (not sent yet) says how old it is: 7–29, default 21, 0 = never. The server refuses to text a price older than 30 days.
  quoteAgeWarnDays: 21,
  // desktop (rounds 7-9 redesign, Kevin "All A" 11-20): the computer layout over 1200 px wide: a sidebar, the list and the lead side by side (desktopLeads),
  // the Pipeline board (desktopPipeline, needs stages + sql 052/053), the Dashboard (desktopDashboard, needs sql 055 for the period switch), J / K / E / L / R keys (desktopKeys).
  // ON for the lab since Kevin's publish yes 11-24 ("Yes, apply and publish", choice 12A). OFF unless exactly true; desktop is the master switch. Under 1201 px the page is exactly as before whatever these say.
  // Built: desktop, desktopLeads, desktopKeys (round 7), desktopPipeline (round 8: the board in dollars, owner only, only with stages on), desktopDashboard (round 9: replaces Metrics in the sidebar, owner only, needs 'metrics' in tabs; its period switch shows once sql/055 is on the database). Staff never get Pipeline or Dashboard.
  // A second client sets only what it wants, e.g. desktop: true, desktopLeads: true (no keys; no Pipeline without stages + sql 052/053), plus its own savedViews below.
  features: { followups: true, calendar: true, quote: true, value: true, metrics: true, forecast: true, pastEvents: true, search: true, notes: true, push: true, addLead: true, support: true, export: true, ask: true, team: false, quoteSend: true, noQuoteFilter: true, quoteDraft: true, guide: true, editLead: true, money: true, hideLead: true, addLeadNoPhone: true, desktop: true, desktopLeads: true, desktopPipeline: true, desktopDashboard: true, desktopKeys: true, quoteCard: true, today: true, stages: true },

  // Saved views (rounds 7-9 redesign, ruling 19A): the fixed list under "Saved views" in the computer sidebar (features.desktop + desktopLeads). At most 6, in this order.
  // Each view: id (a-z, 0-9 and -, up to 24), label (up to 32 characters), and any of:
  //   tab (open, new, contacted, offer_sent, negotiation, booked, lost, all; new / offer_sent / negotiation need features.stages; default all),
  //   eventFrom / eventTo (YYYY-MM-DD, both included), minMoney / maxMoney (dollars: final price on a closed deal, else the quote, else a price you saved but did not send yet),
  //   minGuests / maxGuests, sources (form, text, manual:instagram, manual:phone_call, manual:referral, manual:other, other),
  //   noQuote: true (open, no quote yet), needsYou: true (waiting on you), sort (newest, quiet, event_soon, event_late, quote_high, customer_text, name_az).
  // A view with a mistake is left out whole (never half used). Views with money, noQuote or the quote_high sort are owner only (staff never see them).
  // These three are Kevin's K5 A picks for this client (nothing shows while features.desktop is off). A second client writes its own list here
  // (its own dates, money lines, sources) and records it in its setup notes; [] = no Saved views heading.
  savedViews: [
    { id: 'events-2027', label: 'Events in 2027', eventFrom: '2027-01-01', eventTo: '2027-12-31' },
    { id: 'over-2k', label: 'Quotes over $2k', minMoney: 2000 },
    { id: 'big-parties', label: '100 guests or more', minGuests: 100 }
  ],

  // Quote calculator pick-lists (More details). Leave a list out and that field stays a plain text box.
  // quoteOccasions: exactly the Occasion choices on the client's booking form, same words, same order.
  // (Source: Tally form lb2Jjk / 4aQv1A, "Occasion" dropdown; the form has no "Other" text box, so neither does the page.)
  quoteOccasions: ['Wedding', 'Corporate event', 'Birthday', 'Private party', 'Other'],
  // quotePromos: the client's promo codes, as they are in the database's promotions table (the calculator only applies a code
  // that row is running now). code = what the calculator receives. label + gives = plain words for the owner.
  // from / to = the dates it runs (YYYY-MM-DD in the time zone above; "to" is the first day it no longer works): outside them it is not offered.
  // eventFrom / eventTo = event dates it covers (both included); the page asks for an event date before sending such a code.
  // When the client changes a promo's dates or adds a code, change it here too: tools/tests/test_lib.js checks this list against the lab calculator.
  quotePromos: [
    { code: 'barsetup-all', label: 'Free bar setup', gives: 'The bar rental fee is waived when the bar is rented (old booking form)', from: '2026-10-08', to: '2027-01-01' },
    { code: 'bundle700-all', label: '$700 event bundle', gives: '1 bartender for 4 hours, the bar and delivery for $700, 1 to 100 guests, $50 per extra hour up to 8 (new booking form)',
      from: '2026-11-01', to: '2027-02-01', eventFrom: '2026-11-01', eventTo: '2027-01-31' }
  ],

  // Ask your CRM: the starter questions shown under the empty chat (at most 4, each 80 characters at most).
  askStarters: ['How much did I book this month?', 'Who needs me right now?', "What's booked this weekend?", 'Where are my leads coming from?'],

  // Bottom bar and More: which tabs show, in this order (a tab whose feature is off is skipped).
  // 'list', 'followups', 'calendar', 'metrics' sit in the bottom bar (with features.today on: Today first, and 'metrics' moves to the top of More); 'ask', 'quote', 'guide', 'support' and 'export' sit under More
  // (More itself is always the last slot and also holds Alerts and Sign out).
  tabs: ['list', 'followups', 'calendar', 'ask', 'quote', 'guide', 'support', 'export', 'hidden', 'metrics', 'team'],
  tabLabels: { today: 'Today', list: 'Leads', followups: 'Follow-ups', calendar: 'Calendar', metrics: 'Metrics', more: 'More', ask: 'Ask your CRM', quote: 'Quote calculator', guide: 'How to use the CRM', support: 'Help & support', export: 'Download spreadsheet', hidden: 'Hidden leads', team: 'Team', pipeline: 'Pipeline', dashboard: 'Dashboard', settings: 'Settings' },

  // Status wording on chips, filter chips, the three buttons and the history lines.
  // e.g. contacted: 'Called'. Keys: new, engaged, quoted, handed_off, contacted, offer_sent, negotiation, booked, lost, opted_out.
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
  // cancelled (sql/033): a booking that fell through. OWNER ONLY, and a chip only on a Booked lead; it keeps the money you kept (Metrics: "Kept from cancellations").
  lostReasons: { price: 'Price', date_taken: 'Date taken', no_reply: 'No reply', went_elsewhere: 'Went elsewhere', other: 'Other', old_lead: 'Old lead', cancelled: 'Cancelled after booking' },

  // Where a lead you add by hand came from (the four chips on "+ Add lead", and the source line on the record).
  // Keys are fixed (they are what the database stores): instagram, phone_call, referral, other.
  sourceLabels: { instagram: 'Instagram', phone_call: 'Phone call', referral: 'Referral', other: 'Other' },

  // Metrics tab: which blocks show, in this order.
  // Known: 'booked', 'sources', 'open', 'value', 'forecast', 'close_rate', 'lost_reasons', 'speed'. 'value' (Lead value) also needs features.value.
  metrics: ['booked', 'sources', 'open', 'value', 'forecast', 'close_rate', 'lost_reasons', 'speed']
};
