# StudyMind

StudyMind is a study app that lets you upload your notes and chat with them directly. Instead of
just answering from general knowledge, it searches your actual notes for relevant sections and
answers based on what it finds there, showing you exactly which part of your notes the answer
came from.

It also includes spaced repetition quizzing, so it tracks what you've studied and quizzes you on
it again later at increasing intervals, similar to how Anki works but generated automatically
from your own notes. Beyond that there are flashcards, a summarize feature for condensing a full
document, and a mnemonic generator that comes up with a memory trick for whatever topic you pick.

Everything runs locally. It uses Ollama to run the language model and a local embeddings model
for search, so there's no API key or subscription needed to use it.

## Features

- Upload notes as pasted text or PDF files
- Chat with your notes, with cited sources for every answer
- Multiple choice quizzes, graded instantly, with spaced repetition built in
- A history of every question you've asked, notes-grounded or general chat
- A dashboard showing your streak, weak topics, and most-asked questions
- Flashcards and document summaries
- A mnemonic generator for tricky topics
- A Chrome extension that pulls content in from Google Classroom

## Project structure

```
frontend/            HTML, CSS, and JS frontend (login, study page, dashboard)
backend/             Node/Express API for auth, uploads, chat, quizzes, and stats
embedding_service/   Python service for embeddings and vector search
extension/           Chrome extension for Google Classroom
chroma_data/         Vector database storage, created automatically
```

When you ask a question, the frontend sends it to the backend, which turns the question into a
vector and searches your notes for the closest matches. Those matches get passed into a prompt
sent to the local language model, and the response comes back along with the sources it used.
The chunks you ask about are also logged so the spaced repetition system knows what to review
with you later.

## Setup

You'll need Node.js, Python, MySQL (or MariaDB), and Ollama installed. Everything below runs
entirely on your own machine — there's no server to deploy and no API key to configure.

1. Database

   Create a database user matching what you'll put in `.env` (skip this if you already have
   one set up):
   ```
   mysql -u root -p -e "CREATE USER 'studymind'@'localhost' IDENTIFIED BY 'yourpassword'; GRANT ALL PRIVILEGES ON *.* TO 'studymind'@'localhost';"
   ```
   Then set up the app's database and tables:
   ```
   cd backend
   cp .env.example .env   # edit DB_USER / DB_PASSWORD to match the user above
   npm install
   npm run init-db
   ```
2. Embedding service
   ```
   cd embedding_service
   pip install -r requirements.txt
   uvicorn embed_service:app --port 8001
   ```
3. Ollama
   ```
   ollama pull llama3.1:8b
   ollama serve
   ```
   (llama3.1:8b is the default. If you want a smaller, faster model instead, pull one of
   your choice and set OLLAMA_MODEL=<model name> in backend/.env to match.)
4. Run the app
   ```
   cd backend && npm start
   cd frontend && python3 -m http.server 5173
   ```

Each of steps 2-4 needs its own terminal window/tab running at the same time, since none of
them exit on their own. Once all three (plus `ollama serve`) are running, open localhost:5173,
create an account, and upload a document to get started.

If you're on the same kind of local setup this was developed on (MariaDB and Ollama installed
under your home directory), `./start_all.sh` starts every piece — database, Ollama, embedding
service, backend, and frontend — with a single command instead of the four steps above.

## Chrome extension

There's a step-by-step guide with a download button right in the app, under the "Extension" tab
in the nav once you're logged in. You can also load the `extension/` folder directly: go to
chrome://extensions, enable developer mode, and load it unpacked. Log in through the popup, then
on a Google Classroom page click "save this page" to add it to your notes.

If you change any file in `extension/`, run `./scripts/build-extension-zip.sh` to rebuild the
downloadable zip so the in-app download button stays current.

## Tests

```
cd backend && npm test
cd embedding_service && python3 -m pytest
```

## Roadmap

- Better PDF parsing for documents with unusual formatting
- Support for organizing notes into folders or classes
