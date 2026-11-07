/* Service worker: push alerts only. No fetch handler, no caching: signed-in data never sits in a cache.
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
