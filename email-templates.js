// Branded HTML email templates for Natrio Organics order notifications.
// Built with inline styles and table-based layout throughout, since email
// clients (especially Outlook) don't support modern CSS reliably.

const SITE_URL = process.env.SITE_URL || 'https://natrio.pk';
const LOGO_URL = `${SITE_URL}/images/logo.png`;

const COLORS = {
  olive: '#365C3A',
  oliveDark: '#24452C',
  cream: '#F7F1E5',
  creamDeep: '#FCFAF4',
  gold: '#D99A25',
  ink: '#2D302B',
  muted: '#687267',
  line: '#E4DCC8',
  white: '#FFFFFF'
};

function money(n) {
  return 'Rs. ' + Number(n || 0).toLocaleString();
}

function esc(str) {
  return String(str == null ? '' : str).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// ---------- Shared header / footer wrapper ----------
function wrapEmail({ preheader, bodyHtml }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Natrio Organics</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.cream};font-family:Georgia,'Times New Roman',serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader || '')}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.cream};padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${COLORS.white};">

          <!-- Header -->
          <tr>
            <td align="center" style="background:${COLORS.white};padding:28px 24px;border-bottom:2px solid ${COLORS.line};">
              <img src="${LOGO_URL}" alt="Natrio Organics" width="90" style="display:block;margin:0 auto;">
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 32px 8px;">
              ${bodyHtml}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:32px;border-top:1px solid ${COLORS.line};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${COLORS.muted};line-height:1.7;">
                    <strong style="color:${COLORS.oliveDark};">Natrio Organics</strong><br>
                    Plot No. 237-C, Block Commercial, Etihad Town Phase 1, Off Raiwind Road, Lahore<br>
                    <a href="tel:03303065888" style="color:${COLORS.muted};">0330 306 5888</a> &nbsp;|&nbsp;
                    <a href="mailto:info@natrio.pk" style="color:${COLORS.muted};">info@natrio.pk</a>
                    <br><br>
                    <a href="${SITE_URL}" style="color:${COLORS.olive};">natrio.pk</a> &nbsp;|&nbsp;
                    <a href="${SITE_URL}/contact-us.html" style="color:${COLORS.olive};">Contact Us</a> &nbsp;|&nbsp;
                    <a href="${SITE_URL}/shipping-policy.html" style="color:${COLORS.olive};">Shipping &amp; Returns</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ---------- Reusable pieces ----------
function heading(text) {
  return `<h1 style="margin:0 0 6px;font-family:Georgia,serif;font-weight:500;font-size:26px;color:${COLORS.olive};">${esc(text)}</h1>`;
}

function paragraph(text) {
  return `<p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:14.5px;line-height:1.7;color:${COLORS.ink};">${text}</p>`;
}

function button(text, url) {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0;">
    <tr>
      <td style="background:${COLORS.olive};border-radius:2px;">
        <a href="${url}" style="display:inline-block;padding:13px 30px;font-family:Arial,Helvetica,sans-serif;font-size:14px;letter-spacing:.03em;color:${COLORS.white};text-decoration:none;">${esc(text)}</a>
      </td>
    </tr>
  </table>`;
}

function statusBadge(label, color) {
  return `<span style="display:inline-block;background:${color};color:#fff;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:.05em;text-transform:uppercase;padding:5px 12px;border-radius:20px;">${esc(label)}</span>`;
}

function orderItemsTable(order) {
  const rows = order.items.map(i => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid ${COLORS.line};font-family:Arial,Helvetica,sans-serif;font-size:13.5px;color:${COLORS.ink};">
        ${esc(i.title)}<br><span style="color:${COLORS.muted};font-size:12px;">${esc(i.variant)} &times; ${i.qty}</span>
      </td>
      <td align="right" style="padding:10px 0;border-bottom:1px solid ${COLORS.line};font-family:Arial,Helvetica,sans-serif;font-size:13.5px;color:${COLORS.ink};white-space:nowrap;">
        ${money(i.price * i.qty)}
      </td>
    </tr>`).join('');

  const discountRow = order.discountAmount ? `
    <tr>
      <td style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${COLORS.olive};">Discount (${esc(order.discountCode)})</td>
      <td align="right" style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${COLORS.olive};">&minus;${money(order.discountAmount)}</td>
    </tr>` : '';

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;">
    ${rows}
    <tr><td colspan="2" style="height:6px;"></td></tr>
    <tr>
      <td style="padding:4px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${COLORS.muted};">Subtotal</td>
      <td align="right" style="padding:4px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${COLORS.muted};">${money(order.subtotal)}</td>
    </tr>
    ${discountRow}
    <tr>
      <td style="padding:4px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${COLORS.muted};">Shipping (${esc(order.shippingMethod || 'Standard')})</td>
      <td align="right" style="padding:4px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${COLORS.muted};">${order.shipping === 0 ? 'Free' : money(order.shipping)}</td>
    </tr>
    <tr>
      <td style="padding:10px 0 0;border-top:1px solid ${COLORS.line};font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:${COLORS.oliveDark};">Total</td>
      <td align="right" style="padding:10px 0 0;border-top:1px solid ${COLORS.line};font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:${COLORS.oliveDark};">${money(order.total)}</td>
    </tr>
  </table>`;
}

function addressBlock(order) {
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.creamDeep};margin:18px 0;">
    <tr>
      <td style="padding:16px 18px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${COLORS.ink};line-height:1.7;">
        <strong style="color:${COLORS.oliveDark};">Delivery Address</strong><br>
        ${esc(order.customer.name)}<br>
        ${esc(order.customer.address)}<br>
        ${esc(order.customer.city)}<br>
        ${esc(order.customer.phone)}
      </td>
    </tr>
  </table>`;
}

