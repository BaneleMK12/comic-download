const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });

// Only allow requests to vortexscans.org and its subdomains (keeps this from being an open proxy)
function isAllowedHost(u) {
  try {
    const h = new URL(u).hostname;
    return h === 'vortexscans.org' || h.endsWith('.vortexscans.org');
  } catch {
    return false;
  }
}

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

// Pull the page images out of a chapter page.
// Pages look like: https://storage.vortexscans.org//upload/series/<slug>/<id>/01.jpg
function parseImages(html) {
  html = html
    .replace(/\\u002F|\\\//g, '/')
    .replace(/&amp;/g, '&');

  const re = /https?:\/\/[^\s"'<>)\\]+\/upload\/series\/[^\s"'<>)\\]+?\.(?:jpe?g|png|webp|avif)(?=["'<>)\s\\?]|$)/gi;
  const found = [];
  const seen = new Set();
  for (const m of html.matchAll(re)) {
    const u = m[0];
    if (/\/featured\//i.test(u)) continue; // series cover / thumbnails
    if (seen.has(u)) continue;
    seen.add(u);
    found.push(u);
  }

  // The chapter's pages share one folder; keep only the most common folder
  // so stray images (recommendations etc.) are dropped.
  const folderOf = u => u.slice(0, u.lastIndexOf('/'));
  const counts = new Map();
  for (const u of found) counts.set(folderOf(u), (counts.get(folderOf(u)) || 0) + 1);
  let best = '', bestN = 0;
  for (const [f, n] of counts) if (n > bestN) { best = f; bestN = n; }

  const pages = found.filter(u => folderOf(u) === best);

  // Sort by the page number in the filename (01.jpg, 02.jpg, ...)
  const num = u => parseInt((u.match(/(\d+)\.[a-z0-9]+$/i) || [, '0'])[1], 10);
  pages.sort((a, b) => num(a) - num(b));
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

      const targetUrl = body.url;
      if (!targetUrl) return json({ error: 'Missing URL' }, 400);

      const seriesUrl = targetUrl.split(/\/chapter/i)[0];

      try {
        const res = await fetch(seriesUrl, { headers: { 'User-Agent': UA } });
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

      const chapterUrl = body.url;
      if (!chapterUrl) return json({ error: 'Missing URL' }, 400);
      if (!isAllowedHost(chapterUrl)) return json({ error: 'URL not allowed' }, 400);

      try {
        const res = await fetch(chapterUrl, {
          headers: { 'User-Agent': UA, 'Referer': 'https://vortexscans.org/' }
        });
        if (!res.ok) throw new Error(`Chapter page returned status: ${res.status}`);

        const images = parseImages(await res.text());
        if (!images.length) {
          return json({ error: 'No page images found (chapter may be locked or not released).' }, 404);
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
            'Referer': 'https://vortexscans.org/',
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
  
