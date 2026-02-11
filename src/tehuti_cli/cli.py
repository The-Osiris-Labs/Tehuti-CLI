from __future__ import annotations

from pathlib import Path
from typing import Annotated

import sys
import typer

from tehuti_cli.core.app import TehutiApp
from tehuti_cli.storage.session import load_last_session


cli = typer.Typer(
    help="Project Tehuti: Thoth (Tehuti), Architect of Truth.",
    add_completion=False,
    context_settings={"help_option_names": ["-h", "--help"]},
)


@cli.callback(invoke_without_command=True)
def main(
    ctx: typer.Context,
    config_file: Annotated[
        Path | None,
        typer.Option(
            "--config-file",
            exists=True,
            file_okay=True,
            dir_okay=False,
            readable=True,
            help="Config TOML file to load. Default: ~/.tehuti/config.toml.",
        ),
    ] = None,
    model: Annotated[
        str | None,
        typer.Option(
            "--model",
            "-m",
            help="Model to use. Overrides config.",
        ),
    ] = None,
    prompt: Annotated[
        str | None,
        typer.Option(
            "--prompt",
            "-p",
            help="Run a single prompt and exit (print mode).",
        ),
    ] = None,
    banner: Annotated[
        bool,
        typer.Option(
            "--banner",
            help="Show the animated banner on startup.",
        ),
    ] = False,
    print_mode: Annotated[
        bool,
        typer.Option(
            "--print",
            help="Run in print mode (non-interactive).",
        ),
    ] = False,
    resume: Annotated[
        bool,
        typer.Option(
            "--resume",
            help="Resume the last session for this working directory.",
        ),
    ] = False,
    session_id: Annotated[
        str | None,
        typer.Option(
            "--session-id",
            help="Resume a specific session by ID.",
        ),
    ] = None,
):
    if ctx.invoked_subcommand is not None:
        return

    app = TehutiApp.create(config_file=config_file, model=model)

    if prompt is not None:
        raise typer.Exit(code=app.run_print(prompt))
    if print_mode:
        stdin_text = sys.stdin.read()
        if not stdin_text.strip():
            raise typer.Exit(code=0)
        raise typer.Exit(code=app.run_print(stdin_text))

    work_dir = Path.cwd()
    raise typer.Exit(code=app.run_shell(work_dir, show_banner=banner, resume=resume, session_id=session_id))


@cli.command()
def resume(session_id: str | None = typer.Option(None, help="Specific session ID (optional)")) -> None:
    """Resume a previous Tehuti session."""
    app = TehutiApp.create()
    work_dir = Path.cwd()
    if session_id is None:
        last = load_last_session(work_dir)
        if not last:
            raise typer.Exit(code=app.run_shell(work_dir, show_banner=False, resume=False))
        raise typer.Exit(code=app.run_shell(work_dir, show_banner=False, resume=True))
    raise typer.Exit(code=app.run_shell(work_dir, show_banner=False, session_id=session_id))


@cli.command()
def web(
    host: str = typer.Option("127.0.0.1", help="Host to bind"),
    port: int = typer.Option(5494, help="Port to bind"),
) -> None:
    """Run the Tehuti web UI."""
    from tehuti_cli.web.app import create_app
    import uvicorn

    uvicorn.run(create_app(), host=host, port=port)


@cli.command()
def wire() -> None:
    """Run a minimal wire server over stdio (JSON lines)."""
    import json

    app = TehutiApp.create()
    llm = app.config
    from tehuti_cli.providers.llm import TehutiLLM

    client = TehutiLLM(llm)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            print(json.dumps({"error": "invalid_json"}))
            continue
        prompt = str(payload.get("prompt", ""))
        if not prompt:
            print(json.dumps({"error": "missing_prompt"}))
            continue
        try:
            response = client.chat_messages([{"role": "user", "content": prompt}])
            print(json.dumps({"response": response}))
        except Exception as exc:
            print(json.dumps({"error": str(exc)}))


@cli.command()
def acp() -> None:
    """Run a minimal ACP-compatible stdio server (alias of wire)."""
    wire()


@cli.command(name="tools")
def check_tools() -> None:
    """Check availability of external tools."""
    import sys

    sys.path.insert(0, "src")
    from tehuti_cli.tool_availability import ToolAvailability

    print(ToolAvailability.format_status())


@cli.command(name="doctor")
def doctor() -> None:
    """Run diagnostics and check system health."""
    import sys

    sys.path.insert(0, "src")
    from tehuti_cli.storage.config import load_config
    from tehuti_cli.core.tools import ToolRegistry
    from tehuti_cli.tool_availability import ToolAvailability

    print("Tehuti System Diagnostics")
    print("=" * 50)
    print()

    # Check config
    try:
        config = load_config()
        print(f"✓ Configuration loaded")
        print(f"  Provider: {config.provider.type}")
        print(f"  Model: {config.provider.model}")
        print(f"  YOLO mode: {config.default_yolo}")
    except Exception as e:
        print(f"✗ Configuration error: {e}")

    print()

    # Check tool registry
    try:
        registry = ToolRegistry(config)
        tools = registry.list_tools()
        print(f"✓ Tool registry: {len(tools)} tools registered")
    except Exception as e:
        print(f"✗ Tool registry error: {e}")

    print()

    # Check external tools
    print(ToolAvailability.format_status())

    print()
    print("=" * 50)
    print("Diagnostics complete")


if __name__ == "__main__":
    raise SystemExit(cli())