// "You might also like" product recommendation cards. Pass in 3 products
// (already fetched from the database by the caller in server.js).
function recommendationCards(products) {
  if (!products || !products.length) return '';
  const cells = products.slice(0, 3).map(p => `
    <td width="33%" valign="top" style="padding:0 6px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${COLORS.line};">
        <tr>
          <td>
            <a href="${SITE_URL}/product.html?id=${encodeURIComponent(p.id)}">
              <img src="${p.image ? SITE_URL + p.image : LOGO_URL}" width="176" height="176" alt="${esc(p.title)}" style="display:block;width:100%;height:auto;aspect-ratio:1/1;object-fit:cover;background:${COLORS.creamDeep};">
            </a>
          </td>
        </tr>
        <tr>
          <td style="padding:10px 10px 14px;">
            <a href="${SITE_URL}/product.html?id=${encodeURIComponent(p.id)}" style="font-family:Georgia,serif;font-size:13.5px;color:${COLORS.ink};text-decoration:none;line-height:1.4;display:block;margin-bottom:4px;">${esc(p.title)}</a>
            <span style="font-family:Arial,Helvetica,sans-serif;font-size:12.5px;color:${COLORS.oliveDark};font-weight:bold;">${money(p.price)}</span>
          </td>
        </tr>
      </table>
    </td>`).join('');

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:30px 0 6px;">
    <tr>
      <td style="padding-bottom:14px;">
        <span style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:${COLORS.gold};">You might also like</span>
      </td>
    </tr>
    <tr>${cells}</tr>
  </table>`;
}

function signOff() {
  return paragraph(`Thank you for choosing Natrio Organics — pure, cold-pressed care, from our fields to your routine. 🌿`);
}

// ==================== EMAIL 1: Order Placed ====================
function orderPlacedEmail(order, recommendedProducts) {
  const bodyHtml = `
    ${statusBadge('Order Confirmed', COLORS.olive)}
    ${heading(`Thanks for your order, ${esc(order.customer.name.split(' ')[0])}!`)}
    ${paragraph(`We've received your order <strong>#${esc(order.id)}</strong> and we're getting it ready. Here's your summary:`)}
    ${orderItemsTable(order)}
    ${addressBlock(order)}
    ${paragraph(`<strong>Payment method:</strong> ${esc((order.paymentMethod || 'cod').toUpperCase())}`)}
    ${paragraph(`We'll email you again as soon as your order ships.`)}
    ${signOff()}
    ${recommendationCards(recommendedProducts)}
  `;
  return wrapEmail({ preheader: `Your order #${order.id} is confirmed — thank you!`, bodyHtml });
}

// ==================== EMAIL 2: Order Cancelled ====================
function orderCancelledEmail(order, recommendedProducts) {
  const bodyHtml = `
    ${statusBadge('Order Cancelled', '#A33')}
    ${heading(`Order #${esc(order.id)} has been cancelled`)}
    ${paragraph(`Hi ${esc(order.customer.name.split(' ')[0])}, this order has been cancelled and will not be processed further. If you paid online, any refund will be issued back to your original payment method within a few business days.`)}
    ${orderItemsTable(order)}
    ${paragraph(`If this was a mistake or you have any questions, just reply to this email or reach us on WhatsApp — we're happy to help.`)}
    ${button('Contact Us', `${SITE_URL}/contact-us.html`)}
    ${paragraph(`We hope to see you again soon.`)}
    ${recommendationCards(recommendedProducts)}
  `;
  return wrapEmail({ preheader: `Your order #${order.id} has been cancelled.`, bodyHtml });
}

