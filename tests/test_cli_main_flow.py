from __future__ import annotations

from typer.testing import CliRunner

from tehuti_cli.cli import cli


runner = CliRunner()


def test_main_shell_exit_does_not_emit_internal_error_payload(monkeypatch) -> None:
    class _App:
        def run_shell(self, *_args, **_kwargs):
            return 0

    monkeypatch.setattr("tehuti_cli.cli.TehutiApp.create", lambda **_kwargs: _App())

    result = runner.invoke(cli, [])
    assert result.exit_code == 0
    assert "unclassified_error" not in result.stdout
