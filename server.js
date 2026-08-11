const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const emailTemplates = require('./email-templates');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Data storage keys ----------
// Each of these used to be a JSON file (data/products.json, etc). They're
// now document keys in MongoDB — one document per "collection", storing the
// whole array under a `data` field. This keeps the rest of the file (all
// the route handlers below) almost identical to the old file-based version.
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

// ---------- MongoDB connection ----------
if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI environment variable is not set. See README for setup instructions.');
  process.exit(1);
}
const mongoClient = new MongoClient(process.env.MONGODB_URI);
let db;

async function readJSON(key) {
  const doc = await db.collection('store').findOne({ _id: key });
  return doc ? doc.data : [];
}
async function writeJSON(key, data) {
  await db.collection('store').updateOne(
    { _id: key },
    { $set: { data } },
    { upsert: true }
  );
}

// ---------- Email via Brevo's HTTP API (not raw SMTP) ----------
// Render blocks outbound SMTP ports (465/587) at the network level, which
// is why the earlier Gmail SMTP setup could never actually connect —
// every attempt failed with a connection timeout before it even got to
// authentication. Brevo's API runs over plain HTTPS, same as any other
// API call this app already makes, so it isn't affected by that.
const BREVO_API_KEY = process.env.BREVO_API_KEY || null;
const SENDER_EMAIL = process.env.SENDER_EMAIL || process.env.CONTACT_EMAIL || 'info@natrio.pk';
const SENDER_NAME = process.env.SENDER_NAME || 'Natrio Organics';
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || 'info@natrio.pk';

// Accepts the same shape the rest of this file already uses:
// { from: '"Name" <email>' (optional), to, subject, text, html, replyTo }
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
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': BREVO_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timeout);
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

// Each product's variants can now carry their own price (e.g. 60ml vs
// 100ml costing different amounts). Falls back to the product's base price
// for older data that only has plain variant name strings.
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

function orderItemsText(order) {
  return order.items.map(i => `  - ${i.title} (${i.variant}) x${i.qty} — Rs. ${i.price * i.qty}`).join('\n');
}

