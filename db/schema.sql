-- veynor-backend's entire schema — one table. Idempotent, safe to re-run:
--   psql "$DATABASE_URL" -f db/schema.sql
--
-- Same shape as mambru-backend's drop_signups table (db/002_absorb_apps.sql)
-- MINUS the notified_at/notified_collection columns added later
-- (db/008_drop_signup_notified.sql) — those belong to cungus's drop-notify
-- system, which has no equivalent here. If Chris wants to migrate the
-- existing Veynor Solis signups out of the old shared database, this table
-- is a compatible target for a plain `INSERT INTO drop_signups (email,
-- created_at) SELECT email, created_at FROM <old db>.drop_signups`.

CREATE TABLE IF NOT EXISTS drop_signups (
  id          SERIAL PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Added 2026-09-05 (Chris's ask: "make mambru.online stuff actually send me
-- something / send emails to them or updates"): lets scripts/notify-waitlist.js
-- track who's already been sent a given update so a re-run never double-emails
-- anyone. Same idempotent-per-tag design as mambru-backend's
-- notified_at/notified_collection columns (db/008_drop_signup_notified.sql)
-- for the cungus drop-notify system — called "tag" here instead of
-- "collection" since Veynor Solis is one product, not multiple drops, but
-- the reasoning carries over exactly: kept as ALTER TABLE ADD COLUMN IF NOT
-- EXISTS (not a numbered migration) per this file's own existing note above
-- that a numbered-migrations system isn't warranted until there's a second
-- real schema change — this is that second change, kept in the simplest
-- form that's still safe to re-run on every boot (server.js's ensureSchema()
-- re-applies this whole file every time the service starts).
ALTER TABLE drop_signups ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;
ALTER TABLE drop_signups ADD COLUMN IF NOT EXISTS notified_tag TEXT;
