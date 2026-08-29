const rateLimit = require('express-rate-limit');

// BOTTLENECK FIX (2026-08-29): the version of this route living in
// mambru-backend/routes/cungus.js had no rate limiter at all — every other
// public route in that backend does. `ON CONFLICT DO NOTHING` (see
// routes/waitlist.js) blocks literal duplicate submissions, but not a script
// inserting thousands of unique fake addresses, which would quietly pollute
// the one real number (actual demand) this waitlist exists to produce.
//
// Keyed per-IP, not per-device_id like mambru-backend's app-facing limiters —
// this is a public static-site form with no device identity concept, so IP
// is the only real signal available. 20/hour is generous for a real visitor
// (nobody legitimately submits this form more than once) but blunt enough to
// stop a naive spam script.
const waitlistLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many signups from this network — try again later.' },
});

module.exports = { waitlistLimiter };
