"""Tool result caching for Tehuti.

Provides caching for expensive tool operations to improve performance.
"""

import hashlib
import json
import os
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, Any, Dict
from dataclasses import dataclass, asdict


@dataclass
class CacheEntry:
    """A cached tool result."""

    key: str
    result: Dict[str, Any]
    created: str
    expires: Optional[str]
    ttl_seconds: int
    tool_name: str
    args_hash: str

    def is_expired(self) -> bool:
        """Check if the cache entry has expired."""
        if self.expires is None:
            return False
        try:
            expire_time = datetime.fromisoformat(self.expires)
            return datetime.now() > expire_time
        except (ValueError, TypeError):
            return True


class ToolCache:
    """Cache manager for tool results.

    Features:
    - Configurable TTL per tool
    - Automatic expiration
    - Cache invalidation
    - Statistics tracking
    """

    DEFAULT_TTL = 3600  # 1 hour

    TOOL_TTL = {
        "read": 3600,  # File contents - cache for 1 hour
        "shell": 0,  # Don't cache shell commands
        "web_fetch": 300,  # Web content - cache for 5 minutes
        "web_search": 600,  # Search results - cache for 10 minutes
        "git_log": 300,  # Git log - cache for 5 minutes
        "git_status": 60,  # Git status - cache for 1 minute
        "docker_ps": 60,  # Docker containers - cache for 1 minute
        "docker_images": 120,  # Docker images - cache for 2 minutes
        "psql": 0,  # Don't cache database queries
        "mysql": 0,  # Don't cache database queries
        "redis_cli": 0,  # Don't cache Redis queries
        "pytest": 0,  # Don't cache test results
        "cargo_test": 0,  # Don't cache test results
        "go_test": 0,  # Don't cache test results
        "kubectl": 30,  # Kubernetes - cache for 30 seconds
        "terraform": 0,  # Don't cache terraform output
    }

    def __init__(self, cache_dir: str = "~/.tehuti/cache"):
        """Initialize the cache manager.

        Args:
            cache_dir: Directory for cache files
        """
        self.cache_dir = Path(cache_dir).expanduser()
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self._stats = {
            "hits": 0,
            "misses": 0,
            "sets": 0,
            "expired": 0,
            "invalidated": 0,
        }

    def _get_cache_path(self, key: str) -> Path:
        """Get the file path for a cache entry."""
        # Create subdirectory based on first character of key
        subdir = self.cache_dir / key[0]
        subdir.mkdir(parents=True, exist_ok=True)
        return subdir / f"{key}.json"

    def _compute_key(self, tool_name: str, args: Dict[str, Any]) -> str:
        """Compute a unique cache key for tool call.

        Args:
            tool_name: Name of the tool
            args: Tool arguments

        Returns:
            Unique cache key string
        """
        # Sort args for consistent hashing
        sorted_args = json.dumps(args, sort_keys=True, default=str)
        args_hash = hashlib.md5(sorted_args.encode()).hexdigest()[:16]

        # Create key
        return f"{tool_name}:{args_hash}"

    def _compute_args_hash(self, args: Dict[str, Any]) -> str:
        """Compute hash of tool arguments.

        Args:
            args: Tool arguments

        Returns:
            MD5 hash string
        """
        sorted_args = json.dumps(args, sort_keys=True, default=str)
        return hashlib.md5(sorted_args.encode()).hexdigest()

    def get(self, tool_name: str, args: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Get a cached result for a tool call.

        Args:
            tool_name: Name of the tool
            args: Tool arguments

        Returns:
            Cached result dict or None if not found/expired
        """
        key = self._compute_key(tool_name, args)
        cache_path = self._get_cache_path(key)

        if not cache_path.exists():
            self._stats["misses"] += 1
            return None

        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            entry = CacheEntry(**data)

            # Check expiration
            if entry.is_expired():
                self._stats["expired"] += 1
                cache_path.unlink()
                return None

            self._stats["hits"] += 1
            return entry.result

        except (json.JSONDecodeError, KeyError, TypeError):
            self._stats["misses"] += 1
            return None

    def set(
        self,
        tool_name: str,
        args: Dict[str, Any],
        result: Dict[str, Any],
        ttl_seconds: Optional[int] = None,
    ) -> bool:
        """Cache a tool result.

        Args:
            tool_name: Name of the tool
            args: Tool arguments
            result: Result to cache
            ttl_seconds: Time-to-live in seconds (overrides default)

        Returns:
            True if cached successfully
        """
        # Check if this tool should be cached
        if self.TOOL_TTL.get(tool_name, self.DEFAULT_TTL) == 0:
            return False

        # Get TTL
        if ttl_seconds is None:
            ttl_seconds = self.TOOL_TTL.get(tool_name, self.DEFAULT_TTL)

        # Compute key
        key = self._compute_key(tool_name, args)
        args_hash = self._compute_args_hash(args)

        # Compute expiration
        expires = None
        if ttl_seconds > 0:
            expire_time = datetime.now() + timedelta(seconds=ttl_seconds)
            expires = expire_time.isoformat()

        # Create entry
        entry = CacheEntry(
            key=key,
            result=result,
            created=datetime.now().isoformat(),
            expires=expires,
            ttl_seconds=ttl_seconds,
            tool_name=tool_name,
            args_hash=args_hash,
        )

        # Save to file
        cache_path = self._get_cache_path(key)
        try:
            with open(cache_path, "w", encoding="utf-8") as f:
                json.dump(asdict(entry), f, indent=2)
            self._stats["sets"] += 1
            return True
        except Exception:
            return False

    def invalidate(self, tool_name: Optional[str] = None) -> int:
        """Invalidate cached entries.

        Args:
            tool_name: Optional tool name to invalidate (None = all)

        Returns:
            Number of entries invalidated
        """
        count = 0

        for cache_file in self.cache_dir.rglob("*.json"):
            try:
                with open(cache_file, "r", encoding="utf-8") as f:
                    data = json.load(f)

                entry = CacheEntry(**data)

                # Check if this entry matches the tool filter
                if tool_name is None or entry.tool_name == tool_name:
                    cache_file.unlink()
                    count += 1

            except (json.JSONDecodeError, KeyError, TypeError):
                # Invalid cache file, remove it
                try:
                    cache_file.unlink()
                    count += 1
                except Exception:
                    pass

        self._stats["invalidated"] += count
        return count

    def cleanup_expired(self) -> int:
        """Remove all expired cache entries.

        Returns:
            Number of entries removed
        """
        count = 0

        for cache_file in self.cache_dir.rglob("*.json"):
            try:
                with open(cache_file, "r", encoding="utf-8") as f:
                    data = json.load(f)

                entry = CacheEntry(**data)

                if entry.is_expired():
                    cache_file.unlink()
                    count += 1

            except (json.JSONDecodeError, KeyError, TypeError):
                pass

        self._stats["expired"] += count
        return count

    def get_stats(self) -> Dict[str, Any]:
        """Get cache statistics.

        Returns:
            Dict with hit rate, counts, etc.
        """
        total = self._stats["hits"] + self._stats["misses"]
        hit_rate = (self._stats["hits"] / total * 100) if total > 0 else 0

        return {
            "hits": self._stats["hits"],
            "misses": self._stats["misses"],
            "sets": self._stats["sets"],
            "expired": self._stats["expired"],
            "invalidated": self._stats["invalidated"],
            "total_requests": total,
            "hit_rate_percent": round(hit_rate, 2),
        }

    def clear_stats(self) -> None:
        """Reset cache statistics."""
        self._stats = {
            "hits": 0,
            "misses": 0,
            "sets": 0,
            "expired": 0,
            "invalidated": 0,
        }

    def get_size(self) -> Dict[str, int]:
        """Get cache size information.

        Returns:
            Dict with file count and total size in bytes
        """
        file_count = 0
        total_size = 0

        for cache_file in self.cache_dir.rglob("*.json"):
            file_count += 1
            total_size += cache_file.stat().st_size

        return {
            "files": file_count,
            "bytes": total_size,
            "human": f"{total_size / 1024:.1f} KB",
        }

    def clear_all(self) -> int:
        """Clear all cached entries.

        Returns:
            Number of entries removed
        """
        count = 0
        for cache_file in self.cache_dir.rglob("*.json"):
            try:
                cache_file.unlink()
                count += 1
            except Exception:
                pass
        return count


def get_cache() -> ToolCache:
    """Get the global ToolCache instance.

    Returns:
        Configured ToolCache instance
    """
    return ToolCache()


class CachedToolSuite:
    """Wrapper for tool execution with caching."""

    def __init__(self, cache: Optional[ToolCache] = None):
        """Initialize cached tool suite.

        Args:
            cache: Optional cache instance
        """
        self.cache = cache or ToolCache()

    def cached_execute(
        self,
        tool_name: str,
        args: Dict[str, Any],
        executor: callable,
        ttl_seconds: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Execute a tool with caching.

        Args:
            tool_name: Name of the tool
            args: Tool arguments
            executor: Function to execute the tool
            ttl_seconds: Optional TTL override

        Returns:
            Tool result (from cache or executor)
        """
        # Try to get from cache
        cached = self.cache.get(tool_name, args)
        if cached is not None:
            cached["_cached"] = True
            return cached

        # Execute and cache result
        result = executor()
        if result.get("ok", False):
            self.cache.set(tool_name, args, result, ttl_seconds)
        result["_cached"] = False
        return result


def create_cache_manager(cache_dir: str = "~/.tehuti/cache") -> ToolCache:
    """Factory function to create a ToolCache.

    Args:
        cache_dir: Directory for cache files

    Returns:
        Configured ToolCache instance
    """
    return ToolCache(cache_dir)
