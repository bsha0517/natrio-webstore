# Natrio Organics — Self-Hosted Store

A lightweight, self-hosted ecommerce site (Node.js + Express) with no monthly
platform fees. Full control over your data, design, and checkout flow.

## What's included
- Homepage, product listing, product detail, cart, checkout, order confirmation
- Server-side cart (session based) and orders saved to `data/orders.json`
- Cash on Delivery checkout working out of the box
- Placeholder options for Card / JazzCash / Easypaisa (need merchant setup — see below)
- Simple password-protected admin page at `/admin.html` to view orders

## 1. Run it locally (to preview before going live)

You'll need [Node.js](https://nodejs.org) installed (version 18+).

```bash
cd natrio-store
npm install
npm start
```

Then open **http://localhost:3000** in your browser.

## 2. Add your real product photos

Put images in `public/images/` and reference them in `data/products.json`
under each product's `"image"` field, e.g. `"/images/olive-hair-oil.jpg"`.
If no image is set, a text placeholder is shown instead — nothing will break.

## 3. Edit products / prices

Open `data/products.json` in any text editor. Each product looks like:

```json
{
  "id": "olive-hair-oil",
  "title": "Olive Hair Oil",
  "category": "Hair Oils",
  "price": 260,
  "description": "...",
  "image": "/images/olive-hair-oil.jpg",
  "variants": ["60ml", "100ml"],
  "stock": 100,
  "featured": true
}
```

Add a new product by copying an existing block and giving it a unique `id`.
Restart the server (`npm start`) after editing.

## 4. View orders

Go to **/admin.html**, log in with the password set in `ADMIN_PASSWORD`
(default: `natrio-admin-2026` — **change this before going live**, see step 6).

## 5. Deploying to Render.com (recommended)

Render runs your app as a normal, always-on Node.js server — not a
serverless function — so this project works there with **no code changes**.
(Vercel does not work with this project — see note at the bottom of this section.)

**Steps:**
1. Create a free GitHub account if you don't have one, and upload this
   whole `natrio-store` folder as a new repository.
2. Go to [render.com](https://render.com), sign up, click **New +** → **Web Service**.
3. Connect your GitHub repo. Render will detect `render.yaml` automatically
   and pre-fill the build command (`npm install`) and start command (`npm start`).
4. When prompted, set the `ADMIN_PASSWORD` environment variable to something
   only you know (this protects `/admin.html`). `SESSION_SECRET` is generated
   for you automatically.
5. Click **Deploy**. After a couple of minutes you'll get a live URL like
   `natrio-store.onrender.com`.
6. To use your own domain (natrio.pk), go to your Render service → **Settings**
   → **Custom Domains**, add `natrio.pk`, and create the CNAME/A record it
   gives you at your domain registrar (wherever you bought natrio.pk).

**⚠️ Important — data persistence on Render's free tier:**
This project stores orders and products in JSON files on disk
(`data/orders.json`, `data/products.json`). Render's **free tier** wipes the
disk on every redeploy and restart — so accumulated orders could be lost.
For a real store taking real orders, either:
- Upgrade to a **paid Render plan and add a Persistent Disk** (Render →
  your service → **Disks** → mount at `/opt/render/project/src/data`), or
- Move orders to a proper database later (e.g. a free tier of
  Postgres/MongoDB) — worth asking a developer to help with this once
  you're getting consistent orders.

For testing and getting the site live to look at, the free tier is fine.
Just don't rely on it yet for orders you can't afford to lose.

**Why Vercel didn't work:** Vercel runs your backend as short-lived,
read-only serverless functions, so it can't write to `orders.json` or hold
cart sessions in memory the way this project expects — that's what caused
the `FUNCTION_INVOCATION_FAILED` error. Render (and Railway) don't have
this limitation.

## 6. Before going live — security checklist

- [ ] Change `ADMIN_PASSWORD` (set as an environment variable, don't hardcode)
- [ ] Change `SESSION_SECRET` to a long random string
- [ ] Set up HTTPS (Railway/Render provide this automatically; a VPS needs Let's Encrypt/Certbot)
- [ ] Back up `data/orders.json` and `data/products.json` regularly

## 7. Payments — going beyond Cash on Delivery

Cash on Delivery works immediately with no setup. For card / JazzCash /
Easypaisa, you need a merchant account with that provider, then wire their
SDK into `server.js` at the `/api/checkout` route:

- **Stripe** (international cards): sign up at stripe.com, get API keys,
  use `stripe.paymentIntents.create()` before marking the order as paid.
- **JazzCash / Easypaisa**: apply for a merchant account directly with them
  (or via a payment aggregator like PayFast, SafePay, or PayMob — these
  bundle multiple Pakistani payment methods behind one integration, which
  is usually easier than integrating each wallet separately).

This is genuinely the part of the project that benefits most from a
developer's help for a few hours — payment integrations involve handling
webhooks and verifying signatures correctly for security.

## 8. Project structure

```
natrio-store/
  server.js              → backend (routes for products, cart, checkout, admin)
  data/
    products.json         → your product catalog (edit directly)
    orders.json            → orders placed by customers (auto-created)
  public/
    index.html              → homepage
    products.html            → shop / category listing
    product.html              → single product page
    cart.html                  → shopping cart
    checkout.html               → checkout form
    order-confirmation.html      → thank-you page
    admin.html                    → password-protected order viewer
    style.css                      → all site styling (colors, fonts, layout)
    script.js                       → shared header/footer + cart logic
```

## 9. Customizing the look

All colors, fonts, and spacing live in `public/style.css` at the top under
`:root { ... }`. Change `--olive`, `--gold`, `--cream` to shift the palette
without touching any other file.
