const express = require('express');
const { nextReviewDate } = require('../lib/spacedRepetition');

function createQuizRouter(pool, aiClients) {
  const router = express.Router();

  // chunks whose next_review_date is today or earlier, with ai-generated questions
  router.get('/due', async (req, res) => {
    try {
      const [dueRows] = await pool.query(
        `SELECT rs.id AS schedule_id, rs.interval_days, c.id AS chunk_id, c.text
         FROM review_schedule rs
         JOIN chunks c ON c.id = rs.chunk_id
         WHERE rs.user_id = ? AND rs.next_review_date <= CURDATE()
         ORDER BY rs.next_review_date ASC
         LIMIT 10`,
        [req.userId]
      );

      const due = [];
      let numFailed = 0;

      for (const row of dueRows) {
        const questions = await generateQuestionsWithRetry(aiClients, row.text);
        if (questions === null) {
          numFailed += 1;
          continue;
        }
        due.push({ chunkId: row.chunk_id, scheduleId: row.schedule_id, questions });
      }

      return res.json({ due, failedCount: numFailed });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to load due quizzes', details: err.message });
    }
  });

  // on-demand quiz from a chosen document (or all notes), separate from the
  // spaced-repetition due date. answers still go through /answer below since every
  // chunk already has a review_schedule row from upload time
  router.post('/generate', async (req, res) => {
    try {
      const { documentId } = req.body || {};
      const params = [req.userId];
      let sql = 'SELECT id AS chunk_id, text FROM chunks WHERE user_id = ?';
      if (documentId) {
        sql += ' AND document_id = ?';
        params.push(documentId);
      }
      sql += ' ORDER BY RAND() LIMIT 5';
      const [rows] = await pool.query(sql, params);

      if (rows.length === 0) {
        return res.status(400).json({ error: 'No notes found to quiz you on. Upload something first.' });
      }

      const quiz = [];
      let numFailed = 0;

      for (const row of rows) {
        const questions = await generateQuestionsWithRetry(aiClients, row.text);
        if (questions === null) {
          numFailed += 1;
          continue;
        }
        quiz.push({ chunkId: row.chunk_id, questions });
      }

      if (quiz.length === 0) {
        return res.status(502).json({
          error: 'The AI could not generate a valid quiz from these notes. Please try again.',
        });
      }

      return res.json({ quiz, failedCount: numFailed });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to generate quiz', details: err.message });
    }
  });

  router.post('/answer', async (req, res) => {
    const { chunkId, question, wasCorrect } = req.body || {};
    // checking `=== undefined` instead of `!chunkId` since chunkId can legitimately be 0
    if (chunkId === undefined || question === undefined || typeof wasCorrect !== 'boolean') {
      return res.status(400).json({ error: 'chunkId, question, and wasCorrect (boolean) are required' });
    }

    try {
      await pool.query(
        'INSERT INTO quiz_history (user_id, chunk_id, question, was_correct) VALUES (?, ?, ?, ?)',
        [req.userId, chunkId, question, wasCorrect]
      );

      const [scheduleRows] = await pool.query(
        'SELECT id, interval_days FROM review_schedule WHERE user_id = ? AND chunk_id = ?',
        [req.userId, chunkId]
      );
      if (scheduleRows.length === 0) {
        return res.status(404).json({ error: 'No review schedule found for this chunk' });
      }

      const schedule = scheduleRows[0];
      const { intervalDays, date } = nextReviewDate(new Date(), schedule.interval_days, wasCorrect);
      const nextDateStr = date.toISOString().slice(0, 10);

      await pool.query('UPDATE review_schedule SET interval_days = ?, next_review_date = ? WHERE id = ?', [
        intervalDays,
        nextDateStr,
        schedule.id,
      ]);

      return res.json({ status: 'logged', nextReviewDate: nextDateStr, intervalDays });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to log answer', details: err.message });
    }
  });

  return router;
}

// local models sometimes return output that doesn't parse as valid quiz json. one
// retry clears up most of those. if it still fails, log it so it's visible and
// return null so the caller can count it as a real failure instead of quietly
// reporting nothing due when something actually was due
async function generateQuestionsWithRetry(aiClients, chunkText) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await aiClients.generateQuizQuestions(chunkText);
    } catch (err) {
      if (attempt === 2) {
        console.error('[quiz] failed to generate questions after retry:', err.message);
      }
    }
  }
  return null;
}

module.exports = { createQuizRouter };