// Pulls a few products for the "You might also like" section in emails —
// prefers bestsellers/featured items, falls back to whatever's in stock.
async function getRecommendedProducts(excludeProductIds = []) {
  try {
    const products = await readJSON(PRODUCTS_FILE);
    const inStock = products.filter(p => p.stock > 0 && !excludeProductIds.includes(p.id));
    const preferred = inStock.filter(p => p.bestseller || p.featured);
    const pool = preferred.length >= 3 ? preferred : inStock;
    // shuffle lightly so emails don't always show the exact same 3 products
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

  // email to the customer, if they gave one
  if (order.customer.email) {
    await sendMailSafe({
      from: `"Natrio Organics" <${SENDER_EMAIL}>`,
      to: order.customer.email,
      subject: `Your Natrio Organics order #${order.id} is confirmed`,
      html: emailTemplates.orderPlacedEmail(order, recommended)
    });
  }

  // email to the store owner
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

// ---------- Canonical domain redirect ----------
// natrio.pk is the primary domain for SEO. Any other domain pointed at this
// deployment (natrio.com.pk, natrioorganics.com, www. variants, the Render
// URL, etc.) 301-redirects here so Google treats it as one site, not three.
const CANONICAL_HOST = 'natrio.pk';
const ALTERNATE_HOSTS = [
  'www.natrio.pk',
  'natrio.com.pk',
  'www.natrio.com.pk',
  'natrioorganics.com',
  'www.natrioorganics.com'
];
app.use(async (req, res, next) => {
  const host = (req.headers.host || '').toLowerCase().split(':')[0];
  if (ALTERNATE_HOSTS.includes(host)) {
    return res.redirect(301, `https://${CANONICAL_HOST}${req.originalUrl}`);
  }
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret-in-production',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } // 7 days
}));
const SITE_URL = process.env.SITE_URL || 'https://natrio.pk';

app.get('/sitemap.xml', async (req, res) => {
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

  const categoryUrls = categories.map(c => ({
    loc: `/products.html?category=${encodeURIComponent(c.title)}`,
    priority: '0.7', changefreq: 'weekly'
  }));

  const productUrls = products.map(p => ({
    loc: `/product.html?id=${p.id}`,
    priority: '0.8', changefreq: 'weekly'
  }));

  const blogUrls = blogPosts.map(b => ({
    loc: `/blog-post.html?slug=${b.slug}`,
    priority: '0.6', changefreq: 'monthly',
    lastmod: b.date ? b.date.split('T')[0] : undefined
  }));

  const allUrls = [...staticUrls, ...categoryUrls, ...productUrls, ...blogUrls];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls.map(u => `  <url>
    <loc>${SITE_URL}${u.loc}</loc>
    ${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

  res.type('application/xml').send(xml);
});

app.use(express.static(path.join(__dirname, 'public')));

// ---------- helpers ----------
function getCart(req) {
  if (!req.session.cart) req.session.cart = [];
  return req.session.cart;
}

// ---------- Abandoned cart tracking ----------
// Every time the cart changes, we save a snapshot tied to this browser's
// session, along with an email if we have one (either a logged-in
// customer, or a guest who's typed their email into the checkout form —
// see POST /api/cart/set-email). A background sweep later finds carts
// that have sat untouched for a while with an email attached and sends a
// one-time reminder.
async function syncCartActivity(req) {
  try {
    const cart = getCart(req);
    const activity = await readJSON(CART_ACTIVITY_FILE);
    const sessionId = req.sessionID;

    if (!cart.length) {
      // cart emptied out (checked out, or manually cleared) — nothing to remind about
      const idx = activity.findIndex(a => a.sessionId === sessionId);
      if (idx !== -1) { activity.splice(idx, 1); await writeJSON(CART_ACTIVITY_FILE, activity); }
      return;
    }

    let email = req.session.cartEmail || null;
    let name = req.session.cartName || null;
    if (!email && req.session.userId) {
      const users = await readJSON(USERS_FILE);
      const user = users.find(u => u.id === req.session.userId);
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
    if (email && entry.status === 'active') {
      // new activity on a cart resets the abandonment clock
      entry.status = 'active';
    }

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

const ABANDONED_CART_HOURS = Number(process.env.ABANDONED_CART_HOURS) || 1;

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

      const excludeIds = entry.items.map(i => i.productId);
      const recommended = await getRecommendedProducts(excludeIds);
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

const REVIEW_REQUEST_DAYS = Number(process.env.REVIEW_REQUEST_DAYS) || 3;

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

      const ageDays = (now - deliveredAt) / 864e5;
      if (ageDays < REVIEW_REQUEST_DAYS) continue;

      const excludeIds = order.items.map(i => i.productId);
      const recommended = await getRecommendedProducts(excludeIds);
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

// ---------- password hashing (built-in crypto, no extra dependency) ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
}

function requireCustomer(req, res, next) {
  if (req.session.userId) return next();
  res.status(401).json({ error: 'Please log in first' });
}

// ---------- AUTH ROUTES ----------
app.post('/api/auth/signup', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, and password are required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const users = await readJSON(USERS_FILE);
  const normalizedEmail = email.trim().toLowerCase();
  if (users.find(u => u.email === normalizedEmail)) {
    return res.status(400).json({ error: 'An account with this email already exists. Try logging in instead.' });
  }

  const user = {
    id: uuidv4(),
    name,
    email: normalizedEmail,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString()
  };
  users.push(user);
  await writeJSON(USERS_FILE, users);

  req.session.userId = user.id;
  res.json({ success: true, user: { id: user.id, name: user.name, email: user.email } });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  const users = await readJSON(USERS_FILE);
  const user = users.find(u => u.email === email.trim().toLowerCase());
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Incorrect email or password' });
  }

  req.session.userId = user.id;
  res.json({ success: true, user: { id: user.id, name: user.name, email: user.email } });
});

app.post('/api/auth/logout', async (req, res) => {
  req.session.userId = null;
  res.json({ success: true });
});

app.get('/api/auth/me', async (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const users = await readJSON(USERS_FILE);
  const user = users.find(u => u.id === req.session.userId);
  if (!user) return res.json({ user: null });
  res.json({ user: { id: user.id, name: user.name, email: user.email } });
});

// ---------- CUSTOMER ORDER HISTORY ----------
app.get('/api/my-orders', requireCustomer, async (req, res) => {
  const orders = await readJSON(ORDERS_FILE);
  const mine = orders.filter(o => o.userId === req.session.userId);
  res.json(mine.slice().reverse());
});

// ---------- PRODUCT ROUTES ----------
app.get('/api/products', async (req, res) => {
  const products = await readJSON(PRODUCTS_FILE);
  const { category } = req.query;
  const filtered = category ? products.filter(p => p.category === category) : products;
  res.json(filtered);
});

app.get('/api/products/:id', async (req, res) => {
  const products = await readJSON(PRODUCTS_FILE);
  const product = products.find(p => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json(product);
});

app.get('/api/categories', async (req, res) => {
  res.json(await readJSON(CATEGORIES_FILE));
});

app.get('/api/blog', async (req, res) => {
  const posts = (await readJSON(BLOG_FILE)).filter(p => p.published !== false);
  res.json(posts.slice().reverse());
});

app.get('/api/blog/:slug', async (req, res) => {
  const posts = await readJSON(BLOG_FILE);
  const post = posts.find(p => p.slug === req.params.slug && p.published !== false);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  res.json(post);
});

app.get('/api/hero', async (req, res) => {
  res.json(await readJSON(HERO_FILE));
});

app.get('/api/shipping', async (req, res) => {
  res.json(await readJSON(SHIPPING_FILE));
});

app.get('/api/instagram', async (req, res) => {
  res.json(await readJSON(INSTAGRAM_FILE));
});

app.get('/api/stores', async (req, res) => {
  res.json(await readJSON(STORES_FILE));
});

app.get('/api/announcements', async (req, res) => {
  res.json(await readJSON(ANNOUNCEMENTS_FILE));
});

app.get('/api/settings', async (req, res) => {
  const raw = await readJSON(SETTINGS_FILE);
  const settings = (raw && !Array.isArray(raw)) ? raw : {};
  // only expose the public-facing bits — never leak anything sensitive here.
  // Pixel/tracking IDs are meant to be public (they're embedded in every
  // page's HTML anyway), unlike things like API keys.
  res.json({
    gaTrackingId: settings.gaTrackingId || '',
    googleReviewUrl: settings.googleReviewUrl || '',
    metaPixelId: settings.metaPixelId || '',
    tiktokPixelId: settings.tiktokPixelId || '',
    googleAdsId: settings.googleAdsId || '',
    googleAdsConversionLabel: settings.googleAdsConversionLabel || '',
    jazzCashNumber: settings.jazzCashNumber || '',
    easypaisaNumber: settings.easypaisaNumber || '',
    walletAccountTitle: settings.walletAccountTitle || ''
  });
});

// ---------- Subscribers / mailing list ----------
async function addSubscriber(email, source) {
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return { success: false, isNew: false };
  const normalized = email.trim().toLowerCase();
  const subscribers = await readJSON(SUBSCRIBERS_FILE);
  if (subscribers.find(s => s.email === normalized)) return { success: true, isNew: false }; // already subscribed, not an error
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

app.get('/api/newsletter/unsubscribe', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).send('Missing email.');
  const subscribers = await readJSON(SUBSCRIBERS_FILE);
  const sub = subscribers.find(s => s.email === String(email).trim().toLowerCase());
  if (sub) {
    sub.active = false;
    await writeJSON(SUBSCRIBERS_FILE, subscribers);
  }
  res.send(`<html><body style="font-family:sans-serif;padding:40px;text-align:center;"><h2>You've been unsubscribed</h2><p>${email} will no longer receive marketing emails from Natrio Organics.</p></body></html>`);
});

app.post('/api/newsletter/subscribe', async (req, res) => {
  const { email } = req.body;
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address' });
  }
  const result = await addSubscriber(email, 'newsletter_form');
  if (result.isNew) {
    sendWelcomeEmail(email.trim().toLowerCase()).catch(err => console.error('Welcome email error:', err.message));
  }
  res.json({ success: true });
});

app.post('/api/discounts/validate', async (req, res) => {
  const { code, subtotal } = req.body;
  if (!code) return res.status(400).json({ error: 'Enter a discount code' });

  const discounts = await readJSON(DISCOUNTS_FILE);
  const discount = discounts.find(d => d.code.toLowerCase() === String(code).trim().toLowerCase());

  if (!discount) return res.status(404).json({ error: 'That discount code isn\'t valid' });
  if (discount.active === false) return res.status(400).json({ error: 'That discount code is no longer active' });
  if (discount.expiresAt && new Date(discount.expiresAt) < new Date()) {
    return res.status(400).json({ error: 'That discount code has expired' });
  }
  if (discount.minSubtotal && Number(subtotal) < discount.minSubtotal) {
    return res.status(400).json({ error: `This code requires a minimum order of Rs. ${discount.minSubtotal}` });
  }

  const amountOff = discount.type === 'percent'
    ? Math.round(Number(subtotal) * (discount.value / 100))
    : Math.min(discount.value, Number(subtotal));

  res.json({ success: true, code: discount.code, type: discount.type, value: discount.value, amountOff });
});

app.post('/api/contact', async (req, res) => {
  const { name, email, phone, message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Name, email, and message are required' });
  }

  const entry = {
    id: uuidv4().slice(0, 8),
    name, email, phone: phone || '',
    message,
    date: new Date().toISOString(),
    emailed: false
  };

  entry.emailed = await sendContactEmail(entry);

  const messages = await readJSON(MESSAGES_FILE);
  messages.push(entry);
  await writeJSON(MESSAGES_FILE, messages);

  res.json({ success: true });
});

// ---------- CART ROUTES ----------
app.get('/api/cart', async (req, res) => {
  const cart = getCart(req);
  const products = await readJSON(PRODUCTS_FILE);
  const detailed = cart.map(item => {
    const product = products.find(p => p.id === item.productId);
    const unitPrice = getVariantPrice(product, item.variant);
    return { ...item, product, unitPrice };
  });
  const subtotal = detailed.reduce((sum, i) => sum + i.unitPrice * i.qty, 0);
  res.json({ items: detailed, subtotal });
});

app.post('/api/cart/add', async (req, res) => {
  const { productId, variant, qty } = req.body;
  const products = await readJSON(PRODUCTS_FILE);
  const product = products.find(p => p.id === productId);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const cart = getCart(req);
  const existing = cart.find(i => i.productId === productId && i.variant === variant);
  if (existing) {
    existing.qty += (qty || 1);
  } else {
    const defaultVariant = product.variants[0];
    const defaultVariantName = (typeof defaultVariant === 'object' && defaultVariant !== null) ? defaultVariant.name : defaultVariant;
    cart.push({ productId, variant: variant || defaultVariantName, qty: qty || 1 });
  }
  res.json({ success: true, cartCount: cart.reduce((n, i) => n + i.qty, 0) });
  syncCartActivity(req).catch(() => {});
});

app.post('/api/cart/update', async (req, res) => {
  const { productId, variant, qty } = req.body;
  const cart = getCart(req);
  const item = cart.find(i => i.productId === productId && i.variant === variant);
  if (item) {
    item.qty = Math.max(1, qty);
  }
  res.json({ success: true });
  syncCartActivity(req).catch(() => {});
});

app.post('/api/cart/remove', async (req, res) => {
  const { productId, variant } = req.body;
  req.session.cart = getCart(req).filter(i => !(i.productId === productId && i.variant === variant));
  res.json({ success: true });
  syncCartActivity(req).catch(() => {});
});

app.post('/api/cart/set-email', async (req, res) => {
  const { email, name } = req.body;
  if (email && /^\S+@\S+\.\S+$/.test(email)) {
    req.session.cartEmail = email.trim().toLowerCase();
    if (name) req.session.cartName = name;
    syncCartActivity(req).catch(() => {});
  }
  res.json({ success: true });
});

// ---------- CHECKOUT / ORDER ROUTES ----------
app.post('/api/checkout', async (req, res) => {
  const { name, email, phone, address, city, paymentMethod, shippingMethodId, discountCode, subscribeNewsletter, notes, paymentProofUrl } = req.body;
  const cart = getCart(req);
  if (!cart.length) return res.status(400).json({ error: 'Cart is empty' });
  if (!name || !email || !phone || !address || !city) {
    return res.status(400).json({ error: 'Name, email, phone, address, and city are all required' });
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address' });
  }
  const cleanedPhone = String(phone).replace(/[\s-]/g, '');
  if (!/^(03\d{9}|\+923\d{9})$/.test(cleanedPhone)) {
    return res.status(400).json({ error: 'Please enter a valid Pakistani mobile number (e.g. 03xx-xxxxxxx)' });
  }
  if ((paymentMethod === 'jazzcash' || paymentMethod === 'easypaisa') && !paymentProofUrl) {
    return res.status(400).json({ error: 'Please upload a screenshot of your payment before placing the order.' });
  }

  const products = await readJSON(PRODUCTS_FILE);

  // Verify stock is available before placing the order
  for (const item of cart) {
    const product = products.find(p => p.id === item.productId);
    if (!product) return res.status(400).json({ error: 'One of the items in your cart is no longer available.' });
    if (product.stock < item.qty) {
      return res.status(400).json({ error: `Sorry, only ${product.stock} left of "${product.title}". Please update your cart.` });
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

  // Optional discount code
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
  if (!method) return res.status(400).json({ error: 'No shipping method available. Please contact the store.' });
  const shipping = (method.freeThreshold && subtotal >= method.freeThreshold) ? 0 : method.cost;
  const total = Math.max(0, subtotal - discountAmount + shipping);

  const order = {
    id: uuidv4().slice(0, 8).toUpperCase(),
    userId: req.session.userId || null,
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
    paymentVerified: (paymentMethod || 'cod') === 'cod', // COD needs no verification; wallet transfers do
    status: 'pending',
    statusHistory: [{ status: 'pending', date: new Date().toISOString() }],
    notes: notes || ''
  };

  const orders = await readJSON(ORDERS_FILE);
  orders.push(order);
  await writeJSON(ORDERS_FILE, orders);

  // deduct inventory now that the order is confirmed
  for (const item of cart) {
    const product = products.find(p => p.id === item.productId);
    if (product) product.stock = Math.max(0, product.stock - item.qty);
  }
  await writeJSON(PRODUCTS_FILE, products);

  // clear cart
  req.session.cart = [];
  req.session.cartEmail = null;
  req.session.cartName = null;
  markCartRecovered(req.sessionID).catch(() => {});

  // opt-in to the mailing list, if requested
  if (subscribeNewsletter) {
    const subResult = await addSubscriber(email, 'checkout');
    if (subResult.isNew) {
      sendWelcomeEmail(email.trim().toLowerCase()).catch(err => console.error('Welcome email error:', err.message));
    }
  }

  // send confirmation emails in the background — don't make the customer wait on this
  sendOrderConfirmationEmails(order).catch(err => console.error('Order email error:', err.message));

  res.json({ success: true, orderId: order.id, total: order.total });
});

app.get('/api/order/:id', async (req, res) => {
  const orders = await readJSON(ORDERS_FILE);
  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json(order);
});

// ---------- SIMPLE ADMIN (password protected) ----------
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'natrio-admin-2026';

function requireAdmin(req, res, next) {
  if (req.session.isAdmin) return next();
  res.status(401).json({ error: 'Not authorized' });
}

// ---------- Image uploads (stored in MongoDB, not local disk) ----------
// Local disk isn't safe to store uploads on — Render wipes it on every
// redeploy, same reason we moved the rest of the data to MongoDB. Images
// go in their own collection here instead, and get served back out
// through GET /uploads/:id below.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB per image
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  }
});

