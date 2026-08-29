// Applies db/schema.sql. Only one file exists yet (this is a brand-new,
// single-table service) so this is deliberately simpler than
// mambru-backend/scripts/migrate.js's tracked multi-file migration runner —
// no schema_migrations table needed until there's a second schema change to
// track against. If this service grows more tables later, upgrade this to
// mambru-backend's numbered-files-plus-tracking-table pattern then, not now.
//
//   node scripts/migrate.js
//   DATABASE_URL="postgres://..." node scripts/migrate.js   # explicit target

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set — nothing to migrate against.');
    process.exit(1);
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('railway') ? { rejectUnauthorized: false } : false,
  });
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('✅ schema.sql applied (drop_signups table ready).');
  await pool.end();
}

main().catch((err) => {
  console.error('❌ migration failed:', err.message);
  process.exit(1);
});
