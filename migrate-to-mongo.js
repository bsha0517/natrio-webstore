// Run this ONCE after setting up MongoDB, to copy your existing data/*.json
// files into the database. Usage:
//
//   MONGODB_URI="your-connection-string" node migrate-to-mongo.js
//
// It's safe to re-run — it overwrites each collection with the current
// contents of the matching JSON file, so don't run it again after you've
// started editing data through the live site (that would undo those edits).

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

if (!process.env.MONGODB_URI) {
  console.error('Set MONGODB_URI first, e.g.:\n  MONGODB_URI="mongodb+srv://..." node migrate-to-mongo.js');
  process.exit(1);
}

const FILES = [
  'products', 'orders', 'categories', 'blog', 'hero',
  'users', 'shipping', 'discounts', 'instagram', 'subscribers', 'messages'
];

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db();

  for (const name of FILES) {
    const filePath = path.join(__dirname, 'data', `${name}.json`);
    if (!fs.existsSync(filePath)) {
      console.log(`Skipping ${name} — no data/${name}.json file found.`);
      continue;
    }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    await db.collection('store').updateOne(
      { _id: name },
      { $set: { data } },
      { upsert: true }
    );
    console.log(`Migrated ${name}: ${Array.isArray(data) ? data.length : 1} record(s).`);
  }

  await client.close();
  console.log('\nDone! Your data now lives in MongoDB.');
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