app.post('/api/admin/upload', requireAdmin, (req, res) => {
  upload.single('image')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file was uploaded' });

    const id = uuidv4();
    await db.collection('uploads').insertOne({
      _id: id,
      contentType: req.file.mimetype,
      filename: req.file.originalname,
      data: req.file.buffer,
      uploadedAt: new Date().toISOString()
    });

    res.json({ success: true, url: `/uploads/${id}` });
  });
});

// Public upload for payment-proof screenshots at checkout (JazzCash/Easypaisa
// manual transfers). Same storage as the admin upload above, just without
// requiring an admin session, since customers use this before an account
// or order even exists yet.
app.post('/api/checkout/upload-payment-proof', (req, res) => {
  upload.single('proof')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file was uploaded' });

    const id = uuidv4();
    await db.collection('uploads').insertOne({
      _id: id,
      contentType: req.file.mimetype,
      filename: req.file.originalname,
      data: req.file.buffer,
      uploadedAt: new Date().toISOString(),
      isPaymentProof: true
    });

    res.json({ success: true, url: `/uploads/${id}` });
  });
});

app.get('/uploads/:id', async (req, res) => {
  const doc = await db.collection('uploads').findOne({ _id: req.params.id });
  if (!doc) return res.status(404).send('Not found');
  res.set('Content-Type', doc.contentType);
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(doc.data.buffer ? Buffer.from(doc.data.buffer) : doc.data);
});

