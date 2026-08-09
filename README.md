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

## 5. Deploying to the internet (so customers can actually visit it)

Cheapest reliable options for a Node.js app like this:

- **Railway.app** or **Render.com** — free/cheap tiers, connect your GitHub repo, auto-deploys. Easiest for non-technical users.
- **A VPS** (DigitalOcean, Linode, Hostinger VPS) — more control, ~$5/month, but you manage the server yourself (or pay a freelancer a small one-time fee to set it up with PM2 + Nginx).
- **cPanel hosting with Node.js support** — many Pakistani hosts (Hostinger, etc.) now support Node apps directly from cPanel.

Steps (Railway/Render, easiest path):
1. Create a free GitHub account, upload this project as a new repository.
2. Sign up at railway.app or render.com, connect your GitHub repo.
3. Set the start command to `npm start`.
4. Add environment variables `SESSION_SECRET` and `ADMIN_PASSWORD` (random strong values).
5. Deploy — you'll get a live URL. Point your domain (natrio.pk) at it via a CNAME record from your domain registrar.

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
