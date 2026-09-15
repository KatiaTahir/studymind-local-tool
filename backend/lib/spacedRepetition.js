// spaced repetition progression: 1 day, then 3, then 7, then 14
const INTERVAL_PROGRESSION = [1, 3, 7, 14];

function nextInterval(currentIntervalDays, wasCorrect) {
  if (!wasCorrect) return 1;

  const stepIndex = INTERVAL_PROGRESSION.indexOf(currentIntervalDays);
  const lastStep = INTERVAL_PROGRESSION.length - 1;

  if (stepIndex === -1 || stepIndex === lastStep) {
    // past the last step, or an interval outside the progression, just keep doubling
    return Math.max(currentIntervalDays * 2, INTERVAL_PROGRESSION[lastStep]);
  }
  return INTERVAL_PROGRESSION[stepIndex + 1];
}

function addDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function nextReviewDate(fromDate, currentIntervalDays, wasCorrect) {
  const interval = nextInterval(currentIntervalDays, wasCorrect);
  return { intervalDays: interval, date: addDays(fromDate, interval) };
}

module.exports = { nextInterval, nextReviewDate, addDays, INTERVAL_PROGRESSION };
