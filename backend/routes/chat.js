const express = require('express');

// a real question is never this long, this just stops someone pasting a huge
// wall of text into the prompt
const MAX_QUESTION_LENGTH = 4000;

function createChatRouter(pool, aiClients) {
  const router = express.Router();

  // retrieves relevant note chunks, then has the LLM answer using only those chunks
  router.post('/', async (req, res) => {
    const { question, documentIds } = req.body || {};
    if (!question || !question.trim()) {
      return res.status(400).json({ error: 'question is required' });
    }

    if (question.length > MAX_QUESTION_LENGTH) {
      return res.status(400).json({ error: `Question is too long (max ${MAX_QUESTION_LENGTH} characters)` });
    }

    // documentIds lets the user scope the question to one, several, or all notes.
    // omitted or empty means search everything
    const scopeIds = Array.isArray(documentIds) && documentIds.length > 0 ? documentIds : undefined;

    try {
      const matches = await aiClients.queryVectors({
        text: question,
        userId: req.userId,
        nResults: 5,
        documentIds: scopeIds,
      });
      if (matches.length === 0) {
        return res.json({
          answer: scopeIds
            ? "I couldn't find anything relevant in the notes you selected."
            : "You haven't uploaded any notes yet, so I have nothing to search. Upload a document first.",
          sources: [],
        });
      }

      // matches can span multiple documents, so grab the distinct doc ids first and
      // look up all the titles in one query instead of one per match
      const docIdList = [];
      for (const m of matches) {
        const dId = Number(m.metadata.document_id);
        if (!docIdList.includes(dId)) docIdList.push(dId);
      }

      const [docRows] = await pool.query(
        `SELECT id, title FROM documents WHERE id IN (${docIdList.map(() => '?').join(',')})`,
        docIdList
      );

      // plain object as a lookup table, id to title
      const titleLookup = {};
      for (const d of docRows) {
        titleLookup[d.id] = d.title;
      }

      const sources = [];
      for (const m of matches) {
        const dId = Number(m.metadata.document_id);
        sources.push({
          chunkVectorId: m.id,
          text: m.text,
          documentId: dId,
          documentTitle: titleLookup[dId] || 'Unknown document',
          distance: m.distance,
        });
      }

      const answer = await aiClients.generateAnswer(question, sources);

      // grab chunk_index so the frontend can label sources as "Section N" instead
      // of dumping raw text with no location
      const vecIds = sources.map((s) => s.chunkVectorId);
      const [chunkRows] = await pool.query(
        `SELECT id, vector_id, chunk_index FROM chunks WHERE vector_id IN (${vecIds.map(() => '?').join(',')})`,
        vecIds
      );

      const chunkIndexLookup = {};
      for (const row of chunkRows) {
        chunkIndexLookup[row.vector_id] = row.chunk_index;
      }

      // log which chunks got asked about, this drives the spaced repetition scheduling
      for (const row of chunkRows) {
        await pool.query('INSERT INTO chat_log (user_id, chunk_id) VALUES (?, ?)', [req.userId, row.id]);
      }

      // also keep a plain record of the question and answer for the history panel
      await pool.query(
        'INSERT INTO chat_history (user_id, mode, question, answer) VALUES (?, ?, ?, ?)',
        [req.userId, 'notes', question, answer]
      );

      const outSources = sources.map((s) => ({
        text: s.text,
        documentTitle: s.documentTitle,
        documentId: s.documentId,
        chunkIndex: chunkIndexLookup[s.chunkVectorId],
      }));

      return res.json({ answer, sources: outSources });
    } catch (err) {
      return res.status(500).json({ error: 'Chat failed', details: err.message });
    }
  });

  // "Ask the AI Anything", no note retrieval or grounding. kept as its own route
  // so it's clear in the code which mode answered a question
  router.post('/general', async (req, res) => {
    const { question } = req.body || {};
    if (!question || !question.trim()) {
      return res.status(400).json({ error: 'question is required' });
    }
    if (question.length > MAX_QUESTION_LENGTH) {
      return res.status(400).json({ error: `Question is too long (max ${MAX_QUESTION_LENGTH} characters)` });
    }

    try {
      const answer = await aiClients.generateGeneralAnswer(question);
      await pool.query(
        'INSERT INTO chat_history (user_id, mode, question, answer) VALUES (?, ?, ?, ?)',
        [req.userId, 'general', question, answer]
      );
      return res.json({ answer });
    } catch (err) {
      return res.status(500).json({ error: 'Chat failed', details: err.message });
    }
  });

  // past questions the user has asked, notes-grounded and general, newest first
  router.get('/history', async (req, res) => {
    try {
      // id as a tiebreaker since asked_at only has 1-second resolution and two
      // questions can land in the same second
      const [rows] = await pool.query(
        'SELECT id, mode, question, answer, asked_at FROM chat_history WHERE user_id = ? ORDER BY asked_at DESC, id DESC LIMIT 100',
        [req.userId]
      );
      return res.json({ history: rows });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to load history', details: err.message });
    }
  });

  return router;
}

module.exports = { createChatRouter };
