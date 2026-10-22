import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { test } from 'node:test';
import { servePublic, snapshotPublic } from '../plugins/taste-skill-hardened/skills/taste-frontend-hardened/scripts/lib/public-server.mjs';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'taste-public-test-')), root = join(dir, 'public');
  mkdirSync(root); writeFileSync(join(root, 'index.html'), '<h1>Public marker</h1>');
  writeFileSync(join(root, '.env'), 'SYNTHETIC_SECRET');
  writeFileSync(join(dir, 'outside.json'), 'SYNTHETIC_OUTSIDE');
  symlinkSync(join(dir, 'outside.json'), join(root, 'linked.json'));
  symlinkSync(dir, join(root, 'linked-dir'));
  mkdirSync(join(root, '.git')); writeFileSync(join(root, '.git/config.json'), 'SYNTHETIC_GIT');
  mkdirSync(join(root, 'private')); writeFileSync(join(root, 'private/secret.json'), 'SYNTHETIC_PRIVATE');
  writeFileSync(join(root, 'key.pem'), 'SYNTHETIC_KEY');
  return { dir, root, entry: join(root, 'index.html') };
}
const raw = (url, path, options = {}) => new Promise((done, fail) => {
  const u = new URL(url), req = request({ hostname: u.hostname, port: u.port, path, ...options }, (res) => {
    let body = ''; res.setEncoding('utf8'); res.on('data', (c) => body += c); res.on('end', () => done({ status: res.statusCode, body, headers: res.headers }));
  }); req.on('error', fail); req.end();
});

test('serves normal assets and rejects hidden, linked, private and traversal paths', async () => {
  const f = fixture(); const server = await servePublic(f);
  try {
    const good = await raw(server.url, '/index.html'); assert.equal(good.status, 200); assert.match(good.body, /Public marker/);
    assert.equal(good.headers['x-content-type-options'], 'nosniff');
    for (const path of ['/.env', '/.git/config.json', '/linked.json', '/linked-dir/outside.json', '/private/secret.json', '/key.pem', '/../outside.json', '/%2e%2e/outside.json', '/%2eenv', '/foo%5c..%5coutside.json', '/%00.json']) {
      const r = await raw(server.url, path); assert.equal(r.status, 404, path); assert.doesNotMatch(r.body, /SYNTHETIC_/);
    }
    assert.equal((await raw(server.url, '/%GG')).status, 400);
    assert.equal((await raw(server.url, '/index.html', { headers: { Host: 'attacker.invalid' } })).status, 403);
    assert.equal((await raw(server.url, '/index.html', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    assert.equal((await raw(server.url, '/index.html', { method: 'POST' })).status, 405);
    const head = await raw(server.url, '/index.html', { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(head.body, '');
  } finally { await server.close(); rmSync(f.dir, { recursive: true }); }
});

test('requests use an immutable snapshot even after a path is replaced with an outside symlink', async () => {
  const f = fixture(); const server = await servePublic(f);
  try {
    rmSync(f.entry); symlinkSync(join(f.dir, 'outside.json'), f.entry);
    const r = await raw(server.url, '/index.html'); assert.match(r.body, /Public marker/); assert.doesNotMatch(r.body, /SYNTHETIC_OUTSIDE/);
  } finally { await server.close(); rmSync(f.dir, { recursive: true }); }
});

test('snapshot and entry limits fail closed', async () => {
  const f = fixture();
  try {
    assert.throws(() => snapshotPublic(f.root, { maxFileBytes: 2 }), /size limit/);
    assert.throws(() => snapshotPublic(f.root, { maxTotalBytes: 2 }), /size limit/);
    assert.throws(() => snapshotPublic(f.root, { maxFiles: 0 }), /too many entries|size limit/);
    await assert.rejects(servePublic({ root: f.root, entry: join(f.dir, 'outside.json') }), /inside/);
    await assert.rejects(servePublic({ root: f.root, entry: join(f.root, 'linked.json') }), /linked/);
  } finally { rmSync(f.dir, { recursive: true }); }
});
