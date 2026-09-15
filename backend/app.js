const express = require('express');
const cors = require('cors');
const pdfParse = require('pdf-parse');

const { createAuthRouter } = require('./routes/auth');
const { createDocumentsRouter } = require('./routes/documents');
const { createChatRouter } = require('./routes/chat');
const { createQuizRouter } = require('./routes/quiz');
const { createStatsRouter } = require('./routes/stats');
const { createStudyRouter } = require('./routes/study');
const { requireAuth } = require('./lib/authMiddleware');

async function extractPdfText(buffer) {
  const parsed = await pdfParse(buffer);
  return parsed.text;
}

// pool and aiClients get passed in instead of required directly by each route file
// so tests can swap in fakes without needing a real database or a real ollama
function createApp(pool, aiClients) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

  app.use('/api/auth', createAuthRouter(pool));

  const { router: documentsRouter } = createDocumentsRouter(pool, aiClients, { extractPdfText });
  app.use('/api/documents', requireAuth, documentsRouter);

  app.use('/api/chat', requireAuth, createChatRouter(pool, aiClients));
  app.use('/api/quiz', requireAuth, createQuizRouter(pool, aiClients));
  app.use('/api/stats', requireAuth, createStatsRouter(pool));
  app.use('/api/study', requireAuth, createStudyRouter(pool, aiClients));

  // catches anything a route forgot to handle so it doesn't crash the process
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp, extractPdfText };
