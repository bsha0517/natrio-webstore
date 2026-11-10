// Natrio Organics store — Cloudflare Worker version of ../../server.js.
//
// Route logic is a straight port of server.js (same URLs, same JSON shapes,
// same Mongo documents), so the existing pages in ../public work unchanged.
// What differs is only the plumbing Workers needs:
//   - Hono instead of Express; static files come from Workers Static Assets.
//   - One MongoClient per request (Workers can't share sockets between
//     requests), opened lazily and closed once the response and any
//     background work (emails, cart tracking) have finished.
//   - Sessions live in a Mongo `sessions` collection behind a `sid` cookie,
//     instead of express-session's in-memory store.
//   - Uploads are compressed in the browser (public/image-compress.js)
//     because sharp can't run on Workers.
//   - The setInterval sweeps run from a Cron Trigger (see `scheduled` below).

import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { env } from 'cloudflare:workers';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import emailTemplates from '../../email-templates.js';
import homePageTemplate from '../../public/index.html';
import productPageTemplate from '../../public/product.html';
import productsPageTemplate from '../../public/products.html';
import blogPostTemplate from '../../public/blog-post.html';
import blogIndexTemplate from '../../public/blog.html';
import notFoundTemplate from '../../public/404.html';
import { applyLayout } from './layout.js';

const app = new Hono();

// ---------- Data storage keys ----------
const PRODUCTS_FILE = 'products';
const ORDERS_FILE = 'orders';
const CATEGORIES_FILE = 'categories';
const BLOG_FILE = 'blog';
const HERO_FILE = 'hero';
const USERS_FILE = 'users';
const SHIPPING_FILE = 'shipping';
const DISCOUNTS_FILE = 'discounts';
const INSTAGRAM_FILE = 'instagram';
const SUBSCRIBERS_FILE = 'subscribers';
const STORES_FILE = 'stores';
const ANNOUNCEMENTS_FILE = 'announcements';
const CART_ACTIVITY_FILE = 'cartActivity';
const SETTINGS_FILE = 'settings';
const MESSAGES_FILE = 'messages';

const uuidv4 = () => crypto.randomUUID();

// ---------- Per-request context (Mongo client + background tasks) ----------
// AsyncLocalStorage lets readJSON()/writeJSON()/bg() stay plain functions, as
// in server.js, while still using the current request's own Mongo client.
const als = new AsyncLocalStorage();

function newRequestContext(origin = null) {
  return { client: null, dbPromise: null, pending: [], origin };
}

function getDb() {
  const ctx = als.getStore();
  if (!ctx) throw new Error('getDb() called outside a request context');
  if (!ctx.dbPromise) {
    if (!env.MONGODB_URI) throw new Error('MONGODB_URI secret is not set');
    ctx.client = new MongoClient(env.MONGODB_URI, {
      maxPoolSize: 1,
      minPoolSize: 0,
      serverSelectionTimeoutMS: 10000
    });
    ctx.dbPromise = ctx.client.connect().then(c => c.db()); // db name from the URI
  }
  return ctx.dbPromise;
}

// Runs work after the response is sent (Workers would otherwise cancel it).
function bg(promise) {
  const ctx = als.getStore();
  const p = Promise.resolve(promise).catch(err => console.error('Background task failed:', err && err.message));
  if (ctx) ctx.pending.push(p);
  return p;
}

// Waits for every background task (including ones they start), then closes
// the request's Mongo connection.
async function finishRequestContext(ctx) {
  let seen = 0;
  while (seen < ctx.pending.length) {
    const batch = ctx.pending.slice(seen);
    seen = ctx.pending.length;
    await Promise.allSettled(batch);
  }
  if (ctx.client) await ctx.client.close().catch(() => {});
}

async function readJSON(key) {
  const db = await getDb();
  const doc = await db.collection('store').findOne({ _id: key });
  return doc ? doc.data : [];
}
async function writeJSON(key, data) {
  const db = await getDb();
  await db.collection('store').updateOne({ _id: key }, { $set: { data } }, { upsert: true });
  if (PUBLIC_KEYS.has(key)) await bumpCacheGeneration();
}

// ---------- Edge cache for public pages and API ----------
// Opening a connection to Atlas costs ~1.2 s per request on Workers, so
// public, non-personal GET responses are kept in Cloudflare's edge cache.
// - Fresh for CACHE_FRESH_SECONDS; after that the cached copy is still
//   served instantly while a background request refreshes it
//   (stale-while-revalidate), so visitors almost never wait on Mongo.
// - Every write to data these pages show (admin saves, checkout stock
//   changes) bumps a "generation" number that is part of every cache key,
//   so the next request after a change misses and renders fresh data.
//   The Cache API is per data centre: the bump applies where the write
//   happened (for Pakistani traffic, normally the same one), and anywhere
//   else picks up the change within CACHE_FRESH_SECONDS.
// Cart, checkout, accounts, orders and /api/admin/* are never cached.
const CACHE_FRESH_SECONDS = Number(env.CACHE_FRESH_SECONDS) || 60;
const CACHE_KEEP_SECONDS = 60 * 60 * 24;
const PUBLIC_KEYS = new Set([
  PRODUCTS_FILE, CATEGORIES_FILE, BLOG_FILE, HERO_FILE, SHIPPING_FILE,
  INSTAGRAM_FILE, STORES_FILE, ANNOUNCEMENTS_FILE, SETTINGS_FILE
]);
const CACHEABLE_PATHS = [
  /^\/$/,
  /^\/product\/[^/]+$/,
  /^\/products\/[^/]+$/,
  /^\/products\.html$/,
  /^\/sitemap\.xml$/,
  /^\/product-feed\.xml$/,
  /^\/blog\.html$/,
  /^\/blog\/[^/]+$/,
  /^\/api\/products(\/[^/]+)?$/,
  /^\/api\/blog(\/[^/]+)?$/,
  /^\/api\/(categories|hero|shipping|instagram|stores|announcements|settings)$/
];
const TRACKING_PARAMS = /^(utm_.*|fbclid|gclid|gbraid|wbraid|ttclid|msclkid|_ga)$/i;
// Marks the Worker's own background refresh requests (same isolate only).
// Created on first use: Workers forbid random values at module load.
let refreshToken = null;
const getRefreshToken = () => (refreshToken ||= crypto.randomUUID());
const refreshesInFlight = new Set();

// Bump when the shape of cached HTML changes (e.g. layout changes), so a deploy
// never serves pages cached by the previous version.
const CACHE_VERSION = 'v2';

const isCacheablePath = (path) => CACHEABLE_PATHS.some(re => re.test(path));
const generationKey = (origin) => new Request(`${origin}/__natrio-cache-generation`);

async function getCacheGeneration(origin) {
  const hit = await caches.default.match(generationKey(origin));
  return hit ? await hit.text() : '0';
}

async function bumpCacheGeneration() {
  const ctx = als.getStore();
  if (!ctx || !ctx.origin) return; // cron writes never touch public data
  try {
    await caches.default.put(generationKey(ctx.origin), new Response(String(Date.now()), {
      headers: { 'Cache-Control': `public, s-maxage=${60 * 60 * 24 * 365}` }
    }));
  } catch (err) {
    console.error('Cache generation bump failed:', err.message);
  }
}

async function cacheKeyFor(url) {
  const u = new URL(url);
  for (const name of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(name)) u.searchParams.delete(name);
  }
  u.searchParams.sort();
  u.searchParams.set('__gen', `${CACHE_VERSION}-${await getCacheGeneration(u.origin)}`);
  return new Request(u.toString(), { method: 'GET' });
}

function forBrowser(res, status) {
  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  out.headers.set('X-Cache', status);
  out.headers.delete('X-Natrio-Cached-At');
  return out;
}

// ---------- Email via Brevo's HTTP API ----------
const BREVO_API_KEY = env.BREVO_API_KEY || null;
const SENDER_EMAIL = env.SENDER_EMAIL || env.CONTACT_EMAIL || 'info@natrio.pk';
const SENDER_NAME = env.SENDER_NAME || 'Natrio Organics';
const CONTACT_EMAIL = env.CONTACT_EMAIL || 'info@natrio.pk';
const SITE_URL = env.SITE_URL || 'https://natrio.pk';

async function sendMailSafe(mailOptions, attempts = 3) {
  if (!BREVO_API_KEY) {
    console.log('Email not configured (BREVO_API_KEY missing) — skipping send.');
    return false;
  }

  const fromMatch = /^"?([^"<]*)"?\s*<?([^<>]+@[^<>]+)>?$/.exec(mailOptions.from || '');
  const senderName = (fromMatch && fromMatch[1].trim()) || SENDER_NAME;

  const payload = {
    sender: { name: senderName, email: SENDER_EMAIL },
    to: [{ email: mailOptions.to }],
    subject: mailOptions.subject,
    htmlContent: mailOptions.html || `<pre style="font-family:inherit;white-space:pre-wrap;">${(mailOptions.text || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</pre>`
  };
  if (mailOptions.text && !mailOptions.html) payload.textContent = mailOptions.text;
  if (mailOptions.replyTo) payload.replyTo = { email: mailOptions.replyTo };

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000)
      });
      if (res.ok) return true;
      const errBody = await res.text();
      console.error(`Email send attempt ${attempt}/${attempts} to ${mailOptions.to} failed: ${res.status} ${errBody}`);
    } catch (err) {
      console.error(`Email send attempt ${attempt}/${attempts} to ${mailOptions.to} failed:`, err.message);
    }
    if (attempt < attempts) await new Promise(r => setTimeout(r, 2000 * attempt));
  }
  return false;
}

async function sendContactEmail(message) {
  return sendMailSafe({
    from: `"Natrio Organics Website" <${SENDER_EMAIL}>`,
    to: CONTACT_EMAIL,
    replyTo: message.email,
    subject: `New message from ${message.name} — Natrio Organics site`,
    text: `Name: ${message.name}\nEmail: ${message.email}\nPhone: ${message.phone || 'N/A'}\n\nMessage:\n${message.message}`
  });
}

function getVariantPrice(product, variantName) {
  if (!product) return 0;
  if (Array.isArray(product.variants)) {
    const match = product.variants.find(v => (typeof v === 'object' && v !== null ? v.name : v) === variantName);
    if (match && typeof match === 'object' && match.price !== undefined && match.price !== null && match.price !== '') {
      return Number(match.price);
    }
  }
  return Number(product.price) || 0;
}

async function getRecommendedProducts(excludeProductIds = []) {
  try {
    const products = await readJSON(PRODUCTS_FILE);
    const inStock = products.filter(p => p.stock > 0 && !excludeProductIds.includes(p.id));
    const preferred = inStock.filter(p => p.bestseller || p.featured);
    const pool = preferred.length >= 3 ? preferred : inStock;
    return pool.slice().sort(() => Math.random() - 0.5).slice(0, 3);
  } catch (err) {
    console.error('Could not load recommended products for email:', err.message);
    return [];
  }
}

async function sendOrderConfirmationEmails(order) {
  if (!BREVO_API_KEY) {
    console.log('Email not configured — skipping order confirmation emails.');
    return;
  }
  const recommended = await getRecommendedProducts(order.items.map(i => i.productId));
  if (order.customer.email) {
    await sendMailSafe({
      from: `"Natrio Organics" <${SENDER_EMAIL}>`,
      to: order.customer.email,
      subject: `Your Natrio Organics order #${order.id} is confirmed`,
      html: emailTemplates.orderPlacedEmail(order, recommended)
    });
  }
  await sendMailSafe({
    from: `"Natrio Organics Website" <${SENDER_EMAIL}>`,
    to: CONTACT_EMAIL,
    subject: `New order #${order.id} — Rs. ${order.total}`,
    html: emailTemplates.newOrderOwnerEmail(order)
  });
}

async function sendOrderStatusEmail(order, status) {
  if (!order.customer.email) return;
  const templates = {
    shipped: { subject: `Your Natrio Organics order #${order.id} has shipped`, render: emailTemplates.orderShippedEmail },
    delivered: { subject: `Your Natrio Organics order #${order.id} has been delivered`, render: emailTemplates.orderDeliveredEmail },
    cancelled: { subject: `Your Natrio Organics order #${order.id} has been cancelled`, render: emailTemplates.orderCancelledEmail }
  };
  const t = templates[status];
  if (!t) return;
  const recommended = await getRecommendedProducts(order.items.map(i => i.productId));
  await sendMailSafe({
    from: `"Natrio Organics" <${SENDER_EMAIL}>`,
    to: order.customer.email,
    subject: t.subject,
    html: t.render(order, recommended)
  });
}

