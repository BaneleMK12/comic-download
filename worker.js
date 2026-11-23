// worker.js
import { getAssetFromKV } from '@cloudflare/kv-asset-handler';

// Helper to add CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400'
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Handle preflight OPTIONS request (Crucial for CORS)
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // If the request is for the API endpoint
    if (url.pathname === '/scrape' && request.method === 'POST') {
      let requestData;
      try {
        requestData = await request.json();
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      const { url: targetUrl } = requestData;
      
      if (!targetUrl) {
        return new Response(JSON.stringify({ error: 'No URL provided in request body' }), { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      try
