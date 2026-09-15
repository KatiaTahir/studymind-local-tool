// the backend always runs on port 3000 no matter what port this frontend is
// served on, so point at it directly instead of using a relative path
const API_BASE = 'http://localhost:3000/api';

// the extension only works in chromium based browsers (chrome, edge, brave, opera).
// this is a best effort check to show a heads up on the extension guide page
function isChromiumBrowser() {
  const ua = navigator.userAgent;
  const isChromiumEngine = /Chrome|Chromium|Edg|OPR|Brave/.test(ua);
  const isRealSafari = /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR/.test(ua);
  return isChromiumEngine && !isRealSafari;
}

function getToken() { return localStorage.getItem('studymind_token'); }
function setToken(t) { localStorage.setItem('studymind_token', t); }
function clearToken() { localStorage.removeItem('studymind_token'); }
function isLoggedIn() { return !!getToken(); }

// fetch() throws a generic TypeError, not an HTTP error, when the server is
// unreachable. this turns that into a clearer message than "Failed to fetch"
function describeNetworkError(err) {
  if (err instanceof TypeError) {
    return new Error("Can't reach the StudyMind server. Make sure the backend is running on localhost:3000.");
  }
  return err;
}

// central helper for every json api call, throws on a non-2xx response so
// callers can try/catch instead of checking res.ok everywhere
async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw describeNetworkError(err);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// same idea as api() but for multipart form data (file uploads). no Content-Type
// header here, the browser sets the multipart boundary itself
async function apiUpload(path, formData) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers, body: formData });
  } catch (err) {
    throw describeNetworkError(err);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// disables a button while an async action runs so a slow request (these all hit
// a local llm, a few seconds is normal) can't get fired twice
async function withBusy(button, fn) {
  if (button.disabled) return undefined; // already in flight
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = 'Working…';
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

// ---- theme (dark/light) ----
function getTheme() { return localStorage.getItem('studymind_theme') || 'dark'; }

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('theme-toggle-btn');
  if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
}

function toggleTheme() {
  const next = getTheme() === 'dark' ? 'light' : 'dark';
  localStorage.setItem('studymind_theme', next);
  applyTheme(next);
}

function initTheme() {
  applyTheme(getTheme());
  document.getElementById('theme-toggle-btn')?.addEventListener('click', toggleTheme);
}

function requireAuthOrRedirect() {
  if (!isLoggedIn() && !location.pathname.endsWith('index.html') && location.pathname !== '/') {
    location.href = 'index.html';
  }
}

function logout() {
  clearToken();
  location.href = 'index.html';
}

// ---- index.html (login/signup) ----
function initAuthPage() {
  const form = document.getElementById('auth-form');
  if (!form) return;
  if (isLoggedIn()) { location.href = 'chat.html'; return; }

  const errorEl = document.getElementById('auth-error');
  let mode = 'login';

  document.getElementById('mode-login').addEventListener('click', () => setMode('login'));
  document.getElementById('mode-signup').addEventListener('click', () => setMode('signup'));

  function setMode(m) {
    mode = m;
    document.getElementById('mode-login').classList.toggle('active', m === 'login');
    document.getElementById('mode-signup').classList.toggle('active', m === 'signup');
    document.getElementById('submit-btn').textContent = m === 'login' ? 'Log In' : 'Sign Up';
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    withBusy(document.getElementById('submit-btn'), async () => {
      try {
        const data = await api(`/auth/${mode}`, { method: 'POST', body: { email, password } });
        setToken(data.token);
        location.href = 'chat.html';
      } catch (err) {
        errorEl.textContent = err.message;
      }
    });
  });
}