// ---------- Request context + canonical domain redirect ----------
const CANONICAL_HOST = 'natrio.pk';
const ALTERNATE_HOSTS = [
  'www.natrio.pk',
  'natrio.com.pk',
  'www.natrio.com.pk',
  'natrioorganics.com',
  'www.natrioorganics.com'
];

app.use('*', async (c, next) => {
  const url = new URL(c.req.url);
  if (ALTERNATE_HOSTS.includes(url.hostname.toLowerCase())) {
    return c.redirect(`https://${CANONICAL_HOST}${url.pathname}${url.search}`, 301);
  }
  // Trailing slashes: /product/x/ → /product/x (one canonical form per page).
  if ((c.req.method === 'GET' || c.req.method === 'HEAD') && url.pathname.length > 1 &&
      url.pathname.endsWith('/') && !url.pathname.startsWith('/api/')) {
    // Collapse leading slashes too: "//evil.com/" must never become a
    // protocol-relative Location header (open redirect).
    const target = url.pathname.replace(/\/+$/, '').replace(/^\/+/, '/') || '/';
    return c.redirect(`${target}${url.search}`, 301);
  }
  const ctx = newRequestContext(url.origin);
  await als.run(ctx, () => next());
  c.executionCtx.waitUntil(als.run(ctx, () => finishRequestContext(ctx)));
});

// Edge cache (see "Edge cache for public pages and API" above). Runs before
// the session middleware, so a cache hit never opens a Mongo connection.
app.use('*', async (c, next) => {
  const url = new URL(c.req.url);
  if (c.req.method !== 'GET' || !isCacheablePath(url.pathname)) return next();

  const cache = caches.default;
  const key = await cacheKeyFor(url);
  const isRefresh = c.req.header('X-Natrio-Refresh') === getRefreshToken();

  if (!isRefresh) {
    const hit = await cache.match(key);
    if (hit) {
      const ageSeconds = (Date.now() - Number(hit.headers.get('X-Natrio-Cached-At') || 0)) / 1000;
      if (ageSeconds > CACHE_FRESH_SECONDS && !refreshesInFlight.has(key.url)) {
        refreshesInFlight.add(key.url);
        const refreshReq = new Request(url.toString(), { headers: { 'X-Natrio-Refresh': getRefreshToken() } });
        c.executionCtx.waitUntil(
          Promise.resolve(app.fetch(refreshReq, c.env, c.executionCtx))
            .catch(err => console.error('Cache refresh failed:', err && err.message))
            .finally(() => refreshesInFlight.delete(key.url))
        );
        return forBrowser(hit, 'STALE');
      }
      return forBrowser(hit, 'HIT');
    }
  }

  await next();

  if (c.res.status === 200 && !c.res.headers.has('Set-Cookie')) {
    const stored = new Response(c.res.clone().body, { status: 200, headers: new Headers(c.res.headers) });
    stored.headers.set('Cache-Control', `public, s-maxage=${CACHE_KEEP_SECONDS}`);
    stored.headers.set('X-Natrio-Cached-At', String(Date.now()));
    c.executionCtx.waitUntil(cache.put(key, stored).catch(err => console.error('Cache put failed:', err.message)));
    c.res = forBrowser(c.res, isRefresh ? 'REFRESH' : 'MISS');
  }
});

// Server-rendered header/footer on every storefront HTML page (runs inside
// the edge cache, so cached pages already include it).
app.use('*', async (c, next) => {
  await next();
  const ct = c.res.headers.get('Content-Type') || '';
  if (!ct.includes('text/html') || c.req.method === 'HEAD' || (c.res.status !== 200 && c.res.status !== 404)) return;
  const html = await c.res.text();
  const headers = new Headers(c.res.headers);
  headers.delete('Content-Length');
  headers.delete('ETag');
  c.res = new Response(applyLayout(html), { status: c.res.status, headers });
});

app.onError((err, c) => {
  console.error('Unhandled error:', c.req.method, c.req.path, err && err.stack || err);
  return c.json({ error: 'Something went wrong. Please try again.' }, 500);
});

// ---------- Sessions (Mongo-backed, replaces express-session) ----------
// Cookie holds only a random id; the data lives in the `sessions` collection.
// A session is only written (and the cookie only set) once something is
// actually stored in it, so anonymous browsing costs no writes.
const SESSION_COOKIE = 'sid';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days, same as before
const SID_PATTERN = /^[0-9a-f-]{36}$/;

async function readBody(c) {
  const ct = (c.req.header('content-type') || '').toLowerCase();
  try {
    if (ct.includes('application/json')) return (await c.req.json()) || {};
    if (ct.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(await c.req.text()));
  } catch (_) { /* malformed body → treat as empty, like express.json would 400 */ }
  return {};
}

app.use('/api/*', async (c, next) => {
  // Public cacheable API routes never use the session; skipping it keeps them
  // free of Mongo session lookups and guarantees they never set a cookie.
  if (c.req.method === 'GET' && isCacheablePath(new URL(c.req.url).pathname)) {
    c.set('session', {});
    c.set('body', {});
    return next();
  }
  let sid = getCookie(c, SESSION_COOKIE);
  let data = {};
  let existed = false;
  if (sid && SID_PATTERN.test(sid)) {
    const db = await getDb();
    const doc = await db.collection('sessions').findOne({ _id: sid });
    if (doc && (!doc.expiresAt || doc.expiresAt > new Date())) {
      data = doc.data || {};
      existed = true;
    }
  } else {
    sid = null;
  }
  if (!sid) sid = uuidv4();
  const before = JSON.stringify(data);

  c.set('session', data);
  c.set('sessionId', sid);
  const isMultipart = (c.req.header('content-type') || '').toLowerCase().includes('multipart/form-data');
  c.set('body', ['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method) && !isMultipart ? await readBody(c) : {});

  await next();

  const after = JSON.stringify(c.get('session'));
  if (after !== before) {
    const db = await getDb();
    await db.collection('sessions').updateOne(
      { _id: sid },
      { $set: { data: c.get('session'), expiresAt: new Date(Date.now() + SESSION_MAX_AGE * 1000) } },
      { upsert: true }
    );
    // (Re)set the cookie whenever the session changes so its expiry rolls forward.
    const secure = new URL(c.req.url).protocol === 'https:';
    c.res.headers.append('Set-Cookie',
      `${SESSION_COOKIE}=${sid}; Path=/; Max-Age=${SESSION_MAX_AGE}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`);
  }
  // An unchanged session that didn't exist yet is never saved: no cookie, no write.
  void existed;
});

const session = c => c.get('session');
const body = c => c.get('body') || {};

// ---------- Sitemap ----------
app.get('/sitemap.xml', async (c) => {
  const products = await readJSON(PRODUCTS_FILE);
  const categories = await readJSON(CATEGORIES_FILE);
  const blogPosts = (await readJSON(BLOG_FILE)).filter(p => p.published !== false);

  const staticUrls = [
    { loc: '/', priority: '1.0', changefreq: 'daily' },
    { loc: '/products.html', priority: '0.9', changefreq: 'daily' },
    { loc: '/about-us.html', priority: '0.6', changefreq: 'monthly' },
    { loc: '/contact-us.html', priority: '0.6', changefreq: 'monthly' },
    { loc: '/faq.html', priority: '0.6', changefreq: 'monthly' },
    { loc: '/find-us-in-store.html', priority: '0.5', changefreq: 'monthly' },
    { loc: '/blog.html', priority: '0.7', changefreq: 'weekly' },
    { loc: '/shipping-policy.html', priority: '0.3', changefreq: 'monthly' },
    { loc: '/privacy-policy.html', priority: '0.3', changefreq: 'monthly' }
  ];
  // lastmod only where a real modification date exists (admin edits set
  // updatedAt from now on; blog posts fall back to their publish date).
  const isoDay = (d) => { const t = d ? new Date(d) : null; return t && !isNaN(t) ? t.toISOString().split('T')[0] : undefined; };
  const categoryUrls = categories.map(cat => ({ loc: `/products/${categorySlug(cat.title)}`, priority: '0.7', changefreq: 'weekly' }));
  const productUrls = products.map(p => ({ loc: `/product/${encodeURIComponent(p.id)}`, priority: '0.8', changefreq: 'weekly', lastmod: isoDay(p.updatedAt) }));
  const blogUrls = blogPosts.map(b => ({
    loc: blogPath(b.slug),
    priority: '0.6', changefreq: 'monthly',
    lastmod: isoDay(b.updatedAt || b.date)
  }));
  const allUrls = [...staticUrls, ...categoryUrls, ...productUrls, ...blogUrls];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls.map(u => `  <url>
    <loc>${xmlEscape(SITE_URL + u.loc)}</loc>
    ${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`;
  return c.body(xml, 200, { 'Content-Type': 'application/xml; charset=utf-8' });
});

// ---------- Google Shopping / Meta product feed ----------
function xmlEscape(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]));
}
function stripHtml(str) {
  return String(str || '').replace(/<[^>]+>/g, '').trim();
}
const GOOGLE_PRODUCT_CATEGORY = {
  'Hair Oils': 'Health & Beauty > Personal Care > Cosmetics > Hair Care Products > Hair Oil',
  'Facial Care': 'Health & Beauty > Personal Care > Cosmetics > Skin Care Products'
};

