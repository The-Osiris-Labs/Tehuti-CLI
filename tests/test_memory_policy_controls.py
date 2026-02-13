from __future__ import annotations

from pathlib import Path

from tehuti_cli.core.memory import AgentMemory, ContextManager


def test_memory_retention_max_entries_enforced() -> None:
    memory = AgentMemory(max_entries=3)
    memory.add("one", category="general")
    memory.add("two", category="general")
    memory.add("three", category="general")
    memory.add("four", category="general")

    assert [entry.content for entry in memory.entries] == ["two", "three", "four"]


def test_memory_ephemeral_mode_does_not_persist(tmp_path: Path) -> None:
    storage = tmp_path / "memory.json"
    memory = AgentMemory(storage_path=storage, privacy_mode="ephemeral")
    memory.add("ephemeral item", category="general")

    assert storage.exists() is False


def test_memory_redact_sensitive_category() -> None:
    memory = AgentMemory(privacy_mode="redact_sensitive")
    entry = memory.add("api_key=supersecret", category="secret")

    assert entry.content == "[REDACTED_SENSITIVE_MEMORY]"
    assert entry.metadata.get("redacted") is True
    assert entry.metadata.get("redaction_reason") == "sensitive_category"


def test_memory_redact_sensitive_uses_redacted_embedding_input() -> None:
    memory = AgentMemory(privacy_mode="redact_sensitive")
    entry = memory.add("api_key=supersecret", category="secret")
    expected = memory.embedder.embed("[REDACTED_SENSITIVE_MEMORY]")
    assert entry.embedding == expected


def test_memory_fused_retrieval_is_deterministic() -> None:
    memory = AgentMemory()
    memory.add("rollback drill for release promotion and migration", category="ops")
    memory.add("semantic retrieval fusion and deterministic ranking", category="memory")
    memory.add("contract parity for wire and web envelope", category="contracts")

    query = "deterministic retrieval fusion"
    first = memory.search_fused(query, top_k=2)
    second = memory.search_fused(query, top_k=2)

    assert [item[0].content for item in first] == [item[0].content for item in second]


def test_context_manager_uses_fused_retrieval_tier() -> None:
    memory = AgentMemory()
    memory.add("context packing and semantic retrieval fusion", category="memory")
    memory.add("alpha beta ga canary policy", category="release")

    manager = ContextManager(memory=memory, max_context_length=6)
    manager.add_message("system", "System baseline")
    manager.add_message("user", "Show me retrieval fusion details")
    enriched = manager.get_context()

    memory_system_messages = [msg for msg in enriched if msg.get("role") == "system" and "Relevant context" in msg.get("content", "")]
    assert len(memory_system_messages) == 1
