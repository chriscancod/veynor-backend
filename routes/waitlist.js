const express = require('express');
const pool = require('../db');
const { waitlistLimiter } = require('../middleware');
const captcha = require('../lib/captchaInstance');

const router = express.Router();

// Same pattern used everywhere else in the ecosystem for this exact check —
// mambru-backend/routes/cungus.js, routes/veynorAccount.js, routes/veynorPay.js
// all use this regex (cungus.js's own comment there says it's kept in sync
// with the frontend's EMAIL_RE in shared/cart.js). Found 2026-09-21 (rotation
// 1 brand): this route — the live site's ONLY real conversion path per
// mambru-inc/shared/site.js's CONFIG.BACKEND_URL — never got that fix and was
// still on the old .includes('@') check, confirmed live: 'a@b' and
// 'nota@real' both returned {"success":true} into production drop_signups.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/drop-signup — same path and request/response shape as the old
// cungus-hosted route (mambru-backend/routes/cungus.js) on purpose, so
// mambru-inc/shared/site.js only needs its BACKEND_URL changed, not its
// request code. Dedupe handled by drop_signups.email UNIQUE constraint, same
// as before. New here: a real rate limiter (waitlistLimiter) — the old route
// had none, unlike every other public route in mambru-backend.
router.post('/api/drop-signup', waitlistLimiter, captcha.guard('signup'), async (req, res) => {
  const { email } = req.body || {};
  if (!email || typeof email !== 'string' || !EMAIL_RE.test(email)) {
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