// escapes text before it goes into innerHTML, so a note or ai response can't
// inject html or script tags into the page
function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// local llms write in markdown even when asked for plain text, so without converting
// it users just see literal asterisks and hash symbols. this handles the common
// cases, not a full markdown parser, just enough for summaries/mnemonics/answers
function formatAiText(raw) {
  const escaped = escapeHtml(raw);
  const lines = escaped.split('\n');

  const htmlLines = [];
  let inList = false;

  for (let line of lines) {
    const isBullet = /^\s*[-*]\s+/.test(line);

    if (isBullet) {
      if (!inList) {
        htmlLines.push('<ul>');
        inList = true;
      }
      const bulletText = line.replace(/^\s*[-*]\s+/, '');
      htmlLines.push(`<li>${applyInlineFormatting(bulletText)}</li>`);
      continue;
    }

    if (inList) {
      htmlLines.push('</ul>');
      inList = false;
    }

    // headings become a bold line instead, since a real heading element would
    // look oversized inside a chat bubble or result box
    const headingMatch = line.match(/^\s*#{1,6}\s+(.*)$/);
    if (headingMatch) {
      htmlLines.push(`<strong>${applyInlineFormatting(headingMatch[1])}</strong>`);
      continue;
    }

    if (line.trim() === '') {
      htmlLines.push('<br/>');
    } else {
      htmlLines.push(applyInlineFormatting(line));
    }
  }
  if (inList) htmlLines.push('</ul>');

  return htmlLines.join('<br/>');
}

// handles **bold**, *italic*, and `code` within a single already-escaped line
function applyInlineFormatting(line) {
  let result = line;
  result = result.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  result = result.replace(/`(.+?)`/g, '<code>$1</code>');
  return result;
}

// renders multiple choice quiz questions, used by both the on-demand quiz and the
// review due cards button. items is [{chunkId, questions: [{question, options,
// correctIndex}]}]. clicking an option grades it right there and logs it
function renderQuizQuestions(container, items, { emptyMessage = 'Nothing to quiz you on yet.' } = {}) {
  container.innerHTML = '';
  if (!items || items.length === 0) {
    container.innerHTML = `<p class="muted">${emptyMessage}</p>`;
    return;
  }

  const heading = document.createElement('div');
  const totalQuestions = items.reduce((sum, item) => sum + item.questions.length, 0);
  heading.className = 'result-heading';
  heading.textContent = `${totalQuestions} question${totalQuestions === 1 ? '' : 's'} - click an answer to check it`;
  container.appendChild(heading);

  let questionNumber = 0;
  for (const item of items) {
    for (const q of item.questions) {
      questionNumber += 1;
      const div = document.createElement('div');
      div.className = 'result-block quiz-question';
      div.innerHTML = `<p><span class="q-number">${questionNumber}.</span>${formatAiText(q.question)}</p>`;

      const optionsBox = document.createElement('div');
      optionsBox.className = 'quiz-options';

      const optionButtons = [];
      q.options.forEach((optionText, pickedIndex) => {
        const optBtn = document.createElement('button');
        optBtn.type = 'button';
        optBtn.className = 'quiz-option';
        optBtn.textContent = optionText;
        optionButtons.push(optBtn);

        optBtn.addEventListener('click', async () => {
          // lock the question in on the first click so a second click can't log
          // a second answer for the same question
          optionButtons.forEach((b) => (b.disabled = true));

          const gotItRight = pickedIndex === q.correctIndex;
          optBtn.classList.add(gotItRight ? 'correct' : 'wrong');
          if (!gotItRight) {
            optionButtons[q.correctIndex].classList.add('correct');
          }

          try {
            await api('/quiz/answer', {
              method: 'POST',
              body: { chunkId: item.chunkId, question: q.question, wasCorrect: gotItRight },
            });
          } catch (err) {
            const errEl = document.createElement('p');
            errEl.className = 'error';
            errEl.textContent = err.message;
            div.appendChild(errEl);
          }
        });

        optionsBox.appendChild(optBtn);
      });

      div.appendChild(optionsBox);
      container.appendChild(div);
    }
  }
}

// renders ai-generated flashcards as click-to-flip cards, cards is [{front, back, documentTitle}]
function renderFlashcards(container, cards) {
  container.innerHTML = '';
  if (!cards || cards.length === 0) {
    container.innerHTML = '<p class="muted">No flashcards could be generated. Try a different document.</p>';
    return;
  }
  for (const card of cards) {
    const wrapper = document.createElement('div');
    const el = document.createElement('div');
    el.className = 'flashcard';
    el.innerHTML = `
      <div class="flashcard-inner">
        <div class="flashcard-face front">${formatAiText(card.front)}</div>
        <div class="flashcard-face back">${formatAiText(card.back)}</div>
      </div>`;
    el.addEventListener('click', () => el.classList.toggle('flipped'));
    wrapper.appendChild(el);
    if (card.documentTitle) {
      const label = document.createElement('div');
      label.className = 'flashcard-doc';
      label.textContent = card.documentTitle;
      wrapper.appendChild(label);
    }
    container.appendChild(wrapper);
  }
}

// how much of a source chunk to show before truncating. a short snippet is enough
// to recognize the passage, quoting the whole chunk made sources dominate the page
const SOURCE_PREVIEW_LENGTH = 90;

function appendChatMessage(log, role, text, sources) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  if (role === 'assistant') {
    // the ai's reply may use markdown, render it instead of showing literal
    // asterisks. what the user typed themselves needs no such formatting
    div.innerHTML = formatAiText(text);
  } else {
    div.textContent = text;
  }
  if (sources && sources.length > 0) {
    const sourcesEl = document.createElement('div');
    sourcesEl.className = 'sources';

    // sources stay collapsed behind one small toggle by default. the answer is
    // the important part, citations are just a check-my-work detail
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'ghost small sources-toggle';
    const sourceWord = sources.length === 1 ? 'source' : 'sources';
    toggle.textContent = `📎 ${sources.length} ${sourceWord}`;

    const list = document.createElement('div');
    list.className = 'source-list hidden';

    for (const s of sources) {
      const item = document.createElement('div');
      item.className = 'source-item';

      // "Section N" (chunk_index is 0-based, so +1) gives a short, concrete location
      // instead of dumping the whole paragraph inline
      const label = Number.isInteger(s.chunkIndex)
        ? `${s.documentTitle} · Section ${s.chunkIndex + 1}`
        : s.documentTitle;
      const snippet = s.text.length > SOURCE_PREVIEW_LENGTH
        ? `${s.text.slice(0, SOURCE_PREVIEW_LENGTH).trim()}…`
        : s.text;

      item.innerHTML = `<strong>${escapeHtml(label)}</strong> — ${escapeHtml(snippet)}`;
      list.appendChild(item);
    }

    toggle.addEventListener('click', () => {
      list.classList.toggle('hidden');
    });

    sourcesEl.appendChild(toggle);
    sourcesEl.appendChild(list);
    div.appendChild(sourcesEl);
  }
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

// ---- chat.html (the "Study" hub) ----
function initChatPage() {
  const actionGrid = document.getElementById('action-grid');
  if (!actionGrid) return;
  requireAuthOrRedirect();

  const uploadForm = document.getElementById('upload-form');
  const docList = document.getElementById('doc-list');
  const docSelects = ['summarize-doc-select', 'quiz-doc-select', 'flashcards-doc-select'].map((id) =>
    document.getElementById(id)
  );

  // which documents are checked as sources for the notes-grounded chat. new uploads
  // default to selected, and ids drop out of this set when their document is deleted
  let selectedDocIds = new Set();
  let allDocIds = [];

  function updateScopeHint() {
    const hint = document.getElementById('notes-scope-hint');
    const countEl = document.getElementById('doc-selected-count');
    if (allDocIds.length === 0) {
      hint.textContent = '';
      countEl.textContent = '';
      return;
    }
    countEl.textContent = `${selectedDocIds.size} of ${allDocIds.length} selected`;
    if (selectedDocIds.size === 0) {
      hint.textContent = 'No documents selected below, so nothing will be searched.';
    } else if (selectedDocIds.size === allDocIds.length) {
      hint.textContent = 'Searching all of your uploaded notes.';
    } else {
      hint.textContent = `Searching only ${selectedDocIds.size} selected document(s).`;
    }
  }

  // clicking a study-tool button shows its panel in the stage and hides the rest
  const stageTitle = document.getElementById('stage-title');
  actionGrid.querySelectorAll('.tool-nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      actionGrid.querySelectorAll('.tool-nav-item').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`panel-${btn.dataset.panel}`).classList.add('active');
      stageTitle.textContent = btn.dataset.label;
      if (btn.dataset.panel === 'history') loadHistory();
    });
  });
  // default to the first tool (Ask About My Notes) being marked active on load
  actionGrid.querySelector('.tool-nav-item[data-panel="ask-notes"]')?.classList.add('active');

  let lastDocuments = [];

  function renderDocList() {
    const documents = lastDocuments;
    docList.innerHTML = '';
    if (documents.length === 0) {
      docList.innerHTML = '<li class="muted">No documents uploaded yet.</li>';
    }

    for (const doc of documents) {
      const li = document.createElement('li');

      const info = document.createElement('label');
      info.className = 'doc-info';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selectedDocIds.has(doc.id);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selectedDocIds.add(doc.id);
        else selectedDocIds.delete(doc.id);
        updateScopeHint();
      });
      const title = document.createElement('span');
      title.className = 'doc-title';
      title.textContent = doc.title;
      const badge = document.createElement('span');
      badge.className = 'doc-badge';
      badge.textContent = doc.source_type === 'classroom_extension' ? 'classroom' : 'upload';
      info.appendChild(checkbox);
      info.appendChild(title);
      info.appendChild(badge);

      const delBtn = document.createElement('button');
      delBtn.textContent = 'Delete';
      delBtn.className = 'secondary small';
      delBtn.addEventListener('click', async () => {
        await api(`/documents/${doc.id}`, { method: 'DELETE' });
        loadDocuments();
      });

      li.appendChild(info);
      li.appendChild(delBtn);
      docList.appendChild(li);
    }

    updateScopeHint();

    // rebuild every "which document" dropdown, keeping whatever was already selected
    for (const select of docSelects) {
      const current = select.value;
      select.innerHTML = '<option value="">All my notes</option>';
      for (const doc of documents) {
        const opt = document.createElement('option');
        opt.value = doc.id;
        opt.textContent = doc.title;
        select.appendChild(opt);
      }
      select.value = current;
    }
  }

  async function loadDocuments() {
    try {
      const { documents } = await api('/documents');
      lastDocuments = documents;

      // new documents default to selected, ones that got removed just drop out of the set
      const newIds = new Set(documents.map((d) => d.id));
      for (const id of allDocIds) {
        if (!newIds.has(id)) selectedDocIds.delete(id);
      }
      for (const doc of documents) {
        if (!allDocIds.includes(doc.id)) selectedDocIds.add(doc.id);
      }
      allDocIds = documents.map((d) => d.id);

      renderDocList();
    } catch (err) {
      docList.innerHTML = `<li class="error">${err.message}</li>`;
    }
  }

  document.getElementById('doc-select-all').addEventListener('click', () => {
    selectedDocIds = new Set(allDocIds);
    renderDocList();
  });
  document.getElementById('doc-select-none').addEventListener('click', () => {
    selectedDocIds = new Set();
    renderDocList();
  });

  async function loadTopics() {
    try {
      const { topics } = await api('/study/topics');
      for (const id of ['notes-topic-select', 'mnemonic-topic-select']) {
        const select = document.getElementById(id);
        select.innerHTML = '<option value="">Choose an AI-suggested topic…</option>';
        for (const topic of topics) {
          const opt = document.createElement('option');
          opt.value = topic;
          opt.textContent = topic;
          select.appendChild(opt);
        }
      }
    } catch (err) {
      // not critical, topic dropdowns just stay empty if this fails (no notes yet, etc)
    }
  }

  uploadForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = document.getElementById('doc-title').value.trim();
    const text = document.getElementById('doc-text').value.trim();
    const fileInput = document.getElementById('doc-file');
    const file = fileInput.files[0];
    const status = document.getElementById('upload-status');

    if (!text && !file) { status.textContent = 'Paste some text or choose a file first.'; return; }
    status.textContent = 'Uploading...';
    withBusy(uploadForm.querySelector('button[type="submit"]'), async () => {
      try {
        if (file) {
          const formData = new FormData();
          formData.append('file', file);
          if (title) formData.append('title', title);
          await apiUpload('/documents/upload', formData);
        } else {
          await api('/documents/upload', { method: 'POST', body: { title, text } });
        }
        status.textContent = 'Uploaded.';
        document.getElementById('doc-title').value = '';
        document.getElementById('doc-text').value = '';
        fileInput.value = '';
        loadDocuments();
        loadTopics();
      } catch (err) {
        status.textContent = err.message;
      }
    });
  });

  // ---- Ask About My Notes (grounded RAG chat) ----
  const notesLog = document.getElementById('notes-chat-log');
  const notesForm = document.getElementById('notes-chat-form');
  const notesInput = document.getElementById('notes-question-input');

  async function askNotes(question) {
    if (allDocIds.length > 0 && selectedDocIds.size === 0) {
      appendChatMessage(notesLog, 'assistant', 'Select at least one document above before asking a question.');
      return;
    }
    appendChatMessage(notesLog, 'user', question);
    try {
      const documentIds = Array.from(selectedDocIds);
      const data = await api('/chat', { method: 'POST', body: { question, documentIds } });
      appendChatMessage(notesLog, 'assistant', data.answer, data.sources);
    } catch (err) {
      appendChatMessage(notesLog, 'assistant', `Error: ${err.message}`);
    }
  }

  notesForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const question = notesInput.value.trim();
    if (!question) return;
    notesInput.value = '';
    askNotes(question);
  });

  document.getElementById('notes-topic-select').addEventListener('change', (e) => {
    const topic = e.target.value;
    if (!topic) return;
    e.target.value = '';
    askNotes(`Tell me about ${topic}.`);
  });

  // ---- Ask the AI Anything (ungrounded general chat) ----
  const generalLog = document.getElementById('general-chat-log');
  const generalForm = document.getElementById('general-chat-form');
  const generalInput = document.getElementById('general-question-input');

  generalForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const question = generalInput.value.trim();
    if (!question) return;
    appendChatMessage(generalLog, 'user', question);
    generalInput.value = '';
    withBusy(generalForm.querySelector('button[type="submit"]'), async () => {
      try {
        const data = await api('/chat/general', { method: 'POST', body: { question } });
        appendChatMessage(generalLog, 'assistant', data.answer);
      } catch (err) {
        appendChatMessage(generalLog, 'assistant', `Error: ${err.message}`);
      }
    });
  });

  // ---- Summarize ----
  // scrolls a freshly populated result box into view. these panels can get tall,
  // so without this the output can land off-screen and look like nothing happened
  function scrollToResult(el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ---- History panel ----
  async function loadHistory() {
    const box = document.getElementById('history-result');
    box.innerHTML = '<p class="spinner">Loading history…</p>';
    try {
      const { history } = await api('/chat/history');
      if (!history || history.length === 0) {
        box.innerHTML = '<p class="muted">Nothing asked yet. Go ask something!</p>';
        return;
      }
      box.innerHTML = '';
      for (const entry of history) {
        const row = document.createElement('div');
        row.className = 'result-block';
        const askedWhen = new Date(entry.asked_at).toLocaleString();
        const modeLabel = entry.mode === 'general' ? 'General chat' : 'From my notes';
        row.innerHTML = `
          <p class="muted" style="margin: 0 0 6px; font-size: 0.8rem;">${modeLabel} • ${askedWhen}</p>
          <p><strong>${escapeHtml(entry.question)}</strong></p>
          <div>${formatAiText(entry.answer)}</div>`;
        box.appendChild(row);
      }
    } catch (err) {
      box.innerHTML = `<p class="error">${err.message}</p>`;
    }
  }
  document.getElementById('history-refresh-btn').addEventListener('click', loadHistory);

  document.getElementById('summarize-btn').addEventListener('click', (e) => {
    const result = document.getElementById('summarize-result');
    const documentId = document.getElementById('summarize-doc-select').value || undefined;
    result.innerHTML = '<p class="spinner">Summarizing…</p>';
    withBusy(e.currentTarget, async () => {
      try {
        const { summary } = await api('/study/summarize', { method: 'POST', body: { documentId } });
        result.innerHTML = `<div class="result-block">${formatAiText(summary)}</div>`;
      } catch (err) {
        result.innerHTML = `<p class="error">${err.message}</p>`;
      }
      scrollToResult(result);
    });
  });

  // ---- Generate Quiz ----
  document.getElementById('quiz-generate-btn').addEventListener('click', (e) => {
    const result = document.getElementById('quiz-result');
    const documentId = document.getElementById('quiz-doc-select').value || undefined;
    result.innerHTML = '<p class="spinner">Generating quiz…</p>';
    withBusy(e.currentTarget, async () => {
      try {
        const { quiz } = await api('/quiz/generate', { method: 'POST', body: { documentId } });
        renderQuizQuestions(result, quiz, { emptyMessage: 'Could not generate a quiz from that.' });
      } catch (err) {
        result.innerHTML = `<p class="error">${err.message}</p>`;
      }
      scrollToResult(result);
    });
  });

  // ---- Review Due Cards (spaced repetition, folded into the same Quiz panel) ----
  document.getElementById('quiz-due-btn').addEventListener('click', (e) => {
    const result = document.getElementById('quiz-result');
    result.innerHTML = '<p class="spinner">Loading due reviews…</p>';
    withBusy(e.currentTarget, async () => {
      try {
        const { due, failedCount } = await api('/quiz/due');
        // don't say "nothing due" when something was due but question generation
        // failed. that's different from actually being caught up
        const emptyMessage = failedCount > 0
          ? "Couldn't generate review questions right now. Try again in a moment."
          : "Nothing due for review right now. You're all caught up!";
        renderQuizQuestions(result, due, { emptyMessage });
      } catch (err) {
        result.innerHTML = `<p class="error">${err.message}</p>`;
      }
      scrollToResult(result);
    });
  });

  // ---- Flashcards ----
  document.getElementById('flashcards-generate-btn').addEventListener('click', (e) => {
    const result = document.getElementById('flashcards-result');
    const documentId = document.getElementById('flashcards-doc-select').value || undefined;
    result.innerHTML = '<p class="spinner">Generating flashcards…</p>';
    withBusy(e.currentTarget, async () => {
      try {
        const { cards } = await api('/study/flashcards', { method: 'POST', body: { documentId } });
        renderFlashcards(result, cards);
      } catch (err) {
        result.innerHTML = `<p class="error">${err.message}</p>`;
      }
      scrollToResult(result);
    });
  });

  // ---- Mnemonic Maker (unique feature) ----
  const mnemonicSelect = document.getElementById('mnemonic-topic-select');
  const mnemonicInput = document.getElementById('mnemonic-topic-input');
  mnemonicSelect.addEventListener('change', () => {
    if (mnemonicSelect.value) mnemonicInput.value = mnemonicSelect.value;
  });

  document.getElementById('mnemonic-generate-btn').addEventListener('click', (e) => {
    const result = document.getElementById('mnemonic-result');
    const topic = mnemonicInput.value.trim() || undefined;
    result.innerHTML = '<p class="spinner">Thinking of something memorable…</p>';
    withBusy(e.currentTarget, async () => {
      try {
        const data = await api('/study/mnemonic', { method: 'POST', body: { topic } });
        result.innerHTML = `
          <div class="mnemonic-result">
            <div class="label">🧠 Mnemonic: ${escapeHtml(data.documentTitle)}</div>
            <div>${formatAiText(data.mnemonic)}</div>
          </div>`;
      } catch (err) {
        result.innerHTML = `<p class="error">${err.message}</p>`;
      }
      scrollToResult(result);
    });
  });

  document.getElementById('logout-btn')?.addEventListener('click', logout);
  loadDocuments();
  loadTopics();
}

