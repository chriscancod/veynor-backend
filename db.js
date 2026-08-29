const { Pool } = require('pg');

// Deliberately its own Pool, its own DATABASE_URL, its own process — the
// entire point of this backend existing (see README.md) is that Veynor
// Solis's waitlist no longer shares a failure domain with cungus's backend.
// Point this at either a brand-new Postgres instance, or a separate
// database/schema on an existing Postgres server — either way it must be a
// connection string this service alone uses, not mambru-backend's.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway') ? { rejectUnauthorized: false } : false,
});

// Same defensive pattern as mambru-backend/db.js: node-postgres emits
// 'error' on an idle client when a connection drops (DB restart, network
// blip). An EventEmitter 'error' with no listener is rethrown by Node and
// kills the process — for a single-purpose waitlist service that would mean
// one dropped connection takes down the only thing this service does.
pool.on('error', (err) => {
  console.error('[db] idle client error (pool will recycle it):', err.message);
});

module.exports = pool;
