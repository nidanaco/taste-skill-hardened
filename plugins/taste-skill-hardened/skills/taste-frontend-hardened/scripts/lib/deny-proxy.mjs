import { createServer } from 'node:http';

// This proxy never opens an upstream socket. CONNECT/upgrade sockets outlive
// HTTP's parser, so keep their error handlers and ownership until they close.
export async function denyProxy() {
  let count = 0, closing;
  const sockets = new Set();
  const server = createServer((_req, res) => { count++; res.writeHead(403); res.end(); });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('error', () => socket.destroy());
    socket.once('close', () => sockets.delete(socket));
  });
  server.on('clientError', (_error, socket) => socket.destroy());
  server.on('connect', (_req, socket) => { count++; socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); });
  server.on('upgrade', (_req, socket) => { count++; socket.destroy(); });
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  return {
    url: 'http://127.0.0.1:' + server.address().port,
    get count() { return count; },
    close() {
      if (!closing) closing = new Promise((done) => {
        server.close(done);
        // closeAllConnections does not include upgraded/CONNECT sockets.
        for (const socket of sockets) socket.destroy();
      });
      return closing;
    },
  };
}
