// Minimal CDP client for an isolated, disposable browser profile.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { loopbackURL, proxyBypass } from './network-policy.mjs';
import { denyProxy } from './deny-proxy.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function findChrome() {
  const override = process.env.CHROME_PATH;
  if (override) {
    if (!isAbsolute(override) || !existsSync(override)) throw new Error('CHROME_PATH must name an installed browser by absolute path');
    return override;
  }
  for (const path of ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/usr/bin/chromium', '/usr/bin/google-chrome', '/usr/bin/microsoft-edge']) if (existsSync(path)) return path;
  throw new Error('No browser found; set CHROME_PATH to an installed browser. Nothing will be installed automatically.');
}

export class Browser {
  static async launch({ allowedOrigin, width = 1440, height = 900 } = {}) {
    if (typeof WebSocket === 'undefined') throw new Error('Node 22+ is required');
    const target = loopbackURL(allowedOrigin);
    const exe = findChrome(), base = process.env.TASTE_SKILL_TMP || tmpdir();
    const dir = mkdtempSync(join(base, 'taste-hardened-chrome-'));
    let proc, proxy, disposal;
    const unhook = () => {
      for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.removeListener(signal, onSignal);
      process.removeListener('exit', emergencyCleanup);
    };
    const emergencyCleanup = () => {
      unhook();
      if (proc && proc.exitCode === null && proc.signalCode === null && !proc.killed) proc.kill();
      if (proxy) proxy.close();
      try { rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch {}
    };
    const running = () => proc && proc.exitCode === null && proc.signalCode === null;
    const waitForExit = (timeoutMs) => new Promise((done) => {
      if (!running()) { done(true); return; }
      const finish = (exited) => { clearTimeout(timer); proc.removeListener('exit', exitedHandler); done(exited); };
      const exitedHandler = () => finish(true);
      const timer = setTimeout(() => finish(false), timeoutMs);
      proc.once('exit', exitedHandler);
    });
    const cleanup = () => disposal ||= (async () => {
      // A CDP close reply does not mean the browser has stopped writing its
      // profile. Wait for process exit before removing only our owned directory.
      if (running() && !await waitForExit(500)) {
        proc.kill('SIGTERM');
        if (!await waitForExit(2000)) { proc.kill('SIGKILL'); await waitForExit(2000); }
      }
      if (running()) throw new Error('browser did not exit; owned profile preserved: ' + dir);
      if (proxy) await proxy.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      unhook();
    })();
    const onSignal = () => { cleanup().catch(() => {}).finally(() => process.exit(130)); };
    process.once('exit', emergencyCleanup);
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, onSignal);
    try {
      proxy = await denyProxy();
      const env = Object.fromEntries(['PATH', 'LANG', 'LC_ALL', 'TZ', 'SystemRoot', 'WINDIR'].filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
      Object.assign(env, { TMPDIR: base, XDG_CONFIG_HOME: dir, XDG_CACHE_HOME: join(dir, 'cache') });
      proc = spawn(exe, [
        '--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${dir}`,
        '--no-first-run', '--no-default-browser-check', '--mute-audio', '--hide-scrollbars',
        '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-default-apps',
        '--disable-features=Translate,MediaRouter', '--force-color-profile=srgb',
        '--disk-cache-size=16777216', '--media-cache-size=16777216',
        `--proxy-server=${proxy.url}`, `--proxy-bypass-list=${proxyBypass(target.href)}`,
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE [::1]', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
        `--window-size=${width},${height}`, 'about:blank',
      ], { stdio: ['ignore', 'ignore', 'pipe'], env });
      const wsUrl = await new Promise((done, fail) => {
        let buf = '';
        const timer = setTimeout(() => fail(new Error('browser startup timed out')), 20000);
        proc.on('error', (e) => { clearTimeout(timer); fail(e); });
        proc.on('exit', (code) => { clearTimeout(timer); fail(new Error('browser exited: ' + code + '\n' + buf.slice(-1200))); });
        proc.stderr.on('data', (chunk) => {
          buf = (buf + chunk.toString()).slice(-16384);
          const match = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
          if (match) { clearTimeout(timer); done(match[1]); }
        });
      });
      const endpoint = new URL(wsUrl);
      if (endpoint.protocol !== 'ws:' || !['127.0.0.1', '[::1]', 'localhost'].includes(endpoint.hostname)) throw new Error('unexpected browser debugging endpoint');
      const b = new Browser();
      Object.assign(b, { proc, dir, cleanup, nextId: 1, pending: new Map(), listeners: new Map(), ws: new WebSocket(wsUrl) });
      Object.defineProperty(b, 'deniedRequests', { get: () => proxy.count });
      await new Promise((done, fail) => { b.ws.onopen = done; b.ws.onerror = () => fail(new Error('CDP socket failed')); });
      b.ws.onmessage = (event) => {
        const message = JSON.parse(typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString());
        if (message.id && b.pending.has(message.id)) {
          const { done, fail, timer } = b.pending.get(message.id); clearTimeout(timer); b.pending.delete(message.id);
          if (message.error) fail(new Error(message.error.message)); else done(message.result);
        } else if (message.method) {
          for (const fn of b.listeners.get((message.sessionId || '') + '|' + message.method) || []) fn(message.params);
        }
      };
      return b;
    } catch (error) { await cleanup(); throw error; }
  }
  send(method, params = {}, sessionId, timeoutMs = 30000) {
    const id = this.nextId++;
    return new Promise((done, fail) => {
      const timer = setTimeout(() => { this.pending.delete(id); fail(new Error('CDP timeout: ' + method)); }, timeoutMs);
      this.pending.set(id, { done, fail, timer });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  on(sessionId, method, fn) {
    const key = (sessionId || '') + '|' + method;
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key).add(fn);
    return () => this.listeners.get(key)?.delete(fn);
  }
  async newPage({ width = 1440, height = 900, dsf = 1, mobile = false, reducedMotion = false } = {}) {
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank', newWindow: true });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    const p = new Page(this, targetId, sessionId);
    await p.send('Page.enable'); await p.send('Runtime.enable');
    await p.setViewport({ width, height, dsf, mobile });
    if (reducedMotion) await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    return p;
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    try { await this.send('Browser.close', {}, undefined, 3000); } catch {}
    try { this.ws.close(); } catch {}
    await this.cleanup();
    for (const { timer, fail } of this.pending.values()) { clearTimeout(timer); fail(new Error('browser closed')); }
    this.pending.clear();
    this.listeners.clear();
  }
}

export class Page {
  constructor(browser, targetId, sessionId) {
    this.browser = browser; this.targetId = targetId; this.sessionId = sessionId;
    this.consoleErrors = [];
    browser.on(sessionId, 'Runtime.exceptionThrown', (p) => {
      if (this.consoleErrors.length < 50) this.consoleErrors.push((p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || '').slice(0, 300));
    });
    // Never let a JS dialog block the page.
    browser.on(sessionId, 'Page.javascriptDialogOpening', () => {
      this.send('Page.handleJavaScriptDialog', { accept: false }).catch(() => {});
    });
  }

  send(method, params = {}, timeoutMs = 30000) {
    return this.browser.send(method, params, this.sessionId, timeoutMs);
  }

  async setViewport({ width, height, dsf = 1, mobile = false }) {
    this.viewport = { width, height, dsf, mobile };
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dsf, mobile });
    await this.send('Emulation.setTouchEmulationEnabled', { enabled: !!mobile });
  }

  // Navigates and resolves after the load event (or timeout), then waits `settleMs` for intros to finish.
  async goto(url, { timeoutMs = 25000, settleMs = 1500 } = {}) {
    let off, timer;
    const loaded = new Promise((resolve) => { off = this.browser.on(this.sessionId, 'Page.loadEventFired', () => resolve('load')); });
    const nav = await this.send('Page.navigate', { url }, timeoutMs).catch((e) => ({ errorText: e.message }));
    if (nav.errorText && !/ERR_ABORTED/.test(nav.errorText)) { off(); throw new Error('navigate: ' + nav.errorText); }
    const how = await Promise.race([loaded, new Promise((done) => { timer = setTimeout(() => done('timeout'), timeoutMs); })]);
    clearTimeout(timer); off();
    await sleep(settleMs);
    return how;
  }

  // Evaluates a function (serialised) or an expression string in the page and returns its JSON value.
  async eval(fnOrExpr, arg) {
    const expression = typeof fnOrExpr === 'function'
      ? `(${fnOrExpr.toString()})(${arg === undefined ? '' : JSON.stringify(arg)})`
      : fnOrExpr;
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, 30000);
    if (r.exceptionDetails) {
      throw new Error('page eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result?.value;
  }

  async screenshot({ path, format = 'jpeg', quality = 72, fullPage = false, clip } = {}) {
    const params = { format, captureBeyondViewport: !!fullPage };
    if (format !== 'png') params.quality = quality;
    if (fullPage) {
      const m = await this.send('Page.getLayoutMetrics');
      const s = m.cssContentSize || m.contentSize;
      params.clip = { x: 0, y: 0, width: Math.ceil(s.width), height: Math.min(Math.ceil(s.height), 16000), scale: 1 };
    } else if (clip) {
      params.clip = { scale: 1, ...clip };
    }
    const { data } = await this.send('Page.captureScreenshot', params, 45000);
    if (path) writeFileSync(path, Buffer.from(data, 'base64'));
    return data;
  }

  // Real wheel input, so smooth-scroll libraries and scroll-driven reveals behave as they do for a visitor.
  async wheel(totalDeltaY, { step = 240, pauseMs = 45 } = {}) {
    const { width, height } = this.viewport;
    const dir = Math.sign(totalDeltaY) || 1;
    let left = Math.abs(totalDeltaY);
    while (left > 0) {
      const d = Math.min(step, left);
      await this.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.round(width / 2), y: Math.round(height / 2), deltaX: 0, deltaY: d * dir }).catch(() => {});
      left -= d;
      await sleep(pauseMs);
    }
  }

  async close() {
    try { await this.browser.send('Target.closeTarget', { targetId: this.targetId }, undefined, 5000); } catch {}
  }
}

export { sleep };
