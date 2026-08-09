// ---------- Header & Footer (shared across pages) ----------
function renderHeader() {
  document.body.insertAdjacentHTML('afterbegin', `
    <div class="announce">Free Shipping for All Orders from Rs. 2500 &nbsp;|&nbsp; Use Code FIRST for 10% Off</div>
    <header class="site-header">
      <div class="header-inner">
        <a href="/" class="logo">Natrio Organics</a>
        <nav class="main-nav">
          <a href="/products.html?category=Hair%20Oils">Hair Oils</a>
          <a href="/products.html?category=Facial%20Care">Facial Care</a>
          <a href="/products.html">All Products</a>
        </nav>
        <div class="header-actions">
          <a href="/cart.html" class="icon-btn" aria-label="Cart">
            🛒<span class="cart-count" id="cartCount">0</span>
          </a>
        </div>
      </div>
    </header>
  `);
}

function renderFooter() {
  document.body.insertAdjacentHTML('beforeend', `
    <footer class="site-footer">
      <div class="footer-grid">
        <div>
          <h4>Natrio Organics</h4>
          <p style="opacity:.8;font-size:14px;max-width:320px;">Pure, cold-pressed oils for healthier hair and glowing skin — sourced and bottled with care.</p>
        </div>
        <div>
          <h4>Shop</h4>
          <ul>
            <li><a href="/products.html?category=Hair%20Oils">Hair Oils</a></li>
            <li><a href="/products.html?category=Facial%20Care">Facial Care</a></li>
          </ul>
        </div>
        <div>
          <h4>Information</h4>
          <ul>
            <li><a href="/cart.html">Cart</a></li>
            <li><a href="/checkout.html">Checkout</a></li>
          </ul>
        </div>
      </div>
      <div class="footer-bottom">&copy; ${new Date().getFullYear()} Natrio Organics. All rights reserved.</div>
    </footer>
  `);
}

// ---------- Cart helpers ----------
async function refreshCartCount() {
  try {
    const res = await fetch('/api/cart');
    const data = await res.json();
    const count = data.items.reduce((n, i) => n + i.qty, 0);
    const el = document.getElementById('cartCount');
    if (el) el.textContent = count;
  } catch (e) { /* noop */ }
}

async function addToCart(productId, variant, qty = 1) {
  const res = await fetch('/api/cart/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId, variant, qty })
  });
  const data = await res.json();
  const el = document.getElementById('cartCount');
  if (el) el.textContent = data.cartCount;
  return data;
}

function money(n) {
  return 'Rs. ' + Number(n).toLocaleString();
}

document.addEventListener('DOMContentLoaded', () => {
  renderHeader();
  renderFooter();
  refreshCartCount();
});