app.get('/product-feed.xml', async (c) => {
  const products = await readJSON(PRODUCTS_FILE);
  const items = [];
  for (const p of products) {
    const variants = normalizeVariants(p);
    const description = stripHtml(p.description) || p.title;
    const imageUrl = p.image ? `${SITE_URL}${p.image}` : `${SITE_URL}/images/logo.png`;
    const additionalImages = [p.hoverImage, p.image3, p.image4].filter(Boolean).map(img => `${SITE_URL}${img}`);
    const category = GOOGLE_PRODUCT_CATEGORY[p.category] || '';
    const availability = p.stock > 0 ? 'in stock' : 'out of stock';

    variants.forEach((v) => {
      const itemId = variantItemId(p, v, variants.length);
      items.push(`
    <item>
      <g:id>${xmlEscape(itemId)}</g:id>
      <title>${xmlEscape(`${p.title}${variants.length > 1 ? ` - ${v.name}` : ''}`)}</title>
      <description>${xmlEscape(description)}</description>
      <link>${xmlEscape(productVariantUrl(p, v, variants.length))}</link>
      <g:image_link>${xmlEscape(imageUrl)}</g:image_link>
      ${additionalImages.map(img => `<g:additional_image_link>${xmlEscape(img)}</g:additional_image_link>`).join('\n      ')}
      <g:availability>${availability}</g:availability>
      <g:price>${v.price.toFixed(2)} PKR</g:price>
      <g:brand>Natrio Organics</g:brand>
      <g:condition>new</g:condition>
      <g:identifier_exists>no</g:identifier_exists>
      ${category ? `<g:google_product_category>${xmlEscape(category)}</g:google_product_category>` : ''}
      ${variants.length > 1 ? `<g:item_group_id>${xmlEscape(p.id)}</g:item_group_id>` : ''}
      <g:product_type>${xmlEscape(p.category || '')}</g:product_type>
    </item>`);
    });
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>Natrio Organics — Product Feed</title>
    <link>${SITE_URL}</link>
    <description>Natrio Organics product feed for Google Shopping and Meta (Facebook/Instagram) Shopping.</description>
${items.join('')}
  </channel>
</rss>`;
  return c.body(xml, 200, { 'Content-Type': 'application/xml; charset=utf-8' });
});

// ---------- Server-rendered homepage ----------
app.get('/', async (c) => {
  const [heroSlides, categories, products, blogPosts] = await Promise.all([
    readJSON(HERO_FILE), readJSON(CATEGORIES_FILE), readJSON(PRODUCTS_FILE), readJSON(BLOG_FILE)
  ]);
  const latestPosts = publishedPostsNewestFirst(blogPosts).slice(0, 4);
  const ssrBlog = latestPosts.map(b => `
        <div class="product-card">
          <a href="${blogPath(b.slug)}">
            <div class="thumb">${b.image ? `<img src="${xmlEscape(b.image)}" alt="${xmlEscape(postTitleText(b))}" loading="lazy">` : ''}</div>
          </a>
          <div class="body">
            <h3><a href="${blogPath(b.slug)}">${xmlEscape(postTitleText(b))}</a></h3>
            <a class="read-more" href="${blogPath(b.slug)}" style="font-size:13px;color:var(--olive);border-bottom:1px solid var(--olive);padding-bottom:2px;">Read more</a>
          </div>
        </div>`).join('');

  const hero = heroSlides[0] || {};
  const heroHeading = hero.heading || '';
  const heroEyebrow = hero.eyebrow || '';
  const heroSubtext = hero.subtext || '';
  const heroButtonText = hero.buttonText || '';
  const heroButtonUrl = hero.buttonUrl || '/products.html';
  const hasHeroText = heroHeading || heroEyebrow || heroSubtext || heroButtonText;

  const ssrHero = `
    <div class="hero-slide active" data-index="0">
      <img class="hero-slide-img" src="${xmlEscape(hero.image || '')}" alt="${xmlEscape(heroHeading || 'Natrio Organics')}">
      ${hasHeroText ? `
      <div class="hero-slide-text">
        <div class="hero-inner">
          ${heroEyebrow ? `<span class="eyebrow">${xmlEscape(heroEyebrow)}</span>` : ''}
          ${heroHeading ? `<h1>${xmlEscape(heroHeading)}</h1>` : ''}
          ${heroSubtext ? `<p>${xmlEscape(heroSubtext)}</p>` : ''}
          ${heroButtonText ? `<a href="${xmlEscape(heroButtonUrl)}" class="btn btn-primary">${xmlEscape(heroButtonText)}</a>` : ''}
        </div>
      </div>` : ''}
    </div>
    ${!heroHeading ? `<h1 class="sr-only">Natrio Organics — Pure Cold-Pressed Oils in Pakistan</h1>` : ''}`;

  const ssrCategories = categories.map(cat => `
    <a class="category-tile" href="/products/${categorySlug(cat.title)}">
      <div class="cat-thumb" style="${cat.image ? `background-image:url('${xmlEscape(cat.image)}')` : ''}"></div>
      <span class="cat-label">${xmlEscape(cat.title)}</span>
    </a>`).join('');

  const bestsellers = products.filter(p => p.bestseller);
  const bestsellerList = (bestsellers.length ? bestsellers : products).slice(0, 8);
  const ssrBestsellers = bestsellerList.map(p => {
    const variants = normalizeVariants(p);
    return `
    <div class="product-card">
      <a href="/product/${encodeURIComponent(p.id)}">
        <div class="thumb">${p.image ? `<img src="${xmlEscape(p.image)}" alt="${xmlEscape(p.title)}" loading="lazy">` : ''}</div>
      </a>
      <div class="body">
        <span class="category">${xmlEscape(p.category || '')}</span>
        <h3><a href="/product/${encodeURIComponent(p.id)}">${xmlEscape(p.title)}</a></h3>
        <div class="price">Rs. ${variants[0].price.toLocaleString()}</div>
      </div>
    </div>`;
  }).join('');

  const html = homePageTemplate
    .replace('<div id="heroSlides"></div>', `<div id="heroSlides">${ssrHero}</div>`)
    .replace('<div class="category-strip" id="categoryStrip"></div>', `<div class="category-strip" id="categoryStrip">${ssrCategories}</div>`)
    .replace('<div class="slider-row" id="bestsellerSlider"></div>', `<div class="slider-row" id="bestsellerSlider">${ssrBestsellers}</div>`)
    .replace('<div class="slider-row" id="blogSlider"></div>', `<div class="slider-row" id="blogSlider">${ssrBlog}</div>`);

  return c.html(html);
});

// ---------- Server-rendered product page ----------
function normalizeVariants(p) {
  return (p.variants && p.variants.length ? p.variants : [{ name: 'Default', price: p.price }]).map(v =>
    (typeof v === 'object' && v !== null) ? { name: v.name, price: Number(v.price ?? p.price) } : { name: v, price: Number(p.price) }
  );
}

function categorySlug(title) {
  return String(title || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// ---------- SEO helpers ----------
// JSON for <script type="application/ld+json">; escapes "<" so content can
// never close the script tag early.
const ldJson = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');

function breadcrumbJsonLd(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, url], i) => ({ '@type': 'ListItem', position: i + 1, name, item: url }))
  };
}

// Blog titles are stored HTML-encoded (e.g. "Hair &amp; Scalp"); decode for
// text contexts, then escape again wherever it goes back into HTML.
function decodeEntities(str) {
  return String(str || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
const htmlToText = (html) => decodeEntities(String(html || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function truncateWords(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), 40)).replace(/[\s,;:.–—-]+$/, '') + '…';
}

const blogPath = (slug) => `/blog/${encodeURIComponent(slug)}`;
const postTitleText = (post) => decodeEntities(post.title);
// Same order as GET /api/blog (newest first), published posts only.
const publishedPostsNewestFirst = (posts) => (posts || []).filter(p => p.published !== false).slice().reverse();

// Excerpt if set, else the article's first real paragraph.
function postSummary(post, max = 155) {
  if (post.excerpt && String(post.excerpt).trim()) return truncateWords(htmlToText(post.excerpt), max);
  const body = String(post.body || '').replace(/<h1\b[\s\S]*?<\/h1>/i, '');
  const firstPara = [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(m => htmlToText(m[1])).find(t => t.length >= 60);
  return truncateWords(firstPara || htmlToText(body) || postTitleText(post), max);
}

// ---------- Product variant URLs (shared by page, JSON-LD and feed) ----------
function variantItemId(p, v, variantCount) {
  return variantCount > 1 ? `${p.id}-${String(v.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : p.id;
}
function productVariantUrl(p, v, variantCount) {
  const base = `${SITE_URL}/product/${encodeURIComponent(p.id)}`;
  return variantCount > 1 ? `${base}?variant=${encodeURIComponent(v.name)}` : base;
}

// Shipping and returns markup, built only from the store's own settings and
// published policy (shipping-policy.html: 7-day returns, buyer pays return
// shipping; delivery 1–3 business days; same/next-day processing).
function offerPolicies(shippingMethods) {
  const out = {
    hasMerchantReturnPolicy: {
      '@type': 'MerchantReturnPolicy',
      applicableCountry: 'PK',
      returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
      merchantReturnDays: 7,
      returnMethod: 'https://schema.org/ReturnByMail',
      returnFees: 'https://schema.org/ReturnFeesCustomerResponsibility'
    }
  };
  const m = Array.isArray(shippingMethods) ? shippingMethods[0] : null;
  if (m && m.cost !== undefined && m.cost !== null && !isNaN(Number(m.cost))) {
    const details = {
      '@type': 'OfferShippingDetails',
      shippingRate: { '@type': 'MonetaryAmount', value: Number(m.cost), currency: 'PKR' },
      shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'PK' }
    };
    const days = /(\d+)\s*[–-]\s*(\d+)\s*business days/i.exec(String(m.description || ''));
    if (days) {
      details.deliveryTime = {
        '@type': 'ShippingDeliveryTime',
        handlingTime: { '@type': 'QuantitativeValue', minValue: 0, maxValue: 1, unitCode: 'DAY' },
        transitTime: { '@type': 'QuantitativeValue', minValue: Number(days[1]), maxValue: Number(days[2]), unitCode: 'DAY' }
      };
    }
    out.shippingDetails = details;
  }
  return out;
}

// ---------- Legacy / mistyped internal URLs ----------
// Maps old link forms (found inside existing blog posts and old bookmarks) to
// the real page: /product.html?id=x, /products/<product id>,
// /products/natrio-organics-<product>-60ml, /<category-slug>, /<product-id>.
const looseProductKey = (s) => String(s || '').toLowerCase().replace(/^natrio-organics?-/, '').replace(/-\d+\s*ml$/, '');

function findProductBySlug(slug, products) {
  return products.find(p => p.id === slug) || products.find(p => looseProductKey(p.id) === looseProductKey(slug)) || null;
}

function canonicalPathFor(path, search, products, categories) {
  const clean = path.replace(/\/+$/, '') || '/';
  if (clean === '/' || clean === '/index.html') return '/';
  if (clean === '/product.html') {
    const id = new URLSearchParams(search || '').get('id');
    const p = id && findProductBySlug(id, products);
    return p ? `/product/${encodeURIComponent(p.id)}` : null;
  }
  const seg = clean.split('/').filter(Boolean);
  if (seg.length === 2 && seg[0] === 'products') {
    const slug = decodeURIComponent(seg[1]);
    if (categories.some(cat => categorySlug(cat.title) === slug)) return `/products/${slug}`;
    const p = findProductBySlug(slug, products);
    return p ? `/product/${encodeURIComponent(p.id)}` : null;
  }
  if (seg.length === 1 && !seg[0].includes('.')) {
    const slug = decodeURIComponent(seg[0]);
    if (categories.some(cat => categorySlug(cat.title) === slug)) return `/products/${slug}`;
    const p = findProductBySlug(slug, products);
    if (p) return `/product/${encodeURIComponent(p.id)}`;
  }
  return null;
}

async function legacyRedirectFor(path, search = '') {
  const [products, categories] = await Promise.all([readJSON(PRODUCTS_FILE), readJSON(CATEGORIES_FILE)]);
  const target = canonicalPathFor(path, search, products, categories);
  return target && target !== path ? target : null;
}

// Rewrites links inside stored article HTML to their final URLs (so crawlers
// don't hop through redirects). The stored post is not modified.
function rewriteInternalLinks(html, products, categories) {
  return String(html || '').replace(/href="([^"]*)"/gi, (m, href) => {
    const abs = /^https?:\/\/(www\.)?natrio\.pk(?=\/|$|\?)/i;
    if (!abs.test(href) && !href.startsWith('/')) return m;
    const rel = href.replace(abs, '') || '/';
    const [p, q] = rel.split('?');
    const target = canonicalPathFor(p, q ? `?${q}` : '', products, categories);
    return `href="${target || rel}"`;
  });
}

function notFound(c) {
  return c.html(notFoundTemplate, 404, { 'X-Robots-Tag': 'noindex' });
}

