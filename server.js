const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

const PRODUCTS_FILE = path.join(__dirname, 'data', 'products.json');
const ORDERS_FILE = path.join(__dirname, 'data', 'orders.json');
const CATEGORIES_FILE = path.join(__dirname, 'data', 'categories.json');
const BLOG_FILE = path.join(__dirname, 'data', 'blog.json');
const HERO_FILE = path.join(__dirname, 'data', 'hero.json');
const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const SHIPPING_FILE = path.join(__dirname, 'data', 'shipping.json');
const MESSAGES_FILE = path.join(__dirname, 'data', 'messages.json');

// make sure orders.json / users.json / messages.json exist
if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, '[]');
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
if (!fs.existsSync(MESSAGES_FILE)) fs.writeFileSync(MESSAGES_FILE, '[]');

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret-in-production',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } // 7 days
}));
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
app.post('/api/auth/signup', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, and password are required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const users = readJSON(USERS_FILE);
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
  writeJSON(USERS_FILE, users);

  req.session.userId = user.id;
  res.json({ success: true, user: { id: user.id, name: user.name, email: user.email } });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.email === email.trim().toLowerCase());
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Incorrect email or password' });
  }

  req.session.userId = user.id;
  res.json({ success: true, user: { id: user.id, name: user.name, email: user.email } });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.userId = null;
  res.json({ success: true });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.id === req.session.userId);
  if (!user) return res.json({ user: null });
  res.json({ user: { id: user.id, name: user.name, email: user.email } });
});

// ---------- CUSTOMER ORDER HISTORY ----------
app.get('/api/my-orders', requireCustomer, (req, res) => {
  const orders = readJSON(ORDERS_FILE);
  const mine = orders.filter(o => o.userId === req.session.userId);
  res.json(mine.slice().reverse());
});

// ---------- PRODUCT ROUTES ----------
app.get('/api/products', (req, res) => {
  const products = readJSON(PRODUCTS_FILE);
  const { category } = req.query;
  const filtered = category ? products.filter(p => p.category === category) : products;
  res.json(filtered);
});

