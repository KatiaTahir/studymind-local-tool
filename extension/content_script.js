// runs on classroom.google.com pages and grabs assignment/material text when
// the popup asks for it
function extractClassroomText() {
  // classroom's dom isn't documented or stable, so this tries a few common
  // containers and keeps whichever one has the most text
  const titleEl = document.querySelector('h1, [role="heading"]');
  const pageTitle = titleEl ? titleEl.innerText.trim() : document.title;

  const candidateSelectors = ['[role="main"]', 'main', 'article', 'body'];
  let bestText = '';
  for (const selector of candidateSelectors) {
    const el = document.querySelector(selector);
    if (el && el.innerText && el.innerText.trim().length > bestText.length) {
      bestText = el.innerText.trim();
    }
  }

  return { title: pageTitle, text: bestText, url: location.href };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'EXTRACT_CLASSROOM_CONTENT') {
    sendResponse(extractClassroomText());
  }
  return true;
});
