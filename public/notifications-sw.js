// Displays notifications from an open Scout page. No push subscription or caching.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const destination = new URL('/app/notifications', self.location.origin).href;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const current = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (current) {
      try { const navigated = await current.navigate(destination); if (navigated) return navigated.focus(); }
      catch { /* The original tab may have closed while the notification was clicked. */ }
    }
    return self.clients.openWindow(destination);
  })());
});
