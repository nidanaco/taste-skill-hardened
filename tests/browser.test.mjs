import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Browser, sleep } from '../plugins/taste-skill-hardened/skills/taste-frontend-hardened/scripts/lib/cdp.mjs';
import { servePublic } from '../plugins/taste-skill-hardened/skills/taste-frontend-hardened/scripts/lib/public-server.mjs';
import { restrictPage } from '../plugins/taste-skill-hardened/skills/taste-frontend-hardened/scripts/lib/network-policy.mjs';

const skill = fileURLToPath(new URL('../plugins/taste-skill-hardened/skills/taste-frontend-hardened/', import.meta.url));
let dir, root, server, browser, previousTmp;
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'taste-browser-test-')); root = join(dir, 'public'); mkdirSync(root);
  previousTmp = process.env.TASTE_SKILL_TMP; process.env.TASTE_SKILL_TMP = dir;
  writeFileSync(join(root, 'charts.js'), readFileSync(join(skill, 'assets/charts.js')));
  writeFileSync(join(root, 'index.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Chart fixture</title><style>body{font:16px sans-serif;margin:16px}main{max-width:640px}main>div{width:100%;min-height:140px}</style><main><h1>Synthetic charts</h1><div id="ring"></div><div id="plan"></div><div id="bullet"></div><div id="line"></div><div id="bars"></div></main><script src="charts.js"></script></html>');
  server = await servePublic({ root, entry: join(root, 'index.html') });
  browser = await Browser.launch({ allowedOrigin: server.url });
});
after(async () => {
  if (browser) await browser.close(); if (server) await server.close();
  if (previousTmp === undefined) delete process.env.TASTE_SKILL_TMP; else process.env.TASTE_SKILL_TMP = previousTmp;
  if (dir) rmSync(dir, { recursive: true, force: true });
});
async function page() {
  const p = await browser.newPage();
  try { await restrictPage(p, server.url); await p.goto(server.url, { settleMs: 100 }); return p; }
  catch (error) { await p.close(); throw error; }
}

test('hostile chart labels and formatter results stay text in a real browser', async () => {
  const p = await page();
  try {
    const result = await p.eval(() => {
      window.auditXSS = 0;
      const payload = '<img src=x onerror="window.auditXSS++">';
      Charts.ring(document.querySelector('#ring'), { value: .5, label: payload, sub: payload });
      Charts.plan(document.querySelector('#plan'), [{ label: payload, planned: 100, spent: 40 }], { format: () => payload, note: () => payload });
      Charts.bullet(document.querySelector('#bullet'), [{ label: payload, value: .3, target: .2 }], { format: () => payload });
      Charts.line(document.querySelector('#line'), { labels: [payload, payload], series: [{ name: payload, values: [1, 2] }, { name: payload, values: [2, 3] }], format: () => payload });
      const hit = document.querySelector('#line [fill="transparent"]'), r = hit.getBoundingClientRect();
      hit.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + r.width / 2, clientY: r.top + 10 }));
      return { images: document.querySelectorAll('img').length, hasText: ['ring', 'plan', 'bullet', 'line'].every((id) => document.getElementById(id).textContent.includes(payload)), tooltip: document.querySelector('.chart-tip').textContent.includes(payload) };
    });
    await sleep(100); assert.equal(await p.eval('window.auditXSS'), 0); assert.equal(result.images, 0); assert.equal(result.hasText, true); assert.equal(result.tooltip, true);
    assert.deepEqual(p.consoleErrors, []);
  } finally { await p.close(); }
});

