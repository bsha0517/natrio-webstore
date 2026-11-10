// Natrio SEO + storefront regression tests.
//
//   BASE=http://localhost:8787 node seo/test-seo.mjs          (local wrangler dev: all tests)
//   BASE=https://natrio.pk READ_ONLY=1 node seo/test-seo.mjs  (production: GET-only, no cart/checkout)
//
// Runs against the real Workers runtime (wrangler dev / production), not a
// Node simulation. READ_ONLY mode only issues GET requests, ~4 per second.

const BASE = (process.env.BASE || 'http://localhost:8787').replace(/\/$/, '');
const READ_ONLY = !!process.env.READ_ONLY;
const SITE = 'https://natrio.pk'; // canonical origin used in markup, wherever the test runs
const DELAY = READ_ONLY ? 250 : 0;

let passed = 0;
const failures = [];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function check(name, cond, detail = '') {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

async function get(path, opts = {}) {
  const res = await fetch(BASE + path, { redirect: 'manual', headers: { 'User-Agent': 'NatrioSEOTest/1.0', ...(opts.headers || {}) }, method: opts.method || 'GET', body: opts.body });
  const text = await res.text();
  if (DELAY) await sleep(DELAY);
  return { status: res.status, headers: res.headers, text, location: res.headers.get('location') };
}
const getJSON = async (path) => JSON.parse((await get(path)).text);

const decode = (s) => String(s || '').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function parsePage(html) {
  const head = html.split(/<\/head>/i)[0];
  const noScript = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  const ld = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)) {
    try { ld.push(JSON.parse(m[1])); } catch { ld.push({ '@type': 'INVALID_JSON' }); }
  }
  return {
    title: decode((/<title>([^<]*)<\/title>/i.exec(head) || [])[1]),
    desc: decode((/<meta\s+name="description"[^>]*\scontent="([^"]*)"/i.exec(head) || [])[1]),
    canonical: (/<link\s+rel="canonical"[^>]*\shref="([^"]*)"/i.exec(head) || [])[1],
    robots: (/<meta\s+name="robots"[^>]*\scontent="([^"]*)"/i.exec(head) || [])[1] || '',
    canonicalCount: (head.match(/<link\s+rel="canonical"/gi) || []).length,
    h1s: [...noScript.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => decode(m[1].replace(/<[^>]+>/g, '').trim())),
    links: new Set([...noScript.matchAll(/<a\s[^>]*href="([^"#]*)"/gi)].map(m => m[1].replace(SITE, '') || '/')),
    words: noScript.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length,
    ld,
    headers: (html.match(/class="site-header"/g) || []).length,
    footers: (html.match(/class="site-footer/g) || []).length,
    loading: /Loading…/.test(noScript)
  };
}
const ldOfType = (page, type) => page.ld.filter(j => j['@type'] === type);
const NAV_LINKS = ['/', '/products/hair-oils', '/products/facial-care', '/products.html', '/blog.html', '/about-us.html', '/faq.html', '/contact-us.html', '/shipping-policy.html', '/privacy-policy.html'];

async function main() {
  console.log(`Testing ${BASE}${READ_ONLY ? ' (read-only)' : ''}`);
  const products = await getJSON('/api/products');
  const categories = await getJSON('/api/categories');
  const posts = await getJSON('/api/blog');
  const catSlug = (t) => String(t).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const normVariants = (p) => (p.variants && p.variants.length ? p.variants : [{ name: 'Default', price: p.price }]).map(v => typeof v === 'object' ? { name: v.name, price: Number(v.price ?? p.price) } : { name: v, price: Number(p.price) });

  // ---------- 1. Blog articles ----------
  const titles = new Set(), descs = new Set(), canons = new Set();
  for (const post of posts) {
    const path = `/blog/${encodeURIComponent(post.slug)}`;
    const r = await get(path);
    const pg = parsePage(r.text);
    const want = decode(post.title);
    const tag = `blog ${post.slug.slice(0, 40)}`;
    check(`${tag}: 200`, r.status === 200, `got ${r.status}`);
    check(`${tag}: canonical self`, pg.canonical === SITE + path, pg.canonical);
    check(`${tag}: title has post title`, pg.title.startsWith(want), pg.title);
    check(`${tag}: description present (50–160 chars)`, pg.desc.length >= 50 && pg.desc.length <= 160, `${pg.desc.length} chars`);
    check(`${tag}: exactly one H1 = title`, pg.h1s.length === 1 && pg.h1s[0] === want, JSON.stringify(pg.h1s));
    check(`${tag}: article body in raw HTML (>300 words)`, pg.words > 300 && !pg.loading, `${pg.words} words`);
    check(`${tag}: no robots noindex`, !/noindex/i.test(pg.robots));
    const bp = ldOfType(pg, 'BlogPosting');
    check(`${tag}: one BlogPosting`, bp.length === 1);
    if (bp[0]) {
      check(`${tag}: BlogPosting fields`, bp[0].headline === want && bp[0].datePublished && bp[0].dateModified && bp[0].mainEntityOfPage && bp[0].mainEntityOfPage['@id'] === SITE + path && Array.isArray(bp[0].image));
      check(`${tag}: datePublished matches stored date`, new Date(bp[0].datePublished).getTime() === new Date(post.date).getTime());
    }
    check(`${tag}: BreadcrumbList`, ldOfType(pg, 'BreadcrumbList').length === 1);
    check(`${tag}: no invalid JSON-LD`, !pg.ld.some(j => j['@type'] === 'INVALID_JSON'));
    check(`${tag}: links to blog index`, pg.links.has('/blog.html'));
    check(`${tag}: links to at least one product`, [...pg.links].some(l => l.startsWith('/product/')));
    check(`${tag}: no links to old blog URLs or broken legacy paths`, ![...pg.links].some(l => l.startsWith('/blog-post.html') || l === '/hair-oils' || /^\/products\/natrio-/.test(l)));
    titles.add(pg.title); descs.add(pg.desc); canons.add(pg.canonical);
    const old = await get(`/blog-post.html?slug=${encodeURIComponent(post.slug)}`);
    check(`${tag}: old URL 301 → new`, old.status === 301 && old.location && old.location.endsWith(path), `${old.status} ${old.location}`);
  }
  check('blog: unique titles', titles.size === posts.length, `${titles.size}/${posts.length}`);
  check('blog: unique descriptions', descs.size === posts.length, `${descs.size}/${posts.length}`);
  check('blog: unique canonicals', canons.size === posts.length);

  const blogIndex = parsePage((await get('/blog.html')).text);
  check('blog index: raw HTML links to every article', posts.every(p => blogIndex.links.has(`/blog/${encodeURIComponent(p.slug)}`)), `${posts.filter(p => !blogIndex.links.has(`/blog/${encodeURIComponent(p.slug)}`)).length} missing`);
  const blogRedirect = await get('/blog');
  check('/blog → 301 /blog.html', blogRedirect.status === 301 && blogRedirect.location.endsWith('/blog.html'));

  // ---------- 2. Genuine 404s ----------
  for (const path of ['/blog/no-such-article-xyz', '/blog-post.html?slug=no-such-article-xyz', '/product/no-such-product-xyz', '/products/no-such-category-xyz', '/no-such-page-xyz', '/no-such-page.html']) {
    const r = await get(path);
    const pg = parsePage(r.text);
    check(`404 ${path}`, r.status === 404, `got ${r.status} ${r.location || ''}`);
    check(`404 ${path}: noindex`, /noindex/i.test(pg.robots) || /noindex/i.test(r.headers.get('x-robots-tag') || ''));
    check(`404 ${path}: helpful page with navigation`, pg.links.has('/products.html') && pg.headers === 1);
  }
  if (!READ_ONLY) {
    const draft = await get('/blog/unpublished-test-draft');
    check('unpublished draft is 404', draft.status === 404, `got ${draft.status}`);
  }
  const missingImg = await get('/images/no-such-image.png');
  check('missing image → plain 404', missingImg.status === 404 && !/site-header/.test(missingImg.text));
  const apiMissing = await get('/api/products/no-such-product-xyz');
  check('API unknown product → JSON 404', apiMissing.status === 404 && /"error"/.test(apiMissing.text));

  // ---------- 3. Redirects ----------
  const redirects = [
    ['/product.html', '/products.html'],
    [`/product.html?id=${products[0].id}`, `/product/${products[0].id}`],
    ['/products.html?category=Hair%20Oils', '/products/hair-oils'],
    [`/product/${products[0].id}/`, `/product/${products[0].id}`],
    ['/products/hair-oils/', '/products/hair-oils'],
    ['/hair-oils', '/products/hair-oils'],
    ['/products/natrio-organics-castor-oil', '/product/castor-oil'],
    ['/products/natrio-organics-onion-oil-60ml', '/product/onion-oil']
  ];
  for (const [from, to] of redirects) {
    if (to.includes('castor-oil') && !products.some(p => p.id === 'castor-oil')) continue;
    if (to.includes('onion-oil') && !products.some(p => p.id === 'onion-oil')) continue;
    const r = await get(from);
    check(`301 ${from} → ${to}`, r.status === 301 && r.location && new URL(r.location, BASE).pathname + new URL(r.location, BASE).search === to, `${r.status} ${r.location}`);
  }

  for (const evil of ['//evil.example/', '//evil.example//', '/\\evil.example/']) {
    const r = await get(evil);
    const loc = r.location || '';
    check(`no open redirect for ${evil}`, !/^(https?:)?\/\/(?!natrio\.pk|localhost)/i.test(loc) && !/^\/\\/.test(loc), `${r.status} ${loc}`);
  }

  // ---------- 4. Products: SSR, JSON-LD, variants ----------
  for (const p of products) {
    const path = `/product/${encodeURIComponent(p.id)}`;
    const r = await get(path);
    const pg = parsePage(r.text);
    const tag = `product ${p.id}`;
    const variants = normVariants(p);
    check(`${tag}: 200`, r.status === 200, `got ${r.status}`);
    check(`${tag}: canonical`, pg.canonical === SITE + path, pg.canonical);
    check(`${tag}: one H1 = title`, pg.h1s.length === 1 && pg.h1s[0] === p.title, JSON.stringify(pg.h1s));
    check(`${tag}: description`, pg.desc.length >= 50);
    const prod = ldOfType(pg, 'Product');
    check(`${tag}: exactly one Product JSON-LD`, prod.length === 1, `${prod.length}`);
    if (prod[0]) {
      const offers = Array.isArray(prod[0].offers) ? prod[0].offers : [];
      check(`${tag}: one Offer per variant`, offers.length === variants.length, `${offers.length} vs ${variants.length}`);
      for (const v of variants) {
        const o = offers.find(o => Number(o.price) === v.price && (variants.length === 1 || o.url.endsWith(`?variant=${encodeURIComponent(v.name)}`)));
        check(`${tag}: Offer for ${v.name} @ ${v.price} PKR`, !!o && o.priceCurrency === 'PKR');
      }
      check(`${tag}: offers carry shipping + return policy`, offers.every(o => o.shippingDetails && o.hasMerchantReturnPolicy));
    }
    check(`${tag}: BreadcrumbList`, ldOfType(pg, 'BreadcrumbList').length === 1);
    check(`${tag}: links to parent category`, pg.links.has(`/products/${catSlug(p.category)}`));
    check(`${tag}: single header/footer`, pg.headers === 1 && pg.footers === 1);
    if (variants.length > 1) {
      for (const v of variants) {
        const vr = await get(`${path}?variant=${encodeURIComponent(v.name)}`);
        const vp = parsePage(vr.text);
        check(`${tag}?variant=${v.name}: shows Rs. ${v.price}`, vr.status === 200 && new RegExp(`class="pd-price">Rs\\. ${v.price.toLocaleString()}\\b`).test(vr.text));
        check(`${tag}?variant=${v.name}: canonical is clean product URL`, vp.canonical === SITE + path);
      }
    }
  }

  // ---------- 5. Categories ----------
  for (const cat of categories) {
    const path = `/products/${catSlug(cat.title)}`;
    const r = await get(path);
    const pg = parsePage(r.text);
    const inCat = products.filter(p => p.category === cat.title);
    check(`category ${path}: 200 + canonical`, r.status === 200 && pg.canonical === SITE + path, `${r.status} ${pg.canonical}`);
    check(`category ${path}: H1`, pg.h1s.length === 1 && pg.h1s[0] === cat.title, JSON.stringify(pg.h1s));
    check(`category ${path}: links to all ${inCat.length} products`, inCat.every(p => pg.links.has(`/product/${encodeURIComponent(p.id)}`)));
  }
  const all = parsePage((await get('/products.html')).text);
  check('/products.html: title not duplicated', all.title === 'Shop All Products — Natrio Organics', all.title);

  // ---------- 6. Crawlable navigation ----------
  for (const path of ['/', `/product/${encodeURIComponent(products[0].id)}`, `/blog/${encodeURIComponent(posts[0].slug)}`, '/about-us.html', '/faq.html', '/blog.html', '/products/hair-oils']) {
    const pg = parsePage((await get(path)).text);
    const missing = NAV_LINKS.filter(l => !pg.links.has(l));
    check(`nav ${path}: raw HTML has all main links`, missing.length === 0, `missing ${missing.join(', ')}`);
    check(`nav ${path}: exactly one header + footer`, pg.headers === 1 && pg.footers === 1, `${pg.headers}/${pg.footers}`);
  }
  const home = parsePage((await get('/')).text);
  check('home: links to latest articles', posts.slice(0, 4).every(p => home.links.has(`/blog/${encodeURIComponent(p.slug)}`)));
  check('home: one Store JSON-LD', ldOfType(home, 'Store').length === 1);
  const admin = await get('/admin.html');
  check('admin.html: no storefront header injected', !/class="site-header"/.test(admin.text));

  // ---------- 7. Sitemap ----------
  const sm = await get('/sitemap.xml');
  const locs = [...sm.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => decode(m[1]));
  check('sitemap: 200 + XML', sm.status === 200 && /^<\?xml/.test(sm.text) && /<\/urlset>\s*$/.test(sm.text));
  check('sitemap: absolute https natrio.pk URLs', locs.every(l => l.startsWith(`${SITE}/`)));
  check('sitemap: no duplicates', new Set(locs).size === locs.length);
  check('sitemap: no old blog-post.html URLs', !locs.some(l => l.includes('blog-post.html')));
  check('sitemap: every blog article', posts.every(p => locs.includes(`${SITE}/blog/${encodeURIComponent(p.slug)}`)));
  check('sitemap: every product', products.every(p => locs.includes(`${SITE}/product/${encodeURIComponent(p.id)}`)));
  check('sitemap: every category', categories.every(c => locs.includes(`${SITE}/products/${catSlug(c.title)}`)));
  check('sitemap: lastmod dates valid', [...sm.text.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].every(m => /^\d{4}-\d{2}-\d{2}$/.test(m[1]) && new Date(m[1]) <= new Date()));
  for (const loc of locs) {
    const path = loc.replace(SITE, '');
    const r = await get(path);
    const pg = parsePage(r.text);
    check(`sitemap URL ${path}: 200, indexable, self-canonical`, r.status === 200 && !/noindex/i.test(pg.robots) && pg.canonical === loc, `${r.status} canon=${pg.canonical}`);
  }

  // ---------- 8. robots.txt ----------
  const robots = (await get('/robots.txt')).text;
  check('robots: declares sitemap', /^Sitemap:\s*https:\/\/natrio\.pk\/sitemap\.xml/m.test(robots));
  check('robots: does not block site, /api/, /uploads/, /blog', !/^Disallow:\s*\/(\s|$|api\/?\s|uploads|blog)/m.test(robots));

  // ---------- 9. Merchant feed ----------
  const feed = (await get('/product-feed.xml')).text;
  const items = [...feed.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => ({
    id: (/<g:id>([^<]+)/.exec(m[1]) || [])[1],
    link: decode((/<link>([^<]+)/.exec(m[1]) || [])[1]),
    price: Number(((/<g:price>([\d.]+)/.exec(m[1]) || [])[1]))
  }));
  check('feed: one item per variant', items.length === products.reduce((n, p) => n + normVariants(p).length, 0), `${items.length}`);
  for (const it of items) {
    const path = it.link.replace(SITE, '');
    const r = await get(path);
    const pg = parsePage(r.text);
    const offer = (ldOfType(pg, 'Product')[0]?.offers || []).find(o => o.sku === it.id);
    check(`feed ${it.id}: landing 200 shows Rs. ${it.price}`, r.status === 200 && new RegExp(`class="pd-price">Rs\\. ${it.price.toLocaleString()}\\b`).test(r.text), `${r.status}`);
    check(`feed ${it.id}: JSON-LD offer matches (sku, price, url)`, !!offer && Number(offer.price) === it.price && offer.url === it.link);
  }

  // ---------- 10. Cart + checkout (local only; writes data) ----------
  if (!READ_ONLY) {
    const p = products.find(x => x.stock > 1 && normVariants(x).length > 1) || products.find(x => x.stock > 1);
    const v = normVariants(p).slice(-1)[0];
    let cookie = '';
    const post = async (path, body) => {
      const res = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });
      const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
      return res.json();
    };
    const add = await post('/api/cart/add', { productId: p.id, variant: v.name, qty: 2 });
    check('cart: add', add.success && add.cartCount === 2);
    const cart = await (await fetch(BASE + '/api/cart', { headers: { Cookie: cookie } })).json();
    check('cart: subtotal uses variant price', cart.subtotal === v.price * 2, `${cart.subtotal} vs ${v.price * 2}`);
    // /api/cart reads Mongo directly (never edge-cached), so this is the true current stock.
    const before = cart.items[0].product.stock;
    const order = await post('/api/checkout', { name: 'SEO Test', email: 'seo-test@example.com', phone: '03001234567', address: 'Test', city: 'Lahore', paymentMethod: 'cod' });
    check('checkout: COD order placed', order.success && order.orderId, JSON.stringify(order));
    const after = (await getJSON(`/api/products/${p.id}`)).stock;
    check('checkout: stock decremented', after === before - 2, `${before} → ${after}`);
    const saved = await getJSON(`/api/order/${order.orderId}`);
    check('checkout: order total = subtotal + shipping', saved.total === saved.subtotal + saved.shipping - saved.discountAmount && saved.items[0].price === v.price);
    const empty = await (await fetch(BASE + '/api/cart', { headers: { Cookie: cookie } })).json();
    check('checkout: cart emptied', empty.items.length === 0);
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log(`  FAIL ${f}`);
  process.exit(failures.length ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(2); });
