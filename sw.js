/* Service worker: push alerts + a navigation-only offline fallback. Nothing is cached or stored: signed-in data never sits in a cache.
   The only fetch handler answers page NAVIGATIONS: it passes them to the network and, only if the network fails, shows a fixed inline "No signal" page.
   Rules (checked by tools/check_sw.js at publish): no Cache API, no importScripts, no storage, one fetch listener, navigate requests only.
   Payload (contract): { title, body, url: "/#/lead/<uuid>" | "/", tag, lead_id, test }. */
'use strict';

// Same-origin path only (same rule as safePath in lib.js): one leading "/", no whitespace/control/backslash,
// and it must resolve to our own origin.
function safePath(u) {
  if (typeof u !== 'string' || !/^\/(?!\/)[^\s\\\x00-\x1f\x7f]*$/.test(u)) return '/';
  try { return new URL(u, self.location.origin).origin === self.location.origin ? u : '/'; } catch (e) { return '/'; }
}

// Same rules as L.pushPayload in lib.js (a test loads both and compares).
function parsePayload(data) {
  var p = {};
  try { p = data ? data.json() : {}; } catch (e) { p = {}; }
  if (!p || typeof p !== 'object') p = {};
  var url = safePath(p.url);
  return {
    title: typeof p.title === 'string' && p.title ? p.title.slice(0, 80) : 'New lead needs you',
    body: typeof p.body === 'string' ? p.body.slice(0, 200) : '',
    tag: typeof p.tag === 'string' && p.tag ? p.tag.slice(0, 80) : 'lead-alert',
    url: url
  };
}

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

// Offline fallback: fixed text, no data, no external resources, no script. 503 = honest "unavailable" (never mistaken for the app).
var OFFLINE_HTML = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>No signal</title>' +
  '<style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px;box-sizing:border-box;text-align:center;font:17px/1.4 -apple-system,system-ui,sans-serif;background:#fff;color:#1a1a1a}' +
  '@media(prefers-color-scheme:dark){body{background:#111;color:#f2f2f2}}p{margin:0;max-width:20em}a{display:inline-block;padding:12px 24px;border-radius:12px;background:#1a1a1a;color:#fff;text-decoration:none;font-weight:600}' +
  '@media(prefers-color-scheme:dark){a{background:#f2f2f2;color:#111}}</style></head><body><p>No signal. Your leads load when you\u2019re back.</p><a href="/">Try again</a></body></html>';

function offlineResponse() {
  return new Response(OFFLINE_HTML, {
    status: 503,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    }
  });
}

// Navigation requests only. Anything else (data, scripts, images) is never touched: no respondWith, the browser handles it.
self.addEventListener('fetch', function (event) {
  try {
    if (!event.request || event.request.mode !== 'navigate') return;
    event.respondWith(fetch(event.request).catch(function () {
      try { return offlineResponse(); } catch (e) { return Response.error(); }
    }));
  } catch (e) { /* any failure: fall through to the network */ }
});

self.addEventListener('push', function (event) {
  var n = parsePayload(event.data);
  event.waitUntil(self.registration.showNotification(n.title, {
    body: n.body,
    tag: n.tag,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    data: { url: n.url }
  }));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var d = event.notification.data;
  var rel = safePath(d && d.url);
  var target = new URL(rel, self.location.origin);
  if (target.origin !== self.location.origin) target = new URL('/', self.location.origin);
  target = target.href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c.url.indexOf(self.location.origin) === 0 && 'focus' in c) {
        return c.focus().then(function (w) {
          // Navigate the open window to the lead. A hash-only change just fires hashchange (no reload).
          return (w && 'navigate' in w) ? w.navigate(target).catch(function () { return w; }) : w;
        });
      }
    }
    return self.clients.openWindow(target);
  }));
});
