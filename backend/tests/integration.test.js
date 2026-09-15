const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { createApp } = require('../app');

const TEST_DB = process.env.TEST_DB_NAME || 'studymind_test';
const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'studymind',
  password: process.env.DB_PASSWORD || 'studymind_dev_pw',
  port: process.env.DB_PORT || 3306,
};


let pool;
let app;
let aiClients;


async function resetSchema() {
  const conn = await mysql.createConnection({ ...DB_CONFIG, multipleStatements: true });
  await conn.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
  await conn.query(`CREATE DATABASE \`${TEST_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.query(`USE \`${TEST_DB}\``);
  const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf-8');
  await conn.query(schema);
  await conn.end();
}


async function signupAndLogin(email = 'test@studymind.dev', password = 'password123') {
  const res = await request(app).post('/api/auth/signup').send({ email, password });
  return res.body.token;
}

beforeAll(async () => {
  await resetSchema();
  pool = mysql.createPool({ ...DB_CONFIG, database: TEST_DB, waitForConnections: true, connectionLimit: 5 });

  // fake ai backend, deterministic, no real ollama or embedding service calls
  const fakeVectorStore = [];
  aiClients = {
    addVector: jest.fn(async ({ id, text, userId, documentId }) => {
      fakeVectorStore.push({ id, text, userId, documentId });
      return { status: 'stored', id };
    }),
    queryVectors: jest.fn(async ({ text, userId, nResults, documentIds }) => {
      return fakeVectorStore
        .filter((v) => v.userId === userId)
        .filter((v) => !documentIds || documentIds.includes(v.documentId))
        .slice(0, nResults)
        .map((v) => ({
          id: v.id,
          text: v.text,
          metadata: { user_id: v.userId, document_id: v.documentId },
          distance: 0.1,
        }));
    }),

    deleteVectorsForDocument: jest.fn(async (documentId) => {
      for (let i = fakeVectorStore.length - 1; i >= 0; i--) {
        if (fakeVectorStore[i].documentId === documentId) fakeVectorStore.splice(i, 1);
      }
      return { status: 'deleted' };
    }),
    generateAnswer: jest.fn(async (question, sources) => {
      return `Based on ${sources.length} source(s), here is a grounded answer to: ${question}`;
    }),
    generateQuizQuestions: jest.fn(async (chunkText) => {
      return [{
        question: `What is this about: "${chunkText.slice(0, 20)}..."?`,
        options: ['A sample answer', 'A wrong option', 'Another wrong one', 'Also wrong'],
        correctIndex: 0,
      }];
    }),
    generateGeneralAnswer: jest.fn(async (question) => `General answer to: ${question}`),
    generateSummary: jest.fn(async (text) => `Summary of ${text.length} characters of notes.`),
    generateTopics: jest.fn(async () => ['Topic A', 'Topic B']),
    generateFlashcards: jest.fn(async (chunkText) => [
      { front: `Front of "${chunkText.slice(0, 10)}"`, back: 'Back side' },
    ]),
    generateMnemonic: jest.fn(async (text, topic) => `Mnemonic for ${topic || 'a random topic'}: remember it well!`),
  };

  app = createApp(pool, aiClients);
});

afterAll(async () => {
  if (pool) await pool.end();
});

