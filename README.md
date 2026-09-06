# veynor-backend

Standalone backend for Veynor Solis (Mambru Inc) — right now, just the
waitlist. Split out of `mambru-backend` on 2026-08-29.

## Why this exists

`mambru-inc`'s waitlist form used to POST to `mambru-backend` (the shared
backend behind cungus/2AM, Bettermade, carspootz, and the dashboard) via a
route living in `routes/cungus.js`, reused because it was "brand-agnostic."
That meant Veynor Solis's only working conversion mechanic — the waitlist —
went down any time the shared backend did, for reasons that had nothing to
do with Mambru Inc.

Chris's call: keep Veynor Solis on a waitlist (no checkout) until there's an
actual working prototype, but give that waitlist its own backend so it isn't
riding on cungus's uptime. This is that backend. It does exactly one thing.

## What's in here

- `server.js` — the whole app: one route, defensive error handling (stays up
  through a bad request or a DB hiccup instead of crashing the process),
  same conventions as `mambru-backend/server.js`.
- `routes/waitlist.js` — `POST /api/drop-signup`. Same request/response
  shape as the old cungus-hosted route on purpose, so the frontend only
  needed its target URL changed, not its request code. Now rate-limited
  (the old version wasn't — see `middleware.js`).
- `db.js` / `db/schema.sql` — its own Postgres connection and one table
  (`drop_signups`). Must point at a database only this service uses; see
  `.env.example`.
- `railway.toml` — same NIXPACKS + `node server.js` deploy shape as
  `mambru-backend`.

## Deploying this (Chris's steps, not done from this side)

1. New Railway project (or a new service in an existing one — either way, a
   **separate** service from `mambru-backend`'s).
2. Add a Postgres database to it (Railway's own addon, or point
   `DATABASE_URL` at any other Postgres instance) — must not be
   `mambru-backend`'s database, or this doesn't actually decouple anything.
3. Set `DATABASE_URL` (and optionally `PORT`) as service variables.
4. Deploy. Then run the migration once against that database:
   `DATABASE_URL="<railway's URL>" node scripts/migrate.js`
5. Copy the service's public Railway URL (Settings → Networking → Generate
   Domain, or your own custom domain).
6. Update `mambru-inc/shared/site.js`'s `CONFIG.BACKEND_URL` to that URL —
   it currently has a placeholder with a comment pointing back here. Push
   that change to the `mambru-inc` GitHub repo the same way every other site
   fix reaches `mambru.online` (this is a GitHub Pages site, no CI).

## Seeing and emailing the waitlist (added 2026-09-05)

Nothing read `drop_signups` back until now — signups just piled up in
Postgres with no way to see them or tell anyone about anything. Fixed with
the same script-based approach `mambru-backend` already uses for the cungus
drop-notify system:

```bash
node scripts/notify-waitlist.js --list
# or: npm run waitlist:list

node scripts/notify-waitlist.js --tag=launch-day --subject="It's live" --message="mambru.online/index.html"
# or, to see who'd get it without sending: add --dry-run
```

Sending needs `EMAIL_USER`/`EMAIL_PASS` set (see `.env.example`) — a Gmail
address and an App Password, same two vars `mambru-backend` already uses, so
if that's already set up there, it's already set up here too. `--list`
alone needs nothing but `DATABASE_URL`, which is already required for
everything else in this backend.

`--tag` is required on every send so re-running after a partial failure
never double-emails anyone — already-tagged addresses for that exact tag are
skipped automatically.

## If you want the old signups moved over

The table shape now matches `mambru-backend`'s `drop_signups` exactly
(`notified_at`/`notified_tag` were added here 2026-09-05 for the script
above — see the comment in `db/schema.sql`). A plain
`INSERT INTO drop_signups (email, created_at) SELECT email, created_at FROM <old>.drop_signups`
against this database, run once, carries the existing list over. Not done
automatically — moving real user data between databases is a real action,
not something to do without you saying so.
