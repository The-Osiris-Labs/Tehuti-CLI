from __future__ import annotations

from pathlib import Path

from tehuti_cli.core.memory import AgentMemory, SimpleEmbedder


def test_tfidf_embedding_is_deterministic_for_same_text() -> None:
    embedder = SimpleEmbedder()
    text = "Tehuti capability baseline with deterministic semantic embedding."
    e1 = embedder.embed(text)
    e2 = embedder.embed(text)
    assert e1 == e2


def test_memory_search_top_result_is_deterministic() -> None:
    memory = AgentMemory()
    memory.add("contract parity for wire and web envelope stability", category="conversation")
    memory.add("database migration notes and rollback drills", category="conversation")
    memory.add("protocol timeout and retry policy for mcp transport", category="conversation")

    q = "wire web contract parity"
    r1 = memory.search(q, top_k=2)
    r2 = memory.search(q, top_k=2)

    assert len(r1) == 2
    assert len(r2) == 2
    assert r1[0][0].content == r2[0][0].content
    assert r1[0][1] == r2[0][1]


def test_memory_search_is_stable_after_persist_reload(tmp_path: Path) -> None:
    storage = tmp_path / "memory.json"
    memory = AgentMemory(storage_path=storage)
    memory.add("session diagnostics and correlation ids for incident triage", category="conversation")
    memory.add("feature branch notes", category="conversation")

    before = memory.search("incident correlation ids", top_k=1)
    reloaded = AgentMemory(storage_path=storage)
    after = reloaded.search("incident correlation ids", top_k=1)

    assert before
    assert after
    assert before[0][0].content == after[0][0].content
