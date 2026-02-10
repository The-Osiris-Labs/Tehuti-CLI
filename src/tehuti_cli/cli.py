from __future__ import annotations

from pathlib import Path
from typing import Annotated

import sys
import typer

from tehuti_cli.core.app import TehutiApp


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
    raise typer.Exit(code=app.run_shell(work_dir, show_banner=banner))


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


if __name__ == "__main__":
    raise SystemExit(cli())
