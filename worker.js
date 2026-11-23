const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';

// Supported sites. A URL is allowed if its host is one of these or a subdomain of one
// (e.g. storage.vortexscans.org). To support another site, add its domain here.
const ALLOWED_SITES = ['vortexscans.org', 'asurascans.com', 'asuracomic.net'];

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });

function siteOf(u) {
  try {
    const h = new URL(u).hostname;
    return ALLOWED_SITES.find(d => h === d || h.endsWith('.' + d)) || null;
  } catch {
    return null;
  }
}

const isAllowedHost = u => !!siteOf(u);

// "asurascans.com/comics/..." (no https://) -> "https://asurascans.com/comics/..."
function normalizeUrl(u) {
  u = String(u || '').trim();
  if (!u) return '';
  return /^https?:\/\//i.test(u) ? u : 'https://' + u.replace(/^\/+/, '');
}

// Image hosts often check the Referer, so send the main site's address
const refererFor = u => (siteOf(u) ? `https://${siteOf(u)}/` : 'https://vortexscans.org/');

const pageHeaders = referer => ({
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': referer
});

function parsePage(html, seriesUrl) {
  html = html.replace(/\\u002F|\\\//g, '/');

  const t =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) ||
    html.match(/<title>([^<]+)/i);
  const title = (t ? t[1] : 'Unknown title')
    .replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&')
    .split(/\s[-|–]\s/)[0].replace(/\s*chapter\s*\d+.*$/i, '').trim();

  const prefix = seriesUrl.replace(/\/$/, '');
  const seen = new Map();
  for (const m of html.matchAll(/href=["']([^"']*chapter[^"']*)["']/gi)) {
    let abs;
    try { abs = new URL(m[1], seriesUrl).href; } catch { continue; }
    const n = abs.match(/chapter[\/-]?(\d+(?:[.-]\d+)?)/i);
    if (!n) continue;
    const num = parseFloat(n[1].replace('-', '.'));
    if (!seen.has(num)) seen.set(num, abs);
  }

  // Fallback for sites that keep chapter links in embedded JSON instead of <a href>:
  // look for "<series path>/chapter/<n>" anywhere in the page.
  if (!seen.size) {
    try {
      const path = new URL(seriesUrl).pathname.replace(/\/$/, '');
      const re = new RegExp(
        path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/chapter[\\/-]?(\\d+(?:[.-]\\d+)?)',
        'gi'
      );
      for (const m of html.matchAll(re)) {
        const num = parseFloat(m[1].replace('-', '.'));
        if (!seen.has(num)) seen.set(num, new URL(m[0], seriesUrl).href);
      }
    } catch { /* ignore */ }
  }

  let chapters = [...seen.entries()].map(([num, url]) => ({ num, url }));
  const sameSeries = chapters.filter(c => c.url.startsWith(prefix));
  if (sameSeries.length) chapters = sameSeries;

  // Fill gaps: copy the URL format of a real link and fill missing numbers
  const text = html.replace(/<[^>]+>/g, ' ');
  const declared = text.match(/Chapters\s*\(\s*(\d+)\s*\)/i);
  const maxFound = chapters.length ? Math.max(...chapters.map(c => c.num)) : 0;
  const total = Math.max(maxFound, declared ? parseInt(declared[1], 10) : 0);

  const sample = chapters.find(c => Number.isInteger(c.num));
  if (sample && total > 0 && total <= 3000) {
    const tpl = sample.url.replace(
      new RegExp(`(chapter[\\/-]?)${sample.num}(?!\\d)`, 'i'),
      '$1{N}'
    );
    if (tpl.includes('{N}')) {
      const have = new Set(chapters.map(c => c.num));
      for (let n = 1; n <= total; n++) {
        if (!have.has(n)) chapters.push({ num: n, url: tpl.replace('{N}', n) });
      }
    }
  }

  chapters.sort((a, b) => a.num - b.num);
  return {
    title,
    chapters: chapters.map(c => ({ title: `Chapter ${c.num}`, url: c.url }))
  };
}

// Pull the page images out of a chapter page (works for plain <img> tags, lazy-load
// attributes and image URLs inside embedded JSON). The chapter's pages share one folder,
// so we keep the folder with the most images and drop covers, logos, thumbnails, etc.
function parseImages(html, pageUrl) {
  html = html
    .replace(/\\u002F|\\\//g, '/')
    .replace(/&amp;/g, '&');

  const IMG_EXT = /\.(?:jpe?g|png|webp|avif)(?:$|\?)/i;
  const SKIP = /featured|cover|thumb|logo|avatar|icon|banner|sprite|favicon|emoji|placeholder|loading|\/ads?\//i;

  // Collect candidates in page order
  const candidates = [];
  const attr = /(?:src|data-src|data-lazy-src|data-original)\s*=\s*["']([^"']+)["']/gi;
  const abs = /(?:https?:)?\/\/[^\s"'<>)\\]+?\.(?:jpe?g|png|webp|avif)(?:\?[^\s"'<>)\\]*)?/gi;
  for (const re of [attr, abs]) {
    for (const m of html.matchAll(re)) {
      candidates.push({ raw: m[1] || m[0], at: m.index });
    }
  }
  candidates.sort((a, b) => a.at - b.at);

  const found = [];
  const seen = new Set();
  for (const c of candidates) {
    let u;
    try { u = new URL(c.raw.trim(), pageUrl).href; } catch { continue; }
    if (!/^https?:/i.test(u) || !IMG_EXT.test(u) || SKIP.test(u) || seen.has(u)) continue;
    seen.add(u);
    found.push(u);
  }

  const folderOf = u => u.split('?')[0].replace(/\/[^\/]*$/, '');
  const counts = new Map();
  for (const u of found) counts.set(folderOf(u), (counts.get(folderOf(u)) || 0) + 1);
  let best = '', bestN = 0;
  for (const [f, n] of counts) if (n > bestN) { best = f; bestN = n; }

  const pages = found.filter(u => folderOf(u) === best);

  // Sort by page number in the filename (01.jpg, 002.webp, ...) when every page has one;
  // otherwise keep the order they appear in the page.
  const numOf = u => {
    const m = u.split('?')[0].match(/(\d+)\.[a-z0-9]+$/i);
    return m ? parseInt(m[1], 10) : null;
  };
  if (pages.every(u => numOf(u) !== null)) pages.sort((a, b) => numOf(a) - numOf(b));
  return pages;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // ---- /scrape: list chapters for a series ----
    if (url.pathname === '/scrape' && request.method === 'POST') {
      let body;
      try { body = await request.json(); }
      catch { return json({ error: 'Invalid JSON' }, 400); }

      const targetUrl = normalizeUrl(body.url);
      if (!targetUrl) return json({ error: 'Missing URL' }, 400);
      if (!isAllowedHost(targetUrl)) {
        return json({ error: `Unsupported site. Supported: ${ALLOWED_SITES.join(', ')}` }, 400);
      }

      const seriesUrl = targetUrl.split(/\/chapter/i)[0];

      try {
        const res = await fetch(seriesUrl, { headers: pageHeaders(refererFor(seriesUrl)) });
        if (!res.ok) throw new Error(`Target site returned status: ${res.status}`);

        const { title, chapters } = parsePage(await res.text(), seriesUrl);
        if (!chapters.length) {
          return json({ error: 'No chapter links found in the page HTML.' }, 404);
        }
        return json({ success: true, title, chapters });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    // ---- /images: list the page images for one chapter ----
    if (url.pathname === '/images' && request.method === 'POST') {
      let body;
      try { body = await request.json(); }
      catch { return json({ error: 'Invalid JSON' }, 400); }

      const chapterUrl = normalizeUrl(body.url);
      if (!chapterUrl) return json({ error: 'Missing URL' }, 400);
      if (!isAllowedHost(chapterUrl)) return json({ error: 'URL not allowed' }, 400);

      try {
        const res = await fetch(chapterUrl, { headers: pageHeaders(refererFor(chapterUrl)) });
        if (!res.ok) throw new Error(`Chapter page returned status: ${res.status}`);

        const images = parseImages(await res.text(), chapterUrl);
        if (!images.length) {
          return json({ error: 'No page images found (chapter may be locked or not released).' }, 404);
        }
        // Make sure /img will accept every image host we're about to hand out
        const blocked = images.find(u => !isAllowedHost(u));
        if (blocked) {
          return json({ error: `Images are hosted on a domain that isn't allowed yet: ${new URL(blocked).hostname}` }, 502);
        }
        return json({ success: true, images });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    // ---- /img?u=...: fetch one image server-side and pass it through ----
    if (url.pathname === '/img' && request.method === 'GET') {
      const target = url.searchParams.get('u');
      if (!target) return json({ error: 'Missing u parameter' }, 400);
      if (!isAllowedHost(target)) return json({ error: 'URL not allowed' }, 400);

      try {
        const res = await fetch(target, {
          headers: {
            'User-Agent': UA,
            'Referer': refererFor(target),
            'Accept': 'image/avif,image/webp,image/*,*/*;q=0.8'
          }
        });
        if (!res.ok) return json({ error: `Image returned status: ${res.status}` }, res.status);

        return new Response(res.body, {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream',
            'Cache-Control': 'public, max-age=86400'
          }
        });
      } catch (e) {
        return json({ error: e.message }, 502);
      }
    }

    return new Response('Worker is running', { status: 200, headers: corsHeaders });
  }
};