app.post('/api/admin/login', async (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.json({ success: true });
  }
  res.status(401).json({ error: 'Wrong password' });
});

app.get('/api/admin/orders', requireAdmin, async (req, res) => {
  res.json(await readJSON(ORDERS_FILE));
});

app.get('/api/admin/dashboard', requireAdmin, async (req, res) => {
  const [orders, products] = await Promise.all([readJSON(ORDERS_FILE), readJSON(PRODUCTS_FILE)]);

  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  const startOfToday = new Date(new Date().setHours(0, 0, 0, 0)).getTime();

  // revenue/order counts exclude cancelled orders — those were never real sales
  const validOrders = orders.filter(o => o.status !== 'cancelled');

  function statsSince(sinceTimestamp) {
    const inRange = validOrders.filter(o => new Date(o.date).getTime() >= sinceTimestamp);
    return {
      revenue: inRange.reduce((sum, o) => sum + (o.total || 0), 0),
      orders: inRange.length
    };
  }

  const today = statsSince(startOfToday);
  const last7 = statsSince(now - 7 * DAY);
  const last30 = statsSince(now - 30 * DAY);
  const allTime = statsSince(0);

  const pendingOrdersCount = orders.filter(o => o.status === 'pending').length;
  const lowStockCount = products.filter(p => p.stock > 0 && p.stock <= 15).length;
  const outOfStockCount = products.filter(p => p.stock === 0).length;

  // top products by units sold, over the last 30 days
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
  const topProducts = Object.values(salesByProduct).sort((a, b) => b.qty - a.qty).slice(0, 5);

  res.json({
    today, last7, last30, allTime,
    pendingOrdersCount, lowStockCount, outOfStockCount,
    topProducts
  });
});

