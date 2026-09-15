const EMBED_SERVICE_URL = process.env.EMBEDDING_SERVICE_URL || 'http://localhost:8001';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

// set OLLAMA_MODEL in .env if you want a different model
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b';

async function addVector({ id, text, userId, documentId }) {
  const res = await fetch(`${EMBED_SERVICE_URL}/vectors/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, text, user_id: userId, document_id: documentId }),
  });
  if (!res.ok) throw new Error(`embedding service /vectors/add failed: ${res.status}`);
  return res.json();
}

async function queryVectors({ text, userId, nResults = 5, documentIds }) {
  const res = await fetch(`${EMBED_SERVICE_URL}/vectors/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, user_id: userId, n_results: nResults, document_ids: documentIds }),
  });
  if (!res.ok) throw new Error(`embedding service /vectors/query failed: ${res.status}`);
  const data = await res.json();
  return data.matches;
}

async function deleteVectorsForDocument(documentId) {
  const res = await fetch(`${EMBED_SERVICE_URL}/vectors/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ document_id: documentId }),
  });
  if (!res.ok) throw new Error(`embedding service /vectors/delete failed: ${res.status}`);
  return res.json();
}

// caps how long a local model can ramble. 600 tokens is plenty for a note based
// answer, quiz, or summary, but stops it from running on forever
const MAX_OUTPUT_TOKENS = 600;

async function ollamaGenerate(prompt) {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      options: { num_predict: MAX_OUTPUT_TOKENS },
    }),
  });
  if (!res.ok) throw new Error(`Ollama /api/generate failed: ${res.status}`);
  const data = await res.json();
  return data.response;
}

// local models sometimes wrap json in prose or markdown fences even when told not to.
// this pulls out the first array/object instead of assuming the raw response is clean
function extractJson(rawResponse, kind = 'array') {
  let pattern;
  if (kind === 'array') {
    pattern = /\[[\s\S]*\]/;
  } else {
    pattern = /\{[\s\S]*\}/;
  }

  const found = rawResponse.match(pattern);
  if (!found) throw new Error(`No JSON ${kind} found in model response`);
  return JSON.parse(found[0]);
}

function buildRagPrompt(question, sources) {
  const labeled = [];
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    labeled.push(`[Source ${i + 1} - ${src.documentTitle}]\n${src.text}`);
  }
  const context = labeled.join('\n\n');

  return `Using ONLY the context below, answer the question. If the answer is not in the context, say so explicitly instead of guessing.\n\nContext:\n${context}\n\nQuestion: ${question}`;
}

async function generateAnswer(question, sources) {
  return ollamaGenerate(buildRagPrompt(question, sources));
}

// kept separate from generateAnswer since there's no note context here at all,
// so it stays clear which mode is grounded and which isn't
async function generateGeneralAnswer(question) {
  return ollamaGenerate(
    `You are a friendly, knowledgeable study assistant. Answer the following question clearly and concisely.\n\nQuestion: ${question}`
  );
}

function buildQuizPrompt(chunkText) {
  return `Generate 3 multiple choice quiz questions based ONLY on this text. Each question needs exactly 4 options and one correctIndex (0-3) pointing at the correct option. Return ONLY a JSON array, no other text, in this exact format:\n[{"question": "...", "options": ["...", "...", "...", "..."], "correctIndex": 0}]\n\nText: ${chunkText}`;
}

// a valid quiz question needs question text, exactly 4 options, and a correctIndex
// that actually points at one of them. anything less isn't safe to render on the frontend
function looksLikeAQuestion(item) {
  if (!item || typeof item.question !== 'string') return false;
  if (!Array.isArray(item.options) || item.options.length !== 4) return false;
  if (!item.options.every((opt) => typeof opt === 'string')) return false;
  if (!Number.isInteger(item.correctIndex)) return false;
  if (item.correctIndex < 0 || item.correctIndex > 3) return false;
  return true;
}

function parseQuizResponse(rawResponse) {
  const parsed = extractJson(rawResponse, 'array');
  if (!Array.isArray(parsed)) throw new Error('Quiz response JSON is not an array');

  const good = [];
  for (const item of parsed) {
    if (looksLikeAQuestion(item)) good.push(item);
  }
  return good;
}

async function generateQuizQuestions(chunkText) {
  const raw = await ollamaGenerate(buildQuizPrompt(chunkText));
  return parseQuizResponse(raw);
}

function looksLikeAFlashcard(item) {
  return Boolean(item) && typeof item.front === 'string' && typeof item.back === 'string';
}

function parseFlashcardResponse(rawResponse) {
  const parsed = extractJson(rawResponse, 'array');
  if (!Array.isArray(parsed)) throw new Error('Flashcard response JSON is not an array');

  const good = [];
  for (const item of parsed) {
    if (looksLikeAFlashcard(item)) good.push(item);
  }
  return good;
}

async function generateFlashcards(chunkText, count = 3) {
  const prompt = `Create ${count} flashcards from this text. Each flashcard has a short "front" (a term or question) and a concise "back" (the definition or answer). Return ONLY a JSON array, no other text, in this exact format:\n[{"front": "...", "back": "..."}]\n\nText: ${chunkText}`;
  const raw = await ollamaGenerate(prompt);
  return parseFlashcardResponse(raw);
}

function parseTopicsResponse(rawResponse) {
  const parsed = extractJson(rawResponse, 'array');
  if (!Array.isArray(parsed)) throw new Error('Topics response JSON is not an array');

  const topics = [];
  for (const item of parsed) {
    if (typeof item === 'string' && item.trim()) {
      topics.push(item.trim());
    }
  }
  return topics;
}

async function generateTopics(sampleText) {
  const prompt = `Read these notes and list the 5-8 main topics or themes covered, as short phrases (2-6 words each). Return ONLY a JSON array of strings, no other text, in this exact format:\n["Topic one", "Topic two"]\n\nNotes: ${sampleText}`;
  const raw = await ollamaGenerate(prompt);
  return parseTopicsResponse(raw);
}

async function generateSummary(text) {
  return ollamaGenerate(
    `Summarize the following notes in a clear, well-organized way (use short paragraphs or bullet points). Cover every major topic present, but be concise.\n\nNotes: ${text}`
  );
}

// generates a memory trick (rhyme, acronym, vivid image) for something in the user's notes
async function generateMnemonic(text, topic) {
  let topicNote = '';
  if (topic) {
    topicNote = `The user wants to remember this specifically in relation to: "${topic}".\n`;
  }
  return ollamaGenerate(
    `You are a creative memory-technique coach. Invent ONE vivid, catchy mnemonic device (an acronym, rhyme, silly sentence, or memory palace image) that helps someone remember the key fact(s) in the text below. ${topicNote}Keep it short (1-3 sentences) and explain briefly why it works.\n\nText: ${text}`
  );
}

module.exports = {
  addVector,
  queryVectors,
  deleteVectorsForDocument,
  buildRagPrompt,
  generateAnswer,
  generateGeneralAnswer,
  parseQuizResponse,
  generateQuizQuestions,
  parseFlashcardResponse,
  generateFlashcards,
  parseTopicsResponse,
  generateTopics,
  generateSummary,
  generateMnemonic,
};
