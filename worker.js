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

      try {
        const res = await fetch(targetUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' }
        });
        if (!res.ok) throw new Error(`Target site returned status: ${res.status}`);
        await res.text(); // real parsing goes here later

        return json({
          success: true,
          title: "Reincarnator's Stream",
          chapters: [
            { title: 'Chapter 1', url: targetUrl },
            { title: 'Chapter 2', url: targetUrl.replace('/chapter/1', '/chapter/2') }
          ]
        });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    return new Response('Worker is running', { status: 200, headers: corsHeaders });
  }
};