// ---- dashboard.html ----
function initDashboardPage() {
  const streakEl = document.getElementById('streak-value');
  if (!streakEl) return;
  requireAuthOrRedirect();

  function fillPlainList(id, items, emptyText) {
    const listEl = document.getElementById(id);
    if (!items || items.length === 0) {
      listEl.innerHTML = `<li class="muted">${emptyText}</li>`;
      return;
    }
    listEl.innerHTML = '';
    for (const li of items) {
      const row = document.createElement('li');
      row.innerHTML = li;
      listEl.appendChild(row);
    }
  }

  async function loadStats() {
    try {
      const stats = await api('/stats');
      streakEl.textContent = stats.studyStreakDays;

      const ctx = document.getElementById('accuracy-chart');
      const labels = stats.accuracyByTopic.map((t) => t.topic);
      const data = stats.accuracyByTopic.map((t) => Math.round(t.accuracy * 100));

      new Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [{ label: 'Accuracy %', data, backgroundColor: '#6c8bff' }],
        },
        options: {
          scales: { y: { beginAtZero: true, max: 100 } },
          plugins: { legend: { display: false } },
        },
      });

      fillPlainList(
        'weak-topics-list',
        stats.weakTopics.map((t) => `${escapeHtml(t.topic)} <span class="count">${Math.round(t.accuracy * 100)}%</span>`),
        'Not enough quiz answers yet to tell.'
      );

      fillPlainList(
        'most-asked-list',
        stats.mostAskedQuestions.map((q) => `${escapeHtml(q.question)} <span class="count">x${q.timesAsked}</span>`),
        'No repeated questions yet.'
      );

      fillPlainList(
        'recent-history-list',
        stats.recentHistory.map((h) => {
          const badge = h.mode === 'general' ? 'General' : 'Notes';
          return `<span class="badge">${badge}</span>${escapeHtml(h.question)}`;
        }),
        'Nothing asked yet.'
      );
    } catch (err) {
      document.getElementById('dashboard-error').textContent = err.message;
    }
  }

  document.getElementById('logout-btn')?.addEventListener('click', logout);
  loadStats();
}

// ---- extension-guide.html ----
function initExtensionGuidePage() {
  const warning = document.getElementById('browser-warning');
  if (!warning) return;
  requireAuthOrRedirect();

  if (!isChromiumBrowser()) warning.classList.remove('hidden');

  document.getElementById('logout-btn')?.addEventListener('click', logout);
}

// every page loads this same script. each init function checks for its own
// page-specific element first and does nothing if it's not there
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initAuthPage();
  initChatPage();
  initDashboardPage();
  initExtensionGuidePage();
});
