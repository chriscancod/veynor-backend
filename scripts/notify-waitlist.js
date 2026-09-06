// Lists and emails the real Veynor Solis waitlist (drop_signups).
//
// Chris's ask (2026-09-05, verbatim): "make mambru.online stuff actually send
// me something so i can like send emails to them or updates". Investigated
// first: /api/drop-signup already writes every real signup into Postgres
// (routes/waitlist.js), but until now nothing ever read that table back —
// no way to see who signed up, no way to email them anything. This is the
// missing other half, built the exact same way mambru-backend already solved
// this same problem for cungus's drop-signup waitlist
// (mambru-backend/scripts/notify-drop.js): a hand-run CLI script, nodemailer
// over Gmail SMTP with an App Password, idempotent per-send so a re-run after
// a partial failure never double-emails anyone. Reuses the SAME EMAIL_USER /
// EMAIL_PASS env vars that backend already uses — if Chris already set up a
// Gmail App Password for the 2AM drop-notify system, the exact same one
// works here too, no new setup.
//
// LIST what's actually been collected so far (this is the "get me some
// emails" half of the ask) — prints every signup, doesn't touch anything:
//   node scripts/notify-waitlist.js --list
//
// SEND a real update to everyone who hasn't gotten THIS specific update yet
// (a --tag is required so re-running is always safe — already-tagged
// addresses are skipped, so a crash halfway through only re-sends to the
// stragglers on the next run):
//   node scripts/notify-waitlist.js --tag=launch-day --subject="Veynor Solis is live" --message="It's here. mambru.online/index.html"
//   node scripts/notify-waitlist.js --tag=update1 --subject="Quick update" --message="Still on track — more soon." --dry-run

require('dotenv').config();
const nodemailer = require('nodemailer');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway') ? { rejectUnauthorized: false } : false,
});

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const LIST = args.includes('--list');
const DRY_RUN = args.includes('--dry-run');
const TAG = flag('tag', null);
const SUBJECT = flag('subject', null);
const MESSAGE = flag('message', null);
const SITE_URL = flag('url', 'https://mambru.online');
const BATCH_DELAY_MS = Number(flag('delay', '400')); // gentle on Gmail's rate limits, same as notify-drop.js

function buildMailer() {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
}

async function listSignups() {
  const { rows } = await pool.query(
    `SELECT email, created_at, notified_at, notified_tag FROM drop_signups ORDER BY created_at ASC`
  );
  if (!rows.length) {
    console.log('No signups yet.');
    return;
  }
  console.log(`${rows.length} total signup(s):\n`);
  for (const r of rows) {
    const sentInfo = r.notified_at ? `last emailed ${r.notified_at.toISOString().slice(0, 10)} (tag: ${r.notified_tag})` : 'never emailed';
    console.log(`  ${r.email}  —  signed up ${r.created_at.toISOString().slice(0, 10)}  —  ${sentInfo}`);
  }
  console.log(`\nTip: node scripts/notify-waitlist.js --tag=<name> --subject="..." --message="..." to send them something.`);
}

async function sendUpdate() {
  if (!TAG) {
    console.error('Missing --tag=<name> — required so this is always safe to re-run without double-emailing anyone.');
    console.error('Example: node scripts/notify-waitlist.js --tag=launch-day --subject="It\'s live" --message="mambru.online/index.html"');
    process.exit(1);
  }
  if (!SUBJECT || !MESSAGE) {
    console.error('Missing --subject="..." and/or --message="..." — both are required so nothing gets sent with placeholder text.');
    process.exit(1);
  }

  const { rows } = await pool.query(
    `SELECT id, email FROM drop_signups
      WHERE notified_at IS NULL OR notified_tag IS DISTINCT FROM $1
      ORDER BY created_at ASC`,
    [TAG]
  );

  if (!rows.length) {
    console.log(`Nobody to email for tag "${TAG}" — every signup has already gotten this one.`);
    return;
  }
  console.log(`${rows.length} address(es) to email for tag "${TAG}".`);

  if (DRY_RUN) {
    for (const r of rows) console.log(`  would email: ${r.email}`);
    console.log('\nDry run — nothing sent, nothing stamped.');
    return;
  }

  const mailer = buildMailer();
  if (!mailer) {
    console.error('EMAIL_USER / EMAIL_PASS are not set in this backend\'s environment — cannot send. Nothing was stamped.');
    console.error('Set them the same way mambru-backend does: a Gmail address in EMAIL_USER, and a Gmail App Password (not your real password) in EMAIL_PASS.');
    process.exit(1);
  }

  const bodyText = [MESSAGE, '', SITE_URL, '', '— Veynor Solis'].join('\n');

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await mailer.sendMail({ from: process.env.EMAIL_USER, to: row.email, subject: SUBJECT, text: bodyText });
      // Stamped per-address immediately, same reasoning as notify-drop.js: a
      // crash halfway through must not re-email the first half on retry.
      await pool.query(`UPDATE drop_signups SET notified_at = now(), notified_tag = $1 WHERE id = $2`, [TAG, row.id]);
      sent++;
      console.log(`  sent -> ${row.email}`);
    } catch (err) {
      failed++;
      console.error(`  FAILED -> ${row.email}: ${err.message}`);
    }
    if (BATCH_DELAY_MS > 0) await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
  }

  console.log(`\nDone. ${sent} sent, ${failed} failed.`);
  if (failed) console.log('Re-run this script (same --tag) to retry only the ones that failed.');
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set — nothing to read/send against.');
    process.exit(1);
  }
  if (LIST) return listSignups();
  return sendUpdate();
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => pool.end());
