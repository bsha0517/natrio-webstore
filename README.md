# Natrio Organics — Self-Hosted Store

A lightweight, self-hosted ecommerce site (Node.js + Express) with no monthly
platform fees. Full control over your data, design, and checkout flow.

## What's included
- Homepage, product listing, product detail, cart, checkout, order confirmation
- About Us and Contact Us pages, plus Privacy Policy and Shipping/Returns policy pages
- Customer accounts: sign up / log in / log out, with order history and a visual order-status tracker at `/account.html`
- Contact form that saves messages and (optionally) emails you directly
- Server-side cart (session based) and orders saved to `data/orders.json`
- Cash on Delivery checkout working out of the box, with admin-editable shipping methods and rates
- Placeholder options for Card / JazzCash / Easypaisa (need merchant setup — see below)
- Admin panel at `/admin.html` (password-protected) to view/update orders (click any row for full details), manage the homepage hero slider, categories, shipping methods, blog posts, and contact messages
- Automatic emails for new orders (to both customer and store owner) and shipping notifications, once SMTP is configured

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

## 3. Managing products &amp; inventory (admin panel)

You no longer need to edit `data/products.json` by hand — go to
`/admin.html` → **Products** tab:

- **+ Add Product** to create a new one: title, category, price, an optional
  "compare at" price (shown crossed out for sales), stock quantity, variants
  (e.g. `60ml, 100ml`), description, images, ingredients, how-to-use
  instructions, and key benefits.
- **Edit** any existing product the same way, including its stock count.
- **Delete** removes it from the store.
- Checking **"Featured on homepage"** or **"Show in Bestsellers slider"**
  controls where it appears.

**Inventory is now tracked automatically.** When a customer places an order,
stock is deducted for the items they bought. If you cancel an order from the
Orders tab, that stock is automatically added back. The admin product table
flags items with 15 or fewer left, and out-of-stock items show "Out of
Stock" on the storefront with the Add to Cart button disabled — customers
can't order more than you actually have.

You can still edit `data/products.json` directly if you prefer working in a
text editor — just restart the server (`npm start`) after saving.

## 4. Customer accounts & order tracking

- Shoppers create an account at `/signup.html` and log in at `/login.html`.
- Logged-in shoppers see their name/email pre-filled at checkout, and every
  order they place is linked to their account automatically.
- `/account.html` shows their order history with a visual tracker (pending →
  processing → shipped → delivered).
- Passwords are hashed with Node's built-in `crypto` module (scrypt) — never
  stored in plain text. User accounts live in `data/users.json`.
- You update an order's status from `/admin.html` → **Orders** tab → the
  status dropdown on each row. The customer sees the update immediately next
  time they open their account page.

## 5. Managing categories

Go to `/admin.html` → **Categories** tab to add, edit, or remove the small
category cards shown on the homepage. Each needs a title and an image path
(upload the photo to `public/images/` first). The category title should
match the `category` field used in `data/products.json` exactly (e.g.
`Hair Oils`), or the "Shop more" link on that card won't show matching
products.

## 6. View orders (admin)

Go to **/admin.html**, log in with the password set in `ADMIN_PASSWORD`
(default: `natrio-admin-2026` — **change this before going live**, see step 9).

## 7. Email notifications

The same SMTP setup below (step-by-step further down this section) powers
three kinds of emails:

- **Contact form** — the Contact Us page saves every message to
  `data/messages.json` (viewable in `/admin.html` → **Messages** tab) and,
  if configured, emails it to you directly.
- **New order confirmation** — the moment a customer checks out, they get a
  confirmation email with their order summary (if they gave an email
  address), and you get a "new order" email at `CONTACT_EMAIL` with the same
  details — so you never have to keep the admin panel open to know an order
  came in.
- **Shipped notification** — when you mark an order as **shipped** from
  `/admin.html` → **Orders** tab, the customer automatically gets an email
  letting them know.

All of this is optional — if you skip the setup below, orders and messages
are still saved normally, you'll just need to check the admin panel instead
of your inbox.

**To turn on email sending:**
1. Use a Gmail account you're happy to send from (a dedicated one is fine).
2. Go to your Google Account → **Security** → turn on **2-Step Verification**
   if it isn't already on.
3. Go to **Security** → **App passwords**, create one for "Mail", and copy
   the 16-character password it gives you.
4. Add two environment variables wherever you deploy (see the Render section
   below for how):
   - `SMTP_USER` — your Gmail address
   - `SMTP_PASS` — the app password from step 3 (not your normal Gmail password)
5. Optionally set `CONTACT_EMAIL` to a different address if you want contact
   form submissions and new-order alerts sent somewhere other than
   `info@natrio.pk`.

## 8. Deploying to Render.com (recommended)

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
   for you automatically. If you've set up Gmail sending (see step 7), also
   add `SMTP_USER`, `SMTP_PASS`, and optionally `CONTACT_EMAIL` here.
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

## 9. Before going live — security checklist

- [ ] Change `ADMIN_PASSWORD` (set as an environment variable, don't hardcode)
- [ ] Change `SESSION_SECRET` to a long random string
- [ ] Set up HTTPS (Railway/Render provide this automatically; a VPS needs Let's Encrypt/Certbot)
- [ ] Back up `data/orders.json`, `data/products.json`, and `data/users.json` regularly — `users.json` holds hashed customer passwords, so treat it as sensitive

## 10. Payments — going beyond Cash on Delivery

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

## 11. Project structure

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

## 12. Customizing the look

All colors, fonts, and spacing live in `public/style.css` at the top under
`:root { ... }`. Change `--olive`, `--gold`, `--cream` to shift the palette
without touching any other file.
