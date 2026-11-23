const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
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

  let chapters = [...seen.entries()].map(([num, url]) => ({ num, url }));
  const sameSeries = chapters.filter(c => c.url.startsWith(prefix));
  if (sameSeries.length) chapters = sameSeries;

  // Many sites only put the newest chapters in the HTML.
  // If the links follow /chapter-N, fill in the full 1..total range.
  const declared = html.match(/Chapters\s*\(\s*(\d+)\s*\)/i);
  const maxFound = chapters.length ? Math.max(...chapters.map(c => c.num)) : 0;
  const total = Math.max(maxFound, declared ? parseInt(declared[1], 10) : 0);
  const followsPattern = chapters.every(c => c.url === `${prefix}/chapter-${c.num}`);
  if (followsPattern && total > 0 && total <= 3000) {
    chapters = Array.from({ length: total }, (_, i) => ({
      num: i + 1,
      url: `${prefix}/chapter-${i + 1}`
    }));
  }

  chapters.sort((a, b) => a.num - b.num);
  return {
    title,
    chapters: chapters.map(c => ({ title: `Chapter ${c.num}`, url: c.url }))
  };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (url.pathname === '/scrape' && request.method === 'POST') {
      let body;
      try { body = await request.json(); }
      catch { return json({ error: 'Invalid JSON' }, 400); }

      const targetUrl = body.url;
      if (!targetUrl) return json({ error: 'Missing URL' }, 400);

      // Always read the series page, even if a chapter link was pasted
      const seriesUrl = targetUrl.split(/\/chapter/i)[0];

      try {
        const res = await fetch(seriesUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' }
        });
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

    return new Response('Worker is running', { status: 200, headers: corsHeaders });
  }
};
