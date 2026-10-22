// Page requests stay on the one loopback origin explicitly under review.
export function loopbackURL(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)) {
    throw new Error('inspection accepts only credential-free loopback HTTP(S) URLs');
  }
  // Avoid DNS lookup even for localhost.
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  return url;
}

export function requestAllowed(value, origin) {
  try {
    const url = new URL(value);
    if (url.protocol === 'data:') return true;
    if (url.protocol === 'blob:') return url.origin === origin;
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.origin === origin;
  } catch { return false; }
}

export function proxyBypass(value) {
  const url = loopbackURL(value);
  // URL.host omits default ports; using it would accidentally allow every
  // port on that address when inspecting http://127.0.0.1/ or HTTPS :443.
  return '<-loopback>;' + url.hostname + ':' + (url.port || (url.protocol === 'https:' ? '443' : '80'));
}

export async function restrictPage(page, target) {
  const origin = loopbackURL(target).origin;
  page.blockedRequests = [];
  const off = page.browser.on(page.sessionId, 'Fetch.requestPaused', (event) => {
    const allowed = requestAllowed(event.request.url, origin);
    if (!allowed && page.blockedRequests.length < 50) page.blockedRequests.push(new URL(event.request.url).protocol + '//[blocked]');
    page.send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', allowed ? { requestId: event.requestId } : { requestId: event.requestId, errorReason: 'BlockedByClient' }).catch(() => {});
  });
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  // Fetch interception does not cover WebSocket handshakes. Block sockets and
  // service workers for this static inspection session, before page scripts run.
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    for (const name of ['WebSocket', 'WebTransport', 'RTCPeerConnection', 'Worker', 'SharedWorker']) {
      Object.defineProperty(window, name, { value: class { constructor() { throw new Error('Networking disabled during inspection'); } }, configurable: false, writable: false });
    }
    if (navigator.serviceWorker) Object.defineProperty(navigator.serviceWorker, 'register', { value: () => Promise.reject(new Error('Service workers disabled during inspection')), writable: false });
  })();` });
  await page.send('Network.enable');
  await page.send('Network.setBypassServiceWorker', { bypass: true });
  return off;
}