// ---------- Blog article page ----------
// Products whose name appears in the article (e.g. "castor", "rosehip"),
// most-mentioned first; falls back to bestsellers.
function relatedProductsForPost(post, products) {
  const text = `${postTitleText(post)} ${htmlToText(post.body)}`.toLowerCase();
  const keyFor = (p) => {
    const words = String(p.title).replace(/natrio organics?/i, '').replace(/\d+\s*ml/i, '').trim().toLowerCase().split(/\s+/);
    return words[0] === 'rose' && words[1] === 'water' ? 'rose water' : words[0];
  };
  const scored = products
    .filter(p => p.stock > 0)
    .map(p => ({ p, n: text.split(keyFor(p)).length - 1 }))
    .filter(x => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .map(x => x.p);
  const fallback = products.filter(p => p.stock > 0 && p.bestseller && !scored.includes(p));
  return [...scored, ...fallback].slice(0, 3);
}

async function renderBlogPost(slug) {
  const [posts, products, categories] = await Promise.all([readJSON(BLOG_FILE), readJSON(PRODUCTS_FILE), readJSON(CATEGORIES_FILE)]);
  const published = publishedPostsNewestFirst(posts);
  const post = published.find(p => p.slug === slug);
  if (!post) return null;

  const title = postTitleText(post);
  const pageUrl = `${SITE_URL}${blogPath(post.slug)}`;
  const description = postSummary(post, 155);
  const imgUrl = post.image ? `${SITE_URL}${post.image}` : `${SITE_URL}/images/logo.png`;
  const validDate = (d) => { const t = d ? new Date(d) : null; return t && !isNaN(t) ? t : null; };
  const publishedAt = validDate(post.date);
  const modifiedAt = validDate(post.updatedAt) || publishedAt;
  const fmt = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Karachi' });

  // One H1 per page: drop a leading body H1 that repeats the title (12 posts
  // have one), and demote any other H1 inside the body to H2.
  const norm = (s) => htmlToText(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
  let body = String(post.body || '').replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i, (m, inner) => (norm(inner) === norm(post.title) ? '' : m));
  body = body.replace(/<h1\b/gi, '<h2').replace(/<\/h1>/gi, '</h2>');
  body = rewriteInternalLinks(body, products, categories);

  const related = relatedProductsForPost(post, products);
  const more = published.filter(p => p.slug !== post.slug).slice(0, 3);

  const articleLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: title,
    description,
    image: [imgUrl],
    url: pageUrl,
    mainEntityOfPage: { '@type': 'WebPage', '@id': pageUrl },
    ...(publishedAt ? { datePublished: publishedAt.toISOString() } : {}),
    ...(modifiedAt ? { dateModified: modifiedAt.toISOString() } : {}),
    author: { '@type': 'Organization', name: 'Natrio Organics', url: `${SITE_URL}/` },
    publisher: { '@type': 'Organization', name: 'Natrio Organics', logo: { '@type': 'ImageObject', url: `${SITE_URL}/images/logo.png` } }
  };
  const crumbLd = breadcrumbJsonLd([['Home', `${SITE_URL}/`], ['Blog', `${SITE_URL}/blog.html`], [title, pageUrl]]);

  const content = `
    <nav class="post-crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span class="sep">/</span><a href="/blog.html">Blog</a><span class="sep">/</span><span>${xmlEscape(title)}</span></nav>
    <article>
      <h1>${xmlEscape(title)}</h1>
      ${publishedAt ? `<div class="post-date"><time datetime="${publishedAt.toISOString()}">${fmt(publishedAt)}</time>${modifiedAt && modifiedAt.getTime() !== publishedAt.getTime() ? ` · Updated <time datetime="${modifiedAt.toISOString()}">${fmt(modifiedAt)}</time>` : ''}</div>` : ''}
      ${post.image ? `<div class="post-image"><img src="${xmlEscape(post.image)}" alt="${xmlEscape(title)}" width="1600" height="900" fetchpriority="high"></div>` : ''}
      <div class="post-body">${body}</div>
    </article>
    ${related.length ? `
    <section class="post-related">
      <h2>Shop the oils from this guide</h2>
      <div class="product-grid">${related.map(ssrProductCard).join('')}</div>
    </section>` : ''}
    ${more.length ? `
    <section class="post-related post-more">
      <h2>More hair &amp; skin care guides</h2>
      <ul>${more.map(p => `<li><a href="${blogPath(p.slug)}">${xmlEscape(postTitleText(p))}</a></li>`).join('')}</ul>
      <p><a href="/blog.html">See all articles</a></p>
    </section>` : ''}`;

  const fill = (tpl, key, value) => tpl.split(`{{${key}}}`).join(value);
  let html = blogPostTemplate;
  html = fill(html, 'TITLE', xmlEscape(`${title} — Natrio Organics`));
  html = fill(html, 'OG_TITLE', xmlEscape(`${title} — Natrio Organics`));
  html = fill(html, 'DESCRIPTION', xmlEscape(description));
  html = fill(html, 'CANONICAL', xmlEscape(pageUrl));
  html = fill(html, 'OG_IMAGE', xmlEscape(imgUrl));
  html = fill(html, 'PUBLISHED', publishedAt ? publishedAt.toISOString() : '');
  html = fill(html, 'MODIFIED', modifiedAt ? modifiedAt.toISOString() : '');
  html = fill(html, 'JSON_LD', `<script type="application/ld+json">${ldJson(articleLd)}</script>\n  <script type="application/ld+json">${ldJson(crumbLd)}</script>`);
  html = fill(html, 'CONTENT', content); // last, so article text is never treated as a placeholder
  return html;
}

// Returns null when the product doesn't exist (caller sends a real 404).
async function renderProductPage(id, requestedVariant) {
  const [products, shippingMethods] = await Promise.all([readJSON(PRODUCTS_FILE), readJSON(SHIPPING_FILE)]);
  const p = id ? products.find(x => x.id === id) : null;
  if (!p) return null;

  const variants = normalizeVariants(p);
  const selected = variants.find(v => v.name === requestedVariant) || variants[0];
  const shortDesc = xmlEscape((p.shortDescription || stripHtml(p.description) || p.title).slice(0, 155));
  const pageUrl = `${SITE_URL}/product/${encodeURIComponent(p.id)}`;
  const imgUrl = p.image ? `${SITE_URL}${p.image}` : `${SITE_URL}/images/logo.png`;
  const inStock = p.stock > 0;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.title,
    image: [p.image, p.hoverImage, p.image3, p.image4].filter(Boolean).map(src => `${SITE_URL}${src}`),
    description: stripHtml(p.description) || p.title,
    sku: p.sku || p.id,
    brand: { '@type': 'Brand', name: 'Natrio Organics' },
    // One Offer per size, each with the same URL and SKU (g:id) the
    // Merchant Center feed uses, so feed, landing page and markup agree.
    offers: variants.map(v => ({
      '@type': 'Offer',
      url: productVariantUrl(p, v, variants.length),
      sku: variantItemId(p, v, variants.length),
      name: variants.length > 1 ? `${p.title} - ${v.name}` : p.title,
      priceCurrency: 'PKR',
      price: v.price.toFixed(2),
      itemCondition: 'https://schema.org/NewCondition',
      availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      seller: { '@type': 'Organization', name: 'Natrio Organics' },
      ...offerPolicies(shippingMethods)
    }))
  };
  const breadcrumbLd = breadcrumbJsonLd([
    ['Home', `${SITE_URL}/`],
    [p.category, `${SITE_URL}/products/${categorySlug(p.category)}`],
    [p.title, pageUrl]
  ]);

  const ssrBreadcrumb = `
    <a href="/">Home</a><span class="sep">/</span>
    <a href="/products/${categorySlug(p.category)}">${xmlEscape(p.category)}</a><span class="sep">/</span>
    <span class="current">${xmlEscape(p.title)}</span>`;

  const ssrContent = `
    <div>
      <div class="pd-gallery-main"><img src="${xmlEscape(imgUrl)}" alt="${xmlEscape(p.title)}" style="width:100%;height:100%;object-fit:cover;"></div>
    </div>
    <div>
      <span class="category" style="font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:${p.category === 'Facial Care' ? 'var(--rose)' : 'var(--gold)'};">${xmlEscape(p.category)}</span>
      <h1 class="pd-title">${xmlEscape(p.title)}</h1>
      <div class="pd-meta">
        <strong>Vendor:</strong> Natrio Organics<br>
        <strong>Availability:</strong> ${inStock ? 'In Stock' : 'Out of Stock'}<br>
        <strong>Category:</strong> ${xmlEscape(p.category)}
      </div>
      <p class="pd-desc">${shortDesc}</p>
      <div class="pd-price">Rs. ${selected.price.toLocaleString()}${variants.length > 1 ? ` <small>(${xmlEscape(selected.name)})</small>` : ''}</div>
      ${variants.length > 1 ? `<p class="pd-sizes">Available sizes: ${variants.map(v => `<a href="${xmlEscape(productVariantUrl(p, v, variants.length).replace(SITE_URL, ''))}">${xmlEscape(v.name)} — Rs. ${v.price.toLocaleString()}</a>`).join(' · ')}</p>` : ''}
      <p>${stripHtml(p.description) ? xmlEscape(stripHtml(p.description)) : ''}</p>
    </div>`;

  return productPageTemplate
    .replace('<title>Product — Natrio Organics</title>', `<title>${xmlEscape(p.title)} — Natrio Organics</title>`)
    .replace(
      '<meta name="description" id="metaDescription" content="Shop pure, cold-pressed oils from Natrio Organics.">',
      `<meta name="description" id="metaDescription" content="${shortDesc}">`
    )
    .replace(
      '<link rel="canonical" id="canonicalLink" href="https://natrio.pk/product.html">',
      `<link rel="canonical" id="canonicalLink" href="${pageUrl}">`
    )
    .replace(
      '<meta property="og:title" id="ogTitle" content="Natrio Organics">',
      `<meta property="og:title" id="ogTitle" content="${xmlEscape(p.title)} — Natrio Organics">`
    )
    .replace(
      '<meta property="og:description" id="ogDescription" content="Shop pure, cold-pressed oils from Natrio Organics.">',
      `<meta property="og:description" id="ogDescription" content="${shortDesc}">`
    )
    .replace(
      '<meta property="og:url" id="ogUrl" content="https://natrio.pk/product.html">',
      `<meta property="og:url" id="ogUrl" content="${pageUrl}">`
    )
    .replace(
      '<meta property="og:image" id="ogImage" content="https://natrio.pk/images/logo.png">',
      `<meta property="og:image" id="ogImage" content="${xmlEscape(imgUrl)}">`
    )
    .replace('</head>', `  <script type="application/ld+json">${ldJson(jsonLd)}</script>\n  <script type="application/ld+json">${ldJson(breadcrumbLd)}</script>\n</head>`)
    .replace('<div class="breadcrumb" id="breadcrumb"></div>', `<div class="breadcrumb" id="breadcrumb">${ssrBreadcrumb}</div>`)
    .replace('<div class="pd-layout" id="pd">Loading…</div>', `<div class="pd-layout" id="pd">${ssrContent}</div>`);
}

app.get('/product/:id', async (c) => {
  const html = await renderProductPage(c.req.param('id'), c.req.query('variant'));
  return html ? c.html(html) : notFound(c);
});

function ssrProductCard(p) {
  const variants = normalizeVariants(p);
  return `
        <div class="product-card">
          <a href="/product/${encodeURIComponent(p.id)}">
            <div class="thumb">
              ${p.image ? `<img src="${xmlEscape(p.image)}" alt="${xmlEscape(p.title)}" loading="lazy">` : `<span class="placeholder">${xmlEscape(p.title)}</span>`}
            </div>
          </a>
          <div class="body">
            <span class="category ${p.category === 'Facial Care' ? 'rose' : ''}">${xmlEscape(p.category || '')}</span>
            <h3><a href="/product/${encodeURIComponent(p.id)}">${xmlEscape(p.title)}</a></h3>
            <div class="price">Rs. ${variants[0].price.toLocaleString()}</div>
          </div>
        </div>`;
}

async function renderProductsPage(categoryTitle) {
  const products = await readJSON(PRODUCTS_FILE);
  const filtered = categoryTitle ? products.filter(p => p.category === categoryTitle) : products;

  const pageTitle = categoryTitle || 'All Products';
  const pageUrl = categoryTitle ? `${SITE_URL}/products/${categorySlug(categoryTitle)}` : `${SITE_URL}/products.html`;
  const description = categoryTitle
    ? `Shop ${categoryTitle} from Natrio Organics — pure, cold-pressed, and made in Pakistan.`
    : `Browse Natrio Organics' full range of pure, cold-pressed hair oils and facial care products. Nationwide delivery across Pakistan.`;

  const ssrGrid = filtered.length ? filtered.map(ssrProductCard).join('') : `<div class="empty-state">No products found.</div>`;

  return productsPageTemplate
    .replace('<title>Shop All Products — Natrio Organics</title>', `<title>${categoryTitle ? `${xmlEscape(categoryTitle)} — Natrio Organics` : 'Shop All Products — Natrio Organics'}</title>`)
    .replace(
      "<meta name=\"description\" content=\"Browse Natrio Organics' full range of pure, cold-pressed hair oils and facial care products. Nationwide delivery across Pakistan.\">",
      `<meta name="description" content="${xmlEscape(description)}">`
    )
    .replace('<link rel="canonical" href="https://natrio.pk/products.html">', `<link rel="canonical" href="${pageUrl}">`)
    .replace(
      '<meta property="og:title" content="Shop All Products — Natrio Organics">',
      `<meta property="og:title" content="${xmlEscape(pageTitle)} — Natrio Organics">`
    )
    .replace(
      "<meta property=\"og:description\" content=\"Browse Natrio Organics' full range of pure, cold-pressed hair oils and facial care products.\">",
      `<meta property="og:description" content="${xmlEscape(description)}">`
    )
    .replace('<meta property="og:url" content="https://natrio.pk/products.html">', `<meta property="og:url" content="${pageUrl}">`)
    .replace('<h1 id="pageTitle">All Products</h1>', `<h1 id="pageTitle">${xmlEscape(pageTitle)}</h1>`)
    .replace('<div class="product-grid" id="grid"></div>', `<div class="product-grid" id="grid">${ssrGrid}</div>`);
}

app.get('/products/:slug', async (c) => {
  const slug = c.req.param('slug');
  const categories = await readJSON(CATEGORIES_FILE);
  const match = categories.find(cat => categorySlug(cat.title) === slug);
  if (match) return c.html(await renderProductsPage(match.title));
  // Older links (e.g. inside blog posts) used /products/<product> — send
  // those to the real product page; anything else is a genuine 404.
  const legacy = await legacyRedirectFor(`/products/${slug}`);
  return legacy ? c.redirect(legacy, 301) : notFound(c);
});

