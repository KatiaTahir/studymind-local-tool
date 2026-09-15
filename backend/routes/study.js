const express = require('express');

// keeps prompts a reasonable size. local LLMs slow down and lose accuracy on
// really long inputs, so this samples/truncates instead of sending everything
const SAMPLE_CHAR_LIMIT = 6000;

function createStudyRouter(pool, aiClients) {
  const router = express.Router();

  async function getChunks({ userId, documentId }) {
    if (documentId) {
      const [rows] = await pool.query(
        'SELECT c.id, c.text, d.title AS document_title FROM chunks c JOIN documents d ON c.document_id = d.id WHERE c.user_id = ? AND c.document_id = ? ORDER BY c.chunk_index',
        [userId, documentId]
      );
      return rows;
    }

    const [rows] = await pool.query(
      'SELECT c.id, c.text, d.title AS document_title FROM chunks c JOIN documents d ON c.document_id = d.id WHERE c.user_id = ? ORDER BY c.document_id, c.chunk_index',
      [userId]
    );
    return rows;
  }

  // ai-extracted main topics across the user's notes, used by the topic picker dropdowns
  router.get('/topics', async (req, res) => {
    try {
      const chunks = await getChunks({ userId: req.userId });
      if (chunks.length === 0) return res.json({ topics: [] });

      const sampleText = chunks.map((c) => c.text).join('\n\n').slice(0, SAMPLE_CHAR_LIMIT);
      const topics = await aiClients.generateTopics(sampleText);
      return res.json({ topics });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to extract topics', details: err.message });
    }
  });

  router.post('/summarize', async (req, res) => {
    try {
      const { documentId } = req.body || {};
      const chunks = await getChunks({ userId: req.userId, documentId });
      if (chunks.length === 0) {
        return res.status(400).json({ error: 'No notes found to summarize. Upload something first.' });
      }
      const joinedText = chunks.map((c) => c.text).join('\n\n').slice(0, SAMPLE_CHAR_LIMIT);
      const summary = await aiClients.generateSummary(joinedText);
      return res.json({ summary });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to summarize', details: err.message });
    }
  });

  router.post('/flashcards', async (req, res) => {
    try {
      const { documentId } = req.body || {};
      let chunks = await getChunks({ userId: req.userId, documentId });
      if (chunks.length === 0) {
        return res.status(400).json({ error: 'No notes found. Upload something first.' });
      }

      // cap how many LLM calls a single request can trigger
      chunks = chunks.slice(0, 5);
      const cards = [];

      for (const chunk of chunks) {
        try {
          const generated = await aiClients.generateFlashcards(chunk.text, 3);
          for (const c of generated) {
            cards.push({ front: c.front, back: c.back, documentTitle: chunk.document_title });
          }
        } catch (err) {
          continue; // skip chunks whose model output didn't parse cleanly
        }
      }

      return res.json({ cards });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to generate flashcards', details: err.message });
    }
  });

  // generates a memory device for a topic. if `topic` is given it's used as a search
  // query over the user's notes, same idea as chat. otherwise grabs a random chunk
  router.post('/mnemonic', async (req, res) => {
    try {
      const { topic } = req.body || {};
      if (typeof topic === 'string' && topic.length > 500) {
        return res.status(400).json({ error: 'Topic is too long (max 500 characters)' });
      }

      let sourceText;
      let docTitle;

      if (topic && topic.trim()) {
        const matches = await aiClients.queryVectors({ text: topic, userId: req.userId, nResults: 1 });
        if (matches.length === 0) {
          return res.status(400).json({ error: 'No notes found related to that topic. Upload something first.' });
        }
        sourceText = matches[0].text;
        const [docRows] = await pool.query('SELECT title FROM documents WHERE id = ?', [matches[0].metadata.document_id]);
        docTitle = docRows.length > 0 ? docRows[0].title : 'Unknown document';
      } else {
        const [rows] = await pool.query(
          'SELECT c.text, d.title AS document_title FROM chunks c JOIN documents d ON c.document_id = d.id WHERE c.user_id = ? ORDER BY RAND() LIMIT 1',
          [req.userId]
        );
        if (rows.length === 0) {
          return res.status(400).json({ error: 'No notes found. Upload something first.' });
        }
        sourceText = rows[0].text;
        docTitle = rows[0].document_title;
      }

      const mnemonic = await aiClients.generateMnemonic(sourceText, topic);
      return res.json({ mnemonic, documentTitle: docTitle, basedOn: sourceText });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to generate a mnemonic', details: err.message });
    }
  });

  return router;
}

module.exports = { createStudyRouter };