describe('Auth', () => {
  test('signup creates a user and returns a token', async () => {
    const res = await request(app).post('/api/auth/signup').send({ email: 'a@x.com', password: 'password123' });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toBe('a@x.com');
  });


  test('signup rejects duplicate email', async () => {
    await request(app).post('/api/auth/signup').send({ email: 'dupe@x.com', password: 'password123' });
    const res = await request(app).post('/api/auth/signup').send({ email: 'dupe@x.com', password: 'password123' });
    expect(res.status).toBe(409);
  });

  test('login succeeds with correct credentials and fails with wrong password', async () => {
    await request(app).post('/api/auth/signup').send({ email: 'b@x.com', password: 'correctpw' });
    const good = await request(app).post('/api/auth/login').send({ email: 'b@x.com', password: 'correctpw' });
    expect(good.status).toBe(200);
    expect(good.body.token).toBeDefined();

    const bad = await request(app).post('/api/auth/login').send({ email: 'b@x.com', password: 'wrongpw' });
    expect(bad.status).toBe(401);
  });

  test('protected routes reject requests without a token', async () => {
    const res = await request(app).get('/api/documents');
    expect(res.status).toBe(401);
  });

  test('signup rejects an invalid email format', async () => {
    const res = await request(app).post('/api/auth/signup').send({ email: 'not-an-email', password: 'password123' });
    expect(res.status).toBe(400);
  });

  test('signup rejects a password longer than 72 characters', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'longpw@x.com', password: 'a'.repeat(73) });
    expect(res.status).toBe(400);
  });

  test('signup normalizes email case, so login works with different casing', async () => {
    await request(app).post('/api/auth/signup').send({ email: 'MixedCase@X.com', password: 'password123' });
    const res = await request(app).post('/api/auth/login').send({ email: 'mixedcase@x.com', password: 'password123' });
    expect(res.status).toBe(200);
  });
});

describe('Documents + RAG chat', () => {
  let token;

  beforeAll(async () => {
    token = await signupAndLogin('rag-user@x.com');
  });


  test('uploading pasted text chunks it and stores vectors', async () => {
    const res = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Biology Notes', text: 'Mitochondria is the powerhouse of the cell. It produces ATP.' });

    expect(res.status).toBe(201);
    expect(res.body.chunkCount).toBeGreaterThan(0);
    expect(aiClients.addVector).toHaveBeenCalled();
  });

  test('listing documents returns the uploaded document', async () => {
    const res = await request(app).get('/api/documents').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.documents.some((d) => d.title === 'Biology Notes')).toBe(true);
  });

  test('chat returns an answer with sources citing the uploaded document', async () => {
    const res = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ question: 'What does the mitochondria do?' });

    expect(res.status).toBe(200);
    expect(res.body.answer).toMatch(/mitochondria/i);
    expect(res.body.sources.length).toBeGreaterThan(0);
    expect(res.body.sources[0].documentTitle).toBe('Biology Notes');
    expect(res.body.sources[0].chunkIndex).toBe(0);
  });

  test('chat with no documents returns a graceful message and no sources', async () => {
    const emptyUserToken = await signupAndLogin('empty-user@x.com');
    const res = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${emptyUserToken}`)
      .send({ question: 'Anything?' });
    expect(res.status).toBe(200);
    expect(res.body.sources).toEqual([]);
  });

  

  test('chat scoped to a specific documentIds list only pulls sources from those documents', async () => {
    const scopedToken = await signupAndLogin('scoped-chat-user@x.com');
    const doc1 = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', `Bearer ${scopedToken}`)
      .send({ title: 'Doc One', text: 'The mitochondria is the powerhouse of the cell.' });
    await request(app)
      .post('/api/documents/upload')
      .set('Authorization', `Bearer ${scopedToken}`)
      .send({ title: 'Doc Two', text: 'The French Revolution began in 1789.' });

    const res = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${scopedToken}`)
      .send({ question: 'Tell me something.', documentIds: [doc1.body.documentId] });

    expect(res.status).toBe(200);
    expect(res.body.sources.length).toBeGreaterThan(0);
    expect(res.body.sources.every((s) => s.documentId === doc1.body.documentId)).toBe(true);
  });

  test('uploading text with emoji and special unicode characters does not fail', async () => {
    const res = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Unicode Notes',
        text: 'Energy flow: sunlight → glucose → ATP 🌱. Also "smart quotes" and café.',
      });
    expect(res.status).toBe(201);
    expect(res.body.chunkCount).toBeGreaterThan(0);
  });

  test('rejects a document that exceeds the max text length', async () => {
    const res = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Way Too Long', text: 'a'.repeat(2_000_001) });
    expect(res.status).toBe(400);
  });

  test('rejects a chat question that is too long', async () => {
    const res = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ question: 'a'.repeat(4001) });
    expect(res.status).toBe(400);
  });

  test('deleting a document removes it from the list', async () => {
    const listRes = await request(app).get('/api/documents').set('Authorization', `Bearer ${token}`);
    const docId = listRes.body.documents[0].id;

    const delRes = await request(app).delete(`/api/documents/${docId}`).set('Authorization', `Bearer ${token}`);
    expect(delRes.status).toBe(200);

    const listAfter = await request(app).get('/api/documents').set('Authorization', `Bearer ${token}`);
    expect(listAfter.body.documents.find((d) => d.id === docId)).toBeUndefined();
  });
});

