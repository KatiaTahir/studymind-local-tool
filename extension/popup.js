const API_BASE = 'http://localhost:3000/api';
const WEBAPP_URL = 'http://localhost:5173/chat.html';

// wraps chrome.runtime.sendMessage's callback api in a promise so we can use async/await
function callApi(path, options) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'API_REQUEST', path, options }, (response) => {
      if (!response) return reject(new Error('No response from background service worker'));
      if (response.ok) resolve(response.data);
      else reject(new Error(response.error));
    });
  });
}

// disables a button during an async action so a slow request can't get fired
// twice by a double click
async function withBusy(button, fn) {
  if (button.disabled) return;
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = 'Working…';
  try {
    await fn();
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function init() {
  const { studymind_token } = await chrome.storage.local.get('studymind_token');
  document.getElementById('login-view').classList.toggle('hidden', !!studymind_token);
  document.getElementById('main-view').classList.toggle('hidden', !studymind_token);
}

document.getElementById('login-btn').addEventListener('click', (e) => {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';
  if (!email || !password) {
    errorEl.textContent = 'Enter your email and password.';
    return;
  }

  withBusy(e.currentTarget, async () => {
    try {
      // goes straight to fetch() instead of callApi() since there's no token yet to attach
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Login failed');
      await chrome.storage.local.set({ studymind_token: data.token });
      init();
    } catch (err) {
      errorEl.textContent = err instanceof TypeError
        ? "Can't reach the StudyMind server. Make sure the backend is running."
        : err.message;
    }
  });
});


document.getElementById('logout-btn').addEventListener('click', async () => {
  await chrome.storage.local.remove('studymind_token');
  init();
});

document.getElementById('open-webapp-btn').addEventListener('click', () => {
  chrome.tabs.create({ url: WEBAPP_URL });
});

document.getElementById('save-page-btn').addEventListener('click', (e) => {
  const status = document.getElementById('save-status');
  status.textContent = 'Reading page...';

  withBusy(e.currentTarget, async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url || !tab.url.includes('classroom.google.com')) {
        throw new Error('Open a Google Classroom page first, then try again.');
      }

      let content;
      try {
        content = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_CLASSROOM_CONTENT' });
      } catch (err) {
        // most common real failure: the content script only starts running on pages
        // loaded after the extension was installed or reloaded
        throw new Error('Could not connect to this page. Try refreshing the Classroom tab and clicking again.');
      }
      if (!content || !content.text) throw new Error('Could not read content from this page.');

      status.textContent = 'Saving to StudyMind...';
      await callApi('/documents/upload', {
        method: 'POST',
        body: { title: content.title, text: content.text, sourceType: 'classroom_extension' },
      });
      status.textContent = 'Saved! Ask about it in the chat below or in the web app.';
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
    }
  });
});

document.getElementById('ask-btn').addEventListener('click', (e) => {
  const input = document.getElementById('question-input');
  const question = input.value.trim();
  if (!question) return;
  const log = document.getElementById('chat-log');

  const userMsg = document.createElement('div');
  userMsg.className = 'msg';
  userMsg.textContent = `You: ${question}`;
  log.appendChild(userMsg);
  input.value = '';

  withBusy(e.currentTarget, async () => {
    try {
      const data = await callApi('/chat', { method: 'POST', body: { question } });
      const answerMsg = document.createElement('div');
      answerMsg.className = 'msg';
      answerMsg.textContent = data.answer;
      log.appendChild(answerMsg);
    } catch (err) {
      const errMsg = document.createElement('div');
      errMsg.className = 'msg error';
      errMsg.textContent = err.message;
      log.appendChild(errMsg);
    }
    log.scrollTop = log.scrollHeight;
  });
});

init();
