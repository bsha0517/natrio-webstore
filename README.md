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

You'll need [Node.js](https://nodejs.org) installed (version 18+), and a
MongoDB connection string — see **"Setting up MongoDB Atlas"** further down
this README if you don't have one yet (it's free and takes a few minutes).

```bash
cd natrio-store
npm install
MONGODB_URI="your-connection-string" npm start
```

Then open **http://localhost:3000** in your browser. The server won't
start without `MONGODB_URI` set — that's intentional, since there's no
local file storage to fall back to anymore.

## 2. Adding photos (products, categories, hero slides, blog posts, Instagram)

Every place in `/admin.html` that has an "image path" field also has an
**upload button right below it** now — pick a photo from your computer and
it uploads directly, no GitHub or redeploy involved. This works for
Products, Categories, the Hero Slider, Blog posts, and Instagram posts.

**Products support up to 4 photos each:** Main, Hover (swaps in on
mouse-over on product cards), and two more ("3rd image", "4th image") that
only appear as extra thumbnails on the product page itself, for showing
different angles or the product in use. All four are optional except the
main one — leave any of them blank and no empty placeholder box shows up
anywhere, they just don't appear.

**Where uploaded photos actually live:** MongoDB, in a separate collection
from your product/order data, alongside everything else — not on Render's
local disk, which (as covered in the MongoDB section further down) gets
wiped on every redeploy and wouldn't be safe for this. Your server then
serves each photo back out at a URL like `/uploads/abc123...`, which is
what gets saved into the "image path" field automatically once the upload
finishes. You don't need to do anything with that URL yourself — it's
filled in for you.

A 5MB-per-image size limit is enforced to keep things reasonable — resize
very large photos before uploading if you hit that limit.

**The original approach still works too, if you prefer it:** images placed
in `public/images/` and committed to GitHub are served the same way,
useful if you're comfortable with that workflow or want images bundled
with your code for any reason. Just paste the path (e.g.
`/images/olive-hair-oil.jpg`) directly into the same field instead of
using the upload button — both approaches produce a working image path,
you can mix and match freely.

## 3. Managing products &amp; inventory (admin panel)

You no longer need to edit `data/products.json` by hand — go to
`/admin.html` → **Products** tab:

- **+ Add Product** to create a new one: title, category, a base price, an
  optional "compare at" price (shown crossed out for sales), stock
  quantity, sizes/variants (each with its own price), a short description,
  a longer description, images, ingredients, how-to-use instructions, and
  key benefits.
- **Each size/variant has its own price.** Add as many as you need (e.g.
  60ml, 100ml) and set a different price for each — the shopper sees the
  right price update live as they change the size on the product page, and
  the cart/checkout/order always charges whichever variant they actually
  picked, not a single flat price for the product.
