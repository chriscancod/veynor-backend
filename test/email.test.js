const test = require('node:test');
const assert = require('node:assert');
const { isAcceptableEmail } = require('../lib/email');

test('normal addresses pass', () => {
  for (const e of ['a@b.co', 'chris@example.com', 'first.last+tag@sub.example.org', '  spaced@x.io  ']) assert.ok(isAcceptableEmail(e), e);
});
test('the old holes stay shut', () => {
  assert.ok(!isAcceptableEmail('a@b'));
  assert.ok(!isAcceptableEmail('nota@real'));
  assert.ok(!isAcceptableEmail(''));
  assert.ok(!isAcceptableEmail(['a@b.co']));
  assert.ok(!isAcceptableEmail({ toString: () => 'a@b.co' }));
  assert.ok(!isAcceptableEmail(null));
  assert.ok(!isAcceptableEmail('two words@x.co'));
});
test('a huge address is refused (the 200,000-character one)', () => {
  assert.ok(!isAcceptableEmail('a'.repeat(200000) + '@x.co'));
  assert.ok(!isAcceptableEmail('a'.repeat(65) + '@x.co'));         // before the @: 64 max
  assert.ok(isAcceptableEmail('a'.repeat(64) + '@x.co'));
  assert.ok(!isAcceptableEmail('a@' + 'b'.repeat(250) + '.co'));   // whole address: 254 max
});
