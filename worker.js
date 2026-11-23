// worker.js
import { getAssetFromKV } from '@cloudflare/kv-asset-handler';

// Define CORS headers to allow any origin
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400' // 24 hours cache for preflight
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. Handle the "Preflight" request (OPTIONS)
    // This is the check the browser does before sending the data
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // 2. Handle the API Scrape Endpoint
    if (url.pathname === '/scrape' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const { url: targetUrl } = body;

      if (!targetUrl) {
        return new Response(JSON.stringify({ error: 'Missing URL' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      try {
        // Fetch the target site
        const response = await fetch(targetUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });

        if (!response.ok) {
          throw new Error(`Target site returned status: ${response.status}`);
        }

        const html = await response.text();

        // MOCK PARSING LOGIC (Replace this with real parsing for AsuraScans)
        // For now, we return a dummy success to prove CORS works
        const mockData = {
          success: true,
          title: "Reincarnator's Stream",
          chapters: [
            { title: "Chapter 1", url: targetUrl },
            { title: "Chapter 2", url: targetUrl.replace('/chapter/1', '/chapter/2') }
          ]
        };

        // Return Success with CORS headers
        return new Response(JSON.stringify(mockData), {
          status: 200,
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json' 
          }
        });

      } catch (e) {
        // Return Error with CORS headers (Crucial!)
        console.error("Scrape Error:", e);
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json' 
          }
        });
      }
    }

    // 3. Serve Static Files (index.html) if not hitting /scrape
    return getAssetFromKV(request, {
      cacheControl: {
        browserTTL: 3600,
        edgeTTL: 3600 * 24 * 365,
      }
    });
  }
};
        
