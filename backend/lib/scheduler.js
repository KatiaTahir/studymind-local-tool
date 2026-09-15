const schedule = require('node-schedule');

// runs once a day and logs which users have stuff due for review. question
// generation happens on demand in GET /api/quiz/due, so this is just a log line
function startDailyReviewCheck(pool, cronExpression = '0 6 * * *') {
  return schedule.scheduleJob(cronExpression, async () => {
    try {
      const [dueCounts] = await pool.query(
        `SELECT user_id, COUNT(*) AS due_count
         FROM review_schedule
         WHERE next_review_date <= CURDATE()
         GROUP BY user_id`
      );
      for (const row of dueCounts) {
        console.log(`[scheduler] user ${row.user_id} has ${row.due_count} chunk(s) due for review`);
      }
    } catch (err) {
      console.error('[scheduler] daily review check failed:', err.message);
    }
  });
}

module.exports = { startDailyReviewCheck };
