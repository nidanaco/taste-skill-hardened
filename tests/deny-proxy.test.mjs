import assert from 'node:assert/strict';
import { createServer, get } from 'node:http';
import { connect } from 'node:net';
import { test } from 'node:test';
import { denyProxy } from '../plugins/taste-skill-hardened/skills/taste-frontend-hardened/scripts/lib/deny-proxy.mjs';

const resetConnect = (port) => new Promise((done, fail) => {
  const socket = connect({ host: '127.0.0.1', port }, () => socket.write('CONNECT example.invalid:443 HTTP/1.1\r\nHost: example.invalid:443\r\n\r\n'));
  socket.setTimeout(3000, () => { socket.destroy(); fail(new Error('CONNECT response timed out')); });
  socket.on('data', (chunk) => {
    try { assert.match(chunk.toString(), /^HTTP\/1\.1 403 /); socket.resetAndDestroy(); done(); }
    catch (error) { socket.destroy(); fail(error); }
  });
  socket.on('error', fail);
});

test('denied CONNECT clients can reset connections without crashing the proxy', async () => {
  const proxy = await denyProxy(), { port } = new URL(proxy.url);
  try {
    // This exact reset stress aborts the previous proxy with unhandled ECONNRESET.
    for (let round = 0; round < 10; round++) await Promise.all(Array.from({ length: 20 }, () => resetConnect(+port)));
    await new Promise((done) => setTimeout(done, 100));
    const status = await new Promise((done, fail) => {
      const request = get(proxy.url, (response) => { response.resume(); response.on('end', () => done(response.statusCode)); });
      request.on('error', fail);
    });
    assert.equal(status, 403); assert.equal(proxy.count, 201);
  } finally { await proxy.close(); }
});

test('HTTP, CONNECT and upgrade denial never reaches the requested destination', async () => {
  let hits = 0;
  const destination = createServer((_req, res) => { hits++; res.end('must not be reached'); });
  await new Promise((done) => destination.listen(0, '127.0.0.1', done));
  const proxy = await denyProxy(), proxyPort = +new URL(proxy.url).port, targetPort = destination.address().port;
  try {
    const status = await new Promise((done, fail) => {
      const request = get({ hostname: '127.0.0.1', port: proxyPort, path: `http://127.0.0.1:${targetPort}/private` }, (response) => { response.resume(); response.on('end', () => done(response.statusCode)); });
      request.on('error', fail);
    });
    assert.equal(status, 403);
    for (const text of [
      `CONNECT 127.0.0.1:${targetPort} HTTP/1.1\r\nHost: 127.0.0.1:${targetPort}\r\n\r\n`,
      `GET http://127.0.0.1:${targetPort}/socket HTTP/1.1\r\nHost: 127.0.0.1:${targetPort}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
    ]) await new Promise((done, fail) => {
      const socket = connect({ host: '127.0.0.1', port: proxyPort }, () => socket.write(text));
      socket.setTimeout(3000, () => { socket.destroy(); fail(new Error('denial did not close')); });
      socket.on('error', () => {}); socket.resume(); socket.on('close', done);
    });
    assert.equal(proxy.count, 3); assert.equal(hits, 0);
  } finally { await proxy.close(); destination.closeAllConnections(); await new Promise((done) => destination.close(done)); }
});

test('proxy cleanup closes retained CONNECT sockets and is idempotent', async () => {
  const proxy = await denyProxy(), port = +new URL(proxy.url).port;
  const socket = connect({ host: '127.0.0.1', port, allowHalfOpen: true }, () => socket.write('CONNECT example.invalid:443 HTTP/1.1\r\nHost: example.invalid:443\r\n\r\n'));
  socket.on('error', () => {});
  try {
    await new Promise((done, fail) => { socket.once('data', done); socket.setTimeout(3000, () => fail(new Error('CONNECT timeout'))); });
    await proxy.close(); await proxy.close();
    await assert.rejects(new Promise((done, fail) => {
      const client = connect({ host: '127.0.0.1', port });
      client.on('connect', () => { client.destroy(); done(); }); client.on('error', fail);
    }), { code: 'ECONNREFUSED' });
  } finally { socket.destroy(); await proxy.close(); }
});
