// Last edited: 2026-09-04 08:35 AM EDT (added ensureSchema() self-heal — see find-and-fix-5
// roadmap entry)
require('dotenv').config();
// Must be required before the routes are — Express 4 doesn't catch a
// rejected promise from an async handler, it becomes an unhandled rejection.
// Same reasoning as mambru-backend/server.js: this backend has exactly one
// job (the waitlist), so a single unhandled DB error taking the whole
// process down would be the worst possible outcome for something built
// specifically to be more resilient than the shared backend it replaced.
require('express-async-errors');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const pool = require('./db');

const app = express();
const PORT = process.env.PORT || 4300;

// Fixed 2026-09-04: confirmed live right now — POST /api/drop-signup on the real deployed
// service 500s with a bare "Internal server error". railway logs (per this project's own
// 2026-08-29 roadmap entry) already pinned the exact cause: Postgres 42P01, "relation
// drop_signups does not exist" — scripts/migrate.js was supposed to be run once by hand after
// deploy and, per that same entry, either never actually ran against the right database or
// silently no-op'd; nobody's since confirmed which. Rather than leave the one real conversion
// mechanic on the whole Veynor Solis site broken until someone remembers to SSH in and rerun a
// migration script again, apply the same idempotent schema.sql (CREATE TABLE IF NOT EXISTS —
// safe to run every single boot, matching or no-op either way) once at startup. A failure here
// is logged, never fatal — same "stay up and log it" philosophy as the rest of this file —
// because a backend that can't self-heal its one table shouldn't also refuse to serve the
// requests that don't need it yet.
async function ensureSchema() {
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
    await pool.query(sql);
    console.log('[boot] schema.sql applied (drop_signups table ready).');
  } catch (err) {
    console.error('[boot] could not apply schema.sql — /api/drop-signup will keep 500ing until this is resolved:', err.message);
  }
}

// Railway terminates TLS at its edge and forwards with X-Forwarded-For —
// without this, every visitor would share one rate-limit bucket (Express
// would see the proxy's IP, not the real client's). Same setup as
// mambru-backend/server.js. `1`, not `true`: trust exactly one hop.
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json({ limit: '1mb' })); // a signup body is one email address — no large-payload routes here

app.get('/', (_, res) => res.json({ status: 'ok', service: 'veynor-backend', version: '1.0.0' }));

// Invisible bot check for the public waitlist form: GET /api/captcha/challenge, GET /api/captcha/status.
require('./lib/captchaInstance').mount(app);
app.use('/', require('./routes/waitlist'));

app.use((err, req, res, next) => {
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Same "stay up and log it" philosophy as mambru-backend — a backend that
// serves most requests fine beats one that's gone until someone notices,
// especially for a single-purpose service with no other redundancy.
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandled rejection (server staying up):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[fatal] uncaught exception (server staying up):', err);
});

ensureSchema().finally(() => {
  app.listen(PORT, () => console.log(`veynor-backend listening on :${PORT}`));
});
