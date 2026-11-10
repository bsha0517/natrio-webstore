// Seeds a LOCAL MongoDB (default mongodb://127.0.0.1:27017/natrio) with the
// live catalogue + blog, read from natrio.pk's PUBLIC read-only API, so the
// SEO tests run against real content without touching production data.
// Never point SEED_TARGET at production. Customer data (users, orders,
// subscribers, messages, sessions) is never copied.
//
//   node seo/seed-local-from-prod.cjs
//
const path = require('path');
const { MongoClient } = require(path.join(__dirname, '..', 'worker', 'node_modules', 'mongodb'));

const SOURCE = process.env.SEED_SOURCE || 'https://natrio.pk';
const TARGET = process.env.SEED_TARGET || 'mongodb://127.0.0.1:27017/natrio';
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)[:/]/.test(TARGET)) {
  console.error('Refusing to seed a non-local database:', TARGET);
  process.exit(1);
}

const KEYS = {
  products: '/api/products',
  categories: '/api/categories',
  blog: '/api/blog',
  shipping: '/api/shipping',
  hero: '/api/hero',
  announcements: '/api/announcements',
  stores: '/api/stores',
  instagram: '/api/instagram',
  settings: '/api/settings'
};

(async () => {
  const client = new MongoClient(TARGET);
  await client.connect();
  const db = client.db();
  await db.collection('store').deleteMany({});
  await db.collection('sessions').deleteMany({});
  for (const [key, url] of Object.entries(KEYS)) {
    const res = await fetch(SOURCE + url, { headers: { 'User-Agent': 'NatrioLocalSeed/1.0' } });
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    let data = await res.json();
    // /api/blog returns newest first; the store keeps insertion order (oldest first).
    if (key === 'blog') {
      data = data.slice().reverse();
      // one unpublished post, to prove drafts are never served
      data.push({ id: 'draft001', slug: 'unpublished-test-draft', title: 'Unpublished draft', excerpt: '', body: '<p>Draft</p>', image: '', published: false, date: new Date().toISOString() });
    }
    await db.collection('store').updateOne({ _id: key }, { $set: { data } }, { upsert: true });
    console.log(`seeded ${key}: ${Array.isArray(data) ? data.length + ' items' : 'object'}`);
    await new Promise(r => setTimeout(r, 300));
  }
  await client.close();
})().catch(e => { console.error(e); process.exit(1); });
