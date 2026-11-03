// Vercel serverless function: Google News RSS → JSON (키워드별 상위 기사)
export default async function handler(req, res) {
  const q = String(req.query.q || '투자, AI, 창업').slice(0, 200);
  const kws = q.split(',').map(s => s.trim()).filter(Boolean).slice(0, 5);
  const decode = s => s.replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const pick = (block, tag) => { const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)); return m ? decode(m[1]).trim() : ''; };
  try {
    const lists = await Promise.all(kws.map(async kw => {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(kw + ' when:1d')}&hl=ko&gl=KR&ceid=KR:ko`;
      const xml = await fetch(url, { headers: { 'user-agent': 'naui-haru/1.0' } }).then(r => r.text());
      return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 3).map(m => {
        const source = pick(m[1], 'source');
        let title = pick(m[1], 'title');
        if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3));
        return { kw, title, link: pick(m[1], 'link'), source, date: pick(m[1], 'pubDate') };
      });
    }));
    // 키워드를 번갈아 섞기
    const items = [];
    for (let i = 0; i < 3; i++) for (const l of lists) if (l[i]) items.push(l[i]);
    res.setHeader('cache-control', 's-maxage=1800, stale-while-revalidate=3600');
    res.status(200).json({ items });
  } catch (e) {
    res.status(502).json({ error: 'news_fetch_failed' });
  }
}