- **Short description vs. Description:** the short one is a single line
  that appears right under the product's category label near the top of
  the product page — keep it brief. The longer description shows in the
  "Description" tab further down the page, along with separate tabs for
  Benefits, Ingredients, Shipping & Returns, and How To Use (each tab only
  appears if you've filled in that field).
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

Note: `data/products.json` and the other files in `data/` are no longer
read by the live site — they're just the original seed data used by
`migrate-to-mongo.js`. Once your data is in MongoDB, manage everything
through `/admin.html` instead of editing those files.

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

## 5b. Instagram section

Go to `/admin.html` → **Instagram** tab to manage the "Natrio On Instagram"
strip on the homepage. Each entry needs an image (upload to
`public/images/` first) and the direct link to that specific post (e.g.
`https://www.instagram.com/p/XXXXXXXXX/`) — so clicking a photo takes
customers to the real post, not just your profile page. If you leave this
empty, the whole Instagram section hides itself automatically.

## 5c. Customer accounts at checkout, and the mailing list

Shoppers can now check the box "Create an account with this order" during
checkout to register while placing their first order — no separate signup
step required. Their order is automatically linked to the new account.

**Where customer data is stored:**
- `data/orders.json` — every order, with the customer's name/email/phone/
  address attached (this is your record of who bought what).
- `data/users.json` — people who created a password-protected account
  (via signup, or the checkout checkbox above). Passwords are hashed, never
  stored in plain text.
- `data/subscribers.json` — your marketing mailing list. People land here
  only if they explicitly opt in, either through the footer newsletter form
  or the "email me about offers" checkbox at checkout. This is intentionally
  separate from orders/accounts — someone can buy from you without joining
  your mailing list, and vice versa.

**Sending marketing emails:** go to `/admin.html` → **Marketing** tab. Write
a subject and message (basic HTML is fine — bold text, links, etc.), send
yourself a test first, then send to everyone on the list. This uses the
same Gmail SMTP setup as your contact form and order emails (see the
section below if you haven't configured that yet). Every campaign email
includes an unsubscribe link automatically.

## 6. View orders (admin)

Go to **/admin.html**, log in with the password set in `ADMIN_PASSWORD`
(default: `natrio-admin-2026` — **change this before going live**, see step 9).

## 7. Email notifications

The same SMTP setup below (step-by-step further down this section) powers
these emails:

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
- **Delivered notification** — same idea, triggered when you mark an order
  as **delivered**.
- **Marketing campaigns** — sent from the **Marketing** tab to your
  subscriber list.

**Reliability:** every one of these emails now automatically retries up to
3 times with a short pause between attempts if the first try times out —
this matters because outbound connections from Render to Gmail can
occasionally be flaky (the same kind of intermittent network hiccup you
may have seen with MongoDB during setup). A single retry usually clears it
up. If an email still fails after all attempts, it's logged in your
Render service logs (e.g. `Shipped email error: ...`) so you can see what
happened — the order or message itself is always saved regardless, only
the email notification is affected.

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
6. **Connecting all three domains** (`natrio.pk`, `natrio.com.pk`,
   `natrioorganics.com`): go to your Render service → **Settings** →
   **Custom Domains**, and add all three domains (plus their `www.`
   versions if you own those too) one at a time. Render will show you a
   CNAME or A record to create for each — add those at whichever registrar
   you bought each domain from. Render issues free SSL for all of them
   automatically.

   `natrio.pk` is set as the **canonical domain** in the code — visiting
   `natrio.com.pk` or `natrioorganics.com` (or their `www.` versions)
   automatically redirects to `natrio.pk` with the same page. This is
   intentional and good for SEO: it stops Google from seeing your store as
   three separate duplicate websites and keeps all your search ranking
   concentrated on one domain, while the other two still work perfectly
   fine for anyone who types them in or has them saved. If you'd rather
   make a *different* domain the canonical one, change `CANONICAL_HOST` and
   `ALTERNATE_HOSTS` near the top of `server.js`, and update the
   `https://natrio.pk` references in each page's SEO tags and in
   `/sitemap.xml`'s `SITE_URL` to match.

**✅ Data storage: MongoDB (not local files anymore)**
This project now stores all its data — orders, products, blog posts,
subscribers, everything — in a real MongoDB database instead of JSON files
on Render's disk. This means:
- Data survives every redeploy and restart automatically, on any Render
  plan (even the free tier), since it's no longer tied to that specific
  server's local disk at all.
- You can run more than one server instance in the future if the store
  ever needs to scale, since MongoDB (unlike a local disk) can be safely
  read and written by multiple servers at once.
- **You do need to set this up before the site will start** — the server
  won't run without a working `MONGODB_URI`. Steps below.

### Setting up MongoDB Atlas (free tier)

1. Go to [mongodb.com/cloud/atlas/register](https://www.mongodb.com/cloud/atlas/register) and create a free account.
2. Create a new project, then click **Build a Database** → choose the
   **M0 Free** tier → pick any region close to Pakistan (e.g. Mumbai/AWS
   `ap-south-1`) → **Create**.
3. When prompted to create a database user, set a username and password
   (save these somewhere safe — you'll need them in the connection string).
4. Under **Network Access**, click **Add IP Address** → **Allow Access from
   Anywhere** (`0.0.0.0/0`). This is fine for this use case since the
   database still requires the username/password to connect — it's not
   publicly readable.
5. Go to **Database** → click **Connect** on your cluster → **Drivers** →
   copy the connection string. It looks like:
   ```
   mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/natrio?retryWrites=true&w=majority
   ```
   Replace `<username>` and `<password>` with the ones from step 3. The
   `/natrio` part names your database — you can change it, just keep it
   consistent.

### Adding it to Render

1. Render dashboard → your `natrio-store` service → **Environment**.
2. Add a new environment variable: `MONGODB_URI` → paste the connection
   string from above.
3. Save — Render will automatically redeploy with the new variable.

**If deploy logs show a TLS/SSL error** (something like `tlsv1 alert
internal error` or `SSL routines`), that's not a credentials problem — it's
a known incompatibility between very new Node.js versions (like Node 24,
which Render may pick by default) and MongoDB Atlas's TLS handshake. Fix:
in Render → your service → **Environment**, add `NODE_VERSION` = `20.18.0`
and save to trigger a redeploy. The project's `package.json` also pins
Node 20 now, which should make this automatic on fresh deploys — but for
a service that already exists, adding the environment variable directly is
the more reliable fix.

### Moving your existing data into MongoDB (one time only)

If you already have products, categories, shipping methods, or discount
codes set up, run this once from your own computer (with Node.js
installed) to copy them into the new database:

```bash
cd natrio-store
npm install
MONGODB_URI="paste-your-connection-string-here" node migrate-to-mongo.js
```

This reads whatever's currently in your local `data/*.json` files and
copies it into MongoDB. **Only run this once** — running it again later
would overwrite any changes you've made through the live site since. If
you're starting fresh with no real data yet, you can skip this step
entirely; the site will just start with empty products/categories/etc.,
which you can then add through `/admin.html`.

Once `MONGODB_URI` is set on Render and (optionally) you've run the
migration, your data has no expiry and survives indefinitely — redeploys,
restarts, and plan changes no longer affect it at all, since it isn't
stored on Render's servers in the first place.

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

## 13. SEO

The site now has proper SEO built in:

- **Every page** has a unique title, meta description, canonical URL, Open
  Graph tags (for Facebook/WhatsApp link previews), and Twitter card tags.
- **Product pages** and **blog posts** generate their title/description/
  social preview image automatically from your actual product/post data,
  plus structured data (`Product` and `Article` schema) that helps Google
  show richer results — star ratings, price, stock status, etc., once you
  have enough traffic for Google to pick them up.
- **Private pages** (cart, checkout, account, login, signup, order
  confirmation, admin) are marked `noindex` so they never show up in search
  results.
- **`/sitemap.xml`** is generated automatically and always current — it
  pulls directly from your live products, categories, and published blog
  posts, so you never have to update it by hand when you add something in
  the admin panel.
- **`/robots.txt`** tells search engines what to crawl and points them to
  the sitemap.

**One thing to check before going live:** all of this assumes your site
will be reachable at `https://natrio.pk`. If you deploy somewhere else
first (like `natrio-store.onrender.com`) before pointing your domain at it,
set the `SITE_URL` environment variable to match — e.g.
`SITE_URL=https://natrio-store.onrender.com` — so the sitemap and canonical
URLs stay accurate. Once `natrio.pk` is live, remove that variable (or set
it to `https://natrio.pk`) and redeploy.

**After launch:** submit `https://natrio.pk/sitemap.xml` to
[Google Search Console](https://search.google.com/search-console) and
[Bing Webmaster Tools](https://www.bing.com/webmasters) — that's what
actually gets your pages crawled and indexed; none of the above happens
automatically just by the sitemap existing.
