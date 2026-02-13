from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

import tomlkit

from tehuti_cli.constants import PROGRESS_VERBOSITY_VALUES
from tehuti_cli.storage.paths import config_file, get_tehuti_home

ProviderType = Literal["openrouter", "openai", "gemini"]
ExecutionMode = Literal["standard", "autonomous", "dominant"]
InteractionMode = Literal["auto", "chat", "plan", "act"]
ApprovalMode = Literal["auto", "smart", "manual", "chat_only"]
ProgressVerbosity = Literal["minimal", "standard", "verbose"]
AccessPolicy = Literal["full", "restricted"]
ParserMode = Literal["strict", "repair", "fallback"]


@dataclass
class ProviderConfig:
    type: ProviderType = "openrouter"
    base_url: str = "https://openrouter.ai/api/v1"
    api_key_env: str = "OPENROUTER_API_KEY"
    model: str = "qwen/qwen3-coder:free"


@dataclass
class ProviderCatalog:
    openrouter: ProviderConfig = field(default_factory=ProviderConfig)
    openai: ProviderConfig = field(
        default_factory=lambda: ProviderConfig(
            type="openai",
            base_url="https://api.openai.com/v1",
            api_key_env="OPENAI_API_KEY",
            model="",
        )
    )
    gemini: ProviderConfig = field(
        default_factory=lambda: ProviderConfig(
            type="gemini",
            base_url="https://generativelanguage.googleapis.com/v1beta",
            api_key_env="GEMINI_API_KEY",
            model="",
        )
    )


@dataclass
class OpenRouterRouting:
    provider_order: list[str] = field(default_factory=list)


@dataclass
class Config:
    provider: ProviderConfig = field(default_factory=ProviderConfig)
    providers: ProviderCatalog = field(default_factory=ProviderCatalog)
    openrouter: OpenRouterRouting = field(default_factory=OpenRouterRouting)
    keys_file: Path = field(default_factory=lambda: get_tehuti_home() / "keys.env")
    default_yolo: bool = True
    allow_shell: bool = True
    allow_write: bool = True
    allow_external: bool = True
    allowed_paths: list[str] = field(default_factory=list)
    web_allow_domains: list[str] = field(default_factory=list)
    web_deny_domains: list[str] = field(default_factory=list)
    allow_tools: list[str] = field(default_factory=list)
    deny_tools: list[str] = field(default_factory=list)
    external_tools_file: Path = field(default_factory=lambda: get_tehuti_home() / "tools.json")
    favorite_models: list[str] = field(default_factory=list)
    mcp_file: Path = field(default_factory=lambda: get_tehuti_home() / "mcp.json")
    skills_file: Path = field(default_factory=lambda: get_tehuti_home() / "skills.json")
    experimental_flags: list[str] = field(default_factory=list)
    show_history: bool = False
    show_actions: bool = True
    progress_verbosity: ProgressVerbosity = "standard"
    tool_output_limit: int = 0
    log_dir: Path = field(default_factory=lambda: get_tehuti_home() / "logs")
    execution_mode: ExecutionMode = "dominant"
    interaction_mode: InteractionMode = "auto"
    approval_mode: ApprovalMode = "auto"
    session_autoresume: bool = False
    access_policy: AccessPolicy = "full"
    agent_parser_mode: ParserMode = "repair"
    require_tool_evidence: bool = True
    retry_backoff_base_seconds: float = 1.0
    retry_backoff_cap_seconds: float = 4.0
    loop_stuck_backoff_base_seconds: float = 1.0
    loop_stuck_backoff_cap_seconds: float = 4.0


CONFIG_DIR = get_tehuti_home()
CONFIG_FILE = config_file()


def _normalize_openrouter_model(model: str) -> str:
    """Preserve explicit free-tier default model when legacy value is present."""
    if model == "qwen/qwen3-coder":
        return "qwen/qwen3-coder:free"
    return model


