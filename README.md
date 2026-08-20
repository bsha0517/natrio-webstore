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

## 6. Dashboard (admin)

`/admin.html` now opens on a **Dashboard** tab by default — revenue and
order counts for today, the last 7 days, the last 30 days, and all-time;
how many orders are still pending action; how many products are low on
stock (≤15) or completely out; and your top 5 best-selling products by
units sold over the last 30 days. Cancelled orders are excluded from every
revenue figure, since they were never real sales. Click the pending-orders
or stock cards to jump straight to the relevant tab.

## 7. View orders (admin)

Go to **/admin.html**, log in with the password set in `ADMIN_PASSWORD`
(default: `natrio-admin-2026` — **change this before going live**, see step 10).

## 8. Email notifications

Emails are sent through **Brevo** (formerly Sendinblue), using their HTTP
API — not traditional SMTP. This matters: Render blocks outbound SMTP
ports (465/587) at the network level as an anti-spam measure, which is why
a Gmail-SMTP setup can never actually connect from a Render-hosted app, no
matter how correct the credentials are. Brevo's API runs over regular
HTTPS instead, the same way every other API call in this app works, so
it isn't affected by that restriction.

This setup powers:

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
  letting them know. You'll be prompted for an optional tracking link when
  you set this status — paste your courier's tracking URL for that order
  and it appears as a "Track Your Order" button in the customer's email.
  Leave it blank if you don't have one yet.
- **Delivered notification** — same idea, triggered when you mark an order
  as **delivered**.
- **Cancellation notification** — sent when you mark an order **cancelled**,
  letting the customer know and mentioning refund timing if they paid online.
- **Marketing campaigns** — sent from the **Marketing** tab to your
  subscriber list.

**All four order emails (placed, cancelled, shipped, delivered) are fully
designed HTML emails** — your logo, brand colors, an itemized order table,
and a "You might also like" section with 3 product cards (pulled from your
bestsellers/featured products, pulling different ones each time) to
encourage repeat browsing. The template lives in `email-templates.js` if
you ever want to tweak the wording or layout — it's plain HTML/inline CSS,
no build step required.

**Reliability:** every email automatically retries up to 3 times with a
short pause between attempts if the first try fails. If an email still
fails after all attempts, it's logged in your Render service logs (e.g.
`Shipped email error: ...`) so you can see what happened — the order or
message itself is always saved regardless, only the email notification is
affected.

All of this is optional — if you skip the setup below, orders and messages
are still saved normally, you'll just need to check the admin panel instead
of your inbox.

**To turn on email sending (free tier: 300 emails/day):**
1. Sign up at [brevo.com](https://www.brevo.com) (free, no credit card
   required for the free tier).
2. Go to **Senders, Domains & Dedicated IPs** → **Senders** → add the email
   address you want to send *from* (e.g. `info@natrio.pk` or a Gmail
   address you control). Brevo will email that address a verification
   link — click it to confirm you own it. You can't send from an address
   until it's verified this way.
3. Go to your Brevo account menu (top right) → **SMTP & API** → **API
   Keys** tab → **Generate a new API key**. Copy it — Brevo only shows it
   once.
4. Add these environment variables wherever you deploy (see the Render
   section below for how):
   - `BREVO_API_KEY` — the API key from step 3
   - `SENDER_EMAIL` — the verified sender address from step 2
   - `CONTACT_EMAIL` — where you want contact-form messages and new-order
     alerts sent (can be the same as `SENDER_EMAIL`, or different)
5. That's it — no port numbers, no app passwords, no SMTP configuration.

**On the free plan's 300/day limit:** each order sends 2 emails (customer
+ you), so that's room for 150 orders/day before you'd need to upgrade —
plenty for most stores starting out. Brevo's paid tiers remove the daily
cap if you outgrow it later.

## 9. Deploying to Render.com (recommended)

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
   for you automatically. If you've set up Brevo (see step 8), also add
   `BREVO_API_KEY`, `SENDER_EMAIL`, and `CONTACT_EMAIL` here.
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

## 10. Before going live — security checklist

