import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loopbackURL, requestAllowed, proxyBypass } from '../plugins/taste-skill-hardened/skills/taste-frontend-hardened/scripts/lib/network-policy.mjs';
test('rejects remote, credential-bearing, non-http and ambiguous target URLs', () => {
  assert.equal(loopbackURL('http://localhost:1234/').hostname, '127.0.0.1');
  assert.equal(loopbackURL('http://[::1]:1234/').hostname, '[::1]');
  for (const u of ['https://example.com', 'http://127.0.0.1.example.com', 'http://user:password@127.0.0.1', 'file:///etc/passwd', 'http://169.254.169.254', 'http://192.168.1.1', 'http://0.0.0.0']) assert.throws(() => loopbackURL(u), undefined, u);
});
test('allows only same-origin resources and inert data or origin-owned blobs', () => {
  const origin = 'http://127.0.0.1:1234';
  assert.equal(requestAllowed(origin + '/app.js', origin), true);
  assert.equal(requestAllowed('data:image/png;base64,AA==', origin), true);
  assert.equal(requestAllowed('blob:' + origin + '/id', origin), true);
  for (const u of ['http://127.0.0.1:5678/', 'https://cdn.example.com/x', 'http://169.254.169.254/', 'ws://127.0.0.1:1234', 'file:///tmp/private', 'blob:https://example.com/id', 'javascript:alert(1)', 'bad']) assert.equal(requestAllowed(u, origin), false, u);
});
test('browser proxy exceptions always include an exact port, including default ports', () => {
  assert.equal(proxyBypass('http://127.0.0.1/'), '<-loopback>;127.0.0.1:80');
  assert.equal(proxyBypass('https://localhost/'), '<-loopback>;127.0.0.1:443');
  assert.equal(proxyBypass('http://[::1]:4321/'), '<-loopback>;[::1]:4321');
});
