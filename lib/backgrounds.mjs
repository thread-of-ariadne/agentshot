// Photo and painting backgrounds: `agentshot backgrounds search` finds candidates on Unsplash
// (needs the user's free access key) and in the open-access collections of The Met, the Art
// Institute of Chicago and the Cleveland Museum of Art (public domain, no key). A recipe names
// one as "unsplash:<id>", "met:<id>", "artic:<id>" or "cleveland:<id>"; the first render
// downloads it once into public/backgrounds/<source>/ with its credit, later renders are offline.
import fs from 'node:fs';
import path from 'node:path';
import { os } from './platform/index.mjs';
import { ROOT, ffmpeg, readJson, writeJson } from './util.mjs';

const DIR = path.join(ROOT, 'public', 'backgrounds');
const THUMBS = path.join(ROOT, '.cache', 'backgrounds');
const REF = /^(unsplash|met|artic|cleveland):([\w-]+)$/;
// the Art Institute's image server turns away requests without its own AIC-User-Agent header
const HEADERS = {
  'User-Agent': 'agentshot (+https://github.com/thread-of-ariadne/agentshot)',
  'AIC-User-Agent': 'agentshot (https://github.com/thread-of-ariadne/agentshot)',
};
const FONT = os.labelFont ? `fontfile='${os.labelFont}':` : '';
const UTM ='utm_source=agentshot&utm_medium=referral';
const KEY_HELP =
  'Unsplash needs a free access key: create an app at https://unsplash.com/oauth/applications ' +
  'and set AGENTSHOT_UNSPLASH_KEY to its Access Key (Windows: setx AGENTSHOT_UNSPLASH_KEY <key>, then open a new terminal)';

