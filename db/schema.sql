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
