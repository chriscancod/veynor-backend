// A bot check people do not notice. No puzzle, no images, no tracking, no third party:
//   1. the page asks for a small challenge,
//   2. the visitor's browser quietly solves it in the background while they type (a few hundred milliseconds),
//   3. the form sends the answer with the email,
//   4. the server checks the answer, that it is fresh, not reused, and not suspiciously instant.
// A bot has to spend real computer time on every single submission, and a hidden "honeypot" field catches the
// dumb ones for free. It raises the cost of spam; it does not stop a determined attacker with money to spend.
//
// Rollout is safe by default: CAPTCHA_MODE=log (the default) checks and counts but never blocks, so you can see
// how it behaves before turning on CAPTCHA_MODE=enforce. CAPTCHA_MODE=off disables it. No key is needed: the
// signing key is CAPTCHA_SECRET or, if that is unset, JWT_SECRET. With neither, the check is off (and says so).
//
// This file is copied into veynor-backend/lib/captcha.js. Keep the two identical.
const crypto = require('crypto');

const SCOPES = ['signup', 'contact', 'login'];
const MIN_AGE_MS = 1000;           // a real person is never done in under a second
const TTL_MS = 10 * 60 * 1000;     // a challenge is good for ten minutes
const BASE_MAX = 40_000;           // work for a normal visitor: about 20,000 hashes on average
const HARD_MAX = 1_000_000;        // the most work we ever ask for
const WINDOW_MS = 60 * 1000;
const REPLAY_LIMIT = 20_000;

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const mac = (key, text) => crypto.createHmac('sha256', key).update(text).digest('hex');
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const shortId = (value) => sha256(`log:${value}`).slice(0, 8);
const signedText = (c) => [c.salt, c.challenge, c.maxnumber, c.iat, c.exp, c.scope].join('.');

/** What the browser does, for tests and scripts: find the number that hashes to the challenge. */
function solve(challenge) {
  for (let n = 0; n <= challenge.maxnumber; n++) {
    if (sha256(challenge.salt + n) === challenge.challenge) return n;
  }
  return null;
}
const encodeSolution = (challenge, number) => Buffer.from(JSON.stringify({ ...challenge, number })).toString('base64');

