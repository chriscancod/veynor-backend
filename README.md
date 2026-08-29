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

## If you want the old signups moved over

The table shape matches `mambru-backend`'s `drop_signups` (minus two
drop-notify columns that don't apply here — see the comment in
`db/schema.sql`). A plain
`INSERT INTO drop_signups (email, created_at) SELECT email, created_at FROM <old>.drop_signups`
against this database, run once, carries the existing list over. Not done
automatically — moving real user data between databases is a real action,
not something to do without you saying so.