describe('Quiz + spaced repetition', () => {
  let token;

  beforeAll(async () => {
    token = await signupAndLogin('quiz-user@x.com');
    await request(app)
      .post('/api/documents/upload')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'History Notes', text: 'The French Revolution began in 1789 and reshaped Europe.' });
  });

  test('newly uploaded chunks are immediately due for review', async () => {
    const res = await request(app).get('/api/quiz/due').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.due.length).toBeGreaterThan(0);
    expect(res.body.due[0].questions.length).toBeGreaterThan(0);
  });

  test('answering correctly pushes the review interval out to 3 days', async () => {
    const dueRes = await request(app).get('/api/quiz/due').set('Authorization', `Bearer ${token}`);
    const { chunkId, questions } = dueRes.body.due[0];

    const answerRes = await request(app)
      .post('/api/quiz/answer')
      .set('Authorization', `Bearer ${token}`)
      .send({ chunkId, question: questions[0].question, wasCorrect: true });

    expect(answerRes.status).toBe(200);
    expect(answerRes.body.intervalDays).toBe(3);

    const stillDue = await request(app).get('/api/quiz/due').set('Authorization', `Bearer ${token}`);
    expect(stillDue.body.due.find((d) => d.chunkId === chunkId)).toBeUndefined();
  });

  test('answering incorrectly resets the interval to 1 day', async () => {
    const [[chunkRow]] = await pool.query(
      `SELECT c.id FROM chunks c
       JOIN documents d ON c.document_id = d.id
       WHERE d.title = 'History Notes' LIMIT 1`
    );

    const res = await request(app)
      .post('/api/quiz/answer')
      .set('Authorization', `Bearer ${token}`)
      .send({ chunkId: chunkRow.id, question: 'When did it begin?', wasCorrect: false });

    expect(res.status).toBe(200);
    expect(res.body.intervalDays).toBe(1);
  });
});

describe('Stats dashboard', () => {
  test('GET /api/stats returns accuracy per topic and a study streak', async () => {
    const token = await signupAndLogin('stats-user@x.com');
    await request(app)
      .post('/api/documents/upload')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Chem Notes', text: 'Water is composed of hydrogen and oxygen atoms.' });

    const dueRes = await request(app).get('/api/quiz/due').set('Authorization', `Bearer ${token}`);
    const { chunkId, questions } = dueRes.body.due[0];

    await request(app)
      .post('/api/quiz/answer')
      .set('Authorization', `Bearer ${token}`)
      .send({ chunkId, question: questions[0].question, wasCorrect: true });

    const statsRes = await request(app).get('/api/stats').set('Authorization', `Bearer ${token}`);
    expect(statsRes.status).toBe(200);
    expect(statsRes.body.accuracyByTopic.length).toBeGreaterThan(0);
    expect(statsRes.body.accuracyByTopic[0].topic).toBe('Chem Notes');
    expect(statsRes.body.accuracyByTopic[0].accuracy).toBe(1);
    expect(statsRes.body.studyStreakDays).toBeGreaterThanOrEqual(1);
  });
});

