const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

const PRODUCTS_FILE = path.join(__dirname, 'data', 'products.json');
const ORDERS_FILE = path.join(__dirname, 'data', 'orders.json');
const CATEGORIES_FILE = path.join(__dirname, 'data', 'categories.json');
const BLOG_FILE = path.join(__dirname, 'data', 'blog.json');
const HERO_FILE = path.join(__dirname, 'data', 'hero.json');
const USERS_FILE = path.join(__dirname, 'data', 'users.json');

// make sure orders.json / users.json exist
if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, '[]');
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
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
  res.json(readJSON(BLOG_FILE));
});

app.get('/api/hero', (req, res) => {
  res.json(readJSON(HERO_FILE));
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
  const { name, email, phone, address, city, paymentMethod, notes } = req.body;
  const cart = getCart(req);
  if (!cart.length) return res.status(400).json({ error: 'Cart is empty' });
  if (!name || !phone || !address || !city) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const products = readJSON(PRODUCTS_FILE);
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
  const shipping = subtotal >= 2500 ? 0 : 200;
  const total = subtotal + shipping;

  const order = {
    id: uuidv4().slice(0, 8).toUpperCase(),
    userId: req.session.userId || null,
    date: new Date().toISOString(),
    customer: { name, email, phone, address, city },
    items,
    subtotal,
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

app.put('/api/admin/orders/:id/status', requireAdmin, (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const orders = readJSON(ORDERS_FILE);
  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  order.status = status;
  if (!order.statusHistory) order.statusHistory = [];
  order.statusHistory.push({ status, date: new Date().toISOString() });
  writeJSON(ORDERS_FILE, orders);
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
  const products = readJSON(PRODUCTS_FILE);
  const newProduct = { ...req.body, id: req.body.id || uuidv4().slice(0, 8) };
  products.push(newProduct);
  writeJSON(PRODUCTS_FILE, products);
  res.json({ success: true, product: newProduct });
});

app.put('/api/admin/products/:id', requireAdmin, (req, res) => {
  const products = readJSON(PRODUCTS_FILE);
  const idx = products.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  products[idx] = { ...products[idx], ...req.body };
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
