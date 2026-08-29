#!/usr/bin/env bash
# veynor-backend — Railway deploy, step by step.
#
# Don't run this whole file blindly (`bash deploy-railway.sh`) — a couple of
# steps need you to read the output and confirm a name before the next step,
# same reason it's laid out as commented blocks instead of one command. Copy
# each block into your terminal one at a time, from inside this folder:
#
#   cd "veynor-backend"
#
# Verified against Railway's own current CLI docs (docs.railway.com/cli) on
# 2026-08-29 — commands, not guessed from memory.

set -e

# ── 0. Install the CLI (skip if `railway --version` already works) ─────────
npm i -g @railway/cli

# ── 1. Log in (opens your browser) ──────────────────────────────────────────
railway login

# ── 2. Create a NEW project — separate from mambru-backend's, on purpose.
#       This links the current directory to it. ────────────────────────────
railway init --name veynor-backend

# ── 3. Add a Postgres database TO THIS project. Must not be
#       mambru-backend's database — the whole point was not sharing one. ───
railway add --database postgres

# ── 4. Deploy this folder as its own service ────────────────────────────────
railway up

# ── 5. STOP AND CHECK before the next step ──────────────────────────────────
# Run this and read the output:
railway status
#
# You should see two services in the project: the Postgres one (usually
# named "Postgres") and this app (usually named after this folder,
# "veynor-backend"). If either name is different from what's used below,
# swap it in before running the next two commands.

# ── 6. Wire the app's DATABASE_URL to the Postgres service's own —
#       ${{Postgres.DATABASE_URL}} is Railway's reference-variable syntax,
#       not a placeholder to fill in yourself; leave it exactly like this. ─
railway variable set DATABASE_URL='${{Postgres.DATABASE_URL}}' --service veynor-backend

# ── 7. Create the drop_signups table on the new database ───────────────────
railway run --service veynor-backend node scripts/migrate.js

# ── 8. Get a public URL for the app service ─────────────────────────────────
railway domain --service veynor-backend
#
# Copy the URL it prints (looks like https://veynor-backend-production.up.railway.app)
# into mambru-inc/shared/site.js — CONFIG.BACKEND_URL — replacing the
# placeholder that's there now. Then push mambru-inc the normal way (GitHub
# Pages has no CI, same as every other site fix here) before it's actually live.

# ── 9. Sanity check the deployed service is really up ───────────────────────
curl https://YOUR-DOMAIN-FROM-STEP-8/
# should print: {"status":"ok","service":"veynor-backend","version":"1.0.0"}
