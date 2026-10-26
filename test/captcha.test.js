const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createCaptcha, solve, encodeSolution, BASE_MAX, HARD_MAX, MIN_AGE_MS, TTL_MS } = require('../lib/captcha');

const quiet = { warn() {}, log() {} };
function clock(start = 1_000_000) {
  let t = start;
  const fn = () => t;
  fn.advance = (ms) => { t += ms; };
  return fn;
}
const make = (over = {}) => {
  const now = clock();
  return { now, c: createCaptcha({ secret: 'test-secret', mode: 'enforce', now, log: quiet, ...over }) };
};
const answer = (c, scope = 'signup', ip = '1.1.1.1') => {
  const ch = c.issue(scope, ip);
  return { ch, solution: encodeSolution(ch, solve(ch)) };
};

test('a challenge solved after a moment is accepted exactly once', () => {
  const { now, c } = make();
  const { solution } = answer(c);
  now.advance(MIN_AGE_MS + 50);
  assert.deepEqual(c.verify(solution, 'signup'), { ok: true });
  assert.deepEqual(c.verify(solution, 'signup'), { ok: false, reason: 'replayed' });
});

test('an instant answer is refused: real people are never done in under a second', () => {
  const { now, c } = make();
  const { solution } = answer(c);
  now.advance(MIN_AGE_MS - 100);
  assert.equal(c.verify(solution, 'signup').reason, 'too-fast');
  now.advance(200);
  assert.equal(c.verify(solution, 'signup').ok, true, 'the same challenge works once it is old enough');
});

test('old, forged, mismatched and broken answers are all refused with a reason', () => {
  const { now, c } = make();
  const parts = (s) => JSON.parse(Buffer.from(s, 'base64').toString());
  const pack = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
  const { solution, ch } = answer(c);
  now.advance(MIN_AGE_MS + 10);
  const s = parts(solution);
  assert.equal(c.verify(pack({ ...s, number: (s.number + 1) % (s.maxnumber + 1) }), 'signup').reason, 'wrong-answer');
  assert.equal(c.verify(pack({ ...s, maxnumber: 5 }), 'signup').reason, 'bad-signature');
  assert.equal(c.verify(pack({ ...s, iat: s.iat - 1 }), 'signup').reason, 'bad-signature');
  assert.equal(c.verify(pack({ ...s, signature: 'f'.repeat(64) }), 'signup').reason, 'bad-signature');
  assert.equal(c.verify(solution, 'contact').reason, 'wrong-scope');
  assert.equal(c.verify('', 'signup').reason, 'missing');
  assert.equal(c.verify(undefined, 'signup').reason, 'missing');
  assert.equal(c.verify('!!!not base64 json', 'signup').reason, 'malformed');
  assert.equal(c.verify(pack({ nope: 1 }), 'signup').reason, 'malformed');
  assert.equal(c.verify('x'.repeat(2001), 'signup').reason, 'missing');
  const other = createCaptcha({ secret: 'a-different-secret', mode: 'enforce', now, log: quiet });
  assert.equal(other.verify(solution, 'signup').reason, 'bad-signature', 'another server cannot accept it');
  now.advance(TTL_MS + 1);
  assert.equal(c.verify(solution, 'signup').reason, 'expired');
  assert.ok(ch.maxnumber >= 1)
});

test('work grows for a network that asks for many challenges fast, and stops at a cap', () => {
  const { c } = make();
  assert.equal(c.issue('signup', '9.9.9.9').maxnumber, BASE_MAX);
  for (let i = 0; i < 25; i++) c.issue('signup', '9.9.9.9');
  assert.equal(c.issue('signup', '9.9.9.9').maxnumber, BASE_MAX * 4);
  for (let i = 0; i < 50; i++) c.issue('signup', '9.9.9.9');
  assert.equal(c.issue('signup', '9.9.9.9').maxnumber, Math.min(HARD_MAX, BASE_MAX * 16));
  assert.equal(c.issue('signup', '8.8.8.8').maxnumber, BASE_MAX, 'other networks are not affected');
});

test('with no key the check is off (and says so); a bad mode falls back to log', () => {
  const off = createCaptcha({ secret: '', mode: 'enforce', log: quiet });
  assert.equal(off.mode, 'off');
  assert.equal(off.enabled, false);
  assert.equal(createCaptcha({ secret: 'x', mode: 'banana', log: quiet }).mode, 'log');
  assert.equal(createCaptcha({ secret: 'x', mode: 'off', log: quiet }).enabled, false);
});

async function withServer(captcha, run) {
  const app = express();
  app.use(express.json());
  captcha.mount(app);
  app.post('/join', captcha.guard('signup'), (req, res) => res.json({ success: true, stored: true }));
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await run(base); } finally { await new Promise((r) => server.close(r)); }
}
const post = (base, body) => fetch(`${base}/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('enforce mode: no answer is blocked, a good answer passes, a filled honeypot gets a quiet fake success', async () => {
  const { now, c } = make();
  await withServer(c, async (base) => {
    const blocked = await post(base, { email: 'a@b.co' });
    assert.equal(blocked.status, 400);
    assert.match((await blocked.json()).error, /confirm you are a person/);
    const ch = await (await fetch(`${base}/api/captcha/challenge?scope=signup`)).json();
    assert.equal(ch.scope, 'signup');
    assert.ok(!('number' in ch), 'the answer is never sent to the browser');
    now.advance(MIN_AGE_MS + 5);
    const ok = await post(base, { email: 'a@b.co', captcha: encodeSolution(ch, solve(ch)) });
    assert.deepEqual(await ok.json(), { success: true, stored: true });
    const bot = await post(base, { email: 'a@b.co', hp_note: 'http://spam.example' });
    assert.equal(bot.status, 200);
    assert.deepEqual(await bot.json(), { success: true }, 'the honeypot response never says "stored"');
    const stats = c.stats();
    assert.deepEqual([stats.passed, stats.honeypot, stats.failed.missing], [1, 1, 1]);
  });
});

test('log mode never blocks but still counts what it would have blocked', async () => {
  const warnings = [];
  const { c } = make({ mode: 'log', log: { warn: (m) => warnings.push(m), log() {} } });
  await withServer(c, async (base) => {
    const res = await post(base, { email: 'a@b.co' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).stored, true);
    assert.equal(c.stats().failed.missing, 1);
    assert.match(warnings[0], /would block signup: missing/);
    assert.doesNotMatch(warnings[0], /127\.0\.0\.1|::1/, 'the raw address is never logged');
  });
});

test('the challenge route refuses unknown scopes, answers with no-store, reports status, and is off without a key', async () => {
  const { c } = make();
  await withServer(c, async (base) => {
    assert.equal((await fetch(`${base}/api/captcha/challenge?scope=evil`)).status, 400);
    assert.equal((await fetch(`${base}/api/captcha/challenge`)).status, 400);
    const res = await fetch(`${base}/api/captcha/challenge?scope=contact`);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await (await fetch(`${base}/api/captcha/status`)).json(), { mode: 'enforce', scopes: ['signup', 'contact', 'login'] });
  });
  await withServer(createCaptcha({ secret: '', log: quiet }), async (base) => {
    assert.equal((await fetch(`${base}/api/captcha/challenge?scope=signup`)).status, 503);
    const open = await post(base, { email: 'a@b.co' });
    assert.equal(open.status, 200, 'with the check off, the form works exactly as before');
  });
});

