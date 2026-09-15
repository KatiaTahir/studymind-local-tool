import os
import sys
import shutil
import tempfile

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# point ChromaDB at a throwaway directory before importing embed_service, so tests
# never touch the real chroma_data folder
TEST_CHROMA_DIR = tempfile.mkdtemp(prefix="studymind_test_chroma_")
os.environ["CHROMA_PATH"] = TEST_CHROMA_DIR

import embed_service  # noqa: E402

client = TestClient(embed_service.app)


def teardown_module(module):
    shutil.rmtree(TEST_CHROMA_DIR, ignore_errors=True)


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_embed_returns_vector_of_expected_length():
    resp = client.post("/embed", json={"text": "Mitochondria is the powerhouse of the cell."})
    assert resp.status_code == 200
    vector = resp.json()["embedding"]
    assert isinstance(vector, list)
    assert len(vector) == 384  # all-MiniLM-L6-v2 output dimension


def test_similar_texts_have_similar_embeddings():
    import numpy as np

    v1 = client.post("/embed", json={"text": "The cat sat on the mat."}).json()["embedding"]
    v2 = client.post("/embed", json={"text": "A cat was sitting on a mat."}).json()["embedding"]
    v3 = client.post("/embed", json={"text": "Quantum mechanics describes subatomic particles."}).json()["embedding"]

    def cosine(a, b):
        a, b = np.array(a), np.array(b)
        return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))

    sim_related = cosine(v1, v2)
    sim_unrelated = cosine(v1, v3)
    assert sim_related > sim_unrelated


def test_vector_add_and_query_scoped_by_user():
    client.post("/vectors/add", json={
        "id": "chunk-1", "text": "Photosynthesis converts sunlight into chemical energy.",
        "user_id": 1, "document_id": 100,
    })
    client.post("/vectors/add", json={
        "id": "chunk-2", "text": "The French Revolution began in 1789.",
        "user_id": 1, "document_id": 101,
    })
    client.post("/vectors/add", json={
        "id": "chunk-3", "text": "Photosynthesis also produces oxygen as a byproduct.",
        "user_id": 2, "document_id": 200,
    })

    resp = client.post("/vectors/query", json={
        "text": "How do plants make energy from light?", "user_id": 1, "n_results": 5,
    })
    assert resp.status_code == 200
    matches = resp.json()["matches"]
    ids_returned = []
    for match in matches:
        ids_returned.append(match["id"])
    # Only user 1's chunks should ever be returned
    assert "chunk-3" not in ids_returned
    # The photosynthesis chunk should be the top (most similar) match
    assert matches[0]["id"] == "chunk-1"


def test_vectors_delete_by_document_id():
    client.post("/vectors/add", json={
        "id": "chunk-del-1", "text": "Temporary chunk to be deleted.",
        "user_id": 5, "document_id": 900,
    })
    del_resp = client.post("/vectors/delete", json={"document_id": 900})
    assert del_resp.status_code == 200

    query_resp = client.post("/vectors/query", json={
        "text": "Temporary chunk to be deleted.", "user_id": 5, "n_results": 5,
    })
    ids_returned = []
    for match in query_resp.json()["matches"]:
        ids_returned.append(match["id"])
    assert "chunk-del-1" not in ids_returned


def test_vector_query_scoped_to_specific_document_ids():
    client.post("/vectors/add", json={
        "id": "scope-chunk-1", "text": "Notes about the water cycle.",
        "user_id": 9, "document_id": 501,
    })
    client.post("/vectors/add", json={
        "id": "scope-chunk-2", "text": "Notes about the water cycle, part two.",
        "user_id": 9, "document_id": 502,
    })

    resp = client.post("/vectors/query", json={
        "text": "water cycle", "user_id": 9, "n_results": 5, "document_ids": [501],
    })
    assert resp.status_code == 200
    ids_returned = []
    for match in resp.json()["matches"]:
        ids_returned.append(match["id"])
    assert ids_returned == ["scope-chunk-1"]
