// Tiny static server for renders and previews: the bundled page at /, public/ (captures,
// backgrounds) at /public/ and pre-extracted video frames at /frames/.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

// mounts: { '/url/prefix/': 'dir' }, longest prefix wins. `routes` answers exact paths
// with a function (req, res, url) before files are looked up. Port 0 picks a free one.
export function serveDir(mounts, routes = {}, port = 0) {
  // normalised, so the traversal guard below compares like with like on Windows
  const table = Object.entries(mounts)
    .map(([prefix, dir]) => [prefix, path.resolve(dir)])
    .sort((a, b) => b[0].length - a[0].length);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const rel = decodeURIComponent(url.pathname);
    if (routes[rel]) return routes[rel](req, res, url);
    const hit = table.find(([prefix]) => rel.startsWith(prefix));
    if (!hit) return res.writeHead(404).end();
    const [prefix, dir] = hit;
    let file = path.join(dir, rel.slice(prefix.length));
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!file.startsWith(dir) || !fs.existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    const size = fs.statSync(file).size;
    const headers = {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'bytes',
    };
    // the page and its scripts change under `agentshot preview`; images keep the normal cache
    if (/\.(html|js|css|json|map)$/i.test(file)) headers['Cache-Control'] = 'no-cache';
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
    if (m) {
      const start = m[1] ? Number(m[1]) : 0;
      const end = m[2] ? Number(m[2]) : size - 1;
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { ...headers, 'Content-Length': size });
      fs.createReadStream(file).pipe(res);
    }
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ base: `http://127.0.0.1:${port}/`, close: () => server.close(), server });
    });
  });
}
