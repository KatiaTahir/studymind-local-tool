// service worker for the extension. holds the auth token in chrome.storage.local
// and relays api calls from the popup to the StudyMind backend
const API_BASE = 'http://localhost:3000/api';

async function getToken() {
  const stored = await chrome.storage.local.get('studymind_token');
  return stored.studymind_token || null;
}

async function apiRequest(path, { method = 'GET', body } = {}) {
  const token = await getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'API_REQUEST') {
    apiRequest(message.path, message.options)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // keep the message channel open for the async response
  }
});
