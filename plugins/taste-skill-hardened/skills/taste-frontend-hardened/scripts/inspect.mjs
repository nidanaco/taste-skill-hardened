#!/usr/bin/env node
// Offline-first inspection. No installer, downloader, home history or broad
// project server. A local HTML entry requires an explicit public root.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Browser, sleep } from './lib/cdp.mjs';
import { servePublic } from './lib/public-server.mjs';
import { loopbackURL, restrictPage } from './lib/network-policy.mjs';

const args = process.argv.slice(2), options = {}; let target;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (['--public-root', '--out'].includes(arg)) {
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(arg + ' needs a value');
    options[arg.slice(2)] = args[++i];
  } else if (arg === '--json') options.json = true;
  else if (arg.startsWith('-') || target) throw new Error('unknown or repeated argument: ' + arg);
  else target = arg;
}
if (!target) throw new Error('usage: node inspect.mjs <loopback-url | public/index.html> [--public-root public] [--out DIR] [--json]');

let server, browser;
const report = { target, viewports: [], findings: [], images: [] };
try {
  let url;
  if (/^https?:/i.test(target)) url = loopbackURL(target).href;
  else {
    if (!options['public-root']) throw new Error('local HTML requires --public-root pointing to a directory containing public assets only');
    server = await servePublic({ root: options['public-root'], entry: target });
    url = server.url;
  }
  const base = resolve(options.out || '.taste-skill/inspect');
  mkdirSync(base, { recursive: true });
  const out = mkdtempSync(join(base, 'run-'));
  report.output = out;
  browser = await Browser.launch({ allowedOrigin: url });
  for (const { width, height, reducedMotion } of [
    { width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 390, height: 844 },
    { width: 390, height: 844, reducedMotion: true },
  ]) {
    const page = await browser.newPage({ width, height, reducedMotion });
    const off = await restrictPage(page, url);
    try {
      await page.goto(url, { settleMs: 300 });
      await page.eval('Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 2000))]).then(() => true)');
      const metrics = await page.eval(() => {
        const root = document.documentElement;
        const text = (el) => (el.textContent || '').trim().slice(0, 160);
        return {
          width: innerWidth, height: innerHeight, pageWidth: root.scrollWidth, pageHeight: root.scrollHeight,
          title: document.title, headings: [...document.querySelectorAll('h1,h2,h3')].slice(0, 100).map((el) => ({ tag: el.tagName, text: text(el) })),
          brokenImages: [...document.images].filter((el) => !el.complete || !el.naturalWidth).length,
          missingAlt: [...document.images].filter((el) => !el.hasAttribute('alt')).length,
          hiddenText: [...document.querySelectorAll('h1,h2,h3,p,button,a')].filter((el) => {
            const r = el.getBoundingClientRect(), s = getComputedStyle(el);
            return r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0 && text(el) && (s.visibility === 'hidden' || +s.opacity < 0.1);
          }).map(text).slice(0, 20),
        };
      });
      const mode = width + (reducedMotion ? '-reduced' : '');
      if (metrics.pageWidth > width + 1) report.findings.push({ id: 'overflow', width, message: 'Page extends beyond the viewport' });
      if (metrics.brokenImages) report.findings.push({ id: 'broken-images', width, count: metrics.brokenImages });
      if (metrics.missingAlt) report.findings.push({ id: 'missing-alt', width, count: metrics.missingAlt });
      if (reducedMotion && metrics.hiddenText.length) report.findings.push({ id: 'reduced-hidden', width, text: metrics.hiddenText });
      const screens = Math.min(8, Math.max(1, Math.ceil(metrics.pageHeight / height)));
      for (let i = 0; i < screens; i++) {
        await page.eval(`window.scrollTo(0, ${i * height})`); await sleep(80);
        const path = join(out, mode + '-' + (i + 1) + '.jpg');
        await page.screenshot({ path }); report.images.push(path);
      }
      if (page.blockedRequests.length) report.findings.push({ id: 'blocked-network', width, count: page.blockedRequests.length });
      if (page.consoleErrors.length) report.findings.push({ id: 'page-error', width, messages: page.consoleErrors.slice(0, 5) });
      report.viewports.push({ ...metrics, reducedMotion: !!reducedMotion });
    } finally { off(); await page.close(); }
  }
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(options.json ? JSON.stringify(report) : `Inspection saved to ${out}; ${report.findings.length} finding(s). Open the screenshots to assess the design.`);
  process.exitCode = report.findings.length ? 1 : 0;
} finally {
  if (browser) await browser.close();
  if (server) await server.close();
}
