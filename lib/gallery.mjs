// Builds library/index.html: products, their assets (latest version first) and a
// Time Machine strip of every version with its note. Static, opens from disk.
import fs from 'node:fs';
import path from 'node:path';
import { LIBRARY, readJson } from './util.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function collect() {
  if (!fs.existsSync(LIBRARY)) return [];
  return fs
    .readdirSync(LIBRARY)
    .filter((p) => fs.statSync(path.join(LIBRARY, p)).isDirectory())
    .map((product) => {
      const pdir = path.join(LIBRARY, product);
      const style = fs.existsSync(path.join(pdir, 'style.json')) ? readJson(path.join(pdir, 'style.json')) : {};
      const assets = fs
        .readdirSync(pdir)
        .filter((a) => fs.statSync(path.join(pdir, a)).isDirectory())
        .map((asset) => {
          const versions = fs
            .readdirSync(path.join(pdir, asset))
            .filter((f) => /^v\d+\.json$/.test(f))
            .sort()
            .map((f) => readJson(path.join(pdir, asset, f)))
            .reverse();
          return { asset, versions };
        })
        .filter((a) => a.versions.length)
        .sort((a, b) => (b.versions[0].createdAt > a.versions[0].createdAt ? 1 : -1));
      return { product, title: style.product ?? product, assets };
    })
    .filter((p) => p.assets.length);
}

const media = (src, cls = '') =>
  /\.mp4$/.test(src)
    ? `<video class="${cls}" src="${esc(src)}" muted loop playsinline preload="metadata" onmouseenter="this.play()" onmouseleave="this.pause()"></video>`
    : `<img class="${cls}" src="${esc(src)}" loading="lazy" alt="">`;

// "Photo by <author> on <source>" with both linked, as the Unsplash API guidelines ask;
// museum paintings link the artwork page.
const link = (text, href) => (href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text)}</a>` : esc(text));
function credit(c) {
  if (c.authorUrl) return `Photo by ${link(c.author, c.authorUrl)} on ${link(c.source, c.sourceUrl)}`;
  return link(c.text, c.page);
}

export function buildGallery() {
  const products = collect();
  const total = products.reduce((n, p) => n + p.assets.length, 0);
  const cards = products
    .map(
      (p) => `
  <section data-product="${esc(p.product)}">
    <h2>${esc(p.title)} <span>${p.assets.length}</span></h2>
    <div class="grid">
      ${p.assets
        .map((a) => {
          const v = a.versions[0];
          const rel = `${p.product}/${a.asset}/`;
          const kind = /\.mp4$/.test(v.output) ? 'video' : 'image';
          return `<article class="card" data-kind="${kind}" data-search="${esc(`${p.title} ${a.asset} ${a.versions.map((x) => x.note).join(' ')}`.toLowerCase())}">
        <div class="thumb">${media(rel + v.output)}</div>
        <div class="meta">
          <b>${esc(a.asset)}</b>
          <small>v${v.version} · ${esc(new Date(v.createdAt).toLocaleString('ru-RU'))} · ${esc(v.by)}</small>
          ${v.note ? `<p>${esc(v.note)}</p>` : ''}
          ${v.credit ? `<p class="credit">${credit(v.credit)}</p>` : ''}
        </div>
        <details>
          <summary>Time Machine · ${a.versions.length} ${a.versions.length === 1 ? 'version' : 'versions'}</summary>
          <div class="versions">
            ${a.versions
              .map(
                (x) => `<a href="${esc(rel + x.output)}" target="_blank" title="${esc(x.note)}">
              ${media(rel + x.output, 'mini')}
              <span>v${x.version}</span><em>${esc(x.note || '—')}</em>
              <code>agentshot restore ${esc(p.product)} ${esc(a.asset)} ${x.version}</code>
            </a>`,
              )
              .join('')}
          </div>
        </details>
      </article>`;
        })
        .join('')}
    </div>
  </section>`,
    )
    .join('');

  const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Shot Library</title>
<style>
  :root { --bg: #f6f4f1; --card: #fff; --ink: #1c1b1f; --muted: #8a8791; --line: #e7e4ea; --accent: #6d5ce8; }
  @media (prefers-color-scheme: dark) { :root { --bg: #151418; --card: #1f1e24; --ink: #f1eff4; --muted: #9a97a3; --line: #2d2b33; } }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.45 Inter, system-ui, sans-serif; background: var(--bg); color: var(--ink); }
  header { position: sticky; top: 0; z-index: 2; background: color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter: blur(12px); padding: 18px 28px; display: flex; gap: 16px; align-items: center; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  header h1 { margin: 0; font-size: 18px; }
  header .count { color: var(--muted); }
  input, select { font: inherit; padding: 8px 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--card); color: var(--ink); }
  input { flex: 1; min-width: 180px; max-width: 420px; }
  main { padding: 8px 28px 60px; }
  h2 { font-size: 15px; margin: 26px 0 12px; } h2 span { color: var(--muted); font-weight: 500; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
  .thumb { background: repeating-conic-gradient(var(--line) 0 25%, transparent 0 50%) 0 0 / 16px 16px; height: 220px; display: grid; place-items: center; overflow: hidden; }
  .thumb img, .thumb video { width: 100%; height: 100%; object-fit: contain; display: block; }
  .meta { padding: 10px 14px 4px; } .meta b { display: block; } .meta small { color: var(--muted); } .meta p { margin: 6px 0 0; }
  .meta .credit { color: var(--muted); font-size: 12px; } .credit a { color: inherit; }
  details { padding: 4px 14px 12px; } summary { cursor: pointer; color: var(--accent); font-weight: 600; font-size: 13px; }
  .versions { display: flex; gap: 10px; overflow-x: auto; padding-top: 10px; }
  .versions a { flex: none; width: 150px; color: inherit; text-decoration: none; font-size: 12px; }
  .versions .mini { width: 150px; height: 94px; object-fit: contain; background: var(--bg); border-radius: 8px; display: block; }
  .versions span { font-weight: 700; margin-right: 6px; } .versions em { color: var(--muted); font-style: normal; }
  .versions code { display: block; margin-top: 4px; font-size: 10.5px; color: var(--muted); word-break: break-all; }
  .empty { color: var(--muted); padding: 60px 0; text-align: center; }
  @media (max-width: 600px) { header, main { padding-left: 16px; padding-right: 16px; } }
</style>
</head>
<body>
<header>
  <h1>Shot Library</h1><span class="count">${total} assets</span>
  <input id="q" placeholder="Search names and notes…" aria-label="Search">
  <select id="kind" aria-label="Kind"><option value="">All</option><option value="image">Screenshots</option><option value="video">Recordings</option></select>
</header>
<main>${products.length ? cards : '<p class="empty">Nothing rendered yet. Run <code>agentshot render recipe.json</code>.</p>'}</main>
<script>
  const q = document.getElementById('q'), kind = document.getElementById('kind');
  function filter() {
    const s = q.value.trim().toLowerCase(), k = kind.value;
    document.querySelectorAll('.card').forEach(c => {
      c.hidden = (s && !c.dataset.search.includes(s)) || (k && c.dataset.kind !== k);
    });
    document.querySelectorAll('section').forEach(sec => { sec.hidden = ![...sec.querySelectorAll('.card')].some(c => !c.hidden); });
  }
  q.oninput = filter; kind.onchange = filter;
</script>
</body>
</html>`;
  fs.mkdirSync(LIBRARY, { recursive: true });
  const file = path.join(LIBRARY, 'index.html');
  fs.writeFileSync(file, html);
  return file;
}
