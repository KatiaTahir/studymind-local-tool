const express = require('express');

function createStatsRouter(pool) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const [accuracyRows] = await pool.query(
        `SELECT documents.title AS topic,
                SUM(quiz_history.was_correct) AS correct,
                COUNT(*) AS total
         FROM quiz_history
         JOIN chunks ON quiz_history.chunk_id = chunks.id
         JOIN documents ON chunks.document_id = documents.id
         WHERE quiz_history.user_id = ?
         GROUP BY documents.title`,
        [req.userId]
      );

      const [streakRows] = await pool.query(
        `SELECT DISTINCT DATE(answered_at) AS study_date
         FROM quiz_history
         WHERE user_id = ?
         ORDER BY study_date DESC`,
        [req.userId]
      );

      const studyDates = [];
      for (const r of streakRows) {
        studyDates.push(r.study_date);
      }
      const streakDays = computeStreak(studyDates);

      // mysql2 can return SUM()/COUNT() as strings, Number() normalizes them
      const accuracyByTopic = [];
      for (const row of accuracyRows) {
        const numCorrect = Number(row.correct);
        const numTotal = Number(row.total);
        let pct = 0;
        if (numTotal > 0) pct = numCorrect / numTotal;
        accuracyByTopic.push({ topic: row.topic, correct: numCorrect, total: numTotal, accuracy: pct });
      }

      // weakest topics first, but only ones with a couple of answers logged already.
      // one lucky guess shouldn't label a whole topic as weak
      const weakTopics = accuracyByTopic
        .filter((t) => t.total >= 2)
        .sort((a, b) => a.accuracy - b.accuracy)
        .slice(0, 5);

      const [askedRows] = await pool.query(
        `SELECT question, COUNT(*) AS timesAsked
         FROM quiz_history
         WHERE user_id = ?
         GROUP BY question
         ORDER BY timesAsked DESC, MAX(answered_at) DESC
         LIMIT 5`,
        [req.userId]
      );
      const mostAskedQuestions = askedRows.map((r) => ({ question: r.question, timesAsked: Number(r.timesAsked) }));

      const [recentRows] = await pool.query(
        'SELECT mode, question, asked_at FROM chat_history WHERE user_id = ? ORDER BY asked_at DESC, id DESC LIMIT 8',
        [req.userId]
      );

      return res.json({
        accuracyByTopic,
        studyStreakDays: streakDays,
        weakTopics,
        mostAskedQuestions,
        recentHistory: recentRows,
      });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to load stats', details: err.message });
    }
  });

  return router;
}

// normalizes a date-like value to a UTC midnight timestamp so comparisons aren't
// thrown off by timezone or daylight saving. only the calendar day matters here
function toMidnightUTC(value) {
  const d = new Date(value);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

// counts consecutive days, including today or yesterday, with at least one quiz answer
function computeStreak(sortedDatesDesc) {
  if (sortedDatesDesc.length === 0) return 0;

  const oneDayMs = 24 * 60 * 60 * 1000;
  const todayUTC = toMidnightUTC(new Date());

  const days = [];
  for (const value of sortedDatesDesc) {
    days.push(toMidnightUTC(value));
  }

  // if the most recent study day isn't today or yesterday, the streak's already broken
  if (days[0] !== todayUTC && days[0] !== todayUTC - oneDayMs) return 0;
  let expectedDay = days[0];

  let streak = 0;
  for (const d of days) {
    if (d === expectedDay) {
      streak += 1;
      expectedDay -= oneDayMs;
    } else if (d < expectedDay) {
      break; // gap found, streak ends
    }
  }
  return streak;
}

module.exports = { createStatsRouter, computeStreak };
