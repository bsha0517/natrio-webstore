const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { MongoClient } = require('mongodb');
const { v4: uuidv4 } = require('uuid');

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

// ---------- Email (optional — only sends if SMTP_USER / SMTP_PASS are set) ----------
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || 'info@natrio.pk';
let mailTransporter = null;
if (process.env.SMTP_USER && process.env.SMTP_PASS) {
  mailTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

async function sendContactEmail(message) {
  if (!mailTransporter) {
    console.log('Email not configured (SMTP_USER/SMTP_PASS missing) — message saved but not emailed.');
    return false;
  }
  try {
    await mailTransporter.sendMail({
      from: `"Natrio Organics Website" <${process.env.SMTP_USER}>`,
      to: CONTACT_EMAIL,
      replyTo: message.email,
      subject: `New message from ${message.name} — Natrio Organics site`,
      text: `Name: ${message.name}\nEmail: ${message.email}\nPhone: ${message.phone || 'N/A'}\n\nMessage:\n${message.message}`
    });
    return true;
  } catch (err) {
    console.error('Failed to send contact email:', err.message);
    return false;
  }
}

function orderItemsText(order) {
  return order.items.map(i => `  - ${i.title} (${i.variant}) x${i.qty} — Rs. ${i.price * i.qty}`).join('\n');
}

async function sendOrderConfirmationEmails(order) {
  if (!mailTransporter) {
    console.log('Email not configured — skipping order confirmation emails.');
    return;
  }
  const itemsText = orderItemsText(order);
  const summary = `Order #${order.id}\n\nItems:\n${itemsText}\n\nSubtotal: Rs. ${order.subtotal}${order.discountAmount ? `\nDiscount (${order.discountCode}): -Rs. ${order.discountAmount}` : ''}\nShipping (${order.shippingMethod}): ${order.shipping === 0 ? 'Free' : 'Rs. ' + order.shipping}\nTotal: Rs. ${order.total}\n\nPayment method: ${order.paymentMethod.toUpperCase()}\n\nDelivery to:\n${order.customer.name}\n${order.customer.address}\n${order.customer.city}\nPhone: ${order.customer.phone}`;

  // email to the customer, if they gave one
  if (order.customer.email) {
    try {
      await mailTransporter.sendMail({
        from: `"Natrio Organics" <${process.env.SMTP_USER}>`,
        to: order.customer.email,
        subject: `Your Natrio Organics order #${order.id} is confirmed`,
        text: `Hi ${order.customer.name.split(' ')[0]},\n\nThanks for your order! Here's a summary:\n\n${summary}\n\nWe'll email you again once it ships.\n\n— Natrio Organics`
      });
    } catch (err) {
      console.error('Failed to send customer order confirmation email:', err.message);
    }
  }

  // email to the store owner
  try {
    await mailTransporter.sendMail({
      from: `"Natrio Organics Website" <${process.env.SMTP_USER}>`,
      to: CONTACT_EMAIL,
      subject: `New order #${order.id} — Rs. ${order.total}`,
      text: `A new order was placed.\n\n${summary}\n\nCustomer email: ${order.customer.email || 'not provided'}`
    });
  } catch (err) {
    console.error('Failed to send store owner order notification email:', err.message);
  }
}

async function sendShippedEmail(order) {
  if (!mailTransporter || !order.customer.email) return;
  try {
    await mailTransporter.sendMail({
      from: `"Natrio Organics" <${process.env.SMTP_USER}>`,
      to: order.customer.email,
      subject: `Your Natrio Organics order #${order.id} has shipped`,
      text: `Hi ${order.customer.name.split(' ')[0]},\n\nGood news — your order #${order.id} is on its way!\n\n${orderItemsText(order)}\n\nDelivery to:\n${order.customer.address}\n${order.customer.city}\n\nExpected delivery: 1–3 business days.\n\n— Natrio Organics`
    });
  } catch (err) {
    console.error('Failed to send shipped notification email:', err.message);
  }
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
  const blogPosts = await readJSON(BLOG_FILE).filter(p => p.published !== false);

  const staticUrls = [
    { loc: '/', priority: '1.0', changefreq: 'daily' },
    { loc: '/products.html', priority: '0.9', changefreq: 'daily' },
    { loc: '/about-us.html', priority: '0.6', changefreq: 'monthly' },
    { loc: '/contact-us.html', priority: '0.6', changefreq: 'monthly' },
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
  const posts = await readJSON(BLOG_FILE).filter(p => p.published !== false);
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

// ---------- Subscribers / mailing list ----------
async function addSubscriber(email, source) {
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return false;
  const normalized = email.trim().toLowerCase();
  const subscribers = await readJSON(SUBSCRIBERS_FILE);
  if (subscribers.find(s => s.email === normalized)) return true; // already subscribed, not an error
  subscribers.push({ email: normalized, source: source || 'unknown', subscribedAt: new Date().toISOString(), active: true });
  await writeJSON(SUBSCRIBERS_FILE, subscribers);
  return true;
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
  await addSubscriber(email, 'newsletter_form');
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
    return { ...item, product };
  });
  const subtotal = detailed.reduce((sum, i) => sum + (i.product ? i.product.price * i.qty : 0), 0);
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
    cart.push({ productId, variant: variant || product.variants[0], qty: qty || 1 });
  }
  res.json({ success: true, cartCount: cart.reduce((n, i) => n + i.qty, 0) });
});

