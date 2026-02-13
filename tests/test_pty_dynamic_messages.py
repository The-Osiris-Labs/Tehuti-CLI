from __future__ import annotations

from tehuti_cli.core.pty import PtyManager
from tehuti_cli.core.pty import PtySession


def test_pty_send_and_close_messages_are_dynamic() -> None:
    manager = PtyManager()
    session_id = "test-session"

    class _Child:
        exitstatus = 0
        signalstatus = None

        def sendline(self, _text: str) -> None:
            return None

        def close(self, force: bool = True) -> None:
            return None

    manager.sessions[session_id] = PtySession(child=_Child())  # type: ignore[arg-type]

    ok, send_msg = manager.send(session_id, "hello")
    assert ok is True
    assert session_id in send_msg
    assert "chars" in send_msg

    ok, close_msg = manager.close(session_id)
    assert ok is True
    assert close_msg.startswith(f"Closed session {session_id}")
