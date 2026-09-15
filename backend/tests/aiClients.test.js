const { buildRagPrompt, parseQuizResponse, parseFlashcardResponse, parseTopicsResponse } = require('../lib/aiClients');

describe('buildRagPrompt', () => {
  test('includes the question and every source, labeled by document', () => {
    const prompt = buildRagPrompt('What is photosynthesis?', [
      { documentTitle: 'Bio Notes', text: 'Photosynthesis converts light into energy.' },
      { documentTitle: 'Chem Notes', text: 'Chlorophyll absorbs light.' },
    ]);
    expect(prompt).toContain('What is photosynthesis?');
    expect(prompt).toContain('Bio Notes');
    expect(prompt).toContain('Chem Notes');
    expect(prompt).toContain('Photosynthesis converts light into energy.');
    expect(prompt).toMatch(/ONLY/);
  });
});

describe('parseQuizResponse', () => {
  const q1 = '{"question": "Q1?", "options": ["A", "B", "C", "D"], "correctIndex": 2}';
  const q2 = '{"question": "Q2?", "options": ["A", "B", "C", "D"], "correctIndex": 0}';

  test('parses a clean JSON array', () => {
    const raw = `[${q1}, ${q2}]`;
    const parsed = parseQuizResponse(raw);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ question: 'Q1?', options: ['A', 'B', 'C', 'D'], correctIndex: 2 });
  });

  test('extracts JSON when the model adds extra prose around it', () => {
    const raw = `Sure, here are the questions:\n[${q1}]\nHope that helps!`;
    const parsed = parseQuizResponse(raw);
    expect(parsed).toHaveLength(1);
  });

  test('filters out malformed entries missing options or a valid correctIndex', () => {
    const raw = `[${q1}, {"question": "Q2?"}, {"foo": "bar"}, {"question": "Q3?", "options": ["A", "B"], "correctIndex": 5}]`;
    const parsed = parseQuizResponse(raw);
    expect(parsed).toHaveLength(1);
  });

  test('throws when no JSON array is present', () => {
    expect(() => parseQuizResponse('I cannot generate questions for this.')).toThrow();
  });
});

describe('parseFlashcardResponse', () => {
  test('parses a clean JSON array of front/back cards', () => {
    const raw = '[{"front": "Mitochondria", "back": "Powerhouse of the cell"}]';
    const parsed = parseFlashcardResponse(raw);
    expect(parsed).toEqual([{ front: 'Mitochondria', back: 'Powerhouse of the cell' }]);
  });

  test('filters out entries missing front or back', () => {
    const raw = '[{"front": "A", "back": "B"}, {"front": "C"}]';
    expect(parseFlashcardResponse(raw)).toHaveLength(1);
  });

  test('extracts JSON from surrounding prose', () => {
    const raw = 'Here you go:\n[{"front": "A", "back": "B"}]\nEnjoy!';
    expect(parseFlashcardResponse(raw)).toHaveLength(1);
  });
});

describe('parseTopicsResponse', () => {
  test('parses a clean JSON array of topic strings', () => {
    const raw = '["Cell biology", "Photosynthesis"]';
    expect(parseTopicsResponse(raw)).toEqual(['Cell biology', 'Photosynthesis']);
  });

  test('trims whitespace and drops non-string/empty entries', () => {
    const raw = '["  Genetics  ", "", 42, "Evolution"]';
    expect(parseTopicsResponse(raw)).toEqual(['Genetics', 'Evolution']);
  });

  test('throws when no JSON array is present', () => {
    expect(() => parseTopicsResponse('no topics here')).toThrow();
  });
});
