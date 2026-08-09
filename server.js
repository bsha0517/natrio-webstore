const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

const PRODUCTS_FILE = path.join(__dirname, 'data', 'products.json');
const ORDERS_FILE = path.join(__dirname, 'data', 'orders.json');

// make sure orders.json exists
if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, '[]');

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
    date: new Date().toISOString(),
    customer: { name, email, phone, address, city },
    items,
    subtotal,
    shipping,
    total,
    paymentMethod: paymentMethod || 'cod',
    status: 'pending',
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
