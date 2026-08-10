// ---------- Header & Footer (shared across pages) ----------
function renderHeader() {
  document.body.insertAdjacentHTML('afterbegin', `
    <div class="announce">Free Shipping for All Orders from Rs. 2500 &nbsp;|&nbsp; Use Code FIRST for 10% Off</div>
    <header class="site-header">
      <div class="header-inner">
        <button class="nav-toggle" id="navToggle" aria-label="Menu">
          <span></span><span></span><span></span>
        </button>
        <a href="/" class="logo">
          <img src="/images/logo.png" alt="Natrio Organics" class="logo-img">
        </a>
        <nav class="main-nav" id="mainNav">
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

  const toggle = document.getElementById('navToggle');
  const nav = document.getElementById('mainNav');
  toggle.addEventListener('click', () => {
    nav.classList.toggle('open');
    toggle.classList.toggle('open');
  });
}

function renderFooter() {
  document.body.insertAdjacentHTML('beforeend', `
    <footer class="site-footer dark-footer">
      <div class="footer-grid">
        <div class="footer-contact">
          <img src="/images/logo.png" alt="Natrio Organics" class="footer-logo">
          <p>
            Lahore, Pakistan<br>
            Call us: <a href="tel:+920000000000">+92 300 0000000</a><br>
            Email: <a href="mailto:hello@natrio.pk">hello@natrio.pk</a>
          </p>
          <div class="social-row">
            <a href="https://www.facebook.com/share/18v6kUqF9a/" target="_blank" aria-label="Facebook">f</a>
            <a href="https://www.instagram.com/natrioorganics" target="_blank" aria-label="Instagram">ig</a>
            <a href="#" aria-label="Pinterest">p</a>
          </div>
        </div>
        <div>
          <h4>Categories</h4>
          <ul>
            <li><a href="/products.html?category=Hair%20Oils">Hair Oils</a></li>
            <li><a href="/products.html?category=Facial%20Care">Facial Care</a></li>
            <li><a href="/products.html">All Products</a></li>
          </ul>
        </div>
        <div>
          <h4>Further Info</h4>
          <ul>
            <li><a href="#">About Us</a></li>
            <li><a href="#">Contact Us</a></li>
            <li><a href="#">Shipping &amp; Returns</a></li>
            <li><a href="#">Privacy Policy</a></li>
          </ul>
        </div>
        <div class="newsletter-mini">
          <h4>Newsletter Sign Up</h4>
          <p>Get updates on new arrivals and offers.</p>
          <input type="email" placeholder="Enter your email address">
          <button class="btn btn-primary btn-full" type="button">Submit</button>
        </div>
      </div>
      <div class="dark-footer-bottom">
        <span>&copy; ${new Date().getFullYear()} Natrio Organics. All rights reserved.</span>
        <div class="payment-icons">
          <span>COD</span><span>Visa</span><span>Mastercard</span><span>JazzCash</span><span>Easypaisa</span>
        </div>
      </div>
    </footer>
  `);
}

function scrollSlider(id, dir) {
  const el = document.getElementById(id);
  el.scrollBy({ left: dir * (el.clientWidth * 0.8), behavior: 'smooth' });
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