app.get('/api/admin/messages', requireAdmin, async (req, res) => {
  res.json((await readJSON(MESSAGES_FILE)).slice().reverse());
});

app.get('/api/admin/subscribers', requireAdmin, async (req, res) => {
  res.json((await readJSON(SUBSCRIBERS_FILE)).slice().reverse());
});

app.delete('/api/admin/subscribers/:email', requireAdmin, async (req, res) => {
  let subscribers = await readJSON(SUBSCRIBERS_FILE);
  subscribers = subscribers.filter(s => s.email !== req.params.email.toLowerCase());
  await writeJSON(SUBSCRIBERS_FILE, subscribers);
  res.json({ success: true });
});

app.post('/api/admin/campaign/send', requireAdmin, async (req, res) => {
  const { subject, body, testEmail } = req.body;
  if (!subject || !body) return res.status(400).json({ error: 'Subject and body are required' });
  if (!BREVO_API_KEY) {
    return res.status(400).json({ error: 'Email isn\'t configured yet. Set BREVO_API_KEY first — see the README.' });
  }

  // send a test to just yourself first, if requested, without touching the subscriber list
  if (testEmail) {
    const ok = await sendMailSafe({
      from: `"Natrio Organics" <${SENDER_EMAIL}>`,
      to: testEmail,
      subject: `[TEST] ${subject}`,
      html: `<div style="font-family:sans-serif;font-size:15px;line-height:1.7;color:#222;">${body}</div>`
    });
    if (!ok) return res.status(500).json({ error: 'Failed to send test email after retrying. Check your SMTP settings.' });
    return res.json({ success: true, test: true });
  }

  const subscribers = (await readJSON(SUBSCRIBERS_FILE)).filter(s => s.active !== false);
  if (!subscribers.length) return res.status(400).json({ error: 'There are no active subscribers to send to yet.' });

  let sent = 0;
  let failed = 0;
  for (const sub of subscribers) {
    const unsubscribeUrl = `${req.protocol}://${req.get('host')}/api/newsletter/unsubscribe?email=${encodeURIComponent(sub.email)}`;
    const ok = await sendMailSafe({
      from: `"Natrio Organics" <${SENDER_EMAIL}>`,
      to: sub.email,
      subject,
      html: `<div style="font-family:sans-serif;font-size:15px;line-height:1.7;color:#222;">${body}</div>
             <hr style="margin:24px 0;border:none;border-top:1px solid #ddd;">
             <p style="font-size:12px;color:#888;">You're receiving this because you subscribed to Natrio Organics updates.
             <a href="${unsubscribeUrl}">Unsubscribe</a></p>`
    });
    if (ok) sent++; else failed++;
  }

  res.json({ success: true, sent, failed, total: subscribers.length });
});

app.get('/api/admin/blog', requireAdmin, async (req, res) => {
  res.json((await readJSON(BLOG_FILE)).slice().reverse());
});

function slugify(title) {
  return title.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

app.post('/api/admin/blog', requireAdmin, async (req, res) => {
  const { title, excerpt, body, image, published } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'Title and body are required' });

  const posts = await readJSON(BLOG_FILE);
  let slug = slugify(title);
  let suffix = 1;
  while (posts.find(p => p.slug === slug)) { slug = `${slugify(title)}-${suffix++}`; }

  const post = {
    id: uuidv4().slice(0, 8),
    slug,
    title,
    excerpt: excerpt || '',
    body,
    image: image || '',
    published: published !== false,
    date: new Date().toISOString()
  };
  posts.push(post);
  await writeJSON(BLOG_FILE, posts);
  res.json({ success: true, post });
});

