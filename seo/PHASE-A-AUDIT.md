# Natrio Organics — Phase A SEO audit (read-only)

Date: 2026-11-10. Method: code review of `worker/src/index.js` and `public/*.html`, plus a bounded crawl of https://natrio.pk (GET only, ~3 req/s, 53 requests) and browser rendering of sample pages. **No Search Console data was available**, so nothing below is an observed GSC status; GSC classifications are listed as expected outcomes to verify.

## 1. Production architecture (verified)

| Item | Finding |
|---|---|
| Production app | Cloudflare Worker `natrio-store` (Hono), version deployed 2026-11-10 from this folder via `wrangler deploy` |
| Custom domains | `natrio.pk`, `www.natrio.pk` → `natrio-store` (Cloudflare API) |
| Alternate domains | `natrio.com.pk`, `natrioorganics.com` → zone redirect rules → `https://natrio.pk/<path>` (301) |
| Data | MongoDB Atlas (`store`, `uploads`, `sessions` collections) |
| Edge cache | Public GETs cached (60 s fresh + stale-while-revalidate, generation bump on writes) |
| **Discrepancy** | GitHub repo `bsha0517/natrio-webstore` was last pushed 2026-08-24 and has **no `worker/` folder**; the local folder is not a git repo. Production code exists only in this folder. There is no CI and there are no tests. |
| Legacy | `server.js` (Express/Render) is no longer serving traffic. CLAUDE.md still describes Render as the host. |

## 2. Baseline (measured)

| Metric | Value |
|---|---|
| Published products | 8 (all in stock) |
| Categories | 2 (Hair Oils: 7 products, Facial Care: 2) |
| Published blog articles | 18 |
| Sitemap URLs | 37 (all return 200); 18 have `<lastmod>` (blog only) |
| URLs that are technically indexable with correct raw HTML | 19 (home, products list, 2 categories, 8 products, 7 info pages) |
| URLs in sitemap whose raw canonical points elsewhere | **18** (all blog articles → `/blog.html`) |
| Broken internal links (raw HTML) | 0 found |
| robots.txt | Valid; allows everything public; blocks admin/cart/checkout/account pages and `/api/admin/` only; declares sitemap |
| `noindex` on public pages | None (only on admin/cart/checkout/account/login/signup — correct) |
| Googlebot-UA requests | 200, no challenge (UA test only; not proof that real Googlebot is not challenged) |
| Response time, cached (HIT/STALE) | 0.40–0.75 s |
| Response time, cache MISS (Atlas) | 1.4–1.8 s |
| Product feed | 200, 11 items (8 products, variants split) |

## 3. Findings by priority

### P0 — Critical

**P0-1. Blog articles cannot be indexed as themselves.** Every article at `/blog-post.html?slug=…` returns the *same* raw HTML:
- `<title>Blog — Natrio Organics</title>` and an identical meta description (18 duplicates)
- `<link rel="canonical" href="https://natrio.pk/blog.html">`
- body = "Loading…", no H1, no article text, no Article JSON-LD (all added later by JavaScript)

Google reads the raw canonical before rendering. 18 near-identical shells, each declaring `/blog.html` as canonical, will most likely be reported as **"Alternate page with proper canonical tag"**, **"Duplicate, Google chose different canonical than user"** or **"Crawled – currently not indexed"**. The sitemap still lists all 18, which contradicts the canonical.
Root cause: `public/blog-post.html` renders entirely client-side, and the Worker has no SSR route for blog posts. *(Confirmed in code and on the live site.)*

### P1 — High

**P1-1. Soft 404s.** Unknown URLs return 200 with template pages:
- `/product/does-not-exist-xyz` → 200, title "Product — Natrio Organics", canonical `/product.html`, "Loading…"
- `/products/no-such-category` → 200, a full copy of the all-products page
- `/blog-post.html?slug=does-not-exist` → 200 shell

These are typical **"Soft 404"** sources. Deleted products would also stay 200 forever.

**P1-2. `/product.html` serves an empty, self-canonical page** (200, no H1, "Loading…"). It is an indexable thin page.

**P1-3. Important internal links exist only after JavaScript runs.** The header and footer navigation is injected by `script.js`, and the blog index lists posts client-side. In raw HTML:
- the blog index (`/blog.html`, 17 words) links to **no** articles, so the articles are orphans except via the sitemap
- `/about-us.html`, `/faq.html`, `/blog.html`, `/shipping-policy.html`, `/privacy-policy.html`, `/find-us-in-store.html` and `/products.html` have **0** raw-HTML inbound links

