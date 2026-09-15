const { computeStreak } = require('../routes/stats');

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

describe('computeStreak', () => {
  test('returns 0 for no study days', () => {
    expect(computeStreak([])).toBe(0);
  });

  test('returns 1 when only studied today', () => {
    expect(computeStreak([daysAgo(0)])).toBe(1);
  });

  test('counts consecutive days ending today', () => {
    expect(computeStreak([daysAgo(0), daysAgo(1), daysAgo(2)])).toBe(3);
  });

  test('still counts streak if last study day was yesterday (not yet broken today)', () => {
    expect(computeStreak([daysAgo(1), daysAgo(2)])).toBe(2);
  });

  test('breaks the streak on a gap', () => {
    expect(computeStreak([daysAgo(0), daysAgo(1), daysAgo(5)])).toBe(2);
  });

  test('returns 0 if the most recent study day was more than 1 day ago', () => {
    expect(computeStreak([daysAgo(3), daysAgo(4)])).toBe(0);
  });
});
