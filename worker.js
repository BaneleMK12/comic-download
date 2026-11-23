export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    if (url.pathname === '/scrape' && request.method === 'POST') {
      const { url: targetUrl } = await request.json();
      
      try {
        // Fetch the target page
        const response = await fetch(targetUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        const html = await response.text();

        // Simple parsing logic (Adjust selectors based on actual target site)
        // This is a generic example, you must inspect the specific site to get exact selectors
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        const title = doc.querySelector('h1')?.textContent || 'Unknown Manga';
        const chapters = [];
        
        // Example: Assuming chapters are in links with class 'chapter-link'
        const links = doc.querySelectorAll('a.chapter-link'); 
        links.forEach(link => {
          chapters.push({
            title: link.innerText.trim(),
            url: link.href
          });
        });

        return new Response(JSON.stringify({ 
          success: true, 
          title: title, 
          chapters: chapters 
        }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });

      } catch (e) {
        return new Response(JSON.stringify({ success: false, error: e.message }), {
