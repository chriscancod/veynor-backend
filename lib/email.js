// The one place that decides whether a waitlist email is acceptable. Added 2026-11-01 after a read-only check found a 200,000-character "email" was accepted.
// Limits come from the email standards: whole address at most 254 characters, the part before the @ at most 64.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isAcceptableEmail(email) {
  if (typeof email !== 'string') return false;
  const e = email.trim();
  if (e.length < 5 || e.length > 254) return false;
  if (!EMAIL_RE.test(e)) return false;
  return e.slice(0, e.indexOf('@')).length <= 64;
}
module.exports = { isAcceptableEmail, EMAIL_RE };
