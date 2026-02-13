"""Memory and context management for Tehuti agentic system.

This module provides:
- Vector-based semantic memory
- Conversation summarization
- Context compression for long conversations
"""

from __future__ import annotations

import json
import os
import hashlib
import math
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any


@dataclass
class MemoryEntry:
    """A single memory entry."""

    content: str
    timestamp: datetime = field(default_factory=datetime.now)
    importance: float = 1.0
    category: str = "general"
    metadata: dict[str, Any] = field(default_factory=dict)
    embedding: list[float] | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "content": self.content,
            "timestamp": self.timestamp.isoformat(),
            "importance": self.importance,
            "category": self.category,
            "metadata": self.metadata,
            "embedding": self.embedding,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> MemoryEntry:
        """Create from dictionary."""
        return cls(
            content=data["content"],
            timestamp=datetime.fromisoformat(data["timestamp"]),
            importance=data.get("importance", 1.0),
            category=data.get("category", "general"),
            metadata=data.get("metadata", {}),
            embedding=data.get("embedding"),
        )


class SimpleEmbedder:
    """Simple embedding generator using sentence-transformers if available."""

    def __init__(self):
        self.model = None
        self._vocabulary: dict[str, int] = {}
        self._tried_load = False
        self._enable_model = os.getenv("TEHUTI_MEMORY_MODEL", "").strip().lower() in {"1", "true", "yes"}

    def _try_load_model(self) -> None:
        """Try to load the embedding model."""
        self._tried_load = True
        if not self._enable_model:
            return
        try:
            from sentence_transformers import SentenceTransformer

            self.model = SentenceTransformer("all-MiniLM-L6-v2")
        except Exception:
            pass

    def embed(self, text: str) -> list[float]:
        """Generate embedding for text.

        Falls back to TF-IDF style embedding if model not available.
        """
        if self.model is None and not self._tried_load:
            self._try_load_model()
        if self.model is not None:
            embedding = self.model.encode(text)
            return embedding.tolist()

        # Fallback: TF-IDF style word-based embedding
        return self._tfidf_embedding(text)

    def _tfidf_embedding(self, text: str) -> list[float]:
        """Generate a TF-IDF style embedding based on word frequencies.

        This provides better semantic similarity than character-based approach.
        """
        import re
        from collections import Counter

        # Extract words
        words = re.findall(r"\b[a-zA-Z]{2,}\b", text.lower())

        if not words:
            return [0.0] * 64

        # Build vocabulary from this text
        word_counts = Counter(words)
        unique_words = list(word_counts.keys())

        # Create 64-dimensional embedding
        embedding = [0.0] * 64

        # Use hash-based distribution with word importance weighting
        for word, count in word_counts.items():
            # Deterministic hash for stable embeddings across processes/runs.
            digest = hashlib.blake2b(word.encode("utf-8"), digest_size=8).digest()
            word_hash = int.from_bytes(digest, "big", signed=False)
            idx1 = word_hash % 64
            idx2 = (word_hash >> 6) % 64

            # Weight by frequency
            weight = count / len(words)

            # Distribute weight
            embedding[idx1] += weight * 0.7
            embedding[idx2] += weight * 0.3

            # Add semantic signal from word length (longer words = more specific)
            length_factor = min(len(word) / 10, 1.0)
            embedding[idx1] += length_factor * 0.1
            embedding[idx2] += length_factor * 0.1

        # Normalize
        norm = math.sqrt(sum((x * x) for x in embedding))
        if norm > 0:
            embedding = [x / norm for x in embedding]

        return embedding

    def similarity(self, embedding1: list[float], embedding2: list[float]) -> float:
        """Calculate cosine similarity between two embeddings."""
        if not embedding1 or not embedding2:
            return 0.0
        size = min(len(embedding1), len(embedding2))
        if size == 0:
            return 0.0

        vec1 = embedding1[:size]
        vec2 = embedding2[:size]
        norm1 = math.sqrt(sum((x * x) for x in vec1))
        norm2 = math.sqrt(sum((x * x) for x in vec2))

        if norm1 == 0 or norm2 == 0:
            return 0.0

        dot = sum((a * b) for a, b in zip(vec1, vec2))
        return float(dot / (norm1 * norm2))


