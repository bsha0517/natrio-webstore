# Natrio Organics — Phase B SEO recovery: implementation report

Date: 2026-11-10 · Branch: `seo-recovery` (local only, **not pushed, not deployed**)

## 1. Issues fixed

| Audit ID | Issue | Fix |
|---|---|---|
| **P0-1** | 18 blog articles served an empty shell with `canonical → /blog.html` | Server-rendered at **`/blog/<slug>`**: unique title, description, self-canonical, one H1, full article body in raw HTML, date (`<time>`), image, BlogPosting + BreadcrumbList JSON-LD, breadcrumbs, 3 related-product cards, 3 "more guides" links. `/blog-post.html?slug=x` → **301** `/blog/x`; unknown/unpublished slug → **404** (never redirected to the blog index). Stored posts are not modified. |
| P0-1 (data) | 12 article bodies contain their own `<h1>` duplicating the title; titles stored as `&amp;` | At render time the duplicate leading H1 is dropped (other body H1s become H2s) and titles are decoded before escaping. |
| P0-1 (links) | 14 in-article links went to `/hair-oils` (404) or `/products/natrio-organics-*` (soft-200 shop copy) | Rewritten to their final URLs at render time, and also 301-redirected (`/hair-oils` → `/products/hair-oils`, `/products/natrio-organics-castor-oil` → `/product/castor-oil`, …). |
| **P1-1** | Soft 404s | Unknown product, category, article and page URLs now return **HTTP 404** with a branded `noindex` page (`public/404.html`) linking to the shop, categories and blog. Missing images/scripts stay plain 404s; `/api/*` stays JSON. |
| **P1-2** | `/product.html` empty, self-canonical page | 301 → `/products.html` (`/product.html?id=x` still 301s to the product). |
| **P1-3** | Navigation and blog lists only existed after JavaScript ran | Header and footer are now server-rendered on every storefront page (`worker/src/layout.js`), so all main links (categories, all products, blog, about, FAQ, contact, shipping, privacy) are in the raw HTML. `script.js` no longer builds them; it only adds behaviour, so there are no duplicate menus. The blog index and the homepage "latest articles" are server-rendered. Visual design unchanged. |
| **P1-4** | Merchant feed variants landed on a page showing another size's price | Feed `<link>` is now `/product/<id>?variant=<size>`. The page renders that size's price server-side and preselects it in the size dropdown. Prices are unchanged. |
| P2-1 | Duplicate Product JSON-LD after JavaScript | Client-side Product JSON-LD removed; the server emits exactly one Product block plus a BreadcrumbList. |
| P2-2 | AggregateOffer only | One `Offer` per size (price, PKR, availability, url and sku identical to the feed's `g:id`), plus `shippingDetails` (Rs. 275, PK, 1–3 days, from shipping settings) and `hasMerchantReturnPolicy` (7 days, buyer pays return shipping, from shipping-policy.html). No ratings or reviews added. |
| P2-5 | No `lastmod` except blog | Blog `lastmod` = updated or published date; products get `lastmod` once edited (admin saves now record `updatedAt`). No invented dates. |
| P2-6 | Trailing slash → 404 | 301 to the slash-less URL (with a guard against `//host` open redirects). |
| P2-7 | `<img src="">` on product pages | Removed. |
| P2-8 | "All Products — Shop All Products" title | Fixed to "Shop All Products — Natrio Organics". |
| P1-5 | Production source not in git | See §4. |

Cache: `/blog.html` and `/blog/<slug>` join the edge cache. `CACHE_VERSION` was bumped to `v2`, so no page cached by the old version is served after deploy.

## 2. Files changed (`git diff 07a74b7..seo-recovery`)

| File | Change |
|---|---|
| `worker/src/index.js` | Blog SSR + redirects, 404s, legacy-link resolver, product Offers/variants, feed links, sitemap, trailing slash, layout middleware, cache version, `updatedAt` on admin edits |
| `worker/src/layout.js` (new) | Server-rendered header/footer |
| `public/blog-post.html` | Now a server template (client fetch removed) |
| `public/404.html` (new) | Branded 404 page (`noindex`) |
| `public/blog.html`, `public/index.html` | Links → `/blog/<slug>`; blog index keeps the server list |
| `public/product.html` | `?variant=` preselect; client JSON-LD removed; empty `src` removed |
| `public/script.js` | Header/footer markup removed (server renders it); behaviour kept |
| `seo/test-seo.mjs`, `seo/seed-local-from-prod.cjs` (new) | Regression suite + safe local seeding |
| `CLAUDE.md` | Production = Worker; server.js retired; new conventions |

Not changed: checkout, cart, payments, admin panel, analytics/pixels, robots.txt, prices, product data, MongoDB schema.

## 3. Tests

Run on the **Cloudflare Workers runtime** (`wrangler dev` / workerd) against a local MongoDB seeded with the **live catalogue and all 18 articles** (read via the public API; no customer data):

**528 passed, 0 failed.** Coverage:
- each of the 18 articles: 200, self-canonical, unique title and description, single H1 = title, >300 words of raw HTML, BlogPosting fields, published date matches stored date, breadcrumb, product links, no broken legacy links, old URL 301 → new
- blog index links to all 18 in raw HTML; unpublished draft → 404
- 404s: unknown article (both URL forms), product, category, page; plus `noindex` and helpful navigation
- 8 redirects; open-redirect guards
- all 8 products: canonical, H1, one Product JSON-LD, an Offer per variant at the correct price, shipping and return policy, breadcrumb, category link, `?variant=` price + clean canonical
- both categories link all their products
- navigation links + single header/footer on 7 page types; admin.html untouched
- sitemap: valid, absolute, no duplicates, contains every article, product and category; **every sitemap URL returns 200, is indexable and self-canonical**
- robots.txt; all 11 feed items land on a 200 page showing the feed price, with matching JSON-LD sku/price/url
- cart add, variant subtotal, COD checkout, stock decrement, order totals, cart emptied

Browser check (local): article and product pages render with one header and footer; the mobile menu toggle works; the announcement bar loads; `?variant=100ml` selects 100 ml at Rs. 450.

**Production data:** unaffected. All writes in testing went to the local Docker MongoDB; production was only read through public GET endpoints.

## 4. Git status

- Local repo created on top of the existing GitHub history (48 commits; nothing rewritten).
- `07a74b7` = snapshot of the exact source currently deployed (Worker version 5ecaafe0).
- `seo-recovery` = this work, one commit on top.
- Nothing pushed. Secrets scan clean (only placeholder connection strings); `.dev.vars`, `.env*`, `node_modules`, `.wrangler` are git-ignored. The seed `data/*.json` holds no customer records.
- **Recommended:** push `main` (snapshot) and `seo-recovery` to GitHub as normal (non-force) pushes, then merge `seo-recovery` via PR. GitHub's existing history is preserved. There is no CI and no deploy hook (Render is suspended), so pushing deploys nothing.

## 5. Deployment plan (needs your approval)

1. `cd worker && npx wrangler deploy` (deploys this branch's code; secrets and custom domains untouched).
2. Smoke test: `BASE=https://natrio.pk READ_ONLY=1 node seo/test-seo.mjs` (GET-only; ~600 requests at 4/s, ~3 min).
3. Spot-check in a browser: home, one article, one product with `?variant=`, checkout page loads.

**Rollback** (instant, no data migration involved): `cd worker && npx wrangler rollback 5ecaafe0-7bc3-4432-9d8f-6d5df513fd8f`, or Dashboard → Workers → natrio-store → Deployments → roll back. Edge-cached pages from the new version will be ignored by the old one (different cache key version).

Cloudflare changes required: **none**.

## 6. After deploy — manual actions

**Search Console**
1. Sitemaps → resubmit `https://natrio.pk/sitemap.xml`.
2. URL Inspection → *Test live URL* on 2–3 `/blog/<slug>` pages; confirm the rendered HTML shows the article and Google-selected canonical = the URL itself. Then *Request indexing* for the highest-value articles (Google allows only a handful of requests per day; the sitemap covers the rest).
3. Page indexing report → for "Alternate page with proper canonical", "Duplicate, Google chose different canonical", "Soft 404" and "Crawled – currently not indexed" → *Validate fix*. Old `/blog-post.html` URLs will move to "Page with redirect" (expected).
4. Rich results test on one product and one article.

**Merchant Center:** Products → Feeds → *Fetch now*; check price-mismatch disapprovals clear over the next crawl.

**Cloudflare dashboard (not visible to my token):** Security → Bots / WAF / Events — confirm no rule challenges verified Googlebot.

## 7. Remaining (not done in this phase)

- FAQ and Find-us-in-store content is still JavaScript-rendered (thin raw HTML; FAQPage schema client-only) — P2-3.
- Category pages have no intro copy; `/products/facial-care` is thin (2 products) — P2-4/P3.
- Article slugs contain `-amp-` (left as-is; changing them would need another redirect layer).
- `http://www.natrio.pk` → 2 redirect hops (zone-level; harmless).
- Cache-miss TTFB is still 1.4–1.8 s (an Atlas connection per miss).
- Keyword map, content plan, admin SEO fields — P3.
- No Search Console data has been reviewed yet; actual GSC exclusion reasons are unverified.