Google renders JavaScript, but rendering is deferred and links found only after rendering are discovered more slowly.

**P1-4. Merchant feed variant links.** Variant items (e.g. `olive-hair-oil-100ml` at 850 PKR) link to `/product/olive-hair-oil`, which shows the 60 ml price (520) by default, and the structured data is an AggregateOffer. This is a likely cause of Merchant Center **price mismatch** disapprovals. Fix: variant-specific landing URLs (e.g. `?variant=100ml`) that preselect the variant and render its price.

**P1-5. Production source not under version control** (see §1). This is a change-control risk; any fix should start with getting this folder into git.

### P2 — Medium

| ID | Finding | Evidence |
|---|---|---|
| P2-1 | Duplicate Product JSON-LD after JavaScript runs (server block plus client block) | rendered DOM of `/product/castor-oil`: 2 × Product |
| P2-2 | Product offers use `AggregateOffer` only; no `shippingDetails` or `hasMerchantReturnPolicy` | Merchant listing rich results need `Offer` per variant |
| P2-3 | Main content is client-rendered on `/faq.html` (28 raw words; FAQPage schema client-only), `/find-us-in-store.html` (30) and `/blog.html` (17) | crawl word counts |
| P2-4 | `/products/facial-care` is thin (28 words, 2 products); category pages have no intro copy | crawl |
| P2-5 | No `<lastmod>` for products, categories or static pages | sitemap |
| P2-6 | Trailing slash `/product/olive-hair-oil/` returns 404 instead of a 301 | probe |
| P2-7 | Related-product images have empty `alt`; the product template contains an `<img>` with an empty `src` | crawl and rendered DOM |
| P2-8 | `/products.html` title reads "All Products — Shop All Products — Natrio Organics" | crawl |
| P2-9 | Contact page meta description is 53 characters | crawl |
| P2-10 | `http://www.natrio.pk` takes 2 redirect hops | redirect test |
| P2-11 | Cache MISS costs 1.4–1.8 s TTFB (a new Atlas connection per request) | timings |

### P3 — Long-term
Blog slugs contain `-amp-` (from `&amp;` in titles; changing them needs 301s); no editable SEO fields in admin; thin product copy (160–205 words); keyword-to-page mapping; Store/Organization schema review; Core Web Vitals field data (needs GSC/CrUX).

### Correct and expected (no action needed)
`?utm_*` / `fbclid` URLs canonicalize to the clean URL; `/index.html` canonicalizes to `/`; `/products.html?category=…` and `/product.html?id=…` 301 to clean URLs (GSC: "Page with redirect", expected); alternate domains 301 with the path kept; robots.txt is correct; private pages are `noindex`; feed prices match the product data.

## 4. What I could not verify (needs your input)

1. **Search Console**: the Page indexing report export (all reasons, with example URLs), plus URL Inspection on one blog post, one product and one category (Google-selected canonical, crawl time, rendered screenshot).
2. **Cloudflare security** (the wrangler token has no zone-settings scope): in the dashboard for natrio.pk, check **Security → Bots** (Bot Fight Mode / Super Bot Fight Mode settings for verified bots), **Security → WAF** custom and rate-limiting rules, and **Security → Events** filtered on "Googlebot".
3. **Version control**: how to bring this folder under git (see the proposed plan).
4. **Outage note**: natrio.pk returned **503** (Render suspended) for a period on 2026-11-10 before the Worker cutover. Any "Server error (5xx)" entries from that window should clear on re-crawl.

## 5. Proposed fix plan (Phase C, after approval)

1. Server-render blog posts at clean URLs `/blog/<slug>`, with real title, description, self-canonical, H1, body, Article and Breadcrumb JSON-LD, and related-product links. 301 `/blog-post.html?slug=x` → `/blog/x`. Update the sitemap with real `lastmod`. **(P0-1)**
2. Real 404s (status 404 plus a branded noindex page) for unknown products, categories and blog slugs; 301 `/product.html` → `/products.html`; trailing slash → 301. **(P1-1, P1-2, P2-6)**
3. Server-render the blog index list, header and footer navigation links (as plain `<a>` tags) and the FAQ content. **(P1-3, P2-3)**
4. Product JSON-LD: one block (server only), an `Offer` per variant with `?variant=` URLs; the product page preselects the variant from the URL; feed links per variant. **(P1-4, P2-1, P2-2)**
5. Small fixes: alt text, empty image, titles and descriptions, sitemap `lastmod`. **(P2)**
6. `seo/` regression test script (crawl + assertions) runnable against local and production.