class AgentMemory:
    """Semantic memory system for the agent."""

    SENSITIVE_CATEGORIES = {"secret", "credential", "credentials", "token", "password", "pii"}

    def __init__(
        self,
        storage_path: Path | None = None,
        *,
        max_entries: int | None = None,
        privacy_mode: str = "persistent",
    ):
        self.entries: list[MemoryEntry] = []
        self.embedder = SimpleEmbedder()
        self.storage_path = storage_path
        self.max_entries = max_entries if max_entries is None else max(1, int(max_entries))
        mode = str(privacy_mode or "persistent").strip().lower()
        self.privacy_mode = mode if mode in {"persistent", "ephemeral", "redact_sensitive"} else "persistent"

        if storage_path and self.privacy_mode != "ephemeral":
            self._load()

    def add(
        self,
        content: str,
        category: str = "general",
        importance: float = 1.0,
        metadata: dict[str, Any] | None = None,
    ) -> MemoryEntry:
        """Add a new memory entry.

        Args:
            content: The content to remember
            category: Category for organization
            importance: Importance score (0-1)
            metadata: Additional metadata

        Returns:
            The created MemoryEntry
        """
        normalized_category = str(category or "general").strip().lower()
        stored_content = content
        entry_metadata = dict(metadata or {})
        if self.privacy_mode == "redact_sensitive" and normalized_category in self.SENSITIVE_CATEGORIES:
            stored_content = "[REDACTED_SENSITIVE_MEMORY]"
            entry_metadata["redacted"] = True
            entry_metadata["redaction_reason"] = "sensitive_category"

        # In redact-sensitive mode, avoid embedding raw sensitive content.
        embedding = self.embedder.embed(stored_content)

        entry = MemoryEntry(
            content=stored_content,
            category=normalized_category,
            importance=importance,
            metadata=entry_metadata,
            embedding=embedding,
        )

        self.entries.append(entry)
        if self.max_entries is not None and len(self.entries) > self.max_entries:
            self.entries = self.entries[-self.max_entries :]

        # Auto-save if storage path is set
        if self.storage_path and self.privacy_mode != "ephemeral":
            self._save()

        return entry

    def search(
        self,
        query: str,
        top_k: int = 5,
        category: str | None = None,
        min_importance: float = 0.0,
    ) -> list[tuple[MemoryEntry, float]]:
        """Search for relevant memories.

        Args:
            query: Search query
            top_k: Number of results to return
            category: Filter by category
            min_importance: Minimum importance score

        Returns:
            List of (entry, score) tuples sorted by relevance
        """
        query_embedding = self.embedder.embed(query)

        scored_entries = []
        for entry in self.entries:
            # Filter by category
            if category and entry.category != category:
                continue

            # Filter by importance
            if entry.importance < min_importance:
                continue

            # Calculate similarity
            if entry.embedding:
                score = self.embedder.similarity(query_embedding, entry.embedding)
                # Boost by importance
                score *= entry.importance
                scored_entries.append((entry, score))

        # Sort by score descending
        scored_entries.sort(key=lambda x: x[1], reverse=True)

        return scored_entries[:top_k]

    def search_fused(
        self,
        query: str,
        top_k: int = 5,
        category: str | None = None,
        min_importance: float = 0.0,
    ) -> list[tuple[MemoryEntry, float]]:
        """Deterministic retrieval fusion over semantic and lexical signals."""
        semantic = self.search(query, top_k=max(top_k * 3, 10), category=category, min_importance=min_importance)
        query_terms = {t for t in query.lower().split() if t}
        scored: list[tuple[int, MemoryEntry, float]] = []
        for idx, (entry, semantic_score) in enumerate(semantic):
            entry_terms = {t for t in entry.content.lower().split() if t}
            lexical = 0.0
            if query_terms and entry_terms:
                lexical = len(query_terms & entry_terms) / max(1, len(query_terms | entry_terms))
            fused = ((0.7 * float(semantic_score)) + (0.3 * float(lexical))) * max(0.0, float(entry.importance))
            scored.append((idx, entry, fused))
        scored.sort(key=lambda item: (-item[2], item[0]))
        return [(entry, score) for _, entry, score in scored[:top_k]]

    def get_by_category(self, category: str) -> list[MemoryEntry]:
        """Get all memories in a category."""
        return [e for e in self.entries if e.category == category]

    def summarize_category(self, category: str, max_length: int = 500) -> str:
        """Generate a summary of memories in a category."""
        entries = self.get_by_category(category)

        if not entries:
            return f"No memories in category '{category}'"

        # Sort by importance and recency
        entries.sort(key=lambda e: (e.importance, e.timestamp), reverse=True)

        # Build summary
        lines = [f"Summary of {len(entries)} memories in '{category}':\n"]

        current_length = len(lines[0])
        for entry in entries[:20]:  # Limit to top 20
            line = f"- {entry.content[:100]}{'...' if len(entry.content) > 100 else ''}\n"
            if current_length + len(line) > max_length:
                lines.append("...")
                break
            lines.append(line)
            current_length += len(line)

        return "".join(lines)

    def clear_category(self, category: str) -> int:
        """Clear all memories in a category. Returns count removed."""
        original_count = len(self.entries)
        self.entries = [e for e in self.entries if e.category != category]
        removed = original_count - len(self.entries)

        if self.storage_path and self.privacy_mode != "ephemeral":
            self._save()

        return removed

    def _save(self) -> None:
        """Save memories to disk."""
        if not self.storage_path:
            return

        self.storage_path.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "entries": [e.to_dict() for e in self.entries],
        }
        self.storage_path.write_text(json.dumps(data, indent=2))

    def _load(self) -> None:
        """Load memories from disk."""
        if not self.storage_path or not self.storage_path.exists():
            return

        try:
            data = json.loads(self.storage_path.read_text())
            self.entries = [MemoryEntry.from_dict(e) for e in data.get("entries", [])]
        except Exception:
            pass


