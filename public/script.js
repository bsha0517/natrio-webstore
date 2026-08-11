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
          <a href="#" class="icon-btn" id="accountLink" aria-label="Account">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="10" cy="6" r="4"></circle>
              <path d="M18,22a7.89,7.89,0,0,0-8-8,7.89,7.89,0,0,0-8,8Z"></path>
              <path d="M16.83,3.17a4.13,4.13,0,0,1,.86,1.27,4.08,4.08,0,0,1,0,3.12,4.13,4.13,0,0,1-.86,1.27"></path>
              <path d="M21.8,19.86A11.12,11.12,0,0,0,18,13.5"></path>
            </svg>
          </a>
          <a href="/cart.html" class="icon-btn" aria-label="Cart">
            <img src="/images/cart-icon.png" alt="Cart" width="20" height="20"><span class="cart-count" id="cartCount">0</span>
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
              <img src="/images/social/facebook.png" alt="Facebook">
            </a>
            <a href="https://www.instagram.com/natrioorganics" target="_blank" aria-label="Instagram">
              <img src="/images/social/instagram.png" alt="Instagram">
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
            <li><a href="/find-us-in-store.html">Find Us In Store</a></li>
            <li><a href="/blog.html">Blog</a></li>
            <li><a href="/faq.html">FAQ</a></li>
            <li><a href="/contact-us.html">Contact Us</a></li>
            <li><a href="/shipping-policy.html">Shipping &amp; Returns</a></li>
            <li><a href="/privacy-policy.html">Privacy Policy</a></li>
          </ul>
        </div>
        <div class="newsletter-mini">
          <h4>Let's get in touch</h4>
          <p>Join the list &amp; get 10% off your first order — your glow-up starts here ✨</p>
          <input type="email" placeholder="Enter your email address" id="newsletterEmail">
          <button class="btn btn-primary btn-full" type="button" onclick="subscribeNewsletter()">Subscribe</button>
          <p id="newsletterMsg" style="font-size:12px;margin-top:8px;"></p>
        </div>
      </div>
      <div class="dark-footer-bottom">
        <span>&copy; ${new Date().getFullYear()} Natrio Organics. All rights reserved.</span>
        <div class="payment-icons">
          <span class="payment-badge"><img src="/images/payments/cod.png" alt="Cash on Delivery"></span>
          <span class="payment-badge"><img src="/images/payments/visa.png" alt="Visa"></span>
          <span class="payment-badge"><img src="/images/payments/mastercard.png" alt="Mastercard"></span>
          <span class="payment-badge"><img src="/images/payments/jazzcash.png" alt="JazzCash"></span>
          <span class="payment-badge"><img src="/images/payments/easypaisa.png" alt="Easypaisa"></span>
        </div>
      </div>
    </footer>
  `);
}

function scrollSlider(id, dir) {
  const el = document.getElementById(id);
  el.scrollBy({ left: dir * (el.clientWidth * 0.8), behavior: 'smooth' });
}

async function subscribeNewsletter() {
  const input = document.getElementById('newsletterEmail');
  const msg = document.getElementById('newsletterMsg');
  const email = input.value.trim();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    msg.style.color = '#e08b8b';
    msg.textContent = 'Please enter a valid email address.';
    return;
  }
  const res = await fetch('/api/newsletter/subscribe', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });
  const data = await res.json();
  if (data.error) {
    msg.style.color = '#e08b8b';
    msg.textContent = data.error;
  } else {
    msg.style.color = '#a9d6a0';
    msg.textContent = "You're subscribed! Thanks for joining us.";
    input.value = '';
  }
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

// Loads Google Analytics only if you've set a Measurement ID in
// /admin.html → Settings. Nothing renders or slows the site down if it's
// left blank.
// Loads Google Analytics, Google Ads conversion tracking, Meta Pixel, and
// TikTok Pixel — but only whichever ones you've actually configured in
// /admin.html → Settings. Nothing renders or slows the site down for any
// platform left blank.
function loadAnalytics() {
  fetch('/api/settings').then(r => r.json()).then(settings => {
    // ---- Google (GA4 + Google Ads share the same gtag.js loader) ----
    if (settings.gaTrackingId || settings.googleAdsId) {
      const gtagId = settings.gaTrackingId || settings.googleAdsId;
      const gtagScript = document.createElement('script');
      gtagScript.async = true;
      gtagScript.src = `https://www.googletagmanager.com/gtag/js?id=${gtagId}`;
      document.head.appendChild(gtagScript);

      window.dataLayer = window.dataLayer || [];
      function gtag() { window.dataLayer.push(arguments); }
      window.gtag = gtag;
      gtag('js', new Date());
      if (settings.gaTrackingId) gtag('config', settings.gaTrackingId);
      if (settings.googleAdsId) gtag('config', settings.googleAdsId);
      window.__googleAdsId = settings.googleAdsId || '';
      window.__googleAdsLabel = settings.googleAdsConversionLabel || '';
    }

    // ---- Meta Pixel (Facebook / Instagram ads) ----
    if (settings.metaPixelId) {
      /* eslint-disable */
      !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
      n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
      n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
      t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
      document,'script','https://connect.facebook.net/en_US/fbevents.js');
      /* eslint-enable */
      window.fbq('init', settings.metaPixelId);
      window.fbq('track', 'PageView');
    }

    // ---- TikTok Pixel ----
    if (settings.tiktokPixelId) {
      /* eslint-disable */
      !function (w, d, t) {
        w.TiktokAnalyticsObject = t; var ttq = w[t] = w[t] || [];
        ttq.methods = ["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];
        ttq.setAndDefer = function (t, e) { t[e] = function () { t.push([e].concat(Array.prototype.slice.call(arguments, 0))) } };
        for (var i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i]);
        ttq.instance = function (t) { for (var e = ttq._i[t] || [], n = 0; n < ttq.methods.length; n++) ttq.setAndDefer(e, ttq.methods[n]); return e };
        ttq.load = function (e, n) {
          var i = "https://analytics.tiktok.com/i18n/pixel/events.js";
          ttq._i = ttq._i || {}; ttq._i[e] = []; ttq._i[e]._u = i;
          ttq._t = ttq._t || {}; ttq._t[e] = +new Date;
          ttq._o = ttq._o || {}; ttq._o[e] = n || {};
          var s = document.createElement("script"); s.type = "text/javascript"; s.async = true;
          s.src = i + "?sdkid=" + e + "&lib=" + t;
          var f = document.getElementsByTagName("script")[0];
          f.parentNode.insertBefore(s, f);
        };
        ttq.load(settings.tiktokPixelId);
        ttq.page();
      }(window, document, 'ttq');
      /* eslint-enable */
    }
  }).catch(() => {});
}

document.addEventListener('DOMContentLoaded', () => {
  renderHeader();
  renderFooter();
  renderWhatsAppButton();
  refreshCartCount();
  loadAnalytics();
});
