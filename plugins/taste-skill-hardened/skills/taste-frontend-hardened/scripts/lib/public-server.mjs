// A bounded, immutable snapshot of an explicitly selected public directory.
// Requests never read the filesystem. Hidden paths, symlinks and non-web files
// are omitted before any page code runs.
import { constants, closeSync, fstatSync, lstatSync, openSync, readdirSync, realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const TYPES = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
}));
const DENIED = new Set(['node_modules', 'vendor', 'coverage', 'private', 'secrets']);
const inside = (root, file) => { const p = relative(root, file); return !isAbsolute(p) && p !== '..' && !p.startsWith('..' + sep); };
const safeSegments = (p) => p.split('/').every((s) => !s.startsWith('.') && !DENIED.has(s.toLowerCase()) && !/[\\\u0000-\u001f\u007f]/.test(s));

export function snapshotPublic(root, { maxFileBytes = 5 * 1024 * 1024, maxTotalBytes = 32 * 1024 * 1024, maxFiles = 1000 } = {}) {
  root = realpathSync(resolve(root));
  if (!lstatSync(root).isDirectory()) throw new Error('public root must be a directory');
  const files = new Map(); let bytes = 0; let visited = 0;
  const walk = (dir, depth = 0) => {
    if (depth > 20) throw new Error('public directory nesting exceeds 20 levels');
    for (const name of readdirSync(dir)) {
      if (++visited > maxFiles * 4) throw new Error('public directory has too many entries');
      const p = join(dir, name), key = relative(root, p).split(sep).join('/');
      if (!safeSegments(key)) continue;
      const st = lstatSync(p);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) { walk(p, depth + 1); continue; }
      if (!st.isFile() || !TYPES.has(extname(name).toLowerCase())) continue;
      const actual = realpathSync(p);
      if (!inside(root, actual)) throw new Error('public path escaped its root');
      if (st.size > maxFileBytes || bytes + st.size > maxTotalBytes || files.size >= maxFiles) throw new Error('public snapshot size limit exceeded');
      const fd = openSync(actual, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      try {
        const current = fstatSync(fd);
        if (!current.isFile() || current.dev !== st.dev || current.ino !== st.ino || current.size !== st.size) throw new Error('public file changed during snapshot');
        // A fixed-size read cannot allocate an unbounded buffer if the file grows.
        const body = Buffer.alloc(st.size);
        // readFileSync(fd) would follow a growing file to EOF; use bounded reads.
        const n = readFileBounded(fd, body);
        if (n !== st.size || fstatSync(fd).size !== st.size) throw new Error('public file changed during snapshot');
        bytes += body.length;
        files.set('/' + key, { body, type: TYPES.get(extname(name).toLowerCase()) });
      } finally { closeSync(fd); }
    }
  };
  walk(root);
  return { root, files, bytes };
}

// Kept separate to make all read limits explicit.
import { readSync } from 'node:fs';
function readFileBounded(fd, body) {
  let offset = 0;
  while (offset < body.length) { const n = readSync(fd, body, offset, body.length - offset, offset); if (!n) break; offset += n; }
  return offset;
}

export async function servePublic({ root, entry, ...limits }) {
  const snapshot = snapshotPublic(root, limits);
  const requested = resolve(entry);
  // Preserve the caller's path spelling as well as its canonical root (macOS
  // commonly exposes /var as an alias of /private/var). Resolve only against
  // snapshot keys; following an entry symlink here would defeat its exclusion.
  const sourceRoot = inside(resolve(root), requested) ? resolve(root) : snapshot.root;
  if (!inside(sourceRoot, requested)) throw new Error('entry must be inside the explicit public root');
  const key = '/' + relative(sourceRoot, requested).split(sep).join('/');
  if (!snapshot.files.has(key)) throw new Error('entry is hidden, linked, unsupported, or absent from the public snapshot');
  let authority;
  const server = createServer((req, res) => {
    const end = (status) => { res.writeHead(status); res.end(); };
    if (req.headers.host !== authority || req.headers['sec-fetch-site'] === 'cross-site') return end(403);
    if (!['GET', 'HEAD'].includes(req.method)) return end(405);
    let path;
    try {
      if (!req.url.startsWith('/') || req.url.startsWith('//')) return end(400);
      path = decodeURIComponent(req.url.split('?')[0]);
    } catch { return end(400); }
    if (!safeSegments(path)) return end(404);
    if (path.endsWith('/')) path += 'index.html';
    const file = snapshot.files.get(path) || snapshot.files.get(path + '/index.html');
    if (!file) return end(404);
    res.writeHead(200, {
      'content-type': file.type, 'content-length': file.body.length, 'cache-control': 'no-store',
      'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'; frame-ancestors 'none'",
    });
    res.end(req.method === 'HEAD' ? undefined : file.body);
  });
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  authority = '127.0.0.1:' + server.address().port;
  return { url: 'http://' + authority + key.split('/').map(encodeURIComponent).join('/'),
    close: () => new Promise((done) => { server.closeAllConnections(); server.close(done); }), fileCount: snapshot.files.size };
}