describe('Ask the AI Anything (ungrounded chat)', () => {
  test('POST /api/chat/general answers without touching vector search', async () => {
    const token = await signupAndLogin('general-chat-user@x.com');
    aiClients.queryVectors.mockClear();

    const res = await request(app)
      .post('/api/chat/general')
      .set('Authorization', `Bearer ${token}`)
      .send({ question: 'What is the capital of France?' });

    expect(res.status).toBe(200);
    expect(res.body.answer).toMatch(/capital of France/);
    expect(aiClients.queryVectors).not.toHaveBeenCalled();
  });

  test('rejects an empty question', async () => {
    const token = await signupAndLogin('general-chat-empty@x.com');
    const res = await request(app)
      .post('/api/chat/general')
      .set('Authorization', `Bearer ${token}`)
      .send({ question: '  ' });
    expect(res.status).toBe(400);
  });
});

describe('Chat history', () => {
  test('records both notes-grounded and general questions, newest first', async () => {
    const token = await signupAndLogin('history-user@x.com');
    await request(app)
      .post('/api/documents/upload')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'History Test Notes', text: 'Water boils at 100 degrees Celsius at sea level.' });

    await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ question: 'What temperature does water boil at?' });

    await request(app)
      .post('/api/chat/general')
      .set('Authorization', `Bearer ${token}`)
      .send({ question: 'What is the capital of Japan?' });

    const res = await request(app).get('/api/chat/history').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.history.length).toBe(2);
    // newest first, so the general question (asked second) comes back first
    expect(res.body.history[0].mode).toBe('general');
    expect(res.body.history[0].question).toBe('What is the capital of Japan?');
    expect(res.body.history[1].mode).toBe('notes');
    expect(res.body.history[1].question).toBe('What temperature does water boil at?');
  });

  test('history is scoped per user', async () => {
    const tokenA = await signupAndLogin('history-user-a@x.com');
    const tokenB = await signupAndLogin('history-user-b@x.com');

    await request(app)
      .post('/api/chat/general')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ question: 'A private question for user A' });

    const resB = await request(app).get('/api/chat/history').set('Authorization', `Bearer ${tokenB}`);
    expect(resB.body.history).toEqual([]);
  });
});

