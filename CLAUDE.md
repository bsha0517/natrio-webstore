# Natrio Organics — natrio.pk (project handoff for Claude Code)

Self-hosted ecommerce store for cold-pressed oils in Pakistan. Owner: Haroon (Lahore). No Shopify, no WordPress.
Repo: github.com/bsha0517/natrio-webstore (auto-deploys to Render on push).

## Stack
- Node 20.x, Express 4, express-session (MemoryStore), multer (memory, 5MB), sharp (WebP), uuid, mongodb v6.
- Data: MongoDB Atlas. `readJSON(key)` / `writeJSON(key, data)` use one doc per key in collection `store` (`{_id:key, data:[...]}`).
  Keys: products, orders, categories, blog, hero, users, shipping, discounts, instagram, subscribers, messages, stores, cartActivity, settings, announcements.
- Uploads: stored in Mongo collection `uploads` (`{_id, contentType, filename, data, uploadedAt}`), served at `/uploads/:id`. Compressed with sharp (1600px max, WebP q80).
- Hosting: Render Starter web service. Render blocks outbound SMTP, so email uses the Brevo HTTPS API (`sendMailSafe`, 15s timeout, 3 tries).
- Seed data in `data/*.json` (only used by `migrate-to-mongo.js`; never re-import over live data).

## Env vars (render.yaml)
SESSION_SECRET, ADMIN_PASSWORD (MUST be changed from the public default), MONGODB_URI, NODE_VERSION=20.18.0, BREVO_API_KEY, SENDER_EMAIL, CONTACT_EMAIL. Optional: ABANDONED_CART_HOURS, REVIEW_REQUEST_DAYS, SITE_URL.
Atlas network access must allow 0.0.0.0/0 (Render IPs change; the "SSL alert 80" error was this).

## Layout
- `server.js` — all routes (~77), SSR, sitemap, product feed, uploads, checkout, sweeps.
- `email-templates.js` — HTML emails (orderPlaced, cancelled, shipped, delivered, welcomeSubscriber, abandonedCart, reviewRequest, newOrderOwner). White header, logo, recommended products.
- `public/` — static pages + `script.js` (header/footer, cart count, announcement bar, analytics/pixels, Customer Reviews badge, newsletter) + `style.css`.
- `public/admin.html` — admin panel (tabs: Dashboard, Orders, Products, Categories, Shipping, Discounts, Instagram, Store Locations, Announcement Bar, Abandoned Carts, Settings, Hero Slider, Blog, Messages, Marketing).
- `migrate-to-mongo.js` — one-off seed import.
- `worker/` — **PRODUCTION** since 2026-11-10: Cloudflare Worker `natrio-store` (Hono) serving natrio.pk + www. All route changes go in `worker/src/index.js`; `server.js` is the retired Render/Express app (kept for history, not deployed). Header/footer markup lives in `worker/src/layout.js` (server-rendered; `script.js` only adds behaviour). Deploy = `cd worker && npx wrangler deploy` (manual; no CI). See `worker/README.md`. Uploads are compressed client-side by `public/image-compress.js` (no sharp on Workers).
- `seo/` — `test-seo.mjs` regression suite (run against local `wrangler dev` seeded by `seed-local-from-prod.cjs`, or production with `READ_ONLY=1`), audit and implementation reports.
- Blog articles are server-rendered at `/blog/<slug>` (old `/blog-post.html?slug=` 301s). Unknown products/categories/articles return real 404s (`public/404.html`). Bump `CACHE_VERSION` in worker/src/index.js whenever cached HTML changes shape.

## Key behaviours
- SSR: server.js string-replaces placeholders in index/product/products HTML so crawlers see content; client JS then re-renders the same containers.
- Clean URLs: `/product/:id`, `/products/:slug`. Old `?id=` / `?category=` URLs 301-redirect.
- Canonical redirect: www.natrio.pk, natrio.com.pk, natrioorganics.com → https://natrio.pk.
- SEO: dynamic /sitemap.xml, robots.txt (Disallow /api/admin/ only — do NOT block /api/ or /uploads/), JSON-LD (Store, Product, Article, FAQPage), llms.txt, /product-feed.xml (Google Merchant), `X-Powered-By` disabled, sr-only H1 fallback when hero heading is empty.
- Variants: `variants:[{name,price}]` priced via `getVariantPrice`.
- Payments: COD + manual JazzCash/Easypaisa (screenshot upload, admin `paymentVerified`). No gateway yet (SafePay/PayFast candidates).
- Sweeps (setInterval): abandoned carts every 15 min, review requests hourly.
- Tracking (configured in admin Settings, loaded by `loadAnalytics()`): GA4 purchase, Google Ads, Meta Pixel, TikTok Pixel, Google Customer Reviews (merchant_id in settings).

## Gotchas / lessons
- Always `node -c server.js` and syntax-check inline page scripts after edits. An over-escaped apostrophe once broke order-confirmation.html (and purchase tracking).
- Parenthesize chained awaits: `(await readJSON('x')).slice(...)`.
- Empty-string settings: use explicit checks, not `||` fallbacks (hero text bug).
- Global `input{width:100%}` affects radios/checkboxes; override locally.
- Don't reintroduce an admin "import seed data" button (overwrote live data).
- Product images must be real uploaded files; placeholder `/images/*.jpg` paths don't exist.
- express-session uses MemoryStore (admin logins reset on deploy; fine for one instance).

## Pending / ideas
- Request Merchant Center re-review; confirm Customer Reviews opt-in/badge; verify GA4 purchase in Realtime.
- Search Console "page resources couldn't be loaded" is mostly third-party font CDN; check Screenshot tab renders homepage.
- Off-page SEO: Google Business Profile, backlinks, reviews, content.
- Payment gateway; order tracking page; loyalty/referral; Terms page; uptime monitoring; Mongo backups; branded 404; spam protection on forms; persistent session store.