// ==================== EMAIL 3: Order Shipped ====================
function orderShippedEmail(order, recommendedProducts) {
  const trackingSection = order.trackingUrl
    ? button('Track Your Order', order.trackingUrl)
    : paragraph(`Your delivery partner will contact you directly to arrange delivery.`);

  const bodyHtml = `
    ${statusBadge('On Its Way', COLORS.gold)}
    ${heading(`Your order is on its way!`)}
    ${paragraph(`Hi ${esc(order.customer.name.split(' ')[0])}, good news — order <strong>#${esc(order.id)}</strong> has shipped and should arrive within 1&ndash;3 business days.`)}
    ${trackingSection}
    ${orderItemsTable(order)}
    ${addressBlock(order)}
    ${signOff()}
    ${recommendationCards(recommendedProducts)}
  `;
  return wrapEmail({ preheader: `Your order #${order.id} has shipped!`, bodyHtml });
}

// ==================== EMAIL 4: Order Delivered ====================
function orderDeliveredEmail(order, recommendedProducts) {
  const bodyHtml = `
    ${statusBadge('Delivered', COLORS.olive)}
    ${heading(`Your order has arrived!`)}
    ${paragraph(`Hi ${esc(order.customer.name.split(' ')[0])}, order <strong>#${esc(order.id)}</strong> has been marked as delivered — we hope you love it!`)}
    ${orderItemsTable(order)}
    ${paragraph(`If anything's not quite right, just reply to this email or reach us on WhatsApp within 7 days and we'll sort it out.`)}
    ${button('Shop Again', `${SITE_URL}/products.html`)}
    ${signOff()}
    ${recommendationCards(recommendedProducts)}
  `;
  return wrapEmail({ preheader: `Your order #${order.id} has been delivered.`, bodyHtml });
}

// ==================== EMAIL 5: Newsletter Welcome ====================
function welcomeSubscriberEmail(recommendedProducts) {
  const bodyHtml = `
    ${heading(`Welcome to Natrio Organics 🌿`)}
    ${paragraph(`Thanks for joining the list! You'll be the first to hear about new arrivals, seasonal offers, and the occasional discount code — no spam, just the good stuff.`)}
    ${paragraph(`In the meantime, here's a little inspiration to get you started:`)}
    ${button('Start Shopping', `${SITE_URL}/products.html`)}
    ${recommendationCards(recommendedProducts)}
    ${paragraph(`Follow along on <a href="https://www.instagram.com/natrioorganics" style="color:${COLORS.olive};">Instagram</a> for behind-the-scenes and skincare tips.`)}
  `;
  return wrapEmail({ preheader: `Welcome to Natrio Organics — glad you're here!`, bodyHtml });
}

// ==================== EMAIL 6: Abandoned Cart Reminder ====================
function abandonedCartEmail(cart, recommendedProducts) {
  const rows = cart.items.map(i => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid ${COLORS.line};font-family:Arial,Helvetica,sans-serif;font-size:13.5px;color:${COLORS.ink};">
        ${esc(i.title)}<br><span style="color:${COLORS.muted};font-size:12px;">${esc(i.variant)} &times; ${i.qty}</span>
      </td>
      <td align="right" style="padding:10px 0;border-bottom:1px solid ${COLORS.line};font-family:Arial,Helvetica,sans-serif;font-size:13.5px;color:${COLORS.ink};white-space:nowrap;">
        ${money(i.price * i.qty)}
      </td>
    </tr>`).join('');

  const bodyHtml = `
    ${heading(`You left something behind 👀`)}
    ${paragraph(`${cart.name ? `Hi ${esc(cart.name.split(' ')[0])}, y` : 'Y'}our cart is still waiting for you — these items haven't sold out yet, but we can't promise for how long.`)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;">${rows}</table>
    ${button('Complete Your Order', `${SITE_URL}/cart.html`)}
    ${recommendationCards(recommendedProducts)}
  `;
  return wrapEmail({ preheader: `You left items in your Natrio Organics cart.`, bodyHtml });
}

// ==================== EMAIL 7: Review Request ====================
function reviewRequestEmail(order, recommendedProducts, reviewUrl) {
  const reviewSection = reviewUrl
    ? button('Leave a Review', reviewUrl)
    : paragraph(`Just reply to this email or message us on <a href="https://wa.me/923303065888" style="color:${COLORS.olive};">WhatsApp</a> and let us know what you think — we read every message.`);

  const bodyHtml = `
    ${heading(`How's everything going?`)}
    ${paragraph(`Hi ${esc(order.customer.name.split(' ')[0])}, it's been a few days since order <strong>#${esc(order.id)}</strong> arrived — we'd love to know what you think!`)}
    ${paragraph(`Your feedback genuinely helps us improve, and helps other customers know what to expect.`)}
    ${reviewSection}
    ${paragraph(`Loved it? Here's a little something for next time:`)}
    ${recommendationCards(recommendedProducts)}
  `;
  return wrapEmail({ preheader: `How was your Natrio Organics order?`, bodyHtml });
}

module.exports = {
  orderPlacedEmail,
  orderCancelledEmail,
  orderShippedEmail,
  orderDeliveredEmail,
  welcomeSubscriberEmail,
  abandonedCartEmail,
  reviewRequestEmail
};