app.put('/api/admin/blog/:id', requireAdmin, async (req, res) => {
  const posts = await readJSON(BLOG_FILE);
  const idx = posts.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Post not found' });

  const { title, excerpt, body, image, published } = req.body;
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
    body: body ?? posts[idx].body,
    image: image ?? posts[idx].image,
    published: published !== undefined ? published : posts[idx].published
  };
  await writeJSON(BLOG_FILE, posts);
  res.json({ success: true, post: posts[idx] });
});

app.delete('/api/admin/blog/:id', requireAdmin, async (req, res) => {
  let posts = await readJSON(BLOG_FILE);
  posts = posts.filter(p => p.id !== req.params.id);
  await writeJSON(BLOG_FILE, posts);
  res.json({ success: true });
});

app.put('/api/admin/orders/:id/verify-payment', requireAdmin, async (req, res) => {
  const orders = await readJSON(ORDERS_FILE);
  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  order.paymentVerified = true;
  await writeJSON(ORDERS_FILE, orders);
  res.json({ success: true, order });
});

app.put('/api/admin/orders/:id/status', requireAdmin, async (req, res) => {
  const { status, trackingUrl } = req.body;
  const validStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const orders = await readJSON(ORDERS_FILE);
  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const wasCancelled = order.status === 'cancelled';
  const wasShipped = order.status === 'shipped';
  const wasDelivered = order.status === 'delivered';
  order.status = status;
  if (status === 'shipped' && trackingUrl) order.trackingUrl = trackingUrl;
  if (!order.statusHistory) order.statusHistory = [];
  order.statusHistory.push({ status, date: new Date().toISOString() });
  await writeJSON(ORDERS_FILE, orders);

  // restore inventory if the order is newly cancelled; deduct again if it's un-cancelled
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

  // notify the customer on the status changes that matter to them
  if (status === 'shipped' && !wasShipped) {
    sendOrderStatusEmail(order, 'shipped').catch(err => console.error('Shipped email error:', err.message));
  }
  if (status === 'delivered' && !wasDelivered) {
    sendOrderStatusEmail(order, 'delivered').catch(err => console.error('Delivered email error:', err.message));
  }
  if (status === 'cancelled' && !wasCancelled) {
    sendOrderStatusEmail(order, 'cancelled').catch(err => console.error('Cancellation email error:', err.message));
  }

  res.json({ success: true, order });
});

app.get('/api/admin/categories', requireAdmin, async (req, res) => {
  res.json(await readJSON(CATEGORIES_FILE));
});

app.post('/api/admin/categories', requireAdmin, async (req, res) => {
  const { title, image } = req.body;
  if (!title) return res.status(400).json({ error: 'Category title is required' });
  const categories = await readJSON(CATEGORIES_FILE);
  const category = {
    title,
    url: `/products.html?category=${encodeURIComponent(title)}`,
    image: image || ''
  };
  categories.push(category);
  await writeJSON(CATEGORIES_FILE, categories);
  res.json({ success: true, category });
});

app.put('/api/admin/categories/:index', requireAdmin, async (req, res) => {
  const categories = await readJSON(CATEGORIES_FILE);
  const idx = parseInt(req.params.index);
  if (!categories[idx]) return res.status(404).json({ error: 'Category not found' });
  const { title, image } = req.body;
  categories[idx] = {
    title: title || categories[idx].title,
    url: `/products.html?category=${encodeURIComponent(title || categories[idx].title)}`,
    image: image !== undefined ? image : categories[idx].image
  };
  await writeJSON(CATEGORIES_FILE, categories);
  res.json({ success: true, category: categories[idx] });
});

app.delete('/api/admin/categories/:index', requireAdmin, async (req, res) => {
  const categories = await readJSON(CATEGORIES_FILE);
  const idx = parseInt(req.params.index);
  if (!categories[idx]) return res.status(404).json({ error: 'Category not found' });
  categories.splice(idx, 1);
  await writeJSON(CATEGORIES_FILE, categories);
  res.json({ success: true });
});

app.get('/api/admin/shipping', requireAdmin, async (req, res) => {
  res.json(await readJSON(SHIPPING_FILE));
});

app.put('/api/admin/shipping', requireAdmin, async (req, res) => {
  const methods = req.body.methods;
  if (!Array.isArray(methods)) return res.status(400).json({ error: 'methods must be an array' });
  if (methods.length < 1) return res.status(400).json({ error: 'At least one shipping method is required' });

  for (const m of methods) {
    if (!m.name || m.cost === undefined || m.cost === null || isNaN(Number(m.cost))) {
      return res.status(400).json({ error: 'Each method needs a name and a numeric cost' });
    }
    if (!m.id) m.id = m.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || uuidv4().slice(0, 8);
    m.cost = Number(m.cost);
    m.freeThreshold = m.freeThreshold === '' || m.freeThreshold === undefined ? null : Number(m.freeThreshold);
  }

  await writeJSON(SHIPPING_FILE, methods);
  res.json({ success: true, methods });
});

app.get('/api/admin/discounts', requireAdmin, async (req, res) => {
  res.json(await readJSON(DISCOUNTS_FILE));
});

app.post('/api/admin/discounts', requireAdmin, async (req, res) => {
  const { code, type, value, minSubtotal, expiresAt } = req.body;
  if (!code || !type || value === undefined || value === null || isNaN(Number(value))) {
    return res.status(400).json({ error: 'Code, type, and a numeric value are required' });
  }
  if (!['percent', 'fixed'].includes(type)) return res.status(400).json({ error: 'Type must be "percent" or "fixed"' });

  const discounts = await readJSON(DISCOUNTS_FILE);
  const normalizedCode = String(code).trim().toUpperCase();
  if (discounts.find(d => d.code === normalizedCode)) {
    return res.status(400).json({ error: 'A discount with this code already exists' });
  }

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
  res.json({ success: true, discount });
});

