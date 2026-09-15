"""
StudyMind embedding + vector microservice.

Exposes local HTTP endpoints used by the Node backend:
  POST /embed          -> turn text into a vector (all-MiniLM-L6-v2)
  POST /vectors/add    -> store a chunk's vector + metadata in ChromaDB
  POST /vectors/query  -> similarity search, scoped to a user
  POST /vectors/delete -> remove a document's vectors (used on document delete)
  GET  /health         -> readiness check

Run with: uvicorn embed_service:app --port 8001
"""
import os
from typing import List, Optional

from fastapi import FastAPI
from pydantic import BaseModel

CHROMA_PATH = os.environ.get("CHROMA_PATH", "./chroma_data")

app = FastAPI(title="StudyMind Embedding & Vector Service")

_model = None
_collection = None


def get_model():
    # loaded lazily so importing this file doesn't pay the cost until something needs it
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer
        _model = SentenceTransformer("all-MiniLM-L6-v2")

    return _model


def get_collection():
    global _collection
    if _collection is None:
        import chromadb
        client = chromadb.PersistentClient(path=CHROMA_PATH)
        _collection = client.get_or_create_collection("notes")
    return _collection


class EmbedRequest(BaseModel):
    text: str


class EmbedBatchRequest(BaseModel):
    texts: List[str]


class VectorAddRequest(BaseModel):
    id: str
    text: str
    user_id: int
    document_id: int


class VectorQueryRequest(BaseModel):
    text: str
    user_id: int
    n_results: int = 5
    document_ids: Optional[List[int]] = None


class VectorDeleteRequest(BaseModel):
    document_id: Optional[int] = None
    ids: Optional[List[str]] = None


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/embed")
def embed(payload: EmbedRequest):
    embedding = get_model().encode(payload.text).tolist()
    return {"embedding": embedding}


@app.post("/embed_batch")
def embed_batch(payload: EmbedBatchRequest):
    embeddings = get_model().encode(payload.texts).tolist()
    return {"embeddings": embeddings}


@app.post("/vectors/add")
def vectors_add(payload: VectorAddRequest):
    embedding = get_model().encode(payload.text).tolist()
    get_collection().add(
        ids=[payload.id],
        embeddings=[embedding],
        documents=[payload.text],
        metadatas=[{"user_id": payload.user_id, "document_id": payload.document_id}],
    )
    return {"status": "stored", "id": payload.id}


@app.post("/vectors/query")
def vectors_query(payload: VectorQueryRequest):
    query_embedding = get_model().encode(payload.text).tolist()

    # always scope by user_id, and narrow further when the user picked specific notes
    # instead of searching all of them
    if payload.document_ids:
        where = {"$and": [{"user_id": payload.user_id}, {"document_id": {"$in": payload.document_ids}}]}
    else:
        where = {"user_id": payload.user_id}

    results = get_collection().query(
        query_embeddings=[query_embedding],
        n_results=payload.n_results,
        where=where,
    )

    # chromadb returns each field as a list of lists, one entry per query embedding
    # sent. we only ever send one, so [0] grabs that result set
    ids = results.get("ids", [[]])[0]
    texts = results.get("documents", [[]])[0]
    metadatas = results.get("metadatas", [[]])[0]
    distances = results.get("distances", [[]])[0]

    matches = []
    for i in range(len(ids)):
        matches.append({
            "id": ids[i],
            "text": texts[i],
            "metadata": metadatas[i],
            "distance": distances[i],
        })

    return {"matches": matches}


@app.post("/vectors/delete")
def vectors_delete(payload: VectorDeleteRequest):
    collection = get_collection()
    if payload.ids:
        collection.delete(ids=payload.ids)
    elif payload.document_id is not None:
        collection.delete(where={"document_id": payload.document_id})
    return {"status": "deleted"}