app.get('/products.html', async (c) => {
  const category = c.req.query('category');
  if (category) return c.redirect(`/products/${categorySlug(category)}`, 301);
  return c.html(await renderProductsPage(null));
});

// Bare /product.html (no product) isn't a page of its own any more.
app.get('/product.html', async (c) => {
  const id = c.req.query('id');
  if (id) return c.redirect(`/product/${encodeURIComponent(id)}`, 301);
  return c.redirect('/products.html', 301);
});

// ---------- Blog (server-rendered, clean URLs) ----------
app.get('/blog', (c) => c.redirect('/blog.html', 301));

app.get('/blog.html', async (c) => {
  const posts = publishedPostsNewestFirst(await readJSON(BLOG_FILE));
  const grid = posts.length
    ? posts.map(b => `
        <div class="blog-card">
          <a href="${blogPath(b.slug)}">
            <div class="thumb">${b.image ? `<img src="${xmlEscape(b.image)}" alt="${xmlEscape(postTitleText(b))}" loading="lazy">` : ''}</div>
          </a>
          <div class="body">
            <h3><a href="${blogPath(b.slug)}">${xmlEscape(postTitleText(b))}</a></h3>
            <p>${xmlEscape(postSummary(b, 160))}</p>
            <a class="read-more" href="${blogPath(b.slug)}">Read more</a>
          </div>
        </div>`).join('')
    : `<div class="empty-state">No posts yet — check back soon.</div>`;
  const html = blogIndexTemplate.replace(
    /<div class="blog-grid" id="blogGrid"([^>]*)><\/div>/,
    (m, attrs) => `<div class="blog-grid" id="blogGrid"${attrs}>${grid}</div>`
  );
  return c.html(html);
});

// Old article URLs → permanent redirect to the clean URL. Unknown slugs are
// a real 404 (never redirected to the blog index).
app.get('/blog-post.html', async (c) => {
  const slug = c.req.query('slug');
  if (!slug) return c.redirect('/blog.html', 301);
  const post = publishedPostsNewestFirst(await readJSON(BLOG_FILE)).find(p => p.slug === slug);
  return post ? c.redirect(blogPath(post.slug), 301) : notFound(c);
});

app.get('/blog/:slug', async (c) => {
  const html = await renderBlogPost(c.req.param('slug'));
  return html ? c.html(html) : notFound(c);
});

// ---------- helpers ----------
// Reading the cart must not mutate the session (that would hand every visitor
// a cookie and a Mongo write); routes that add items store the array back.
function getCart(c) {
  return session(c).cart || [];
}

// ---------- Abandoned cart tracking ----------
async function syncCartActivity(c) {
  try {
    const s = session(c);
    const cart = getCart(c);
    const activity = await readJSON(CART_ACTIVITY_FILE);
    const sessionId = c.get('sessionId');

    if (!cart.length) {
      const idx = activity.findIndex(a => a.sessionId === sessionId);
      if (idx !== -1) { activity.splice(idx, 1); await writeJSON(CART_ACTIVITY_FILE, activity); }
      return;
    }

    let email = s.cartEmail || null;
    let name = s.cartName || null;
    if (!email && s.userId) {
      const users = await readJSON(USERS_FILE);
      const user = users.find(u => u.id === s.userId);
      if (user) { email = user.email; name = user.name; }
    }

    const products = await readJSON(PRODUCTS_FILE);
    const items = cart.map(item => {
      const product = products.find(p => p.id === item.productId);
      return {
        productId: item.productId,
        title: product ? product.title : 'Unknown',
        variant: item.variant,
        qty: item.qty,
        price: getVariantPrice(product, item.variant),
        image: product ? product.image : ''
      };
    });

    let entry = activity.find(a => a.sessionId === sessionId);
    if (!entry) {
      entry = { sessionId, createdAt: new Date().toISOString(), status: 'active' };
      activity.push(entry);
    }
    entry.items = items;
    entry.email = email;
    entry.name = name;
    entry.updatedAt = new Date().toISOString();

    await writeJSON(CART_ACTIVITY_FILE, activity);
  } catch (err) {
    console.error('Cart activity tracking error:', err.message);
  }
}

async function markCartRecovered(sessionId) {
  try {
    const activity = await readJSON(CART_ACTIVITY_FILE);
    const idx = activity.findIndex(a => a.sessionId === sessionId);
    if (idx !== -1) { activity.splice(idx, 1); await writeJSON(CART_ACTIVITY_FILE, activity); }
  } catch (err) {
    console.error('Cart activity cleanup error:', err.message);
  }
}

const ABANDONED_CART_HOURS = Number(env.ABANDONED_CART_HOURS) || 1;

async function checkAbandonedCarts() {
  if (!BREVO_API_KEY) return;
  try {
    const activity = await readJSON(CART_ACTIVITY_FILE);
    const now = Date.now();
    let changed = false;

    for (const entry of activity) {
      if (entry.status !== 'active' || !entry.email || !entry.items || !entry.items.length) continue;
      const ageHours = (now - new Date(entry.updatedAt).getTime()) / 36e5;
      if (ageHours < ABANDONED_CART_HOURS) continue;

      const recommended = await getRecommendedProducts(entry.items.map(i => i.productId));
      const sent = await sendMailSafe({
        from: `"Natrio Organics" <${SENDER_EMAIL}>`,
        to: entry.email,
        subject: `You left something in your cart 🌿`,
        html: emailTemplates.abandonedCartEmail(entry, recommended)
      });
      if (sent) {
        entry.status = 'reminded';
        entry.remindedAt = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) await writeJSON(CART_ACTIVITY_FILE, activity);
  } catch (err) {
    console.error('Abandoned cart sweep error:', err.message);
  }
}

const REVIEW_REQUEST_DAYS = Number(env.REVIEW_REQUEST_DAYS) || 3;

async function checkReviewRequests() {
  if (!BREVO_API_KEY) return;
  try {
    const orders = await readJSON(ORDERS_FILE);
    const raw = await readJSON(SETTINGS_FILE);
    const settings = (raw && !Array.isArray(raw)) ? raw : {};
    const now = Date.now();
    let changed = false;

    for (const order of orders) {
      if (order.status !== 'delivered' || order.reviewRequestSent || !order.customer.email) continue;
      const deliveredEntry = (order.statusHistory || []).slice().reverse().find(h => h.status === 'delivered');
      const deliveredAt = deliveredEntry ? new Date(deliveredEntry.date).getTime() : null;
      if (!deliveredAt) continue;
      if ((now - deliveredAt) / 864e5 < REVIEW_REQUEST_DAYS) continue;

      const recommended = await getRecommendedProducts(order.items.map(i => i.productId));
      const sent = await sendMailSafe({
        from: `"Natrio Organics" <${SENDER_EMAIL}>`,
        to: order.customer.email,
        subject: `How was your Natrio Organics order?`,
        html: emailTemplates.reviewRequestEmail(order, recommended, settings.googleReviewUrl)
      });
      if (sent) {
        order.reviewRequestSent = true;
        order.reviewRequestSentAt = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) await writeJSON(ORDERS_FILE, orders);
  } catch (err) {
    console.error('Review request sweep error:', err.message);
  }
}

// ---------- password hashing (same scheme as server.js, so existing accounts keep working) ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
}

const requireCustomer = async (c, next) => {
  if (session(c).userId) return next();
  return c.json({ error: 'Please log in first' }, 401);
};

// ---------- AUTH ROUTES ----------
app.post('/api/auth/signup', async (c) => {
  const { name, email, password } = body(c);
  if (!name || !email || !password) return c.json({ error: 'Name, email, and password are required' }, 400);
  if (password.length < 6) return c.json({ error: 'Password must be at least 6 characters' }, 400);

  const users = await readJSON(USERS_FILE);
  const normalizedEmail = email.trim().toLowerCase();
  if (users.find(u => u.email === normalizedEmail)) {
    return c.json({ error: 'An account with this email already exists. Try logging in instead.' }, 400);
  }
  const user = { id: uuidv4(), name, email: normalizedEmail, passwordHash: hashPassword(password), createdAt: new Date().toISOString() };
  users.push(user);
  await writeJSON(USERS_FILE, users);

  session(c).userId = user.id;
  return c.json({ success: true, user: { id: user.id, name: user.name, email: user.email } });
});

app.post('/api/auth/login', async (c) => {
  const { email, password } = body(c);
  if (!email || !password) return c.json({ error: 'Email and password are required' }, 400);
  const users = await readJSON(USERS_FILE);
  const user = users.find(u => u.email === email.trim().toLowerCase());
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return c.json({ error: 'Incorrect email or password' }, 401);
  }
  session(c).userId = user.id;
  return c.json({ success: true, user: { id: user.id, name: user.name, email: user.email } });
});

app.post('/api/auth/logout', async (c) => {
  session(c).userId = null;
  return c.json({ success: true });
});

app.get('/api/auth/me', async (c) => {
  const userId = session(c).userId;
  if (!userId) return c.json({ user: null });
  const users = await readJSON(USERS_FILE);
  const user = users.find(u => u.id === userId);
  if (!user) return c.json({ user: null });
  return c.json({ user: { id: user.id, name: user.name, email: user.email } });
});

app.get('/api/my-orders', requireCustomer, async (c) => {
  const orders = await readJSON(ORDERS_FILE);
  const mine = orders.filter(o => o.userId === session(c).userId);
  return c.json(mine.slice().reverse());
});

// ---------- PRODUCT / CONTENT ROUTES ----------
app.get('/api/products', async (c) => {
  const products = await readJSON(PRODUCTS_FILE);
  const category = c.req.query('category');
  return c.json(category ? products.filter(p => p.category === category) : products);
});

app.get('/api/products/:id', async (c) => {
  const products = await readJSON(PRODUCTS_FILE);
  const product = products.find(p => p.id === c.req.param('id'));
  if (!product) return c.json({ error: 'Product not found' }, 404);
  return c.json(product);
});

app.get('/api/categories', async (c) => c.json(await readJSON(CATEGORIES_FILE)));

app.get('/api/blog', async (c) => {
  const posts = (await readJSON(BLOG_FILE)).filter(p => p.published !== false);
  return c.json(posts.slice().reverse());
});

app.get('/api/blog/:slug', async (c) => {
  const posts = await readJSON(BLOG_FILE);
  const post = posts.find(p => p.slug === c.req.param('slug') && p.published !== false);
  if (!post) return c.json({ error: 'Post not found' }, 404);
  return c.json(post);
});

app.get('/api/hero', async (c) => c.json(await readJSON(HERO_FILE)));
app.get('/api/shipping', async (c) => c.json(await readJSON(SHIPPING_FILE)));
app.get('/api/instagram', async (c) => c.json(await readJSON(INSTAGRAM_FILE)));
app.get('/api/stores', async (c) => c.json(await readJSON(STORES_FILE)));
app.get('/api/announcements', async (c) => c.json(await readJSON(ANNOUNCEMENTS_FILE)));

app.get('/api/settings', async (c) => {
  const raw = await readJSON(SETTINGS_FILE);
  const settings = (raw && !Array.isArray(raw)) ? raw : {};
  return c.json({
    gaTrackingId: settings.gaTrackingId || '',
    googleReviewUrl: settings.googleReviewUrl || '',
    metaPixelId: settings.metaPixelId || '',
    tiktokPixelId: settings.tiktokPixelId || '',
    googleAdsId: settings.googleAdsId || '',
    googleAdsConversionLabel: settings.googleAdsConversionLabel || '',
    jazzCashNumber: settings.jazzCashNumber || '',
    easypaisaNumber: settings.easypaisaNumber || '',
    walletAccountTitle: settings.walletAccountTitle || '',
    googleMerchantId: settings.googleMerchantId || ''
  });
});

// ---------- Subscribers / mailing list ----------
async function addSubscriber(email, source) {
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return { success: false, isNew: false };
  const normalized = email.trim().toLowerCase();
  const subscribers = await readJSON(SUBSCRIBERS_FILE);
  if (subscribers.find(s => s.email === normalized)) return { success: true, isNew: false };
  subscribers.push({ email: normalized, source: source || 'unknown', subscribedAt: new Date().toISOString(), active: true });
  await writeJSON(SUBSCRIBERS_FILE, subscribers);
  return { success: true, isNew: true };
}

