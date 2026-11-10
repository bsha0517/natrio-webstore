# natrio.pk on Cloudflare Workers

This folder is the Cloudflare Workers version of `../server.js`. It serves the
same pages from `../public`, uses the same MongoDB Atlas data (collections
`store` and `uploads`) and the same `../email-templates.js`. The Render app
keeps working unchanged until DNS is switched.

## What changed compared to server.js

| Before (Render / Node) | Now (Workers) |
|---|---|
| Express | Hono (`src/index.js`), same URLs and JSON responses |
| `express.static` | Workers Static Assets from `../public` |
| express-session in memory (logins lost on every deploy) | `sid` cookie + Mongo `sessions` collection (7 days; TTL index created by the cron) |
| One shared Mongo connection | One connection per request, closed after the response and any background emails |
| multer + sharp (server-side WebP) | `request.formData()` + in-browser WebP via `public/image-compress.js` (1600px, q0.8) |
| "Recompress old uploads" admin button | Returns a message saying it's not available; new uploads are already compressed |
| `setInterval` sweeps | Cron Trigger `*/15 * * * *` (abandoned carts every run, review requests hourly) |
| `/uploads/:id` read from Mongo every time | Cached at the Cloudflare edge after the first view (payment screenshots excluded) |
| Every page reads Mongo | Public GETs (home, product/category pages, sitemap, feed, `/api/products`, categories, blog, hero, settings…) are edge-cached. A copy is fresh for 60 s, then served stale while it refreshes in the background. Any save to public data (admin edits, checkout stock changes) bumps a cache generation so the next view is fresh. The response header `X-Cache` shows MISS, HIT or STALE. Cart, checkout, accounts and admin are never cached. Tune with the `CACHE_FRESH_SECONDS` variable. |

Customer carts and admin logins from the old site don't carry over (different
cookie), so everyone starts with an empty cart once. Customer accounts,
passwords and orders are unaffected.

## Requirements

- **Workers Paid plan ($5/month).** The free plan allows only 10 ms of CPU per
  request. Opening a TLS connection to Atlas and checking passwords with scrypt
  both use more than that.
- Atlas Network Access must still allow `0.0.0.0/0`, because Workers connect
  from many IP addresses.

## Run locally

```bash
npm install
cp .dev.vars.example .dev.vars   # then fill in the real values
npm run dev                      # http://localhost:8787
```

To test the cron without waiting: `npx wrangler dev --test-scheduled`, then open
`http://localhost:8787/__scheduled?cron=*/15+*+*+*+*`.

## Status (2026-11-10)

Live. natrio.pk is served by this Worker. Its custom domain was attached in
the Cloudflare dashboard, not in `wrangler.jsonc`. `wrangler deploy` leaves
dashboard-attached domains alone, so keep the `routes` block commented out
unless you move the domains into config. The secrets (MONGODB_URI,
ADMIN_PASSWORD, …) are also set in the dashboard. Never add them as plain-text
variables, because `wrangler deploy` replaces those with what's in `vars`.

## Deploy and cut over

1. `npx wrangler login`
2. Set the secrets (each command prompts for the value):
   ```bash
   npx wrangler secret put MONGODB_URI
   npx wrangler secret put ADMIN_PASSWORD
   npx wrangler secret put BREVO_API_KEY
   npx wrangler secret put SENDER_EMAIL
   npx wrangler secret put CONTACT_EMAIL
   ```
3. `npm run deploy`, then test on the `*.workers.dev` URL it prints: browse,
   add to cart, check out with COD, log in to admin, upload an image.
4. Add natrio.pk (and natrio.com.pk, natrioorganics.com) to Cloudflare as
   zones, and update the nameservers at the registrar.
5. Uncomment the `routes` block in `wrangler.jsonc` and add the other domains
   as custom domains too, so the Worker's canonical redirect sends them to
   natrio.pk. Then deploy again.
6. Once natrio.pk is served by the Worker, suspend the Render service. Don't
   run both at the same time for long: the Render app also runs the cron
   sweeps, so reminder emails would go out twice.
