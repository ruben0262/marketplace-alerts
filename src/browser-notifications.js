let registration;

export async function prepareBrowserNotifications() {
  if (!('Notification' in window) || Notification.permission !== 'granted' || !window.isSecureContext || !('serviceWorker' in navigator)) return null;
  registration ||= navigator.serviceWorker.register('/notifications-sw.js').then(() => navigator.serviceWorker.ready).catch(error => {
    registration = null;
    throw error;
  });
  return registration;
}

export async function showBrowserNotification(item, onOpen, isCurrent) {
  const options = { body: item.body, tag: `scout-${item._id}`, icon: '/favicon.svg' };
  try {
    const worker = await prepareBrowserNotifications();
    if (!isCurrent()) return true;
    if (worker) { await worker.showNotification(item.title, options); return true; }
  } catch { /* A desktop browser can still support the direct notification API. */ }
  if (!isCurrent() || Notification.permission !== 'granted') return true;
  try {
    const notification = new Notification(item.title, options);
    notification.onclick = () => { onOpen(); notification.close(); };
    return true;
  } catch { return false; }
}