app.put('/api/admin/discounts/:id', requireAdmin, async (req, res) => {
  const discounts = await readJSON(DISCOUNTS_FILE);
  const idx = discounts.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Discount not found' });

  const { code, type, value, minSubtotal, expiresAt, active } = req.body;
  if (code) discounts[idx].code = String(code).trim().toUpperCase();
  if (type) discounts[idx].type = type;
  if (value !== undefined) discounts[idx].value = Number(value);
  if (minSubtotal !== undefined) discounts[idx].minSubtotal = minSubtotal ? Number(minSubtotal) : null;
  if (expiresAt !== undefined) discounts[idx].expiresAt = expiresAt || null;
  if (active !== undefined) discounts[idx].active = !!active;

  await writeJSON(DISCOUNTS_FILE, discounts);
  res.json({ success: true, discount: discounts[idx] });
});

app.delete('/api/admin/discounts/:id', requireAdmin, async (req, res) => {
  let discounts = await readJSON(DISCOUNTS_FILE);
  discounts = discounts.filter(d => d.id !== req.params.id);
  await writeJSON(DISCOUNTS_FILE, discounts);
  res.json({ success: true });
});

app.get('/api/admin/instagram', requireAdmin, async (req, res) => {
  res.json(await readJSON(INSTAGRAM_FILE));
});

app.put('/api/admin/instagram', requireAdmin, async (req, res) => {
  const posts = req.body.posts;
  if (!Array.isArray(posts)) return res.status(400).json({ error: 'posts must be an array' });
  for (const p of posts) {
    if (!p.image || !p.postUrl) return res.status(400).json({ error: 'Each post needs an image and a post URL' });
  }
  await writeJSON(INSTAGRAM_FILE, posts);
  res.json({ success: true, posts });
});

app.get('/api/admin/stores', requireAdmin, async (req, res) => {
  res.json(await readJSON(STORES_FILE));
});

app.put('/api/admin/stores', requireAdmin, async (req, res) => {
  const stores = req.body.stores;
  if (!Array.isArray(stores)) return res.status(400).json({ error: 'stores must be an array' });
  for (const s of stores) {
    if (!s.name) return res.status(400).json({ error: 'Each store needs a name' });
  }
  await writeJSON(STORES_FILE, stores);
  res.json({ success: true, stores });
});

app.get('/api/admin/announcements', requireAdmin, async (req, res) => {
  res.json(await readJSON(ANNOUNCEMENTS_FILE));
});

app.put('/api/admin/announcements', requireAdmin, async (req, res) => {
  const announcements = req.body.announcements;
  if (!Array.isArray(announcements)) return res.status(400).json({ error: 'announcements must be an array' });
  const cleaned = announcements.map(a => String(a).trim()).filter(Boolean);
  if (!cleaned.length) return res.status(400).json({ error: 'Add at least one announcement message' });
  await writeJSON(ANNOUNCEMENTS_FILE, cleaned);
  res.json({ success: true, announcements: cleaned });
});

app.get('/api/admin/settings', requireAdmin, async (req, res) => {
  const raw = await readJSON(SETTINGS_FILE);
  res.json((raw && !Array.isArray(raw)) ? raw : {});
});

app.put('/api/admin/settings', requireAdmin, async (req, res) => {
  const { gaTrackingId, googleReviewUrl, metaPixelId, tiktokPixelId, googleAdsId, googleAdsConversionLabel, jazzCashNumber, easypaisaNumber, walletAccountTitle } = req.body;
  const settings = {
    gaTrackingId: gaTrackingId || '',
    googleReviewUrl: googleReviewUrl || '',
    metaPixelId: metaPixelId || '',
    tiktokPixelId: tiktokPixelId || '',
    googleAdsId: googleAdsId || '',
    googleAdsConversionLabel: googleAdsConversionLabel || '',
    jazzCashNumber: jazzCashNumber || '',
    easypaisaNumber: easypaisaNumber || '',
    walletAccountTitle: walletAccountTitle || ''
  };
  await writeJSON(SETTINGS_FILE, settings);
  res.json({ success: true, settings });
});

app.get('/api/admin/abandoned-carts', requireAdmin, async (req, res) => {
  const activity = await readJSON(CART_ACTIVITY_FILE);
  res.json(activity.slice().reverse());
});

app.post('/api/admin/abandoned-carts/:sessionId/remind', requireAdmin, async (req, res) => {
  const activity = await readJSON(CART_ACTIVITY_FILE);
  const entry = activity.find(a => a.sessionId === req.params.sessionId);
  if (!entry) return res.status(404).json({ error: 'Cart not found' });
  if (!entry.email) return res.status(400).json({ error: 'This cart has no email on file to send to' });

  const excludeIds = (entry.items || []).map(i => i.productId);
  const recommended = await getRecommendedProducts(excludeIds);
  const sent = await sendMailSafe({
    from: `"Natrio Organics" <${SENDER_EMAIL}>`,
    to: entry.email,
    subject: `You left something in your cart 🌿`,
    html: emailTemplates.abandonedCartEmail(entry, recommended)
  });
  if (!sent) return res.status(500).json({ error: 'Failed to send reminder after retrying.' });

  entry.status = 'reminded';
  entry.remindedAt = new Date().toISOString();
  await writeJSON(CART_ACTIVITY_FILE, activity);
  res.json({ success: true });
});