- [ ] Change `ADMIN_PASSWORD` (set as an environment variable, don't hardcode)
- [ ] Change `SESSION_SECRET` to a long random string
- [ ] Set up HTTPS (Railway/Render provide this automatically; a VPS needs Let's Encrypt/Certbot)
- [ ] Back up `data/orders.json`, `data/products.json`, and `data/users.json` regularly — `users.json` holds hashed customer passwords, so treat it as sensitive

## 11. Payments

Checkout currently offers three payment methods:

- **Cash on Delivery** — works immediately, no setup, no verification needed.
- **JazzCash** and **Easypaisa** — handled as **manual wallet transfers**,
  not a live payment gateway integration. Here's how it works:
  1. Set your wallet numbers in `/admin.html` → **Settings** → *Wallet
     Payments* (JazzCash number, Easypaisa number, and optionally an
     account title so customers can confirm they're sending to the right
     place).
  2. At checkout, a customer who picks JazzCash or Easypaisa sees your
     number and is required to upload a screenshot of their payment
     before they can place the order.
  3. The order comes into `/admin.html` → **Orders** with a ⚠️ next to the
     payment method, meaning "not yet verified." Open the order, check the
     uploaded screenshot against your actual wallet account, and click
     **"Mark Payment as Verified"** — the ⚠️ becomes a ✅.
  4. This is intentionally manual: it avoids needing a merchant account or
     gateway approval to start accepting online payments today, at the
     cost of you having to eyeball each screenshot before fulfilling the
     order. Don't ship an order paid via wallet until you've actually
     confirmed the money landed in your account — the screenshot is a
     claim, not proof the transfer succeeded.

**Upgrading to a real payment gateway later:** once you have a merchant
account with a Pakistani payment aggregator (SafePay and PayFast are
common choices — both bundle cards, JazzCash, and Easypaisa behind one
integration instead of three separate ones), replace the manual wallet
flow in `server.js`'s `/api/checkout` route with their SDK, so payment
gets verified automatically instead of by hand. This is genuinely the
part of the project most worth a developer's time when you get there —
gateway integrations involve handling webhooks and verifying signatures
correctly for security, which is easy to get subtly wrong.

## 12. Project structure

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

## 13. Customizing the look

All colors, fonts, and spacing live in `public/style.css` at the top under
`:root { ... }`. Change `--olive`, `--gold`, `--cream` to shift the palette
without touching any other file.

## 14. SEO

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

## 15. Store locations page

Go to `/admin.html` → **Store Locations** tab to list the physical stores
that carry Natrio Organics (currently seeded with Decent Store and Rainbow
Hypermarket, both Lahore — add real addresses whenever you have them).
Shown on `/find-us-in-store.html`, linked from the footer.

## 16. Newsletter welcome emails

Anyone who subscribes — through the footer form or the checkout opt-in
checkbox — now automatically gets a branded welcome email the first time
they join. Resubscribing or already being on the list won't send a second
one. Uses the same Brevo setup as every other email (see section 7).

## 17. Abandoned cart reminders

The store now tracks carts that get left behind and sends one automatic
reminder email if it has an address to send to.

**How it works:**
- Adding, updating, or removing something from a cart saves a snapshot
  tied to that shopper's browser session.
- An email gets attached to that snapshot as soon as we have one — either
  because they're logged in, or because they've typed their email into the
  checkout form (captured the moment they move to the next field, even if
  they never finish checking out).
- Every 15 minutes, the server checks for carts that have sat inactive for
  **1 hour** with an email attached, and sends a one-time reminder with
  the items they left and a link back to their cart. It won't send a
  second reminder for the same cart.
- Completing an order clears that cart's tracking entirely, so a finished
  purchase never triggers a "you forgot something" email.

**To view or manually manage this:** `/admin.html` → **Abandoned Carts**
tab shows every tracked cart — email, items, subtotal, last activity, and
status (active / reminded). You can send a reminder immediately regardless
of the 1-hour wait, or dismiss a cart you don't want tracked anymore.

**To change the 1-hour wait:** set the `ABANDONED_CART_HOURS` environment
variable (e.g. `4` for a 4-hour delay) wherever you deploy.

## 18. Trust badges

Small "Cash on Delivery / 7-Day Returns / 100% Natural" badges now appear
right above the Add to Cart button on every product page, and again above
the Place Order button at checkout — right where someone's actually
deciding whether to buy, not just buried in the footer. These are plain
HTML/CSS, no admin config — edit the text directly in `product.html` and
`checkout.html` if you want to change the wording.

## 19. Post-purchase review requests

A few days after you mark an order **delivered**, the customer
automatically gets an email asking how it went — with a link straight to
leaving a Google review if you've set one up (see **Settings** below), or
a prompt to reply/WhatsApp you directly if you haven't. Checked hourly,
sent once per order.

**To change the wait time:** set the `REVIEW_REQUEST_DAYS` environment
variable (default: `3`).

## 20. Analytics, Ad Pixels & Settings

`/admin.html` → **Settings** tab has two sections:

**Analytics & Reviews**
- **Google Analytics Measurement ID** — paste your GA4 ID (looks like
  `G-XXXXXXXXXX`, found in Google Analytics → Admin → Data Streams → your
  website) and analytics loads automatically on every page.
- **Google Review Link** — powers the review request email (section 19).
  Get yours from Google Business Profile → Ask for reviews → Copy link.

**Ad Pixels** — for retargeting and measuring ad conversions on each
platform. All are optional; leave any blank to skip that platform with no
performance cost:
- **Meta Pixel ID** — from Meta Events Manager → Data Sources → your pixel
  → Settings. Powers Facebook/Instagram retargeting and ad conversion
  tracking.
- **TikTok Pixel ID** — from TikTok Ads Manager → Assets → Events → your
  pixel.
- **Google Ads Conversion ID + Label** — from Google Ads → Goals →
  Conversions → your conversion action → "Use Google tag." Note this is
  **different** from the GA4 Measurement ID above — GA4 tells you
  analytics, this tells Google Ads which of your ad spend actually led to
  a sale, which is what Google uses to optimize campaigns. Both the
  `AW-...` ID and the label are required together.

**Every configured platform automatically fires a purchase event** on the
order confirmation page with the real order value, currency, and items —
genuine conversion tracking, not just page views. Each platform's tracking
code loads independently, so it's fine to set up only some of them.

All settings are stored in the database and take effect immediately — no
redeploy needed to turn any of this on/off or change an ID.

## 21. WhatsApp order updates (manual, no third-party service)

Every order — in both the Orders table and the order detail modal — has a
**💬 Send WhatsApp Update** button. Clicking it opens WhatsApp (web or app,
whichever you use) with a message already written for you, tailored to
that order's current status (placed / processing / shipped with tracking
link if you added one / delivered / cancelled), addressed to the
customer's actual phone number. You review it and hit send yourself —
nothing goes out automatically.

This intentionally avoids WhatsApp's official Business Platform API,
which needs a Meta Business Manager account, a dedicated phone number,
template message approval, and ongoing per-message costs — overkill for
where the store is right now. If order volume grows enough that manually
clicking send becomes a bottleneck, that's the point to revisit full
automation via the Cloud API or a provider like Wati/Interakt/Gupshup.

## 22. SEO for Google and AI answer engines (ChatGPT, Perplexity, etc.)

Beyond the technical SEO already covered in section 14:

- **`/faq.html`** — common questions with `FAQPage` structured data, which
  can let Google show expandable Q&A results directly in search, and gives
  AI answer engines clean, directly-quotable content. Linked in the footer.
- **`Store`/`LocalBusiness` structured data** on the homepage — your
  address, phone, hours, and price range, so Google understands Natrio
  Organics as a real, locatable business (helps with "near me" style
  searches), not just a website.
- **`/llms.txt`** — a plain-text summary of the business, products, and key
  pages, written specifically for AI crawlers. This is an emerging (not yet
  universally adopted) convention, similar in spirit to `robots.txt` but
  aimed at language models rather than search engine crawlers.
- **Alt text audit** — every meaningful product/blog image now has
  descriptive alt text; purely decorative/duplicate images (like the
  hover-swap image on product cards) intentionally have empty alt text,
  which is the correct accessibility practice, not an oversight.

**What actually moves the needle beyond this, that no amount of code can
substitute for:**
- **Google Business Profile** — not yet set up as far as this project
  knows; genuinely one of the highest-leverage things you can do for local
  search and AI-generated answers about "hair oil shops in Lahore" style
  queries.
- **Backlinks** — other websites (press, local directories, beauty blog
  roundups) linking to natrio.pk. This is what actually builds domain
  authority in Google's eyes.
- **Being mentioned elsewhere on the web** — Reddit, review sites,
  Instagram/TikTok — AI answer engines weight how often and how positively
  a business is discussed across the internet, not just its own site.
- **Regular blog content and accumulating real customer reviews** — both
  already have the infrastructure built (the Blog admin tab, and the
  post-purchase review request email), but the actual payoff comes from
  consistently using them over time.

## 23. Announcement bar

`/admin.html` → **Announcement Bar** tab controls the scrolling message at
the very top of every page (currently "Free Shipping for All Orders from
Rs. 2500 | Use Code FIRST for 10% Off"). Add a single message to show it
permanently, or add several and they rotate automatically every 4 seconds
with a smooth fade — a mini slider, no extra setup needed. Takes effect
on refresh, no redeploy required.

## 24. Google Shopping & Meta (Facebook/Instagram) Shopping

**`https://natrio.pk/product-feed.xml`** is a live product feed, generated
automatically from your current products, prices, stock, and images — one
feed that both Google Merchant Center and Meta Commerce Manager can read,
since they both accept this same format. Once connected, each platform
re-fetches this URL on its own schedule (usually daily), so listings stay
current with zero manual work on your end — no re-uploading a spreadsheet
every time a price changes.

Products with multiple sizes (like Olive Hair Oil's 60ml/100ml) are listed
as separate variants with the correct price for each, grouped together so
Google/Meta display them as one product with size options rather than
duplicate listings.

**To connect Google Shopping:**
1. Create a free [Google Merchant Center](https://merchants.google.com)
   account and verify you own `natrio.pk` (Merchant Center walks you
   through this — usually a DNS record or an HTML file upload).
2. Go to **Products** → **Feeds** → add a new feed → choose **Scheduled
   fetch** → paste in `https://natrio.pk/product-feed.xml`.
3. Google reviews new feeds before products go live (can take a few days).
   Once approved, connect Merchant Center to Google Ads if you want to run
   Shopping ads, or products can appear in free Google Shopping listings
   without any ad spend.

**To connect Meta (Facebook & Instagram) Shopping:**
1. Set up [Meta Commerce Manager](https://business.facebook.com/commerce)
   under your Meta Business account.
2. Create a catalog → **Add items** → **Use bulk upload** → **Data feed**
   → paste in the same `https://natrio.pk/product-feed.xml` URL and set it
   to fetch daily.
3. Once approved, connect the catalog to your Facebook Page and Instagram
   account to enable Shop tabs and shoppable posts.

**Things worth knowing:**
- Both platforms require your site to have working Privacy Policy,
  Shipping/Returns, and Contact pages before approving a store — you
  already have all three.
- Prices don't include a GTIN/barcode (`identifier_exists: no` in the
  feed) since these are handmade/small-batch products without standard
  barcodes — this is expected and accepted by both platforms, not an error.
- If a product's images look wrong or missing in Merchant Center/Commerce
  Manager, double check that product actually has a `Main image` set in
  `/admin.html` → Products — the feed can't show an image that doesn't
  exist.

**If Google Merchant Center rejects your site** with a message like "your
domain should provide customers with unique, valuable content" — this was
fixed as of the server-rendered product pages below (section 25), but if
it recurs, it's almost always because a crawler saw a page before its
JavaScript finished loading real content. Product pages specifically are
now server-rendered to avoid this; if the same issue comes up for the
homepage or category pages later, those would need the same treatment.

## 25. Server-rendered product pages (fixes Google Merchant Center rejections)

Product pages (`/product.html?id=...`) used to ship as a mostly-empty page
that said "Loading…" — all the real content (title, price, description,
images) only appeared after JavaScript ran in a browser. That's invisible
to crawlers that don't fully execute JavaScript, including Google Merchant
Center's — which is what causes the rejection message: *"Your domain
should provide customers with unique, valuable content."*

Product pages are now rendered server-side: the actual product title,
price, description, image, and `Product` structured data are all present
in the very first response the server sends, before any JavaScript runs.
Real visitors don't notice a difference — the same client-side script
still runs afterward and upgrades the page to the full interactive version
(variant selector, image gallery, tabs, Add to Cart) exactly as before.
This was verified against every real product in the database, including
ones with multiple size variants, before shipping.

**After deploying this,** request a review in Google Merchant Center
(Products → Diagnostics, or wherever the rejection notice appeared) so
Google re-crawls your site with the fix in place — it won't re-check
automatically on its own schedule for a flagged account.

## 26. Google Customer Reviews

`/admin.html` → **Settings** → **Google Customer Reviews** — paste in your
Google Merchant Center ID (a numeric ID, found in Merchant Center →
Settings → Business information) and two things turn on automatically:

- **Opt-in survey** — right after a customer checks out, a small Google
  popup asks if they'd like to rate their experience once the order
  arrives. This uses the real order ID, the customer's email, and an
  estimated delivery date calculated from the order date (matching the
  site's stated 1–3 business day delivery window).
- **Seller rating badge** — a floating widget in the bottom-left corner of
  every page (kept clear of the WhatsApp button, which sits bottom-right)
  showing your accumulated star rating once you have enough reviews for
  Google to display one.

Leave the Merchant ID blank and neither loads — no performance cost either
way. This is the same Merchant Center account used for the product feed in
section 24, so you likely already have the ID from setting that up.

## 27. Homepage SEO fixes

The homepage used to ship with an empty hero, empty category strip, and
empty bestseller slider — everything only appeared once JavaScript ran in
a browser. To any SEO crawler that doesn't fully execute JavaScript
(including some auditing tools), that looked like a nearly blank page: no
H1, ~75 words total, one paragraph, almost no internal links. Fixed the
same way as the product pages (section 25) — real content, including a
genuine H1, ~250+ words of homepage copy about the brand, and real
product/category links, now renders directly in the server's response
before any JavaScript runs. The existing client-side script still runs
afterward and upgrades the same containers to the full interactive version
(image sliders, rotating hero, hover effects) exactly as before.

Also fixed along the way:
- **Skipped heading level** — the footer's section titles ("Shop",
  "Information", "Let's get in touch") were `<h4>` tags with no `<h3>`
  anywhere else on the page, which is an actual accessibility/SEO problem
  independent of the JS-rendering issue above. Changed to `<h3>`.
- **`X-Powered-By` response header** — Express sends this by default,
  revealing your tech stack to anyone inspecting response headers. Now
  disabled site-wide.

These fixes were verified against the real content in your database (not
sample data) before shipping — word count, H1 count, heading level
presence, internal link count, and whether the page title's key words
actually appear in the visible content were all checked directly.

## 28. Clean URLs (no query-string parameters)

Product and category pages now use clean paths instead of query strings:

- `/product/olive-hair-oil` instead of `/product.html?id=olive-hair-oil`
- `/products/hair-oils` instead of `/products.html?category=Hair%20Oils`

Every internal link across the site (navigation, footer, homepage,
sitemap, product feed, breadcrumbs) now points to these clean URLs
directly. The old query-string URLs still work — they 301-redirect into
the clean version — so nothing that's already indexed or bookmarked
breaks, but the site itself never links to that form anymore.

Category slugs are generated automatically from the category title (e.g.
"Facial Care" → `facial-care`), so adding a new category in
`/admin.html` → Categories just works, no manual slug entry needed.

## 29. Automatic image compression on upload

Every image uploaded through the admin panel (product photos, category
images, hero slides, blog images, Instagram posts) or through checkout
(payment proof screenshots) is now automatically compressed before it's
stored — no extra step, nothing to remember to do.

**What happens on upload:**
- Resized so its longest side is no more than 1600px (larger than the
  site ever actually displays an image, so there's still headroom for
  retina/high-DPI screens) — but never enlarged if the original was
  already smaller.
- Converted to WebP, a modern format that's substantially smaller than
  JPEG or PNG at equivalent visual quality, and still supports
  transparency (so logos and icons with transparent backgrounds still
  work correctly).
- Tested against a real image from this project before shipping: a
  1.34MB PNG logo compressed down to 110KB — a 92% reduction — with the
  result verified as a valid, correctly-sized image afterward, not just
  assumed to work.
- If compression fails for any reason (a corrupt file, an unsupported
  format), the original file is stored as-is rather than the upload
  failing outright.

**What this doesn't cover:** images already uploaded before this change
went live stay as they were — this only affects new uploads going
forward. If your homepage still feels slow after this update, the
existing hero/product images already in your database are the likely
cause; re-uploading them through the same admin fields will compress them
retroactively. Images that live in `public/images/` and were added by
committing files directly to GitHub (rather than through the admin
upload button) also aren't touched by this — those should be compressed
before committing, or uploaded through the admin panel instead so they
go through this same pipeline.

**To compress everything already uploaded before this feature existed:**
`/admin.html` → Settings → **Compress Existing Images** → click
"Recompress All Existing Images." This goes through every image already
in the database and compresses whichever ones haven't been already,
showing you a summary of how much space it saved when it's done. Safe to
run more than once — it automatically detects and skips anything already
compressed, so re-running it can't accidentally degrade an image through
repeated lossy re-encoding. Tested against a realistic mix of an
uncompressed image, an already-compressed one, and a tiny image before
shipping, to confirm each case is handled correctly (compress, skip as
already-done, and skip if compression wouldn't actually help).
