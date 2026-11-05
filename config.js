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