function createCaptcha({ secret = process.env.CAPTCHA_SECRET || process.env.JWT_SECRET, mode = process.env.CAPTCHA_MODE || 'log', now = () => Date.now(), log = console } = {}) {
  const effectiveMode = !secret ? 'off' : ['off', 'log', 'enforce'].includes(mode) ? mode : 'log';
  const key = secret ? `captcha:v1:${secret}` : '';
  const used = new Map();   // signature -> when it expires (a solved challenge works once)
  const asked = new Map();  // ip -> timestamps of recent challenge requests
  const stats = { issued: 0, passed: 0, honeypot: 0, failed: {} };
  const startedAt = new Date(now()).toISOString();
  if (mode !== effectiveMode && !secret && mode !== 'off') log.warn('[captcha] no CAPTCHA_SECRET or JWT_SECRET: the bot check is OFF.');

  /** More work for networks that ask for many challenges quickly. */
  function difficultyFor(ip) {
    const t = now();
    const recent = (asked.get(ip) || []).filter((x) => t - x < WINDOW_MS);
    recent.push(t);
    asked.set(ip, recent);
    if (asked.size > 5000) for (const [k, v] of asked) if (!v.some((x) => t - x < WINDOW_MS)) asked.delete(k);
    const factor = recent.length > 60 ? 16 : recent.length > 20 ? 4 : 1;
    return { maxnumber: Math.min(HARD_MAX, BASE_MAX * factor), tooMany: recent.length > 120 };
  }

  function issue(scope, ip = '') {
    const { maxnumber } = difficultyFor(ip);
    const t = now();
    const salt = crypto.randomBytes(12).toString('hex');
    const number = crypto.randomInt(0, maxnumber + 1);
    const c = { salt, challenge: sha256(salt + number), maxnumber, iat: t, exp: t + TTL_MS, scope };
    stats.issued += 1;
    return { ...c, signature: mac(key, signedText(c)) };
  }

  function verify(solution, scope) {
    if (!solution || typeof solution !== 'string' || solution.length > 2000) return { ok: false, reason: 'missing' };
    let s;
    try { s = JSON.parse(Buffer.from(solution, 'base64').toString('utf8')); } catch { return { ok: false, reason: 'malformed' }; }
    if (!s || typeof s !== 'object') return { ok: false, reason: 'malformed' };
    const numbers = [s.maxnumber, s.iat, s.exp, s.number];
    if (typeof s.salt !== 'string' || typeof s.challenge !== 'string' || typeof s.signature !== 'string' || typeof s.scope !== 'string' || !numbers.every((n) => Number.isSafeInteger(n))) return { ok: false, reason: 'malformed' };
    if (!safeEqual(mac(key, signedText(s)), s.signature)) return { ok: false, reason: 'bad-signature' };
    if (s.scope !== scope) return { ok: false, reason: 'wrong-scope' };
    const t = now();
    if (t > s.exp) return { ok: false, reason: 'expired' };
    if (t - s.iat < MIN_AGE_MS) return { ok: false, reason: 'too-fast' };
    if (s.number < 0 || s.number > s.maxnumber || sha256(s.salt + s.number) !== s.challenge) return { ok: false, reason: 'wrong-answer' };
    for (const [sig, until] of used) if (until < t) used.delete(sig);
    if (used.has(s.signature)) return { ok: false, reason: 'replayed' };
    if (used.size >= REPLAY_LIMIT) return { ok: false, reason: 'busy' };
    used.set(s.signature, s.exp);
    return { ok: true };
  }

  /**
   * Express middleware for a public form route. A filled honeypot gets a quiet fake success (so the bot learns nothing).
   * In "log" mode a failed check is counted and logged but the request goes on; in "enforce" it is refused.
   */
  function guard(scope, { fakeSuccess = { success: true } } = {}) {
    return (req, res, next) => {
      if (effectiveMode === 'off') return next();
      const body = req.body || {};
      if (typeof body.hp_note === 'string' && body.hp_note.trim()) {
        stats.honeypot += 1;
        return res.status(200).json(fakeSuccess);
      }
      const result = verify(body.captcha, scope);
      if (result.ok) { stats.passed += 1; return next(); }
      stats.failed[result.reason] = (stats.failed[result.reason] || 0) + 1;
      log.warn(`[captcha] ${effectiveMode === 'enforce' ? 'blocked' : 'would block'} ${scope}: ${result.reason} (network ${shortId(req.ip)})`);
      if (effectiveMode === 'enforce') return res.status(400).json({ error: 'We could not confirm you are a person. Reload the page and try again.' });
      return next();
    };
  }

  /** GET /api/captcha/challenge?scope=signup and GET /api/captcha/status. */
  function mount(app, base = '/api/captcha') {
    app.get(`${base}/challenge`, (req, res) => {
      if (effectiveMode === 'off') return res.status(503).json({ error: 'The bot check is off.' });
      const scope = String(req.query.scope || '');
      if (!SCOPES.includes(scope)) return res.status(400).json({ error: 'Unknown scope.' });
      if (difficultyFor(req.ip).tooMany) return res.status(429).json({ error: 'Too many requests. Wait a minute.' });
      res.set('Cache-Control', 'no-store').json(issue(scope, req.ip));
    });
    // Counts since the last restart, so you can tell whether it is safe to turn on CAPTCHA_MODE=enforce: if "failed" is
    // near zero next to "passed" after real signups, enforcing will not block real people. Nothing personal is in here.
    app.get(`${base}/status`, (req, res) => res.json({ mode: effectiveMode, scopes: SCOPES, since: startedAt, ...stats, failed: { ...stats.failed } }));
  }

  return { mode: effectiveMode, enabled: effectiveMode !== 'off', issue, verify, guard, mount, stats: () => ({ ...stats, failed: { ...stats.failed } }) };
}

module.exports = { createCaptcha, solve, encodeSolution, SCOPES, MIN_AGE_MS, BASE_MAX, HARD_MAX, TTL_MS };