class ConversationSummarizer:
    """Summarizes long conversations for context management."""

    def __init__(self, llm_client: Any | None = None):
        self.llm = llm_client

    def summarize_turns(self, turns: list[dict[str, Any]], max_length: int = 1000) -> str:
        """Summarize a list of conversation turns.

        Args:
            turns: List of turn dicts with 'role' and 'content'
            max_length: Maximum length of summary

        Returns:
            Summary text
        """
        if not turns:
            return ""

        # Simple extractive summarization
        summary_parts = []
        current_length = 0

        for turn in turns:
            role = turn.get("role", "user")
            content = turn.get("content", "")

            # Truncate long content
            if len(content) > 200:
                content = content[:197] + "..."

            part = f"{role}: {content}\n"

            if current_length + len(part) > max_length:
                summary_parts.append("... [truncated]")
                break

            summary_parts.append(part)
            current_length += len(part)

        return "".join(summary_parts)

    def extract_key_facts(self, text: str) -> list[str]:
        """Extract key facts from text.

        This is a simple implementation that looks for important sentences.
        A full implementation would use the LLM to extract facts.
        """
        # Simple heuristics
        facts = []
        sentences = text.replace("!", ".").replace("?", ".").split(".")

        for sentence in sentences:
            sentence = sentence.strip()

            # Look for important indicators
            indicators = [
                "is",
                "are",
                "was",
                "were",
                "has",
                "have",
                "should",
                "must",
                "need",
                "important",
                "key",
            ]

            if any(f" {ind} " in sentence.lower() for ind in indicators):
                if len(sentence) > 20 and len(sentence) < 200:
                    facts.append(sentence)

        return facts[:10]  # Return top 10 facts

    def compress_context(
        self,
        messages: list[dict[str, str]],
        max_messages: int = 10,
    ) -> list[dict[str, str]]:
        """Compress a long context to fit within message limits.

        Args:
            messages: Full conversation history
            max_messages: Maximum number of messages to keep

        Returns:
            Compressed message list
        """
        if len(messages) <= max_messages:
            return messages

        # Always keep system message
        system_messages = [m for m in messages if m.get("role") == "system"]
        other_messages = [m for m in messages if m.get("role") != "system"]

        if len(other_messages) <= max_messages - len(system_messages):
            return messages

        # Keep first message (usually context)
        first_message = other_messages[:1] if other_messages else []

        # Keep most recent messages
        recent_count = max_messages - len(system_messages) - len(first_message)
        recent_messages = other_messages[-recent_count:]

        # Summarize middle messages if there are any
        middle_start = len(first_message)
        middle_end = len(other_messages) - recent_count

        if middle_end > middle_start:
            middle_messages = other_messages[middle_start:middle_end]
            summary = self.summarize_turns(middle_messages, max_length=500)

            if summary:
                summary_message = {"role": "system", "content": f"[Earlier conversation summary]:\n{summary}"}
                return system_messages + first_message + [summary_message] + recent_messages

        return system_messages + first_message + recent_messages