app.post('/api/cart/update', async (req, res) => {
  const { productId, variant, qty } = req.body;
  const cart = getCart(req);
  const item = cart.find(i => i.productId === productId && i.variant === variant);
  if (item) {
    item.qty = Math.max(1, qty);
  }
  res.json({ success: true });
});

app.post('/api/cart/remove', async (req, res) => {
  const { productId, variant } = req.body;
  req.session.cart = getCart(req).filter(i => !(i.productId === productId && i.variant === variant));
  res.json({ success: true });
});

// ---------- CHECKOUT / ORDER ROUTES ----------
app.post('/api/checkout', async (req, res) => {
  const { name, email, phone, address, city, paymentMethod, shippingMethodId, discountCode, subscribeNewsletter, notes } = req.body;
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
      price: product ? product.price : 0
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

  // opt-in to the mailing list, if requested
  if (subscribeNewsletter) await addSubscriber(email, 'checkout');

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

// ---------- One-time seed data import ----------
// Copies the original data/*.json files (bundled with the deployed code)
// into MongoDB. Safe to run more than once — it just overwrites each
// collection with whatever's currently in the matching JSON file, so only
// use this before you've started making real edits through the live site.
app.post('/api/admin/import-seed-data', requireAdmin, async (req, res) => {
  const keys = ['products', 'orders', 'categories', 'blog', 'hero', 'users', 'shipping', 'discounts', 'instagram', 'subscribers', 'messages'];
  const results = [];
  for (const key of keys) {
    const filePath = path.join(__dirname, 'data', `${key}.json`);
    if (!fs.existsSync(filePath)) {
      results.push({ key, status: 'skipped (no file)' });
      continue;
    }
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      await writeJSON(key, data);
      results.push({ key, status: 'imported', count: Array.isArray(data) ? data.length : 1 });
    } catch (err) {
      results.push({ key, status: 'error: ' + err.message });
    }
  }
  res.json({ success: true, results });
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

app.get('/api/admin/messages', requireAdmin, async (req, res) => {
  res.json(await readJSON(MESSAGES_FILE).slice().reverse());
});

app.get('/api/admin/subscribers', requireAdmin, async (req, res) => {
  res.json(await readJSON(SUBSCRIBERS_FILE).slice().reverse());
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
  if (!mailTransporter) {
    return res.status(400).json({ error: 'Email isn\'t configured yet. Set SMTP_USER and SMTP_PASS first — see the README.' });
  }

  // send a test to just yourself first, if requested, without touching the subscriber list
  if (testEmail) {
    try {
      await mailTransporter.sendMail({
        from: `"Natrio Organics" <${process.env.SMTP_USER}>`,
        to: testEmail,
        subject: `[TEST] ${subject}`,
        html: `<div style="font-family:sans-serif;font-size:15px;line-height:1.7;color:#222;">${body}</div>`
      });
      return res.json({ success: true, test: true });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to send test email: ' + err.message });
    }
  }

  const subscribers = await readJSON(SUBSCRIBERS_FILE).filter(s => s.active !== false);
  if (!subscribers.length) return res.status(400).json({ error: 'There are no active subscribers to send to yet.' });

  let sent = 0;
  let failed = 0;
  for (const sub of subscribers) {
    const unsubscribeUrl = `${req.protocol}://${req.get('host')}/api/newsletter/unsubscribe?email=${encodeURIComponent(sub.email)}`;
    try {
      await mailTransporter.sendMail({
        from: `"Natrio Organics" <${process.env.SMTP_USER}>`,
        to: sub.email,
        subject,
        html: `<div style="font-family:sans-serif;font-size:15px;line-height:1.7;color:#222;">${body}</div>
               <hr style="margin:24px 0;border:none;border-top:1px solid #ddd;">
               <p style="font-size:12px;color:#888;">You're receiving this because you subscribed to Natrio Organics updates.
               <a href="${unsubscribeUrl}">Unsubscribe</a></p>`
      });
      sent++;
    } catch (err) {
      console.error(`Campaign email to ${sub.email} failed:`, err.message);
      failed++;
    }
  }

  res.json({ success: true, sent, failed, total: subscribers.length });
});

app.get('/api/admin/blog', requireAdmin, async (req, res) => {
  res.json(await readJSON(BLOG_FILE).slice().reverse());
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

app.put('/api/admin/orders/:id/status', requireAdmin, async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const orders = await readJSON(ORDERS_FILE);
  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const wasCancelled = order.status === 'cancelled';
  const wasShipped = order.status === 'shipped';
  order.status = status;
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

  // notify the customer when their order ships
  if (status === 'shipped' && !wasShipped) {
    sendShippedEmail(order).catch(err => console.error('Shipped email error:', err.message));
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
    ? req.body.variants
    : (typeof req.body.variants === 'string' && req.body.variants.trim()
        ? req.body.variants.split(',').map(v => v.trim()).filter(Boolean)
        : ['Default']);

  const newProduct = {
    id,
    title,
    category,
    price: Number(price),
    compareAtPrice: req.body.compareAtPrice ? Number(req.body.compareAtPrice) : null,
    description: description || '',
    image: req.body.image || '',
    hoverImage: req.body.hoverImage || '',
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
    body.variants = body.variants.split(',').map(v => v.trim()).filter(Boolean);
    if (!body.variants.length) body.variants = ['Default'];
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
}

start();
