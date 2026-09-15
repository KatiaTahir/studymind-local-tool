#!/usr/bin/env bash
# Starts every StudyMind service locally: MariaDB, the embedding/vector service,
# Ollama, the backend API, and a static server for the frontend.
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$HOME/.local/bin:$PATH"

MDB="$HOME/.local/mariadb"
DATADIR="$HOME/.local/mariadb-data"
SOCK="$DATADIR/mysqld.sock"

if [ -d "$MDB" ] && ! "$MDB/bin/mariadb-admin" --no-defaults -u root --socket="$SOCK" ping >/dev/null 2>&1; then
  echo "Starting MariaDB..."
  nohup "$MDB/bin/mariadbd" --no-defaults --datadir="$DATADIR" --socket="$SOCK" \
    --port=3306 --bind-address=127.0.0.1 --pid-file="$DATADIR/mariadb.pid" \
    > /tmp/mariadbd.log 2>&1 &
  disown
  sleep 3
fi

if ! curl -s http://localhost:11434/api/version >/dev/null 2>&1; then
  echo "Starting Ollama..."
  export OLLAMA_MODELS="$HOME/.ollama/models"
  nohup ollama serve > /tmp/ollama_serve.log 2>&1 &
  disown
  sleep 2
fi

if ! curl -s http://localhost:8001/health >/dev/null 2>&1; then
  echo "Starting embedding/vector service..."
  cd "$ROOT/embedding_service"
  CHROMA_PATH="$ROOT/chroma_data" nohup python3 -m uvicorn embed_service:app --port 8001 \
    > /tmp/embed_service.log 2>&1 &
  disown
  cd "$ROOT"
  sleep 3
fi

if ! curl -s http://localhost:3000/api/health >/dev/null 2>&1; then
  echo "Starting backend API..."
  cd "$ROOT/backend"
  nohup node server.js > /tmp/backend_server.log 2>&1 &
  disown
  cd "$ROOT"
  sleep 1
fi

if ! curl -s http://localhost:5173 >/dev/null 2>&1; then
  echo "Starting frontend static server..."
  cd "$ROOT/frontend"
  nohup python3 -m http.server 5173 > /tmp/frontend_server.log 2>&1 &
  disown
  cd "$ROOT"
fi

echo ""
echo "StudyMind is up:"
echo "  Web app:  http://localhost:5173"
echo "  API:      http://localhost:3000/api/health"
echo "  Ollama:   http://localhost:11434"
echo "  Embedder: http://localhost:8001/health"