async function sendWelcomeEmail(email) {
  const recommended = await getRecommendedProducts();
  await sendMailSafe({
    from: `"Natrio Organics" <${SENDER_EMAIL}>`,
    to: email,
    subject: `Welcome to Natrio Organics 🌿`,
    html: emailTemplates.welcomeSubscriberEmail(recommended)
  });
}

app.get('/api/newsletter/unsubscribe', async (c) => {
  const email = c.req.query('email');
  if (!email) return c.text('Missing email.', 400);
  const subscribers = await readJSON(SUBSCRIBERS_FILE);
  const sub = subscribers.find(s => s.email === String(email).trim().toLowerCase());
  if (sub) {
    sub.active = false;
    await writeJSON(SUBSCRIBERS_FILE, subscribers);
  }
  // (server.js echoed the raw email here; escaped now to avoid HTML injection)
  return c.html(`<html><body style="font-family:sans-serif;padding:40px;text-align:center;"><h2>You've been unsubscribed</h2><p>${xmlEscape(email)} will no longer receive marketing emails from Natrio Organics.</p></body></html>`);
});

app.post('/api/newsletter/subscribe', async (c) => {
  const { email } = body(c);
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return c.json({ error: 'Please enter a valid email address' }, 400);
  const result = await addSubscriber(email, 'newsletter_form');
  if (result.isNew) bg(sendWelcomeEmail(email.trim().toLowerCase()));
  return c.json({ success: true });
});

app.post('/api/discounts/validate', async (c) => {
  const { code, subtotal } = body(c);
  if (!code) return c.json({ error: 'Enter a discount code' }, 400);

  const discounts = await readJSON(DISCOUNTS_FILE);
  const discount = discounts.find(d => d.code.toLowerCase() === String(code).trim().toLowerCase());
  if (!discount) return c.json({ error: 'That discount code isn\'t valid' }, 404);
  if (discount.active === false) return c.json({ error: 'That discount code is no longer active' }, 400);
  if (discount.expiresAt && new Date(discount.expiresAt) < new Date()) return c.json({ error: 'That discount code has expired' }, 400);
  if (discount.minSubtotal && Number(subtotal) < discount.minSubtotal) {
    return c.json({ error: `This code requires a minimum order of Rs. ${discount.minSubtotal}` }, 400);
  }
  const amountOff = discount.type === 'percent'
    ? Math.round(Number(subtotal) * (discount.value / 100))
    : Math.min(discount.value, Number(subtotal));
  return c.json({ success: true, code: discount.code, type: discount.type, value: discount.value, amountOff });
});

app.post('/api/contact', async (c) => {
  const { name, email, phone, message } = body(c);
  if (!name || !email || !message) return c.json({ error: 'Name, email, and message are required' }, 400);

  const entry = { id: uuidv4().slice(0, 8), name, email, phone: phone || '', message, date: new Date().toISOString(), emailed: false };
  entry.emailed = await sendContactEmail(entry);

  const messages = await readJSON(MESSAGES_FILE);
  messages.push(entry);
  await writeJSON(MESSAGES_FILE, messages);
  return c.json({ success: true });
});

// ---------- CART ROUTES ----------
app.get('/api/cart', async (c) => {
  const cart = getCart(c);
  const products = cart.length ? await readJSON(PRODUCTS_FILE) : [];
  const detailed = cart.map(item => {
    const product = products.find(p => p.id === item.productId);
    const unitPrice = getVariantPrice(product, item.variant);
    return { ...item, product, unitPrice };
  });
  const subtotal = detailed.reduce((sum, i) => sum + i.unitPrice * i.qty, 0);
  return c.json({ items: detailed, subtotal });
});

app.post('/api/cart/add', async (c) => {
  const { productId, variant, qty } = body(c);
  const products = await readJSON(PRODUCTS_FILE);
  const product = products.find(p => p.id === productId);
  if (!product) return c.json({ error: 'Product not found' }, 404);

  const cart = getCart(c);
  const existing = cart.find(i => i.productId === productId && i.variant === variant);
  if (existing) {
    existing.qty += (qty || 1);
  } else {
    const defaultVariant = (product.variants || [])[0];
    const defaultVariantName = (typeof defaultVariant === 'object' && defaultVariant !== null) ? defaultVariant.name : defaultVariant;
    cart.push({ productId, variant: variant || defaultVariantName, qty: qty || 1 });
  }
  session(c).cart = cart;
  bg(syncCartActivity(c));
  return c.json({ success: true, cartCount: cart.reduce((n, i) => n + i.qty, 0) });
});

app.post('/api/cart/update', async (c) => {
  const { productId, variant, qty } = body(c);
  const item = getCart(c).find(i => i.productId === productId && i.variant === variant);
  if (item) item.qty = Math.max(1, qty);
  bg(syncCartActivity(c));
  return c.json({ success: true });
});

app.post('/api/cart/remove', async (c) => {
  const { productId, variant } = body(c);
  session(c).cart = getCart(c).filter(i => !(i.productId === productId && i.variant === variant));
  bg(syncCartActivity(c));
  return c.json({ success: true });
});

app.post('/api/cart/set-email', async (c) => {
  const { email, name } = body(c);
  if (email && /^\S+@\S+\.\S+$/.test(email)) {
    session(c).cartEmail = email.trim().toLowerCase();
    if (name) session(c).cartName = name;
    bg(syncCartActivity(c));
  }
  return c.json({ success: true });
});

// ---------- CHECKOUT / ORDER ROUTES ----------
app.post('/api/checkout', async (c) => {
  const { name, email, phone, address, city, paymentMethod, shippingMethodId, discountCode, subscribeNewsletter, notes, paymentProofUrl } = body(c);
  const s = session(c);
  const cart = getCart(c);
  if (!cart.length) return c.json({ error: 'Cart is empty' }, 400);
  if (!name || !email || !phone || !address || !city) {
    return c.json({ error: 'Name, email, phone, address, and city are all required' }, 400);
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) return c.json({ error: 'Please enter a valid email address' }, 400);
  const cleanedPhone = String(phone).replace(/[\s-]/g, '');
  if (!/^(03\d{9}|\+923\d{9})$/.test(cleanedPhone)) {
    return c.json({ error: 'Please enter a valid Pakistani mobile number (e.g. 03xx-xxxxxxx)' }, 400);
  }
  if ((paymentMethod === 'jazzcash' || paymentMethod === 'easypaisa') && !paymentProofUrl) {
    return c.json({ error: 'Please upload a screenshot of your payment before placing the order.' }, 400);
  }

  const products = await readJSON(PRODUCTS_FILE);
  for (const item of cart) {
    const product = products.find(p => p.id === item.productId);
    if (!product) return c.json({ error: 'One of the items in your cart is no longer available.' }, 400);
    if (product.stock < item.qty) {
      return c.json({ error: `Sorry, only ${product.stock} left of "${product.title}". Please update your cart.` }, 400);
    }
  }

  const items = cart.map(item => {
    const product = products.find(p => p.id === item.productId);
    return {
      productId: item.productId,
      title: product ? product.title : 'Unknown',
      variant: item.variant,
      qty: item.qty,
      price: getVariantPrice(product, item.variant)
    };
  });
  const subtotal = items.reduce((sum, i) => sum + i.price * i.qty, 0);

  let discountAmount = 0;
  let appliedDiscountCode = null;
  if (discountCode) {
    const discounts = await readJSON(DISCOUNTS_FILE);
    const discount = discounts.find(d => d.code.toLowerCase() === String(discountCode).trim().toLowerCase());
    if (discount && discount.active !== false && (!discount.expiresAt || new Date(discount.expiresAt) >= new Date()) && (!discount.minSubtotal || subtotal >= discount.minSubtotal)) {
      discountAmount = discount.type === 'percent' ? Math.round(subtotal * (discount.value / 100)) : Math.min(discount.value, subtotal);
      appliedDiscountCode = discount.code;
    }
  }

  const shippingMethods = await readJSON(SHIPPING_FILE);
  const method = shippingMethods.find(m => m.id === shippingMethodId) || shippingMethods[0];
  if (!method) return c.json({ error: 'No shipping method available. Please contact the store.' }, 400);
  const shipping = (method.freeThreshold && subtotal >= method.freeThreshold) ? 0 : method.cost;
  const total = Math.max(0, subtotal - discountAmount + shipping);

  const order = {
    id: uuidv4().slice(0, 8).toUpperCase(),
    userId: s.userId || null,
    date: new Date().toISOString(),
    customer: { name, email, phone, address, city },
    items,
    subtotal,
    discountCode: appliedDiscountCode,
    discountAmount,
    shippingMethod: method.name,
    shipping,
    total,
    paymentMethod: paymentMethod || 'cod',
    paymentProofUrl: paymentProofUrl || null,
    paymentVerified: (paymentMethod || 'cod') === 'cod',
    status: 'pending',
    statusHistory: [{ status: 'pending', date: new Date().toISOString() }],
    notes: notes || ''
  };

  const orders = await readJSON(ORDERS_FILE);
  orders.push(order);
  await writeJSON(ORDERS_FILE, orders);

  for (const item of cart) {
    const product = products.find(p => p.id === item.productId);
    if (product) product.stock = Math.max(0, product.stock - item.qty);
  }
  await writeJSON(PRODUCTS_FILE, products);

  s.cart = [];
  s.cartEmail = null;
  s.cartName = null;
  bg(markCartRecovered(c.get('sessionId')));

  if (subscribeNewsletter) {
    const subResult = await addSubscriber(email, 'checkout');
    if (subResult.isNew) bg(sendWelcomeEmail(email.trim().toLowerCase()));
  }

  bg(sendOrderConfirmationEmails(order));
  return c.json({ success: true, orderId: order.id, total: order.total });
});

app.get('/api/order/:id', async (c) => {
  const orders = await readJSON(ORDERS_FILE);
  const order = orders.find(o => o.id === c.req.param('id'));
  if (!order) return c.json({ error: 'Order not found' }, 404);
  return c.json(order);
});

// ---------- SIMPLE ADMIN (password protected) ----------
const ADMIN_PASSWORD = env.ADMIN_PASSWORD || 'natrio-admin-2026';

const requireAdmin = async (c, next) => {
  if (session(c).isAdmin) return next();
  return c.json({ error: 'Not authorized' }, 401);
};

// ---------- Image uploads (stored in MongoDB `uploads`) ----------
// Compression now happens in the browser before upload (public/image-compress.js),
// since sharp is a native module that can't run on Workers.
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

async function readUploadedImage(c, fieldName) {
  let form;
  try {
    form = await c.req.formData();
  } catch (_) {
    return { error: 'No file was uploaded' };
  }
  const file = form.get(fieldName);
  if (!file || typeof file === 'string') return { error: 'No file was uploaded' };
  if (!String(file.type || '').startsWith('image/')) return { error: 'Only image files are allowed' };
  if (file.size > MAX_UPLOAD_BYTES) return { error: 'File too large' }; // multer's wording
  return { form, file, data: Buffer.from(await file.arrayBuffer()) };
}

app.post('/api/admin/upload', requireAdmin, async (c) => {
  const up = await readUploadedImage(c, 'image');
  if (up.error) return c.json({ error: up.error }, 400);

  const label = (up.form.get('label') || '').toString().trim();
  const slug = label ? label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60) : '';
  const id = slug ? `${slug}-${uuidv4().slice(0, 8)}` : uuidv4();

  const db = await getDb();
  await db.collection('uploads').insertOne({
    _id: id,
    contentType: up.file.type,
    filename: up.file.name,
    data: up.data,
    uploadedAt: new Date().toISOString()
  });
  return c.json({ success: true, url: `/uploads/${id}` });
});

app.post('/api/checkout/upload-payment-proof', async (c) => {
  const up = await readUploadedImage(c, 'proof');
  if (up.error) return c.json({ error: up.error }, 400);

  const id = uuidv4();
  const db = await getDb();
  await db.collection('uploads').insertOne({
    _id: id,
    contentType: up.file.type,
    filename: up.file.name,
    data: up.data,
    uploadedAt: new Date().toISOString(),
    isPaymentProof: true
  });
  return c.json({ success: true, url: `/uploads/${id}` });
});