async function get(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { ...HEADERS, ...opts.headers } });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status} for ${url.split('?')[0]}`);
  return res;
}
const json = async (url, opts) => (await get(url, opts)).json();

function unsplashKey() {
  const key = process.env.AGENTSHOT_UNSPLASH_KEY;
  if (!key) throw new Error(KEY_HELP);
  return { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' };
}

// Same order as the sources, so a mixed search shows every collection near the top.
const interleave = (lists) => {
  const out = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
};

const orientationOf = (w, h) => (!w || !h ? null : w / h > 1.15 ? 'landscape' : h / w > 1.15 ? 'portrait' : 'squarish');

// Each source: search(query, { count, orientation }) -> candidates with a thumbnail URL, and
// fetch(id) -> { image (URL of the full-size file), credit } for the one the recipe uses.
const SOURCES = {
  unsplash: {
    async search(q, { count, orientation }) {
      const params = new URLSearchParams({ query: q, per_page: String(Math.min(30, count)), content_filter: 'high' });
      if (orientation) params.set('orientation', orientation);
      const j = await json(`https://api.unsplash.com/search/photos?${params}`, { headers: unsplashKey() });
      // Unsplash+ photos are not covered by the free licence
      return j.results
        .filter((p) => !p.premium && !p.plus)
        .map((p) => ({
          id: p.id,
          title: p.description ?? p.alt_description ?? '',
          width: p.width,
          height: p.height,
          thumb: p.urls.small,
          credit: unsplashCredit(p),
        }));
    },
    async fetch(id) {
      const headers = unsplashKey();
      const p = await json(`https://api.unsplash.com/photos/${id}`, { headers });
      // the API guidelines ask to report every use of a photo to this endpoint
      await get(p.links.download_location, { headers });
      // longest side 4096 px: covers a 4K canvas without a 40 MB original
      return { image: `${p.urls.raw}&fm=jpg&q=88&fit=max&w=4096&h=4096`, width: p.width, height: p.height, credit: unsplashCredit(p) };
    },
  },
  met: {
    async search(q, { count }) {
      const ids = await Promise.all(
        ['Paintings', 'Prints'].map(async (medium) => {
          const params = new URLSearchParams({ q, hasImages: 'true', isPublicDomain: 'true', medium, limit: String(count) });
          return (await json(`https://collectionapi.metmuseum.org/public/collection/v1.1/search?${params}`)).objectIDs ?? [];
        }),
      );
      const objects = await Promise.all(interleave(ids).slice(0, count).map((id) => metObject(id).catch(() => null)));
      return objects
        .filter((o) => o?.isPublicDomain && o.primaryImageSmall)
        .map((o) => ({ id: String(o.objectID), title: o.title, thumb: o.primaryImageSmall, credit: museumCredit(o.title, o.artistDisplayName, 'The Metropolitan Museum of Art', o.objectURL) }));
    },
    async fetch(id) {
      const o = await metObject(id);
      if (!o.isPublicDomain || !o.primaryImage) throw new Error(`met:${id} has no public-domain image`);
      return { image: o.primaryImage, credit: museumCredit(o.title, o.artistDisplayName, 'The Metropolitan Museum of Art', o.objectURL) };
    },
  },
  artic: {
    async search(q, { count }) {
      const j = await json('https://api.artic.edu/api/v1/artworks/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q,
          query: {
            bool: {
              filter: [
                { term: { is_public_domain: true } },
                { exists: { field: 'image_id' } },
                { terms: { 'artwork_type_title.keyword': ['Painting', 'Print', 'Drawing and Watercolor'] } },
              ],
            },
          },
          fields: ['id', 'title', 'artist_title', 'image_id', 'thumbnail'],
          limit: count,
        }),
      });
      return j.data.map((a) => ({
        id: String(a.id),
        title: a.title,
        width: a.thumbnail?.width,
        height: a.thumbnail?.height,
        thumb: articImage(a.image_id, 400),
        credit: museumCredit(a.title, a.artist_title, 'Art Institute of Chicago', `https://www.artic.edu/artworks/${a.id}`),
      }));
    },
    async fetch(id) {
      const { data: a } = await json(`https://api.artic.edu/api/v1/artworks/${id}?fields=id,title,artist_title,image_id,is_public_domain`);
      if (!a.is_public_domain || !a.image_id) throw new Error(`artic:${id} has no public-domain image`);
      // 3000 px is the largest size the public image server gives
      return { image: articImage(a.image_id, 3000), credit: museumCredit(a.title, a.artist_title, 'Art Institute of Chicago', `https://www.artic.edu/artworks/${a.id}`) };
    },
  },
  cleveland: {
    async search(q, { count }) {
      const lists = await Promise.all(
        ['Painting', 'Print'].map(async (type) => {
          const params = new URLSearchParams({ q, cc0: '1', has_image: '1', type, limit: String(count) });
          return (await json(`https://openaccess-api.clevelandart.org/api/artworks/?${params}`)).data;
        }),
      );
      return interleave(lists)
        .slice(0, count)
        .map((a) => ({
          id: String(a.id),
          title: a.title,
          width: Number(a.images.print?.width) || undefined,
          height: Number(a.images.print?.height) || undefined,
          thumb: a.images.web.url,
          credit: museumCredit(a.title, a.creators?.[0]?.description?.replace(/\s*\(.*$/, ''), 'Cleveland Museum of Art', a.url),
        }));
    },
    async fetch(id) {
      const { data: a } = await json(`https://openaccess-api.clevelandart.org/api/artworks/${id}`);
      if (a.share_license_status !== 'CC0' || !a.images?.print) throw new Error(`cleveland:${id} has no CC0 image`);
      return {
        image: a.images.print.url,
        credit: museumCredit(a.title, a.creators?.[0]?.description?.replace(/\s*\(.*$/, ''), 'Cleveland Museum of Art', a.url),
      };
    },
  },
};
const ART = ['met', 'artic', 'cleveland'];

function unsplashCredit(p) {
  return {
    text: `Photo by ${p.user.name} on Unsplash`,
    author: p.user.name,
    authorUrl: `${p.user.links.html}?${UTM}`,
    source: 'Unsplash',
    sourceUrl: `https://unsplash.com/?${UTM}`,
    page: `${p.links.html}?${UTM}`,
  };
}

const museumCredit = (title, artist, museum, page) => ({
  text: `${title}${artist ? ` by ${artist}` : ''}, ${museum} (public domain)`,
  ...(artist ? { author: artist } : {}),
  source: museum,
  page,
});

const metObject = (id) => json(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`);
const articImage = (imageId, px) => `https://www.artic.edu/iiif/2/${imageId}/full/!${px},${px}/0/default.jpg`;

function sourcesFor(source) {
  const s = source ?? (process.env.AGENTSHOT_UNSPLASH_KEY ? 'unsplash' : 'art');
  if (s === 'art') return ART;
  if (s === 'all') return ['unsplash', ...ART];
  if (SOURCES[s]) return [s];
  throw new Error(`unknown source "${s}". Use unsplash, met, artic, cleveland, art (all three museums) or all`);
}

// `agentshot backgrounds search`: candidates plus a numbered contact sheet to look at.
export async function search(query, opt = {}) {
  if (!query) throw new Error('usage: agentshot backgrounds search "<what the place looks like>" [--source unsplash|met|artic|cleveland|art|all]');
  const count = Math.max(1, Math.min(30, Number(opt.count) || 12));
  const orientation = opt.orientation;
  if (orientation && !['landscape', 'portrait', 'squarish'].includes(orientation)) {
    throw new Error(`unknown orientation "${orientation}". Use landscape, portrait or squarish`);
  }
  const names = sourcesFor(opt.source);
  const per = Math.ceil(count / names.length);
  const lists = await Promise.all(
    names.map(async (s) => (await SOURCES[s].search(query, { count: per, orientation })).map((r) => ({ ...r, background: `${s}:${r.id}` }))),
  );
  // museums cannot filter by shape server-side; drop known mismatches
  const results = interleave(lists)
    .filter((r) => !orientation || !r.width || orientationOf(r.width, r.height) === orientation)
    .slice(0, count)
    .map((r, i) => ({ n: i + 1, background: r.background, title: r.title, ...(r.width ? { size: [r.width, r.height] } : {}), credit: r.credit.text, thumb: r.thumb }));
  const sheet = results.length ? await contactSheet(results, query) : null;
  return {
    query,
    sources: names,
    results: results.map(({ thumb, ...r }) => r),
    sheet,
    ...(!process.env.AGENTSHOT_UNSPLASH_KEY && !opt.source ? { hint: `searched museum paintings only. ${KEY_HELP}` } : {}),
  };
}

async function contactSheet(results, query) {
  const dir = path.join(THUMBS, 'search');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  await Promise.all(
    results.map(async (r) => {
      const file = path.join(dir, `raw-${r.n}`);
      fs.writeFileSync(file, Buffer.from(await (await get(r.thumb)).arrayBuffer()));
    }),
  );
  // every tile 360x240 with its number, so "pick 3" maps to results[2]
  for (const r of results) {
    ffmpeg([
      '-i', path.join(dir, `raw-${r.n}`),
      '-vf', `scale=360:240:force_original_aspect_ratio=decrease,pad=360:240:(ow-iw)/2:(oh-ih)/2:color=0x202020,drawtext=${FONT}text='${r.n}':x=6:y=6:fontsize=26:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=5`,
      '-frames:v', '1', path.join(dir, `tile-${String(r.n).padStart(2, '0')}.png`),
    ]);
  }
  const cols = Math.min(4, results.length);
  const out = path.join(THUMBS, `search-${query.replace(/[^\w]+/g, '-').slice(0, 40)}.png`);
  ffmpeg(['-framerate', '1', '-start_number', '1', '-i', path.join(dir, 'tile-%02d.png'), '-vf', `tile=${cols}x${Math.ceil(results.length / cols)}:padding=4:color=0x202020`, '-frames:v', '1', out]);
  return out;
}

// "unsplash:<id>" -> backgrounds/unsplash/<id>.jpg under public/, downloaded on first use.
// Anything else (presets, CSS, own files) passes through unchanged.
export async function resolveBackground(background, { log } = {}) {
  const m = REF.exec(background ?? '');
  if (!m) {
    if (/^[a-z]{3,}:[\w-]+$/i.test(background ?? '')) {
      throw new Error(`unknown background source "${background}". Use unsplash:<id>, met:<id>, artic:<id> or cleveland:<id> from agentshot backgrounds search`);
    }
    return { background };
  }
  const [, source, id] = m;
  const rel = `backgrounds/${source}/${id}.jpg`;
  const file = path.join(DIR, source, `${id}.jpg`);
  const meta = path.join(DIR, source, `${id}.json`);
  if (!fs.existsSync(file) || !fs.existsSync(meta)) {
    log?.(`downloading background ${source}:${id}`);
    const got = await SOURCES[source].fetch(id);
    const res = await get(got.image);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    writeJson(meta, { background: `${source}:${id}`, credit: got.credit, image: got.image.split('?')[0], downloadedAt: new Date().toISOString() });
  }
  return { background: rel, credit: readJson(meta).credit };
}
