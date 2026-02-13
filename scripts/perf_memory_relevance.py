#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from tehuti_cli.core.memory import AgentMemory


def main() -> int:
    memory = AgentMemory()
    documents = [
        ("python_asyncio", "python asyncio event loop coroutines await task scheduling"),
        ("docker_networking", "docker bridge network container ports compose service discovery"),
        ("git_rebase", "git interactive rebase squash fixup commit history branch"),
        ("postgres_index", "postgres btree index query planner analyze vacuum sequential scan"),
        ("mcp_contract", "mcp protocol server tool discovery json schema typed error"),
        ("a2a_streaming", "a2a protocol sse stream task status lifecycle cancel"),
        ("ci_quality_gate", "ci quality gate contract parity migration rollback perf smoke"),
        ("linux_permissions", "linux file permissions chmod chown sudo root access"),
        ("http_retry", "http retry backoff timeout transient status code 429"),
        ("memory_retrieval", "semantic memory retrieval relevance embedding ranking context"),
    ]
    for key, text in documents:
        memory.add(text, category="knowledge", importance=1.0, metadata={"id": key})

    queries = [
        ("async coroutines event loop", "python_asyncio"),
        ("container bridge ports", "docker_networking"),
        ("squash commits branch history", "git_rebase"),
        ("query planner btree", "postgres_index"),
        ("typed protocol tool schema", "mcp_contract"),
        ("sse cancel task lifecycle", "a2a_streaming"),
        ("migration rollback parity", "ci_quality_gate"),
        ("chmod sudo root ownership", "linux_permissions"),
        ("transient timeout backoff", "http_retry"),
        ("embedding ranking relevance", "memory_retrieval"),
    ]

    hits_top1 = 0
    hits_top3 = 0
    for query, expected in queries:
        results = memory.search(query, top_k=3, category="knowledge")
        ids = [str(entry.metadata.get("id", "")) for entry, _score in results]
        if ids and ids[0] == expected:
            hits_top1 += 1
        if expected in ids:
            hits_top3 += 1

    recall_top1 = hits_top1 / len(queries)
    recall_top3 = hits_top3 / len(queries)
    print(f"[perf-memory] recall@1={recall_top1:.2f} recall@3={recall_top3:.2f}")

    # Deterministic baseline for local fallback embeddings; catch major retrieval regressions.
    if recall_top1 < 0.50:
        raise RuntimeError(f"memory relevance regression: recall@1 {recall_top1:.2f} < 0.50")
    if recall_top3 < 0.80:
        raise RuntimeError(f"memory relevance regression: recall@3 {recall_top3:.2f} < 0.80")

    print("[perf-memory] PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