app.delete('/api/admin/abandoned-carts/:sessionId', requireAdmin, async (req, res) => {
  let activity = await readJSON(CART_ACTIVITY_FILE);
  activity = activity.filter(a => a.sessionId !== req.params.sessionId);
  await writeJSON(CART_ACTIVITY_FILE, activity);
  res.json({ success: true });
});

app.get('/api/admin/hero', requireAdmin, async (req, res) => {
  res.json(await readJSON(HERO_FILE));
});

app.put('/api/admin/hero', requireAdmin, async (req, res) => {
  let slides = req.body.slides;
  if (!Array.isArray(slides)) return res.status(400).json({ error: 'slides must be an array' });
  if (slides.length > 3) slides = slides.slice(0, 3); // hard cap at 3
  if (slides.length < 1) return res.status(400).json({ error: 'At least one hero slide is required' });
  await writeJSON(HERO_FILE, slides);
  res.json({ success: true, slides });
});

app.post('/api/admin/products', requireAdmin, async (req, res) => {
  const { title, category, price, stock, description } = req.body;
  if (!title || !category || price === undefined || price === null || isNaN(Number(price))) {
    return res.status(400).json({ error: 'Title, category, and a numeric price are required' });
  }

  const products = await readJSON(PRODUCTS_FILE);
  let id = slugify(title);
  let suffix = 1;
  while (products.find(p => p.id === id)) { id = `${slugify(title)}-${suffix++}`; }

  const variants = Array.isArray(req.body.variants) && req.body.variants.length
    ? req.body.variants.map(v => (typeof v === 'object' && v !== null)
        ? { name: v.name, price: (v.price === null || v.price === undefined || v.price === '' || isNaN(Number(v.price))) ? Number(price) : Number(v.price) }
        : { name: v, price: Number(price) })
    : (typeof req.body.variants === 'string' && req.body.variants.trim()
        ? req.body.variants.split(',').map(v => ({ name: v.trim(), price: Number(price) })).filter(v => v.name)
        : [{ name: 'Default', price: Number(price) }]);

  const newProduct = {
    id,
    title,
    category,
    price: Number(price),
    compareAtPrice: req.body.compareAtPrice ? Number(req.body.compareAtPrice) : null,
    shortDescription: req.body.shortDescription || '',
    description: description || '',
    image: req.body.image || '',
    hoverImage: req.body.hoverImage || '',
    image3: req.body.image3 || '',
    image4: req.body.image4 || '',
    variants,
    stock: stock !== undefined && stock !== '' ? Math.max(0, parseInt(stock)) : 0,
    featured: !!req.body.featured,
    bestseller: !!req.body.bestseller,
    sku: req.body.sku || '',
    ingredients: req.body.ingredients || '',
    howToUse: req.body.howToUse || '',
    benefits: req.body.benefits || ''
  };
  products.push(newProduct);
  await writeJSON(PRODUCTS_FILE, products);
  res.json({ success: true, product: newProduct });
});

app.put('/api/admin/products/:id', requireAdmin, async (req, res) => {
  const products = await readJSON(PRODUCTS_FILE);
  const idx = products.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  const body = { ...req.body };
  if (body.price !== undefined) body.price = Number(body.price);
  if (body.compareAtPrice !== undefined) body.compareAtPrice = body.compareAtPrice ? Number(body.compareAtPrice) : null;
  if (body.stock !== undefined) body.stock = Math.max(0, parseInt(body.stock) || 0);
  if (typeof body.variants === 'string') {
    body.variants = body.variants.split(',').map(v => ({ name: v.trim(), price: body.price })).filter(v => v.name);
    if (!body.variants.length) body.variants = [{ name: 'Default', price: body.price }];
  } else if (Array.isArray(body.variants)) {
    body.variants = body.variants.map(v => (typeof v === 'object' && v !== null)
      ? { name: v.name, price: (v.price === null || v.price === undefined || v.price === '' || isNaN(Number(v.price))) ? body.price : Number(v.price) }
      : { name: v, price: body.price });
  }
  body.featured = !!body.featured;
  body.bestseller = !!body.bestseller;

  products[idx] = { ...products[idx], ...body };
  await writeJSON(PRODUCTS_FILE, products);
  res.json({ success: true, product: products[idx] });
});

app.delete('/api/admin/products/:id', requireAdmin, async (req, res) => {
  let products = await readJSON(PRODUCTS_FILE);
  products = products.filter(p => p.id !== req.params.id);
  await writeJSON(PRODUCTS_FILE, products);
  res.json({ success: true });
});

async function start() {
  try {
    await mongoClient.connect();
    db = mongoClient.db(); // uses the database name from the connection string
    console.log('Connected to MongoDB.');
  } catch (err) {
    console.error('Failed to connect to MongoDB. Check MONGODB_URI.', err.message);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`Natrio Organics store running at http://localhost:${PORT}`);
  });

  // check for abandoned carts every 15 minutes
  setInterval(() => checkAbandonedCarts().catch(err => console.error('Abandoned cart sweep failed:', err.message)), 15 * 60 * 1000);

  // check for delivered orders ready for a review request every hour
  setInterval(() => checkReviewRequests().catch(err => console.error('Review request sweep failed:', err.message)), 60 * 60 * 1000);
}

start();