def _cohere_model_fields(config: Config) -> None:
    provider_model = str(config.provider.model or "")
    openrouter_model = str(config.providers.openrouter.model or "")
    if config.provider.type == "openrouter":
        provider_model = _normalize_openrouter_model(provider_model)
    openrouter_model = _normalize_openrouter_model(openrouter_model)
    if config.provider.type == "openrouter" and not provider_model and openrouter_model:
        provider_model = openrouter_model
    if not openrouter_model and provider_model:
        openrouter_model = provider_model
    config.provider.model = provider_model
    config.providers.openrouter.model = openrouter_model


def _path_is_writable(path: Path, is_dir: bool = False) -> bool:
    target_dir = path if is_dir else path.parent
    try:
        target_dir.mkdir(parents=True, exist_ok=True)
        probe = target_dir / ".write_probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
        return True
    except Exception:
        return False


def _cohere_path_fields(config: Config) -> None:
    home = get_tehuti_home()
    defaults = {
        "keys_file": home / "keys.env",
        "external_tools_file": home / "tools.json",
        "mcp_file": home / "mcp.json",
        "skills_file": home / "skills.json",
        "log_dir": home / "logs",
    }
    for field_name, fallback in defaults.items():
        current = getattr(config, field_name, fallback)
        current = Path(str(current)).expanduser()
        is_dir = field_name == "log_dir"
        if not _path_is_writable(current, is_dir=is_dir):
            current = fallback
            current.parent.mkdir(parents=True, exist_ok=True)
        setattr(config, field_name, current)


def _cohere_access_policy(config: Config) -> None:
    policy = str(getattr(config, "access_policy", "full") or "full").strip().lower()
    if policy not in {"full", "restricted"}:
        policy = "full"
    config.access_policy = policy  # type: ignore[assignment]
    if policy == "full":
        config.default_yolo = True
        config.allow_shell = True
        config.allow_write = True
        config.allow_external = True
        config.approval_mode = "auto"
        config.allowed_paths = []
        config.allow_tools = []
        config.deny_tools = []
        config.web_allow_domains = []
        config.web_deny_domains = []


def default_config() -> Config:
    return Config()


