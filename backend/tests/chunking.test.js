const { chunkText } = require('../lib/chunking');

describe('chunkText', () => {
  test('returns empty array for empty input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n\n  ')).toEqual([]);
  });

  test('keeps a short document as a single chunk', () => {
    const text = 'This is a short note.\n\nIt has two paragraphs.';
    const chunks = chunkText(text, 400);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toContain('short note');
    expect(chunks[0]).toContain('two paragraphs');
  });

  test('splits long text into multiple chunks near the target word count', () => {
    const paragraph = 'word '.repeat(300).trim();
    const text = [paragraph, paragraph, paragraph].join('\n\n');
    const chunks = chunkText(text, 400);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      const wordCount = chunk.split(/\s+/).filter(Boolean).length;
      // some headroom since the target is only checked before adding a whole paragraph
      expect(wordCount).toBeLessThanOrEqual(400 * 1.6);
    }
  });

  test('splits a single very long paragraph on sentence boundaries', () => {
    const sentence = 'The mitochondria produces energy for the cell. ';
    const longParagraph = sentence.repeat(150);
    const chunks = chunkText(longParagraph, 400);
    expect(chunks.length).toBeGreaterThan(1);
    // no sentence should be cut in half, every chunk should end with punctuation
    for (const chunk of chunks) {
      expect(chunk.trim()).toMatch(/[.!?]$/);
    }
  });

  test('preserves total content across chunks', () => {
    const text = 'Alpha beta gamma.\n\nDelta epsilon zeta.\n\nEta theta iota.';
    const chunks = chunkText(text, 3);
    const rejoined = chunks.join(' ');
    for (const word of ['Alpha', 'zeta', 'theta', 'iota']) {
      expect(rejoined).toContain(word);
    }
  });
});
