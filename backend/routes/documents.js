const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const { chunkText } = require('../lib/chunking');

// a cap on note length, separate from the 25MB file size limit below. a doc this
// big would produce hundreds of chunks, each needing its own embedding and LLM
// call, which would make a single upload feel stuck for a long time
const MAX_TEXT_LENGTH = 2000000; // roughly 400 pages of plain text

function createDocumentsRouter(pool, aiClients, { extractPdfText } = {}) {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

  async function storeDocumentAndChunks({ userId, title, sourceType, text }) {
    const [docResult] = await pool.query(
      'INSERT INTO documents (user_id, title, source_type) VALUES (?, ?, ?)',
      [userId, title, sourceType]
    );
    const newDocId = docResult.insertId;

    const pieces = chunkText(text);
    const savedChunks = [];

    for (let i = 0; i < pieces.length; i++) {
      const vecId = `${newDocId}-${i}-${crypto.randomBytes(4).toString('hex')}`;
      const [chunkResult] = await pool.query(
        'INSERT INTO chunks (document_id, user_id, chunk_index, text, vector_id) VALUES (?, ?, ?, ?, ?)',
        [newDocId, userId, i, pieces[i], vecId]
      );
      await aiClients.addVector({ id: vecId, text: pieces[i], userId, documentId: newDocId });

      // every chunk is due for review right away, no waiting period
      const [scheduleResult] = await pool.query(
        'INSERT INTO review_schedule (user_id, chunk_id, next_review_date, interval_days) VALUES (?, ?, CURDATE(), 1)',
        [userId, chunkResult.insertId]
      );

      savedChunks.push({ id: chunkResult.insertId, index: i, vectorId: vecId, scheduleId: scheduleResult.insertId });
    }

    return { documentId: newDocId, chunkCount: pieces.length, chunks: savedChunks };
  }

  router.post('/upload', (req, res, next) => {
    // if the client disconnects mid upload, node throws instead of just failing
    // the request. this stops that
    req.on('error', () => {});
    next();
  }, upload.single('file'), async (req, res) => {
    try {
      const userId = req.userId;
      let text = req.body.text;
      let title = req.body.title;

      if (req.file) {
        title = title || req.file.originalname;
        const isPdf = req.file.mimetype === 'application/pdf' || req.file.originalname.endsWith('.pdf');
        if (isPdf) {
          try {
            text = await extractPdfText(req.file.buffer);
          } catch (pdfErr) {
            return res.status(400).json({
              error: 'Could not read text from this PDF. It may be corrupted, password-protected, or a scanned image with no selectable text.',
            });
          }
        } else {
          text = req.file.buffer.toString('utf-8');
        }
      }

      if (!text || !text.trim()) {
        return res.status(400).json({ error: 'No text content found (upload a file or provide text)' });
      }
      if (text.length > MAX_TEXT_LENGTH) {
        return res.status(400).json({
          error: `This document is too long (${text.length.toLocaleString()} characters). The limit is ${MAX_TEXT_LENGTH.toLocaleString()} characters — try splitting it into smaller documents.`,
        });
      }
      if (!title) title = `Untitled note ${new Date().toISOString()}`;

      const result = await storeDocumentAndChunks({
        userId,
        title,
        sourceType: req.body.sourceType || 'upload',
        text,
      });

      return res.status(201).json({ documentId: result.documentId, title, chunkCount: result.chunkCount });
    } catch (err) {
      return res.status(500).json({ error: 'Upload failed', details: err.message });
    }
  });

  router.get('/', async (req, res) => {
    try {
      const [rows] = await pool.query(
        'SELECT id, title, source_type, uploaded_at FROM documents WHERE user_id = ? ORDER BY uploaded_at DESC',
        [req.userId]
      );
      return res.json({ documents: rows });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to list documents', details: err.message });
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      const docId = Number(req.params.id);

      // confirm ownership first so a user can't delete someone else's document
      // just by guessing an id
      const [rows] = await pool.query('SELECT id FROM documents WHERE id = ? AND user_id = ?', [
        docId,
        req.userId,
      ]);
      if (rows.length === 0) return res.status(404).json({ error: 'Document not found' });

      // vectors live in chromadb, not mysql, so they need cleaning up separately.
      // the chunks, review_schedule, and quiz_history rows cascade delete on their own
      await aiClients.deleteVectorsForDocument(docId);
      await pool.query('DELETE FROM documents WHERE id = ?', [docId]);
      return res.json({ status: 'deleted' });
    } catch (err) {
      return res.status(500).json({ error: 'Delete failed', details: err.message });
    }
  });

  return { router, storeDocumentAndChunks };
}

module.exports = { createDocumentsRouter };
