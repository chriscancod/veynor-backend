require('dotenv').config();
// Must be required before the routes are — Express 4 doesn't catch a
// rejected promise from an async handler, it becomes an unhandled rejection.
// Same reasoning as mambru-backend/server.js: this backend has exactly one
// job (the waitlist), so a single unhandled DB error taking the whole
// process down would be the worst possible outcome for something built
// specifically to be more resilient than the shared backend it replaced.
require('express-async-errors');
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 4300;

// Railway terminates TLS at its edge and forwards with X-Forwarded-For —
// without this, every visitor would share one rate-limit bucket (Express
// would see the proxy's IP, not the real client's). Same setup as
// mambru-backend/server.js. `1`, not `true`: trust exactly one hop.
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json({ limit: '1mb' })); // a signup body is one email address — no large-payload routes here

app.get('/', (_, res) => res.json({ status: 'ok', service: 'veynor-backend', version: '1.0.0' }));

app.use('/', require('./routes/waitlist'));

app.use((err, req, res, next) => {
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Same "stay up and log it" philosophy as mambru-backend — a backend that
// serves most requests fine beats one that's gone until someone notices,
// especially for a single-purpose service with no other redundancy.
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandled rejection (server staying up):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[fatal] uncaught exception (server staying up):', err);
});

app.listen(PORT, () => console.log(`veynor-backend listening on :${PORT}`));