// Uploads never change once written, so they're cached at the Cloudflare edge
// after the first request — repeat views don't touch Mongo at all.
app.get('/uploads/:id', async (c) => {
  const cache = caches.default;
  const cacheKey = new Request(new URL(c.req.url).toString(), { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const db = await getDb();
  const doc = await db.collection('uploads').findOne({ _id: c.req.param('id') });
  if (!doc) return c.text('Not found', 404);

  const d = doc.data;
  const bytes = d && d.buffer instanceof Uint8Array
    ? d.buffer.subarray(0, typeof d.position === 'number' ? d.position : d.buffer.length)
    : d;
  const res = new Response(bytes, {
    headers: {
      'Content-Type': doc.contentType || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable'
    }
  });
  // Payment screenshots are private-ish; don't put them in the shared edge cache.
  if (!doc.isPaymentProof) c.executionCtx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
});

app.post('/api/admin/recompress-uploads', requireAdmin, async (c) => {
  return c.json({
    error: 'Server-side recompression isn\'t available on Cloudflare Workers. New uploads are already compressed in your browser before they\'re sent.'
  }, 400);
});

app.post('/api/admin/login', async (c) => {
  if (body(c).password === ADMIN_PASSWORD) {
    session(c).isAdmin = true;
    return c.json({ success: true });
  }
  return c.json({ error: 'Wrong password' }, 401);
});

app.get('/api/admin/orders', requireAdmin, async (c) => c.json(await readJSON(ORDERS_FILE)));

app.get('/api/admin/dashboard', requireAdmin, async (c) => {
  const [orders, products] = await Promise.all([readJSON(ORDERS_FILE), readJSON(PRODUCTS_FILE)]);
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  const startOfToday = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  const validOrders = orders.filter(o => o.status !== 'cancelled');

  function statsSince(sinceTimestamp) {
    const inRange = validOrders.filter(o => new Date(o.date).getTime() >= sinceTimestamp);
    return { revenue: inRange.reduce((sum, o) => sum + (o.total || 0), 0), orders: inRange.length };
  }

  const salesByProduct = {};
  validOrders
    .filter(o => new Date(o.date).getTime() >= now - 30 * DAY)
    .forEach(o => {
      (o.items || []).forEach(item => {
        if (!salesByProduct[item.productId]) salesByProduct[item.productId] = { title: item.title, qty: 0, revenue: 0 };
        salesByProduct[item.productId].qty += item.qty;
        salesByProduct[item.productId].revenue += item.price * item.qty;
      });
    });

  return c.json({
    today: statsSince(startOfToday),
    last7: statsSince(now - 7 * DAY),
    last30: statsSince(now - 30 * DAY),
    allTime: statsSince(0),
    pendingOrdersCount: orders.filter(o => o.status === 'pending').length,
    lowStockCount: products.filter(p => p.stock > 0 && p.stock <= 15).length,
    outOfStockCount: products.filter(p => p.stock === 0).length,
    topProducts: Object.values(salesByProduct).sort((a, b) => b.qty - a.qty).slice(0, 5)
  });
});

app.get('/api/admin/messages', requireAdmin, async (c) => c.json((await readJSON(MESSAGES_FILE)).slice().reverse()));
app.get('/api/admin/subscribers', requireAdmin, async (c) => c.json((await readJSON(SUBSCRIBERS_FILE)).slice().reverse()));

app.delete('/api/admin/subscribers/:email', requireAdmin, async (c) => {
  let subscribers = await readJSON(SUBSCRIBERS_FILE);
  subscribers = subscribers.filter(s => s.email !== c.req.param('email').toLowerCase());
  await writeJSON(SUBSCRIBERS_FILE, subscribers);
  return c.json({ success: true });
});

app.post('/api/admin/campaign/send', requireAdmin, async (c) => {
  const { subject, body: campaignBody, testEmail } = body(c);
  if (!subject || !campaignBody) return c.json({ error: 'Subject and body are required' }, 400);
  if (!BREVO_API_KEY) return c.json({ error: 'Email isn\'t configured yet. Set BREVO_API_KEY first — see the README.' }, 400);

  if (testEmail) {
    const ok = await sendMailSafe({
      from: `"Natrio Organics" <${SENDER_EMAIL}>`,
      to: testEmail,
      subject: `[TEST] ${subject}`,
      html: `<div style="font-family:sans-serif;font-size:15px;line-height:1.7;color:#222;">${campaignBody}</div>`
    });
    if (!ok) return c.json({ error: 'Failed to send test email after retrying. Check your SMTP settings.' }, 500);
    return c.json({ success: true, test: true });
  }

  const subscribers = (await readJSON(SUBSCRIBERS_FILE)).filter(s => s.active !== false);
  if (!subscribers.length) return c.json({ error: 'There are no active subscribers to send to yet.' }, 400);

  const origin = new URL(c.req.url).origin;
  let sent = 0;
  let failed = 0;
  for (const sub of subscribers) {
    const unsubscribeUrl = `${origin}/api/newsletter/unsubscribe?email=${encodeURIComponent(sub.email)}`;
    const ok = await sendMailSafe({
      from: `"Natrio Organics" <${SENDER_EMAIL}>`,
      to: sub.email,
      subject,
      html: `<div style="font-family:sans-serif;font-size:15px;line-height:1.7;color:#222;">${campaignBody}</div>
             <hr style="margin:24px 0;border:none;border-top:1px solid #ddd;">
             <p style="font-size:12px;color:#888;">You're receiving this because you subscribed to Natrio Organics updates.
             <a href="${unsubscribeUrl}">Unsubscribe</a></p>`
    });
    if (ok) sent++; else failed++;
  }
  return c.json({ success: true, sent, failed, total: subscribers.length });
});

app.get('/api/admin/blog', requireAdmin, async (c) => c.json((await readJSON(BLOG_FILE)).slice().reverse()));

function slugify(title) {
  return title.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

app.post('/api/admin/blog', requireAdmin, async (c) => {
  const { title, excerpt, body: postBody, image, published } = body(c);
  if (!title || !postBody) return c.json({ error: 'Title and body are required' }, 400);

  const posts = await readJSON(BLOG_FILE);
  let slug = slugify(title);
  let suffix = 1;
  while (posts.find(p => p.slug === slug)) { slug = `${slugify(title)}-${suffix++}`; }

  const post = {
    id: uuidv4().slice(0, 8), slug, title,
    excerpt: excerpt || '', body: postBody, image: image || '',
    published: published !== false,
    date: new Date().toISOString()
  };
  posts.push(post);
  await writeJSON(BLOG_FILE, posts);
  return c.json({ success: true, post });
});

app.put('/api/admin/blog/:id', requireAdmin, async (c) => {
  const posts = await readJSON(BLOG_FILE);
  const idx = posts.findIndex(p => p.id === c.req.param('id'));
  if (idx === -1) return c.json({ error: 'Post not found' }, 404);

  const { title, excerpt, body: postBody, image, published } = body(c);
  if (title && title !== posts[idx].title) {
    let slug = slugify(title);
    let suffix = 1;
    while (posts.find((p, i) => p.slug === slug && i !== idx)) { slug = `${slugify(title)}-${suffix++}`; }
    posts[idx].slug = slug;
  }
  posts[idx] = {
    ...posts[idx],
    title: title ?? posts[idx].title,
    excerpt: excerpt ?? posts[idx].excerpt,
    body: postBody ?? posts[idx].body,
    image: image ?? posts[idx].image,
    published: published !== undefined ? published : posts[idx].published,
    updatedAt: new Date().toISOString()
  };
  await writeJSON(BLOG_FILE, posts);
  return c.json({ success: true, post: posts[idx] });
});

app.delete('/api/admin/blog/:id', requireAdmin, async (c) => {
  const posts = (await readJSON(BLOG_FILE)).filter(p => p.id !== c.req.param('id'));
  await writeJSON(BLOG_FILE, posts);
  return c.json({ success: true });
});

app.put('/api/admin/orders/:id/verify-payment', requireAdmin, async (c) => {
  const orders = await readJSON(ORDERS_FILE);
  const order = orders.find(o => o.id === c.req.param('id'));
  if (!order) return c.json({ error: 'Order not found' }, 404);
  order.paymentVerified = true;
  await writeJSON(ORDERS_FILE, orders);
  return c.json({ success: true, order });
});

app.put('/api/admin/orders/:id/status', requireAdmin, async (c) => {
  const { status, trackingUrl } = body(c);
  const validStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
  if (!validStatuses.includes(status)) return c.json({ error: 'Invalid status' }, 400);

  const orders = await readJSON(ORDERS_FILE);
  const order = orders.find(o => o.id === c.req.param('id'));
  if (!order) return c.json({ error: 'Order not found' }, 404);

  const wasCancelled = order.status === 'cancelled';
  const wasShipped = order.status === 'shipped';
  const wasDelivered = order.status === 'delivered';
  order.status = status;
  if (status === 'shipped' && trackingUrl) order.trackingUrl = trackingUrl;
  if (!order.statusHistory) order.statusHistory = [];
  order.statusHistory.push({ status, date: new Date().toISOString() });
  await writeJSON(ORDERS_FILE, orders);

  if (status === 'cancelled' && !wasCancelled) {
    const products = await readJSON(PRODUCTS_FILE);
    for (const item of order.items) {
      const product = products.find(p => p.id === item.productId);
      if (product) product.stock += item.qty;
    }
    await writeJSON(PRODUCTS_FILE, products);
  } else if (status !== 'cancelled' && wasCancelled) {
    const products = await readJSON(PRODUCTS_FILE);
    for (const item of order.items) {
      const product = products.find(p => p.id === item.productId);
      if (product) product.stock = Math.max(0, product.stock - item.qty);
    }
    await writeJSON(PRODUCTS_FILE, products);
  }

  if (status === 'shipped' && !wasShipped) bg(sendOrderStatusEmail(order, 'shipped'));
  if (status === 'delivered' && !wasDelivered) bg(sendOrderStatusEmail(order, 'delivered'));
  if (status === 'cancelled' && !wasCancelled) bg(sendOrderStatusEmail(order, 'cancelled'));

  return c.json({ success: true, order });
});

app.get('/api/admin/categories', requireAdmin, async (c) => c.json(await readJSON(CATEGORIES_FILE)));

app.post('/api/admin/categories', requireAdmin, async (c) => {
  const { title, image } = body(c);
  if (!title) return c.json({ error: 'Category title is required' }, 400);
  const categories = await readJSON(CATEGORIES_FILE);
  const category = { title, url: `/products/${categorySlug(title)}`, image: image || '' };
  categories.push(category);
  await writeJSON(CATEGORIES_FILE, categories);
  return c.json({ success: true, category });
});

app.put('/api/admin/categories/:index', requireAdmin, async (c) => {
  const categories = await readJSON(CATEGORIES_FILE);
  const idx = parseInt(c.req.param('index'));
  if (!categories[idx]) return c.json({ error: 'Category not found' }, 404);
  const { title, image } = body(c);
  categories[idx] = {
    title: title || categories[idx].title,
    url: `/products/${categorySlug(title || categories[idx].title)}`,
    image: image !== undefined ? image : categories[idx].image
  };
  await writeJSON(CATEGORIES_FILE, categories);
  return c.json({ success: true, category: categories[idx] });
});

app.delete('/api/admin/categories/:index', requireAdmin, async (c) => {
  const categories = await readJSON(CATEGORIES_FILE);
  const idx = parseInt(c.req.param('index'));
  if (!categories[idx]) return c.json({ error: 'Category not found' }, 404);
  categories.splice(idx, 1);
  await writeJSON(CATEGORIES_FILE, categories);
  return c.json({ success: true });
});

app.get('/api/admin/shipping', requireAdmin, async (c) => c.json(await readJSON(SHIPPING_FILE)));

app.put('/api/admin/shipping', requireAdmin, async (c) => {
  const methods = body(c).methods;
  if (!Array.isArray(methods)) return c.json({ error: 'methods must be an array' }, 400);
  if (methods.length < 1) return c.json({ error: 'At least one shipping method is required' }, 400);

  for (const m of methods) {
    if (!m.name || m.cost === undefined || m.cost === null || isNaN(Number(m.cost))) {
      return c.json({ error: 'Each method needs a name and a numeric cost' }, 400);
    }
    if (!m.id) m.id = m.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || uuidv4().slice(0, 8);
    m.cost = Number(m.cost);
    m.freeThreshold = m.freeThreshold === '' || m.freeThreshold === undefined ? null : Number(m.freeThreshold);
  }
  await writeJSON(SHIPPING_FILE, methods);
  return c.json({ success: true, methods });
});

app.get('/api/admin/discounts', requireAdmin, async (c) => c.json(await readJSON(DISCOUNTS_FILE)));

app.post('/api/admin/discounts', requireAdmin, async (c) => {
  const { code, type, value, minSubtotal, expiresAt } = body(c);
  if (!code || !type || value === undefined || value === null || isNaN(Number(value))) {
    return c.json({ error: 'Code, type, and a numeric value are required' }, 400);
  }
  if (!['percent', 'fixed'].includes(type)) return c.json({ error: 'Type must be "percent" or "fixed"' }, 400);

  const discounts = await readJSON(DISCOUNTS_FILE);
  const normalizedCode = String(code).trim().toUpperCase();
  if (discounts.find(d => d.code === normalizedCode)) return c.json({ error: 'A discount with this code already exists' }, 400);

  const discount = {
    id: uuidv4().slice(0, 8),
    code: normalizedCode,
    type,
    value: Number(value),
    minSubtotal: minSubtotal ? Number(minSubtotal) : null,
    expiresAt: expiresAt || null,
    active: true
  };
  discounts.push(discount);
  await writeJSON(DISCOUNTS_FILE, discounts);
  return c.json({ success: true, discount });
});

app.put('/api/admin/discounts/:id', requireAdmin, async (c) => {
  const discounts = await readJSON(DISCOUNTS_FILE);
  const idx = discounts.findIndex(d => d.id === c.req.param('id'));
  if (idx === -1) return c.json({ error: 'Discount not found' }, 404);

  const { code, type, value, minSubtotal, expiresAt, active } = body(c);
  if (code) discounts[idx].code = String(code).trim().toUpperCase();
  if (type) discounts[idx].type = type;
  if (value !== undefined) discounts[idx].value = Number(value);
  if (minSubtotal !== undefined) discounts[idx].minSubtotal = minSubtotal ? Number(minSubtotal) : null;
  if (expiresAt !== undefined) discounts[idx].expiresAt = expiresAt || null;
  if (active !== undefined) discounts[idx].active = !!active;

  await writeJSON(DISCOUNTS_FILE, discounts);
  return c.json({ success: true, discount: discounts[idx] });
});

app.delete('/api/admin/discounts/:id', requireAdmin, async (c) => {
  const discounts = (await readJSON(DISCOUNTS_FILE)).filter(d => d.id !== c.req.param('id'));
  await writeJSON(DISCOUNTS_FILE, discounts);
  return c.json({ success: true });
});

app.get('/api/admin/instagram', requireAdmin, async (c) => c.json(await readJSON(INSTAGRAM_FILE)));

app.put('/api/admin/instagram', requireAdmin, async (c) => {
  const posts = body(c).posts;
  if (!Array.isArray(posts)) return c.json({ error: 'posts must be an array' }, 400);
  for (const p of posts) {
    if (!p.image || !p.postUrl) return c.json({ error: 'Each post needs an image and a post URL' }, 400);
  }
  await writeJSON(INSTAGRAM_FILE, posts);
  return c.json({ success: true, posts });
});

app.get('/api/admin/stores', requireAdmin, async (c) => c.json(await readJSON(STORES_FILE)));

app.put('/api/admin/stores', requireAdmin, async (c) => {
  const stores = body(c).stores;
  if (!Array.isArray(stores)) return c.json({ error: 'stores must be an array' }, 400);
  for (const s of stores) {
    if (!s.name) return c.json({ error: 'Each store needs a name' }, 400);
  }
  await writeJSON(STORES_FILE, stores);
  return c.json({ success: true, stores });
});

app.get('/api/admin/announcements', requireAdmin, async (c) => c.json(await readJSON(ANNOUNCEMENTS_FILE)));

app.put('/api/admin/announcements', requireAdmin, async (c) => {
  const announcements = body(c).announcements;
  if (!Array.isArray(announcements)) return c.json({ error: 'announcements must be an array' }, 400);
  const cleaned = announcements.map(a => String(a).trim()).filter(Boolean);
  if (!cleaned.length) return c.json({ error: 'Add at least one announcement message' }, 400);
  await writeJSON(ANNOUNCEMENTS_FILE, cleaned);
  return c.json({ success: true, announcements: cleaned });
});

app.get('/api/admin/settings', requireAdmin, async (c) => {
  const raw = await readJSON(SETTINGS_FILE);
  return c.json((raw && !Array.isArray(raw)) ? raw : {});
});

app.put('/api/admin/settings', requireAdmin, async (c) => {
  const { gaTrackingId, googleReviewUrl, metaPixelId, tiktokPixelId, googleAdsId, googleAdsConversionLabel, jazzCashNumber, easypaisaNumber, walletAccountTitle, googleMerchantId } = body(c);
  const settings = {
    gaTrackingId: gaTrackingId || '',
    googleReviewUrl: googleReviewUrl || '',
    metaPixelId: metaPixelId || '',
    tiktokPixelId: tiktokPixelId || '',
    googleAdsId: googleAdsId || '',
    googleAdsConversionLabel: googleAdsConversionLabel || '',
    jazzCashNumber: jazzCashNumber || '',
    easypaisaNumber: easypaisaNumber || '',
    walletAccountTitle: walletAccountTitle || '',
    googleMerchantId: googleMerchantId || ''
  };
  await writeJSON(SETTINGS_FILE, settings);
  return c.json({ success: true, settings });
});

app.get('/api/admin/abandoned-carts', requireAdmin, async (c) => c.json((await readJSON(CART_ACTIVITY_FILE)).slice().reverse()));

app.post('/api/admin/abandoned-carts/:sessionId/remind', requireAdmin, async (c) => {
  const activity = await readJSON(CART_ACTIVITY_FILE);
  const entry = activity.find(a => a.sessionId === c.req.param('sessionId'));
  if (!entry) return c.json({ error: 'Cart not found' }, 404);
  if (!entry.email) return c.json({ error: 'This cart has no email on file to send to' }, 400);

  const recommended = await getRecommendedProducts((entry.items || []).map(i => i.productId));
  const sent = await sendMailSafe({
    from: `"Natrio Organics" <${SENDER_EMAIL}>`,
    to: entry.email,
    subject: `You left something in your cart 🌿`,
    html: emailTemplates.abandonedCartEmail(entry, recommended)
  });
  if (!sent) return c.json({ error: 'Failed to send reminder after retrying.' }, 500);

  entry.status = 'reminded';
  entry.remindedAt = new Date().toISOString();
  await writeJSON(CART_ACTIVITY_FILE, activity);
  return c.json({ success: true });
});

app.delete('/api/admin/abandoned-carts/:sessionId', requireAdmin, async (c) => {
  const activity = (await readJSON(CART_ACTIVITY_FILE)).filter(a => a.sessionId !== c.req.param('sessionId'));
  await writeJSON(CART_ACTIVITY_FILE, activity);
  return c.json({ success: true });
});

app.get('/api/admin/hero', requireAdmin, async (c) => c.json(await readJSON(HERO_FILE)));

app.put('/api/admin/hero', requireAdmin, async (c) => {
  let slides = body(c).slides;
  if (!Array.isArray(slides)) return c.json({ error: 'slides must be an array' }, 400);
  if (slides.length > 3) slides = slides.slice(0, 3);
  if (slides.length < 1) return c.json({ error: 'At least one hero slide is required' }, 400);
  await writeJSON(HERO_FILE, slides);
  return c.json({ success: true, slides });
});

app.post('/api/admin/products', requireAdmin, async (c) => {
  const b = body(c);
  const { title, category, price, stock, description } = b;
  if (!title || !category || price === undefined || price === null || isNaN(Number(price))) {
    return c.json({ error: 'Title, category, and a numeric price are required' }, 400);
  }

  const products = await readJSON(PRODUCTS_FILE);
  let id = slugify(title);
  let suffix = 1;
  while (products.find(p => p.id === id)) { id = `${slugify(title)}-${suffix++}`; }

  const variants = Array.isArray(b.variants) && b.variants.length
    ? b.variants.map(v => (typeof v === 'object' && v !== null)
        ? { name: v.name, price: (v.price === null || v.price === undefined || v.price === '' || isNaN(Number(v.price))) ? Number(price) : Number(v.price) }
        : { name: v, price: Number(price) })
    : (typeof b.variants === 'string' && b.variants.trim()
        ? b.variants.split(',').map(v => ({ name: v.trim(), price: Number(price) })).filter(v => v.name)
        : [{ name: 'Default', price: Number(price) }]);

  const newProduct = {
    id,
    title,
    category,
    price: Number(price),
    compareAtPrice: b.compareAtPrice ? Number(b.compareAtPrice) : null,
    shortDescription: b.shortDescription || '',
    description: description || '',
    image: b.image || '',
    hoverImage: b.hoverImage || '',
    image3: b.image3 || '',
    image4: b.image4 || '',
    variants,
    stock: stock !== undefined && stock !== '' ? Math.max(0, parseInt(stock)) : 0,
    featured: !!b.featured,
    bestseller: !!b.bestseller,
    sku: b.sku || '',
    ingredients: b.ingredients || '',
    howToUse: b.howToUse || '',
    benefits: b.benefits || '',
    updatedAt: new Date().toISOString()
  };
  products.push(newProduct);
  await writeJSON(PRODUCTS_FILE, products);
  return c.json({ success: true, product: newProduct });
});

app.put('/api/admin/products/:id', requireAdmin, async (c) => {
  const products = await readJSON(PRODUCTS_FILE);
  const idx = products.findIndex(p => p.id === c.req.param('id'));
  if (idx === -1) return c.json({ error: 'Not found' }, 404);

  const b = { ...body(c) };
  if (b.price !== undefined) b.price = Number(b.price);
  if (b.compareAtPrice !== undefined) b.compareAtPrice = b.compareAtPrice ? Number(b.compareAtPrice) : null;
  if (b.stock !== undefined) b.stock = Math.max(0, parseInt(b.stock) || 0);
  if (typeof b.variants === 'string') {
    b.variants = b.variants.split(',').map(v => ({ name: v.trim(), price: b.price })).filter(v => v.name);
    if (!b.variants.length) b.variants = [{ name: 'Default', price: b.price }];
  } else if (Array.isArray(b.variants)) {
    b.variants = b.variants.map(v => (typeof v === 'object' && v !== null)
      ? { name: v.name, price: (v.price === null || v.price === undefined || v.price === '' || isNaN(Number(v.price))) ? b.price : Number(v.price) }
      : { name: v, price: b.price });
  }
  b.featured = !!b.featured;
  b.bestseller = !!b.bestseller;
  b.updatedAt = new Date().toISOString();

  products[idx] = { ...products[idx], ...b };
  await writeJSON(PRODUCTS_FILE, products);
  return c.json({ success: true, product: products[idx] });
});

app.delete('/api/admin/products/:id', requireAdmin, async (c) => {
  const products = (await readJSON(PRODUCTS_FILE)).filter(p => p.id !== c.req.param('id'));
  await writeJSON(PRODUCTS_FILE, products);
  return c.json({ success: true });
});

// ---------- Static files (everything in ../public) ----------
app.all('*', async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  if (res.status !== 404 || !['GET', 'HEAD'].includes(c.req.method)) return res;
  const url = new URL(c.req.url);
  // Only page-like paths get the HTML treatment; missing images/scripts stay plain 404s.
  const last = url.pathname.split('/').pop();
  if (last.includes('.') && !last.endsWith('.html')) return res;
  if (url.pathname.startsWith('/api/')) return c.json({ error: 'Not found' }, 404);
  const legacy = await legacyRedirectFor(url.pathname, url.search);
  return legacy ? c.redirect(legacy, 301) : notFound(c);
});

// ---------- Cron: abandoned carts every 15 min, review requests hourly ----------
async function runSweeps(scheduledTime) {
  await checkAbandonedCarts();
  if (new Date(scheduledTime).getUTCMinutes() < 15) await checkReviewRequests();
  // keeps expired sessions from piling up (cheap no-op once the index exists)
  const db = await getDb();
  await db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {});
}

export default {
  fetch: app.fetch,
  async scheduled(controller, _env, ctx) {
    const rc = newRequestContext();
    ctx.waitUntil(als.run(rc, async () => {
      try {
        await runSweeps(controller.scheduledTime);
      } finally {
        await finishRequestContext(rc);
      }
    }));
  }
};
