"""Tehuti Theme Configuration - Egyptian Hieroglyphic Symbols

This module provides customizable Egyptian-themed symbols for the Tehuti CLI.
All symbols are authentic Egyptian hieroglyphs or themed ASCII alternatives.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional


@dataclass
class TehutiTheme:
    """A complete Egyptian theme configuration."""

    # Core identity symbols
    ibis: str = "𓅞"  # Thoth's sacred ibis
    ankh: str = "𓋹"  # Symbol of life
    scroll: str = "𓏲"  # Papyrus scroll
    eye_of_horus: str = "𓁹"  # Protection/sight
    feather_of_ma_at: str = "𓆄"  # Truth/balance
    was_scepter: str = "𓃾"  # Power
    scarab: str = "𓃭"  # Rebirth/transformation
    lotus: str = "𓆼"  # Creation
    pyramid: str = "𓏊"  # Structure/permanence
    sun_disk: str = "𓇯"  # Ra/sun

    # Action states
    thinking: str = "𓅞"
    planning: str = "𓏲"
    completed: str = "𓋹"
    error: str = "𓃻"
    waiting: str = "𓃜"

    # File operations (Writing/Recording)
    read: str = "𓏞"
    write: str = "𓏠"
    edit: str = "𓏛"
    search: str = "𓁹"
    list_files: str = "𓃊"

    # Execution (Power/Command)
    execute: str = "𓃾"
    run: str = "𓃍"
    build: str = "𓏔"
    test: str = "𓏏"

    # Communication (Connection)
    fetch: str = "𓁹"
    send: str = "𓂁"
    receive: str = "𓂀"

    # Version Control (History/Chronicles)
    history: str = "𓂅"
    branch: str = "𓂇"
    merge: str = "𓂈"
    commit: str = "𓂉"

    # Container/Package
    container: str = "𓃍"
    package: str = "𓃎"

    # Database (Storage)
    storage: str = "𓏘"
    cache: str = "𓏚"

    # Vision/Sight
    vision: str = "𓁹"
    capture: str = "𓁻"

    # Time/Progress
    time: str = "𓏎"
    progress: str = "𓃜"


# Pre-defined theme variants
THEMES = {
    "hieroglyphic": TehutiTheme(),  # Full Unicode hieroglyphs
    "minimal": TehutiTheme(  # Simplified ASCII
        ibis="[T]",
        ankh="[+]",
        scroll="[S]",
        eye_of_horus="[O]",
        feather_of_ma_at="[F]",
        was_scepter="[P]",
        scarab="[B]",
        lotus="[L]",
        pyramid="[A]",
        sun_disk="[R]",
        thinking="[?]",
        planning="[!]",
        completed="[+]",
        error="[X]",
        waiting="[~]",
        read="[R]",
        write="[W]",
        edit="[E]",
        search="[F]",
        list_files="[L]",
        execute="[X]",
        run="[>]",
        build="[B]",
        test="[T]",
        fetch="[G]",
        send="[S]",
        receive="[R]",
        history="[H]",
        branch="[B]",
        merge="[M]",
        commit="[C]",
        container="[D]",
        package="[P]",
        storage="[D]",
        cache="[C]",
        vision="[V]",
        capture="[C]",
        time="[T]",
        progress="[~]",
    ),
    "arrows": TehutiTheme(  # Arrow-based
        thinking="->",
        planning="=>",
        completed="->",
        error="!!",
        waiting="~~",
        read="<-",
        write="->",
        edit="<>",
        search="?",
        execute="$",
        run=">>",
        fetch="<-",
        history="<",
    ),
    "brackets": TehutiTheme(  # Bracket notation
        thinking="[THO]",
        planning="[PLN]",
        completed="[DONE]",
        error="[ERR]",
        waiting="[WAIT]",
        read="[READ]",
        write="[WRITE]",
        edit="[EDIT]",
        search="[FIND]",
        execute="[EXEC]",
        run="[RUN]",
        fetch="[GET]",
        history="[HIST]",
    ),
}


def get_theme(name: str = "hieroglyphic") -> TehutiTheme:
    """Get a theme by name."""
    return THEMES.get(name, THEMES["hieroglyphic"])


def get_symbol(tool: str, theme_name: str = "hieroglyphic") -> str:
    """Get the appropriate symbol for a tool."""
    theme = get_theme(theme_name)

    # Map tools to theme attributes
    symbol_map = {
        # Core
        "thinking": theme.thinking,
        "planning": theme.planning,
        "completed": theme.completed,
        "error": theme.error,
        "waiting": theme.waiting,
        # File operations
        "read": theme.read,
        "write": theme.write,
        "edit": theme.edit,
        "glob": theme.search,
        "grep": theme.search,
        "find": theme.search,
        "ls": theme.list_files,
        "cat": theme.read,
        "head": theme.read,
        "tail": theme.read,
        # Shell & execution
        "shell": theme.execute,
        "host_discovery": theme.search,
        "execute": theme.execute,
        "run": theme.run,
        # Docker
        "docker_ps": theme.container,
        "docker_run": theme.run,
        "docker_build": theme.build,
        "docker_exec": theme.execute,
        # Build & test
        "make": theme.build,
        "cmake": theme.build,
        "pytest": theme.test,
        "jest": theme.test,
        "unittest": theme.test,
        # Git
        "git_status": theme.search,
        "git_log": theme.history,
        "git_diff": theme.edit,
        "git_branch": theme.branch,
        "git_push": theme.send,
        "git_pull": theme.receive,
        "git_clone": theme.receive,
        "gh": theme.history,
        # Web
        "fetch": theme.fetch,
        "web_search": theme.search,
        "web_fetch": theme.fetch,
        "api_get": theme.receive,
        "api_post": theme.send,
        # Database
        "psql": theme.storage,
        "mysql": theme.storage,
        "redis_cli": theme.cache,
        # Vision
        "image_analyze": theme.vision,
        "image_ocr": theme.vision,
        "image_screenshot": theme.capture,
        # Browser
        "browser_navigate": theme.run,
        "browser_click": theme.execute,
        "browser_screenshot": theme.capture,
        # Time
        "time": theme.time,
        "progress": theme.progress,
    }

    return symbol_map.get(tool, theme.ankh)
