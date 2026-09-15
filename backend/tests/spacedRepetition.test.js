const { nextInterval, nextReviewDate, INTERVAL_PROGRESSION } = require('../lib/spacedRepetition');

describe('nextInterval', () => {
  test('progresses 1 -> 3 -> 7 -> 14 on correct answers', () => {
    expect(nextInterval(1, true)).toBe(3);
    expect(nextInterval(3, true)).toBe(7);
    expect(nextInterval(7, true)).toBe(14);
  });

  test('doubles beyond 14 on continued correct answers', () => {
    expect(nextInterval(14, true)).toBe(28);
    expect(nextInterval(28, true)).toBe(56);
  });

  test('resets to 1 day on any incorrect answer, regardless of current interval', () => {
    expect(nextInterval(1, false)).toBe(1);
    expect(nextInterval(7, false)).toBe(1);
    expect(nextInterval(14, false)).toBe(1);
    expect(nextInterval(56, false)).toBe(1);
  });

  test('handles an interval value outside the defined progression', () => {
    expect(nextInterval(5, true)).toBeGreaterThanOrEqual(10);
  });

  test('progression constant matches spec (1, 3, 7, 14)', () => {
    expect(INTERVAL_PROGRESSION).toEqual([1, 3, 7, 14]);
  });
});

describe('nextReviewDate', () => {
  test('adds the correct number of days to the given date', () => {
    const base = new Date(Date.UTC(2026, 0, 1)); // Jan 1, 2026
    const { intervalDays, date } = nextReviewDate(base, 1, true);
    expect(intervalDays).toBe(3);
    expect(date.toISOString().slice(0, 10)).toBe('2026-01-04');
  });

  test('resets date to 1 day out after an incorrect answer', () => {
    const base = new Date(Date.UTC(2026, 0, 1));
    const { intervalDays, date } = nextReviewDate(base, 14, false);
    expect(intervalDays).toBe(1);
    expect(date.toISOString().slice(0, 10)).toBe('2026-01-02');
  });
});