def load_config(path: Path | None = None) -> Config:
    cfg_path = path or CONFIG_FILE
    if not cfg_path.exists():
        return default_config()

    doc = tomlkit.parse(cfg_path.read_text(encoding="utf-8"))

    provider_doc = doc.get("provider", {})
    providers_doc = doc.get("providers", {})
    openrouter_doc = doc.get("openrouter", {})
    keys_file = Path(doc.get("keys_file", str(get_tehuti_home() / "keys.env")))
    access_policy = str(doc.get("access_policy", "full")).strip().lower()
    if access_policy not in {"full", "restricted"}:
        access_policy = "full"
    default_yolo = bool(doc.get("default_yolo", access_policy == "full"))
    allow_shell = bool(doc.get("allow_shell", True))
    allow_write = bool(doc.get("allow_write", True))
    allow_external = bool(doc.get("allow_external", True))
    allowed_paths = list(doc.get("allowed_paths", []))
    web_allow_domains = list(doc.get("web_allow_domains", []))
    web_deny_domains = list(doc.get("web_deny_domains", []))
    allow_tools = list(doc.get("allow_tools", []))
    deny_tools = list(doc.get("deny_tools", []))
    external_tools_file = Path(
        doc.get("external_tools_file", str(get_tehuti_home() / "tools.json"))
    )
    favorite_models = list(doc.get("favorite_models", []))
    mcp_file = Path(doc.get("mcp_file", str(get_tehuti_home() / "mcp.json")))
    skills_file = Path(
        doc.get("skills_file", str(get_tehuti_home() / "skills.json"))
    )
    experimental_flags = list(doc.get("experimental_flags", []))
    show_history = bool(doc.get("show_history", False))
    show_actions = bool(doc.get("show_actions", True))
    progress_verbosity = str(doc.get("progress_verbosity", "standard")).lower()
    if progress_verbosity not in PROGRESS_VERBOSITY_VALUES:
        progress_verbosity = "standard"
    tool_output_limit = int(doc.get("tool_output_limit", 0))
    log_dir = Path(doc.get("log_dir", str(get_tehuti_home() / "logs")))
    execution_mode = str(doc.get("execution_mode", "dominant"))
    if execution_mode not in {"standard", "autonomous", "dominant"}:
        execution_mode = "dominant"
    interaction_mode = str(doc.get("interaction_mode", "auto"))
    if interaction_mode not in {"auto", "chat", "plan", "act"}:
        interaction_mode = "auto"
    approval_mode = str(doc.get("approval_mode", "auto"))
    if approval_mode not in {"auto", "smart", "manual", "chat_only"}:
        approval_mode = "auto"
    session_autoresume = bool(doc.get("session_autoresume", False))
    agent_parser_mode = str(doc.get("agent_parser_mode", "repair")).strip().lower()
    if agent_parser_mode not in {"strict", "repair", "fallback"}:
        agent_parser_mode = "repair"
    require_tool_evidence = bool(doc.get("require_tool_evidence", True))
    retry_backoff_base_seconds = max(0.1, float(doc.get("retry_backoff_base_seconds", 1.0)))
    retry_backoff_cap_seconds = max(retry_backoff_base_seconds, float(doc.get("retry_backoff_cap_seconds", 4.0)))
    loop_stuck_backoff_base_seconds = max(0.1, float(doc.get("loop_stuck_backoff_base_seconds", 1.0)))
    loop_stuck_backoff_cap_seconds = max(
        loop_stuck_backoff_base_seconds,
        float(doc.get("loop_stuck_backoff_cap_seconds", 4.0)),
    )

    provider = ProviderConfig(
        type=provider_doc.get("type", "openrouter"),
        base_url=provider_doc.get("base_url", "https://openrouter.ai/api/v1"),
        api_key_env=provider_doc.get("api_key_env", "OPENROUTER_API_KEY"),
        model=provider_doc.get("model", "qwen/qwen3-coder:free"),
    )
    providers = ProviderCatalog(
        openrouter=ProviderConfig(
            type="openrouter",
            base_url=providers_doc.get("openrouter", {}).get(
                "base_url", "https://openrouter.ai/api/v1"
            ),
            api_key_env=providers_doc.get("openrouter", {}).get(
                "api_key_env", "OPENROUTER_API_KEY"
            ),
            model=providers_doc.get("openrouter", {}).get(
                "model", "qwen/qwen3-coder:free"
            ),
        ),
        openai=ProviderConfig(
            type="openai",
            base_url=providers_doc.get("openai", {}).get(
                "base_url", "https://api.openai.com/v1"
            ),
            api_key_env=providers_doc.get("openai", {}).get(
                "api_key_env", "OPENAI_API_KEY"
            ),
            model=providers_doc.get("openai", {}).get("model", ""),
        ),
        gemini=ProviderConfig(
            type="gemini",
            base_url=providers_doc.get("gemini", {}).get(
                "base_url", "https://generativelanguage.googleapis.com/v1beta"
            ),
            api_key_env=providers_doc.get("gemini", {}).get(
                "api_key_env", "GEMINI_API_KEY"
            ),
            model=providers_doc.get("gemini", {}).get("model", ""),
        ),
    )
    if providers.openrouter.model.startswith("/"):
        providers.openrouter.model = provider.model
    openrouter = OpenRouterRouting(
        provider_order=[
            p
            for p in list(openrouter_doc.get("provider_order", []))
            if isinstance(p, str) and p and not p.startswith("/")
        ],
    )
    config = Config(
        provider=provider,
        providers=providers,
        openrouter=openrouter,
        keys_file=keys_file,
        default_yolo=default_yolo,
        allow_shell=allow_shell,
        allow_write=allow_write,
        allow_external=allow_external,
        allowed_paths=allowed_paths,
        web_allow_domains=web_allow_domains,
        web_deny_domains=web_deny_domains,
        allow_tools=allow_tools,
        deny_tools=deny_tools,
        external_tools_file=external_tools_file,
        favorite_models=favorite_models,
        mcp_file=mcp_file,
        skills_file=skills_file,
        experimental_flags=experimental_flags,
        show_history=show_history,
        show_actions=show_actions,
        progress_verbosity=progress_verbosity,  # type: ignore[arg-type]
        tool_output_limit=tool_output_limit,
        log_dir=log_dir,
        execution_mode=execution_mode,  # type: ignore[arg-type]
        interaction_mode=interaction_mode,  # type: ignore[arg-type]
        approval_mode=approval_mode,  # type: ignore[arg-type]
        session_autoresume=session_autoresume,
        access_policy=access_policy,  # type: ignore[arg-type]
        agent_parser_mode=agent_parser_mode,  # type: ignore[arg-type]
        require_tool_evidence=require_tool_evidence,
        retry_backoff_base_seconds=retry_backoff_base_seconds,
        retry_backoff_cap_seconds=retry_backoff_cap_seconds,
        loop_stuck_backoff_base_seconds=loop_stuck_backoff_base_seconds,
        loop_stuck_backoff_cap_seconds=loop_stuck_backoff_cap_seconds,
    )
    _cohere_model_fields(config)
    _cohere_path_fields(config)
    _cohere_access_policy(config)
    return config