class ContextManager:
    """Manages conversation context with memory integration."""

    def __init__(
        self,
        memory: AgentMemory | None = None,
        summarizer: ConversationSummarizer | None = None,
        max_context_length: int = 10,
    ):
        self.memory = memory or AgentMemory()
        self.summarizer = summarizer or ConversationSummarizer()
        self.max_context_length = max_context_length
        self.current_context: list[dict[str, str]] = []

    def add_message(self, role: str, content: str) -> None:
        """Add a message to the current context."""
        self.current_context.append({"role": role, "content": content})

        # Compress if needed
        if len(self.current_context) > self.max_context_length:
            self.current_context = self.summarizer.compress_context(self.current_context, self.max_context_length)

    def get_context(self) -> list[dict[str, str]]:
        """Get the current context, enriched with relevant memories."""
        # Get the most recent user message
        user_messages = [m for m in self.current_context if m.get("role") == "user"]

        if user_messages:
            latest_query = user_messages[-1].get("content", "")
            relevant_memories = self.memory.search_fused(latest_query, top_k=3)

            if relevant_memories:
                # Add memory context as system message
                memory_content = "Relevant context from memory:\n"
                for entry, score in relevant_memories:
                    memory_content += f"- {entry.content}\n"

                # Insert after system messages
                enriched = []
                for msg in self.current_context:
                    enriched.append(msg)
                    if msg.get("role") == "system" and not any(
                        m.get("content", "").startswith("Relevant context") for m in enriched[:-1]
                    ):
                        enriched.append({"role": "system", "content": memory_content})

                return enriched

        return self.current_context

    def remember_interaction(
        self,
        user_input: str,
        agent_response: str,
        importance: float = 1.0,
    ) -> None:
        """Store an interaction in memory."""
        content = f"User asked: {user_input}\nAgent responded: {agent_response}"
        self.memory.add(
            content=content,
            category="conversation",
            importance=importance,
        )

    def clear_context(self) -> None:
        """Clear the current context but keep memories."""
        # Store important facts before clearing
        for msg in self.current_context:
            if msg.get("role") == "assistant":
                facts = self.summarizer.extract_key_facts(msg.get("content", ""))
                for fact in facts:
                    self.memory.add(
                        content=fact,
                        category="fact",
                        importance=0.8,
                    )

        self.current_context = []
