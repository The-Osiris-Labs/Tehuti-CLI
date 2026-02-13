from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from tehuti_cli.ui.interactive import ChatMessage, ChatShell, ChatState


class _FakeSession:
    def __init__(self, items: list[dict[str, str]]):
        self._items = items
        self.id = "s-1"
        self.context_file = Path("/tmp/unused-context.jsonl")

    def iter_context(self):
        return list(self._items)


class _RecordingSession:
    def __init__(self):
        self.writes: list[tuple[str, str]] = []
        self.context_file = Path("/tmp/unused-context.jsonl")

    def append_context(self, role: str, content: str) -> None:
        self.writes.append((role, content))


def _shell_stub(tmp_path: Path) -> ChatShell:
    shell = ChatShell.__new__(ChatShell)
    shell.work_dir = tmp_path
    shell.console = SimpleNamespace(print=lambda *_args, **_kwargs: None)
    shell.state = ChatState(working_dir=tmp_path)
    return shell


def test_load_session_rehydrates_message_history(monkeypatch, tmp_path: Path) -> None:
    shell = _shell_stub(tmp_path)

    monkeypatch.setattr(
        "tehuti_cli.ui.interactive.load_session",
        lambda _session_id, _work_dir: _FakeSession(
            [
                {"role": "user", "content": "hello"},
                {"role": "assistant", "content": "world"},
            ]
        ),
    )

    shell._load_session("s-1")

    assert shell.state.session_id == "s-1"
    assert [m.role for m in shell.state.messages] == ["user", "assistant"]
    assert [m.content for m in shell.state.messages] == ["hello", "world"]


def test_save_session_state_rebuilds_context(monkeypatch, tmp_path: Path) -> None:
    shell = _shell_stub(tmp_path)
    shell.state.session_id = "s-1"
    shell.state.messages = [
        ChatMessage(role="user", content="hello"),
        ChatMessage(role="assistant", content="world"),
    ]

    recording = _RecordingSession()
    monkeypatch.setattr("tehuti_cli.ui.interactive.load_session", lambda _sid, _wd: recording)

    writes: list[tuple[str, str]] = []
    monkeypatch.setattr(
        Path,
        "write_text",
        lambda self, text, encoding=None: writes.append((str(self), text)),
    )

    shell._save_session_state()

    assert recording.writes == [("user", "hello"), ("assistant", "world")]
    assert writes and writes[0][1] == ""