def save_config(config: Config, path: Path | None = None) -> None:
    _cohere_model_fields(config)
    _cohere_path_fields(config)
    _cohere_access_policy(config)
    cfg_path = path or CONFIG_FILE
    cfg_path.parent.mkdir(parents=True, exist_ok=True)

    doc = tomlkit.document()
    doc.add(
        "provider",
        {
            "type": config.provider.type,
            "base_url": config.provider.base_url,
            "api_key_env": config.provider.api_key_env,
            "model": config.provider.model,
        },
    )
    doc.add(
        "providers",
        {
            "openrouter": {
                "base_url": config.providers.openrouter.base_url,
                "api_key_env": config.providers.openrouter.api_key_env,
                "model": config.providers.openrouter.model,
            },
            "openai": {
                "base_url": config.providers.openai.base_url,
                "api_key_env": config.providers.openai.api_key_env,
                "model": config.providers.openai.model,
            },
            "gemini": {
                "base_url": config.providers.gemini.base_url,
                "api_key_env": config.providers.gemini.api_key_env,
                "model": config.providers.gemini.model,
            },
        },
    )
    doc.add(
        "openrouter",
        {
            "provider_order": list(config.openrouter.provider_order),
        },
    )
    doc.add("keys_file", str(config.keys_file))
    doc.add("default_yolo", bool(config.default_yolo))
    doc.add("allow_shell", bool(config.allow_shell))
    doc.add("allow_write", bool(config.allow_write))
    doc.add("allow_external", bool(config.allow_external))
    doc.add("allowed_paths", list(config.allowed_paths))
    doc.add("web_allow_domains", list(config.web_allow_domains))
    doc.add("web_deny_domains", list(config.web_deny_domains))
    doc.add("allow_tools", list(config.allow_tools))
    doc.add("deny_tools", list(config.deny_tools))
    doc.add("external_tools_file", str(config.external_tools_file))
    doc.add("favorite_models", list(config.favorite_models))
    doc.add("mcp_file", str(config.mcp_file))
    doc.add("skills_file", str(config.skills_file))
    doc.add("experimental_flags", list(config.experimental_flags))
    doc.add("show_history", bool(config.show_history))
    doc.add("show_actions", bool(config.show_actions))
    doc.add("progress_verbosity", str(config.progress_verbosity))
    doc.add("tool_output_limit", int(config.tool_output_limit))
    doc.add("log_dir", str(config.log_dir))
    doc.add("execution_mode", str(config.execution_mode))
    doc.add("interaction_mode", str(config.interaction_mode))
    doc.add("approval_mode", str(config.approval_mode))
    doc.add("session_autoresume", bool(config.session_autoresume))
    doc.add("access_policy", str(config.access_policy))
    doc.add("agent_parser_mode", str(config.agent_parser_mode))
    doc.add("require_tool_evidence", bool(config.require_tool_evidence))
    doc.add("retry_backoff_base_seconds", float(config.retry_backoff_base_seconds))
    doc.add("retry_backoff_cap_seconds", float(config.retry_backoff_cap_seconds))
    doc.add("loop_stuck_backoff_base_seconds", float(config.loop_stuck_backoff_base_seconds))
    doc.add("loop_stuck_backoff_cap_seconds", float(config.loop_stuck_backoff_cap_seconds))

    cfg_path.write_text(tomlkit.dumps(doc), encoding="utf-8")
