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
          <a href="/account.html" id="mobileAccountLink" class="mobile-only-link">My Account</a>
        </nav>
        <div class="header-actions">
          <a href="#" class="icon-btn" id="accountLink" aria-label="Account">👤</a>
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

  refreshAccountLink();
}

async function refreshAccountLink() {
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();
    const link = document.getElementById('accountLink');
    const mobileLink = document.getElementById('mobileAccountLink');
    const href = data.user ? '/account.html' : '/login.html';
    const title = data.user ? `Hi, ${data.user.name.split(' ')[0]}` : 'Log in';
    const mobileText = data.user ? 'My Account' : 'Log In / Sign Up';
    link.href = href;
    link.title = title;
    if (mobileLink) {
      mobileLink.href = href;
      mobileLink.textContent = mobileText;
    }
  } catch (e) { /* noop */ }
}

function renderFooter() {
  document.body.insertAdjacentHTML('beforeend', `
    <footer class="site-footer dark-footer">
      <div class="footer-grid">
        <div class="footer-contact">
          <img src="/images/logo.png" alt="Natrio Organics" class="footer-logo">
          <p>
            Natrio Organics is where pure, cold-pressed oils meet everyday natural care for healthier hair and glowing skin 🌿
          </p>
          <div class="social-row">
            <a href="https://www.facebook.com/share/18v6kUqF9a/" target="_blank" aria-label="Facebook">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5 3.66 9.15 8.44 9.94v-7.03H7.9v-2.91h2.54V9.85c0-2.51 1.49-3.89 3.77-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.44 2.91h-2.34V22c4.78-.79 8.44-4.94 8.44-9.94z"/></svg>
            </a>
            <a href="https://www.instagram.com/natrioorganics" target="_blank" aria-label="Instagram">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41-.56-.22-.96-.48-1.38-.9-.42-.42-.68-.82-.9-1.38-.16-.42-.36-1.06-.41-2.23-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41 1.27-.06 1.65-.07 4.85-.07zM12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63c-.8.31-1.48.72-2.15 1.4-.68.67-1.09 1.35-1.4 2.15-.3.76-.5 1.64-.56 2.91C.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.06 1.27.26 2.15.56 2.91.31.8.72 1.48 1.4 2.15.67.68 1.35 1.09 2.15 1.4.76.3 1.64.5 2.91.56 1.28.06 1.69.07 4.95.07s3.67-.01 4.95-.07c1.27-.06 2.15-.26 2.91-.56.8-.31 1.48-.72 2.15-1.4.68-.67 1.09-1.35 1.4-2.15.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91-.31-.8-.72-1.48-1.4-2.15-.67-.68-1.35-1.09-2.15-1.4-.76-.3-1.64-.5-2.91-.56C15.67.01 15.26 0 12 0zm0 5.84A6.16 6.16 0 1 0 12 18.16 6.16 6.16 0 0 0 12 5.84zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.41-10.85a1.44 1.44 0 1 1-2.88 0 1.44 1.44 0 0 1 2.88 0z"/></svg>
            </a>
            <a href="https://wa.me/923303065888" target="_blank" aria-label="WhatsApp">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M17.47 14.38c-.3-.15-1.77-.87-2.04-.97-.28-.1-.48-.15-.68.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.47-.88-.79-1.48-1.77-1.65-2.07-.17-.3-.02-.46.13-.61.14-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.68-1.6-.93-2.2-.24-.57-.49-.5-.68-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.47 0 1.46 1.06 2.87 1.21 3.07.15.2 2.1 3.2 5.08 4.48.71.31 1.26.49 1.7.63.71.22 1.36.19 1.87.12.57-.09 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.07-.13-.27-.2-.57-.35zM12 2C6.5 2 2 6.5 2 12c0 1.87.51 3.62 1.4 5.13L2 22l4.99-1.31A9.96 9.96 0 0012 22c5.5 0 10-4.5 10-10S17.5 2 12 2zm0 18.09c-1.7 0-3.29-.5-4.62-1.36l-.33-.2-3.44 1.03 1.02-3.36-.22-.36A8.06 8.06 0 013.91 12 8.09 8.09 0 1112 20.09z"/></svg>
            </a>
          </div>
        </div>
        <div>
          <h4>Shop</h4>
          <ul>
            <li><a href="/products.html?category=Hair%20Oils">Hair Oils</a></li>
            <li><a href="/products.html?category=Facial%20Care">Facial Care</a></li>
            <li><a href="/products.html">All Products</a></li>
          </ul>
        </div>
        <div>
          <h4>Information</h4>
          <ul>
            <li><a href="/about-us.html">About Us</a></li>
            <li><a href="/contact-us.html">Contact Us</a></li>
            <li><a href="/shipping-policy.html">Shipping &amp; Returns</a></li>
            <li><a href="/privacy-policy.html">Privacy Policy</a></li>
          </ul>
        </div>
        <div class="newsletter-mini">
          <h4>Newsletter Sign Up</h4>
          <p>Get updates on new arrivals and offers.</p>
          <input type="email" placeholder="Enter your email address">
          <button class="btn btn-primary btn-full" type="button">Subscribe</button>
        </div>
      </div>
      <div class="dark-footer-bottom">
        <span>&copy; ${new Date().getFullYear()} Natrio Organics. All rights reserved.</span>
        <div class="payment-icons">
          <span><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M20 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V6a2 2 0 00-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z"/></svg> COD</span>
          <span><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><rect x="2" y="5" width="20" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="2" y="8.2" width="20" height="2.6" fill="currentColor"/></svg> Visa</span>
          <span><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><rect x="2" y="5" width="20" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="2" y="8.2" width="20" height="2.6" fill="currentColor"/></svg> Mastercard</span>
          <span><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M17 2H7a2 2 0 00-2 2v16a2 2 0 002 2h10a2 2 0 002-2V4a2 2 0 00-2-2zm0 16H7V4h10v14z"/></svg> JazzCash</span>
          <span><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M17 2H7a2 2 0 00-2 2v16a2 2 0 002 2h10a2 2 0 002-2V4a2 2 0 00-2-2zm0 16H7V4h10v14z"/></svg> Easypaisa</span>
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

function renderWhatsAppButton() {
  document.body.insertAdjacentHTML('beforeend', `
    <a href="https://wa.me/923303065888" target="_blank" class="whatsapp-float" aria-label="Chat with us on WhatsApp">
      <svg viewBox="0 0 32 32" width="30" height="30" fill="currentColor" aria-hidden="true">
        <path d="M16.001 3C9.096 3 3.5 8.596 3.5 15.5c0 2.42.68 4.68 1.86 6.6L3 29l7.1-2.31A12.44 12.44 0 0016 28c6.905 0 12.5-5.596 12.5-12.5S22.905 3 16.001 3zm0 22.7c-1.98 0-3.83-.55-5.41-1.5l-.39-.23-4.21 1.37 1.38-4.1-.25-.42a10.18 10.18 0 01-1.61-5.47c0-5.65 4.6-10.25 10.25-10.25S26.25 9.85 26.25 15.5 21.65 25.7 16 25.7z"/>
        <path d="M21.62 18.13c-.3-.15-1.77-.87-2.05-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.47-.89-.79-1.48-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.14-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.6-.91-2.2-.24-.57-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.47 0 1.46 1.06 2.87 1.21 3.07.15.2 2.1 3.2 5.08 4.48.71.31 1.26.49 1.7.63.71.22 1.36.19 1.87.12.57-.09 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.07-.13-.27-.2-.57-.35z"/>
      </svg>
    </a>
  `);
}

document.addEventListener('DOMContentLoaded', () => {
  renderHeader();
  renderFooter();
  renderWhatsAppButton();
  refreshCartCount();
});