describe('Study tools: topics, summarize, flashcards, mnemonic', () => {
  let token;

  beforeAll(async () => {
    token = await signupAndLogin('study-tools-user@x.com');
    await request(app)
      .post('/api/documents/upload')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Astronomy Notes', text: 'Jupiter is the largest planet in the solar system.' });
  });

  test('GET /api/study/topics returns AI-extracted topics', async () => {
    const res = await request(app).get('/api/study/topics').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.topics).toEqual(['Topic A', 'Topic B']);
  });

  test('GET /api/study/topics returns an empty list for a user with no notes', async () => {
    const emptyToken = await signupAndLogin('no-notes-user@x.com');
    const res = await request(app).get('/api/study/topics').set('Authorization', `Bearer ${emptyToken}`);
    expect(res.status).toBe(200);
    expect(res.body.topics).toEqual([]);
  });

  test('POST /api/study/summarize summarizes the user\'s notes', async () => {
    const res = await request(app)
      .post('/api/study/summarize')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatch(/Summary of/);
  });

  test('POST /api/study/summarize with no notes returns 400', async () => {
    const emptyToken = await signupAndLogin('no-notes-summarize@x.com');
    const res = await request(app)
      .post('/api/study/summarize')
      .set('Authorization', `Bearer ${emptyToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  test('POST /api/study/flashcards generates front/back cards labeled by document', async () => {
    const res = await request(app)
      .post('/api/study/flashcards')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.cards.length).toBeGreaterThan(0);
    expect(res.body.cards[0]).toHaveProperty('front');
    expect(res.body.cards[0]).toHaveProperty('back');
    expect(res.body.cards[0].documentTitle).toBe('Astronomy Notes');
  });

  test('POST /api/study/mnemonic without a topic uses a random chunk from the user\'s notes', async () => {
    const res = await request(app)
      .post('/api/study/mnemonic')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.mnemonic).toMatch(/Mnemonic for/);
    expect(res.body.documentTitle).toBe('Astronomy Notes');
  });

  test('POST /api/study/mnemonic with a topic searches notes for that topic', async () => {
    const res = await request(app)
      .post('/api/study/mnemonic')
      .set('Authorization', `Bearer ${token}`)
      .send({ topic: 'largest planet' });
    expect(res.status).toBe(200);
    expect(res.body.mnemonic).toMatch(/Mnemonic for largest planet/);
  });

  test('POST /api/study/mnemonic with no notes returns 400', async () => {
    const emptyToken = await signupAndLogin('no-notes-mnemonic@x.com');
    const res = await request(app)
      .post('/api/study/mnemonic')
      .set('Authorization', `Bearer ${emptyToken}`)
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('On-demand quiz generation', () => {
  test('POST /api/quiz/generate builds a quiz from a specific document', async () => {
    const token = await signupAndLogin('ondemand-quiz-user@x.com');
    const uploadRes = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Geography Notes', text: 'Mount Everest is the tallest mountain on Earth.' });

    const res = await request(app)
      .post('/api/quiz/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({ documentId: uploadRes.body.documentId });

    expect(res.status).toBe(200);
    expect(res.body.quiz.length).toBeGreaterThan(0);
    expect(res.body.quiz[0].questions.length).toBeGreaterThan(0);
  });

  test('POST /api/quiz/generate with no notes returns 400', async () => {
    const emptyToken = await signupAndLogin('ondemand-quiz-empty@x.com');
    const res = await request(app)
      .post('/api/quiz/generate')
      .set('Authorization', `Bearer ${emptyToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  test('retries once on a malformed model response before giving up', async () => {
    const token = await signupAndLogin('quiz-retry-user@x.com');
    await request(app)
      .post('/api/documents/upload')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Retry Notes', text: 'The retry logic should recover from one bad response.' });

    aiClients.generateQuizQuestions
      .mockRejectedValueOnce(new Error('malformed JSON'))
      .mockResolvedValueOnce([{
        question: 'Recovered?',
        options: ['Yes', 'No', 'Maybe', 'Unclear'],
        correctIndex: 0,
      }]);

    const res = await request(app).post('/api/quiz/generate').set('Authorization', `Bearer ${token}`).send({});
    expect(res.status).toBe(200);
    expect(res.body.quiz[0].questions[0].question).toBe('Recovered?');
    expect(res.body.failedCount).toBe(0);

    aiClients.generateQuizQuestions.mockImplementation(async (chunkText) => {
      return [{
        question: `What is this about: "${chunkText.slice(0, 20)}..."?`,
        options: ['A sample answer', 'A wrong option', 'Another wrong one', 'Also wrong'],
        correctIndex: 0,
      }];
    });
  });

  test('reports a clear error instead of an empty quiz when generation keeps failing', async () => {
    const token = await signupAndLogin('quiz-allfail-user@x.com');
    await request(app)
      .post('/api/documents/upload')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Fail Notes', text: 'This one will keep failing to generate.' });

    aiClients.generateQuizQuestions.mockRejectedValue(new Error('always broken'));

    const res = await request(app).post('/api/quiz/generate').set('Authorization', `Bearer ${token}`).send({});
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/could not generate/i);

    aiClients.generateQuizQuestions.mockImplementation(async (chunkText) => {
      return [{
        question: `What is this about: "${chunkText.slice(0, 20)}..."?`,
        options: ['A sample answer', 'A wrong option', 'Another wrong one', 'Also wrong'],
        correctIndex: 0,
      }];
    });
  });
});
