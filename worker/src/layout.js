// Site header and footer, rendered on the server so every page ships real
// <a href> navigation links in its raw HTML (crawlers don't have to run
// JavaScript to discover the shop, categories, blog and info pages).
// public/script.js no longer builds this markup; it only wires up the menu
// toggle, account link, cart count and announcement bar on top of it.

export function siteHeader() {
  return `
    <div class="announce" id="announceBar">&nbsp;</div>
    <header class="site-header">
      <div class="header-inner">
        <button class="nav-toggle" id="navToggle" aria-label="Menu">
          <span></span><span></span><span></span>
        </button>
        <a href="/" class="logo">
          <img src="/images/logo.png" alt="Natrio Organics" class="logo-img">
        </a>
        <nav class="main-nav" id="mainNav">
          <a href="/products/hair-oils">Hair Oils</a>
          <a href="/products/facial-care">Facial Care</a>
          <a href="/products.html">All Products</a>
          <a href="/account.html" id="mobileAccountLink" class="mobile-only-link">My Account</a>
        </nav>
        <div class="header-actions">
          <a href="/login.html" class="icon-btn" id="accountLink" aria-label="Account" rel="nofollow">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="10" cy="6" r="4"></circle>
              <path d="M18,22a7.89,7.89,0,0,0-8-8,7.89,7.89,0,0,0-8,8Z"></path>
              <path d="M16.83,3.17a4.13,4.13,0,0,1,.86,1.27,4.08,4.08,0,0,1,0,3.12,4.13,4.13,0,0,1-.86,1.27"></path>
              <path d="M21.8,19.86A11.12,11.12,0,0,0,18,13.5"></path>
            </svg>
          </a>
          <a href="/cart.html" class="icon-btn" aria-label="Cart" rel="nofollow">
            <img src="/images/cart-icon.png" alt="Cart" width="20" height="20"><span class="cart-count" id="cartCount">0</span>
          </a>
        </div>
      </div>
    </header>`;
}

export function siteFooter(year = new Date().getUTCFullYear()) {
  return `
    <footer class="site-footer dark-footer">
      <div class="footer-grid">
        <div class="footer-contact">
          <img src="/images/logo.png" alt="Natrio Organics" class="footer-logo" loading="lazy">
          <p>
            Natrio Organics is where pure, cold-pressed oils meet everyday natural care for healthier hair and glowing skin 🌿
          </p>
          <div class="social-row">
            <a href="https://www.facebook.com/share/18v6kUqF9a/" target="_blank" rel="noopener" aria-label="Facebook">
              <img src="/images/social/facebook.png" alt="Facebook" loading="lazy">
            </a>
            <a href="https://www.instagram.com/natrioorganics" target="_blank" rel="noopener" aria-label="Instagram">
              <img src="/images/social/instagram.png" alt="Instagram" loading="lazy">
            </a>
          </div>
        </div>
        <div>
          <h3>Shop</h3>
          <ul>
            <li><a href="/products/hair-oils">Hair Oils</a></li>
            <li><a href="/products/facial-care">Facial Care</a></li>
            <li><a href="/products.html">All Products</a></li>
          </ul>
        </div>
        <div>
          <h3>Information</h3>
          <ul>
            <li><a href="/about-us.html">About Us</a></li>
            <li><a href="/find-us-in-store.html">Find Us In Store</a></li>
            <li><a href="/blog.html">Blog</a></li>
            <li><a href="/faq.html">FAQ</a></li>
            <li><a href="/contact-us.html">Contact Us</a></li>
            <li><a href="/shipping-policy.html">Shipping &amp; Returns</a></li>
            <li><a href="/privacy-policy.html">Privacy Policy</a></li>
          </ul>
        </div>
        <div class="newsletter-mini">
          <h3>Let's get in touch</h3>
          <p>Join the list &amp; get 10% off your first order — your glow-up starts here ✨</p>
          <input type="email" placeholder="Enter your email address" id="newsletterEmail" aria-label="Email address">
          <button class="btn btn-primary btn-full" type="button" onclick="subscribeNewsletter()">Subscribe</button>
          <p id="newsletterMsg" style="font-size:12px;margin-top:8px;"></p>
        </div>
      </div>
      <div class="dark-footer-bottom">
        <span>&copy; ${year} Natrio Organics. All rights reserved.</span>
        <div class="payment-icons">
          <span class="payment-badge"><img src="/images/payments/cod.png" alt="Cash on Delivery" loading="lazy"></span>
          <span class="payment-badge"><img src="/images/payments/visa.png" alt="Visa" loading="lazy"></span>
          <span class="payment-badge"><img src="/images/payments/mastercard.png" alt="Mastercard" loading="lazy"></span>
          <span class="payment-badge"><img src="/images/payments/jazzcash.png" alt="JazzCash" loading="lazy"></span>
          <span class="payment-badge"><img src="/images/payments/easypaisa.png" alt="Easypaisa" loading="lazy"></span>
        </div>
      </div>
    </footer>`;
}

// Adds the header/footer to any storefront page (identified by loading
// /script.js; admin.html doesn't, so it's left alone). Idempotent.
export function applyLayout(html) {
  if (!html.includes('src="/script.js"') || html.includes('class="site-header"')) return html;
  return html
    .replace(/<body([^>]*)>/i, (m) => `${m}${siteHeader()}`)
    .replace(/<\/body>/i, `${siteFooter()}\n</body>`);
}