test('ordinary chart rendering and labels remain usable', async () => {
  const p = await page();
  try {
    const result = await p.eval(() => {
      Charts.ring(document.querySelector('#ring'), { value: .72, label: '72%', sub: 'of capacity' });
      Charts.plan(document.querySelector('#plan'), [{ label: 'Groceries', planned: 100, spent: 40, committed: 10 }, { label: 'Transport', planned: 10, spent: 20 }]);
      Charts.bullet(document.querySelector('#bullet'), [{ label: 'Bonds', value: .3, target: .25 }]);
      Charts.line(document.querySelector('#line'), { labels: ['Oct 1', 'Oct 2'], series: [{ name: 'Requests', values: [2, 4] }] });
      Charts.bars(document.querySelector('#bars'), { labels: ['A', 'B'], values: [2, 4] });
      return { ring: document.querySelector('#ring').textContent, plan: document.querySelector('#plan').textContent, bullet: document.querySelector('#bullet').textContent, svg: document.querySelectorAll('svg').length };
    });
    assert.match(result.ring, /72%.*of capacity/); assert.match(result.plan, /Groceries/); assert.match(result.plan, /Transport/); assert.match(result.bullet, /Bonds/); assert.ok(result.svg >= 3);
    assert.deepEqual(p.consoleErrors, []);
  } finally { await p.close(); }
});

test('page requests, navigation and sockets cannot reach a second origin', async () => {
  let hits = 0; const other = createServer((_req, res) => { hits++; res.end('should not be reached'); });
  await new Promise((done) => other.listen(0, '127.0.0.1', done));
  const p = await page();
  try {
    const otherURL = 'http://127.0.0.1:' + other.address().port + '/private';
    const result = await p.eval(async (url) => {
      let fetchBlocked = false, socketBlocked = false, rtcBlocked = false;
      try { await fetch(url); } catch { fetchBlocked = true; }
      try { new WebSocket(url.replace('http:', 'ws:')); } catch { socketBlocked = true; }
      try { new RTCPeerConnection(); } catch { rtcBlocked = true; }
      return { fetchBlocked, socketBlocked, rtcBlocked };
    }, otherURL);
    assert.deepEqual(result, { fetchBlocked: true, socketBlocked: true, rtcBlocked: true }); assert.equal(hits, 0);
    // Navigate directly as well, so response CSP alone cannot account for denial.
    await p.goto(otherURL, { timeoutMs: 1500, settleMs: 0 }).catch(() => {});
    assert.equal(hits, 0); assert.ok(p.blockedRequests.length >= 1);
    // The browser proxy is a separate layer: it must deny a disallowed port
    // even in a fresh target with no page-level Fetch interception installed.
    const raw = await browser.newPage(), before = browser.deniedRequests;
    try { await raw.goto(otherURL, { timeoutMs: 1000, settleMs: 0 }).catch(() => {}); }
    finally { await raw.close(); }
    assert.equal(hits, 0); assert.ok(browser.deniedRequests > before);
  } finally { await p.close(); other.closeAllConnections(); await new Promise((done) => other.close(done)); }
});

test('inspector completes a responsive fixture and preserves prior outputs and other profiles', async () => {
  await browser.close(); browser = null;
  const clean = join(dir, 'clean'); mkdirSync(clean);
  writeFileSync(join(clean, 'index.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Clean fixture</title><style>body{font:16px system-ui;margin:16px}main{max-width:600px}h1{font-size:32px}</style><main><h1>Local fixture</h1><p>All content is synthetic and local.</p><button>Review</button></main></html>');
  const output = join(dir, 'output'); mkdirSync(output); writeFileSync(join(output, 'desktop-fold.jpg'), 'PRESERVE');
  const unrelated = join(dir, 'ad-chrome-unrelated'); mkdirSync(unrelated); writeFileSync(join(unrelated, 'sentinel'), 'PRESERVE');
  const result = spawnSync(process.execPath, [join(skill, 'scripts/inspect.mjs'), join(clean, 'index.html'), '--public-root', clean, '--out', output, '--json'], { encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, String(result.error || '') + result.stderr + result.stdout);
  const report = JSON.parse(result.stdout); assert.equal(report.viewports.length, 4); assert.equal(report.findings.length, 0); assert.equal(report.images.length, 4);
  assert.equal(readFileSync(join(output, 'desktop-fold.jpg'), 'utf8'), 'PRESERVE'); assert.equal(readFileSync(join(unrelated, 'sentinel'), 'utf8'), 'PRESERVE');
  assert.ok(readdirSync(dir).every((name) => !name.startsWith('taste-hardened-chrome-')));
});
