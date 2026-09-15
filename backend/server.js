require('dotenv').config();
const { createApp } = require('./app');
const pool = require('./db/connection');
const aiClients = require('./lib/aiClients');
const { startDailyReviewCheck } = require('./lib/scheduler');

if (!process.env.JWT_SECRET) {
  console.warn('[warning] JWT_SECRET is not set in .env — using an insecure default. Set it before deploying anywhere real.');
}

const app = createApp(pool, aiClients);
const port = process.env.PORT || 3000;

// log unexpected errors and keep running so one bad request doesn't crash the server
// for everyone else. if the port is already taken though, exit right away since the
// server isn't actually listening at that point anyway
process.on('uncaughtException', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`[fatal] Port ${port} is already in use. Is another instance of the server already running?`);
    process.exit(1);
  }
  console.error('[uncaughtException]', err);
});

process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});

app.listen(port, () => {
  console.log(`StudyMind backend listening on http://localhost:${port}`);
  startDailyReviewCheck(pool);
});