app.get('/api/products/:id', (req, res) => {
  const products = readJSON(PRODUCTS_FILE);
  const product = products.find(p => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json(product);
});

app.get('/api/categories', (req, res) => {
  res.json(readJSON(CATEGORIES_FILE));
});

app.get('/api/blog', (req, res) => {
  const posts = readJSON(BLOG_FILE).filter(p => p.published !== false);
  res.json(posts.slice().reverse());
});

app.get('/api/blog/:slug', (req, res) => {
  const posts = readJSON(BLOG_FILE);
  const post = posts.find(p => p.slug === req.params.slug && p.published !== false);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  res.json(post);
});

app.get('/api/hero', (req, res) => {
  res.json(readJSON(HERO_FILE));
});

app.get('/api/shipping', (req, res) => {
  res.json(readJSON(SHIPPING_FILE));
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

  const messages = readJSON(MESSAGES_FILE);
  messages.push(entry);
  writeJSON(MESSAGES_FILE, messages);

  res.json({ success: true });
});

// ---------- CART ROUTES ----------
app.get('/api/cart', (req, res) => {
  const cart = getCart(req);
  const products = readJSON(PRODUCTS_FILE);
  const detailed = cart.map(item => {
    const product = products.find(p => p.id === item.productId);
    return { ...item, product };
  });
  const subtotal = detailed.reduce((sum, i) => sum + (i.product ? i.product.price * i.qty : 0), 0);
  res.json({ items: detailed, subtotal });
});

app.post('/api/cart/add', (req, res) => {
  const { productId, variant, qty } = req.body;
  const products = readJSON(PRODUCTS_FILE);
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

app.post('/api/cart/update', (req, res) => {
  const { productId, variant, qty } = req.body;
  const cart = getCart(req);
  const item = cart.find(i => i.productId === productId && i.variant === variant);
  if (item) {
    item.qty = Math.max(1, qty);
  }
  res.json({ success: true });
});

app.post('/api/cart/remove', (req, res) => {
  const { productId, variant } = req.body;
  req.session.cart = getCart(req).filter(i => !(i.productId === productId && i.variant === variant));
  res.json({ success: true });
});

// ---------- CHECKOUT / ORDER ROUTES ----------
app.post('/api/checkout', (req, res) => {
  const { name, email, phone, address, city, paymentMethod, shippingMethodId, notes } = req.body;
  const cart = getCart(req);
  if (!cart.length) return res.status(400).json({ error: 'Cart is empty' });
  if (!name || !phone || !address || !city) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const products = readJSON(PRODUCTS_FILE);

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

  const shippingMethods = readJSON(SHIPPING_FILE);
  const method = shippingMethods.find(m => m.id === shippingMethodId) || shippingMethods[0];
  if (!method) return res.status(400).json({ error: 'No shipping method available. Please contact the store.' });
  const shipping = (method.freeThreshold && subtotal >= method.freeThreshold) ? 0 : method.cost;
  const total = subtotal + shipping;

  const order = {
    id: uuidv4().slice(0, 8).toUpperCase(),
    userId: req.session.userId || null,
    date: new Date().toISOString(),
    customer: { name, email, phone, address, city },
    items,
    subtotal,
    shippingMethod: method.name,
    shipping,
    total,
    paymentMethod: paymentMethod || 'cod',
    status: 'pending',
    statusHistory: [{ status: 'pending', date: new Date().toISOString() }],
    notes: notes || ''
  };

  const orders = readJSON(ORDERS_FILE);
  orders.push(order);
  writeJSON(ORDERS_FILE, orders);

  // deduct inventory now that the order is confirmed
  for (const item of cart) {
    const product = products.find(p => p.id === item.productId);
    if (product) product.stock = Math.max(0, product.stock - item.qty);
  }
  writeJSON(PRODUCTS_FILE, products);

  // clear cart
  req.session.cart = [];

  res.json({ success: true, orderId: order.id, total: order.total });
});

app.get('/api/order/:id', (req, res) => {
  const orders = readJSON(ORDERS_FILE);
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

app.post('/api/admin/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.json({ success: true });
  }
  res.status(401).json({ error: 'Wrong password' });
});

app.get('/api/admin/orders', requireAdmin, (req, res) => {
  res.json(readJSON(ORDERS_FILE));
});

app.get('/api/admin/messages', requireAdmin, (req, res) => {
  res.json(readJSON(MESSAGES_FILE).slice().reverse());
});

app.get('/api/admin/blog', requireAdmin, (req, res) => {
  res.json(readJSON(BLOG_FILE).slice().reverse());
});

function slugify(title) {
  return title.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

app.post('/api/admin/blog', requireAdmin, (req, res) => {
  const { title, excerpt, body, image, published } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'Title and body are required' });

  const posts = readJSON(BLOG_FILE);
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
  writeJSON(BLOG_FILE, posts);
  res.json({ success: true, post });
});

app.put('/api/admin/blog/:id', requireAdmin, (req, res) => {
  const posts = readJSON(BLOG_FILE);
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
  writeJSON(BLOG_FILE, posts);
  res.json({ success: true, post: posts[idx] });
});

app.delete('/api/admin/blog/:id', requireAdmin, (req, res) => {
  let posts = readJSON(BLOG_FILE);
  posts = posts.filter(p => p.id !== req.params.id);
  writeJSON(BLOG_FILE, posts);
  res.json({ success: true });
});

app.put('/api/admin/orders/:id/status', requireAdmin, (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const orders = readJSON(ORDERS_FILE);
  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const wasCancelled = order.status === 'cancelled';
  order.status = status;
  if (!order.statusHistory) order.statusHistory = [];
  order.statusHistory.push({ status, date: new Date().toISOString() });
  writeJSON(ORDERS_FILE, orders);

  // restore inventory if the order is newly cancelled; deduct again if it's un-cancelled
  if (status === 'cancelled' && !wasCancelled) {
    const products = readJSON(PRODUCTS_FILE);
    for (const item of order.items) {
      const product = products.find(p => p.id === item.productId);
      if (product) product.stock += item.qty;
    }
    writeJSON(PRODUCTS_FILE, products);
  } else if (status !== 'cancelled' && wasCancelled) {
    const products = readJSON(PRODUCTS_FILE);
    for (const item of order.items) {
      const product = products.find(p => p.id === item.productId);
      if (product) product.stock = Math.max(0, product.stock - item.qty);
    }
    writeJSON(PRODUCTS_FILE, products);
  }

  res.json({ success: true, order });
});

app.get('/api/admin/categories', requireAdmin, (req, res) => {
  res.json(readJSON(CATEGORIES_FILE));
});

app.post('/api/admin/categories', requireAdmin, (req, res) => {
  const { title, image } = req.body;
  if (!title) return res.status(400).json({ error: 'Category title is required' });
  const categories = readJSON(CATEGORIES_FILE);
  const category = {
    title,
    url: `/products.html?category=${encodeURIComponent(title)}`,
    image: image || ''
  };
  categories.push(category);
  writeJSON(CATEGORIES_FILE, categories);
  res.json({ success: true, category });
});

app.put('/api/admin/categories/:index', requireAdmin, (req, res) => {
  const categories = readJSON(CATEGORIES_FILE);
  const idx = parseInt(req.params.index);
  if (!categories[idx]) return res.status(404).json({ error: 'Category not found' });
  const { title, image } = req.body;
  categories[idx] = {
    title: title || categories[idx].title,
    url: `/products.html?category=${encodeURIComponent(title || categories[idx].title)}`,
    image: image !== undefined ? image : categories[idx].image
  };
  writeJSON(CATEGORIES_FILE, categories);
  res.json({ success: true, category: categories[idx] });
});

app.delete('/api/admin/categories/:index', requireAdmin, (req, res) => {
  const categories = readJSON(CATEGORIES_FILE);
  const idx = parseInt(req.params.index);
  if (!categories[idx]) return res.status(404).json({ error: 'Category not found' });
  categories.splice(idx, 1);
  writeJSON(CATEGORIES_FILE, categories);
  res.json({ success: true });
});

app.get('/api/admin/shipping', requireAdmin, (req, res) => {
  res.json(readJSON(SHIPPING_FILE));
});

app.put('/api/admin/shipping', requireAdmin, (req, res) => {
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

  writeJSON(SHIPPING_FILE, methods);
  res.json({ success: true, methods });
});

app.get('/api/admin/hero', requireAdmin, (req, res) => {
  res.json(readJSON(HERO_FILE));
});

app.put('/api/admin/hero', requireAdmin, (req, res) => {
  let slides = req.body.slides;
  if (!Array.isArray(slides)) return res.status(400).json({ error: 'slides must be an array' });
  if (slides.length > 3) slides = slides.slice(0, 3); // hard cap at 3
  if (slides.length < 1) return res.status(400).json({ error: 'At least one hero slide is required' });
  writeJSON(HERO_FILE, slides);
  res.json({ success: true, slides });
});

app.post('/api/admin/products', requireAdmin, (req, res) => {
  const { title, category, price, stock, description } = req.body;
  if (!title || !category || price === undefined || price === null || isNaN(Number(price))) {
    return res.status(400).json({ error: 'Title, category, and a numeric price are required' });
  }

  const products = readJSON(PRODUCTS_FILE);
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
  writeJSON(PRODUCTS_FILE, products);
  res.json({ success: true, product: newProduct });
});

app.put('/api/admin/products/:id', requireAdmin, (req, res) => {
  const products = readJSON(PRODUCTS_FILE);
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
  writeJSON(PRODUCTS_FILE, products);
  res.json({ success: true, product: products[idx] });
});

app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
  let products = readJSON(PRODUCTS_FILE);
  products = products.filter(p => p.id !== req.params.id);
  writeJSON(PRODUCTS_FILE, products);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Natrio Organics store running at http://localhost:${PORT}`);
});
