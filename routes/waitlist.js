const express = require('express');
const pool = require('../db');
const { waitlistLimiter } = require('../middleware');

const router = express.Router();

// POST /api/drop-signup — same path and request/response shape as the old
// cungus-hosted route (mambru-backend/routes/cungus.js) on purpose, so
// mambru-inc/shared/site.js only needs its BACKEND_URL changed, not its
// request code. Dedupe handled by drop_signups.email UNIQUE constraint, same
// as before. New here: a real rate limiter (waitlistLimiter) — the old route
// had none, unlike every other public route in mambru-backend.
router.post('/api/drop-signup', waitlistLimiter, async (req, res) => {
  const { email } = req.body || {};
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Invalid email' });
  }
  const normalized = email.trim().toLowerCase();
  await pool.query(
    `INSERT INTO drop_signups (email) VALUES ($1) ON CONFLICT (email) DO NOTHING`,
    [normalized]
  );
  res.json({ success: true });
});

module.exports = router;
