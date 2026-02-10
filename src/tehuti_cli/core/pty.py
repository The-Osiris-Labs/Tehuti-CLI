from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Dict

import pexpect


@dataclass
class PtySession:
    child: pexpect.spawn


class PtyManager:
    def __init__(self) -> None:
        self.sessions: Dict[str, PtySession] = {}

    def spawn(self, command: str):
        if not command:
            return False, "Missing command"
        session_id = str(uuid.uuid4())
        child = pexpect.spawn(command, encoding="utf-8", timeout=5)
        self.sessions[session_id] = PtySession(child=child)
        return True, session_id

    def send(self, session_id: str, input_text: str):
        session = self.sessions.get(session_id)
        if not session:
            return False, "Unknown session_id"
        try:
            session.child.sendline(input_text)
            return True, "OK"
        except Exception as exc:
            return False, str(exc)

    def read(self, session_id: str):
        session = self.sessions.get(session_id)
        if not session:
            return False, "Unknown session_id"
        try:
            output = session.child.read_nonblocking(size=4096, timeout=1)
            return True, output
        except pexpect.TIMEOUT:
            return True, ""
        except Exception as exc:
            return False, str(exc)

    def close(self, session_id: str):
        session = self.sessions.pop(session_id, None)
        if not session:
            return False, "Unknown session_id"
        try:
            session.child.close(force=True)
            return True, "Closed"
        except Exception as exc:
            return False, str(exc)
