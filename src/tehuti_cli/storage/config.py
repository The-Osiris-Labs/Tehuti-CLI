from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

import tomlkit

ProviderType = Literal["openrouter", "openai", "gemini"]
ExecutionMode = Literal["standard", "autonomous", "dominant"]


@dataclass
class ProviderConfig:
    type: ProviderType = "openrouter"
    base_url: str = "https://openrouter.ai/api/v1"
    api_key_env: str = "OPENROUTER_API_KEY"
    model: str = "mistralai/devstral-2512:free"


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
    keys_file: Path = Path.home() / ".tehuti" / "keys.env"
    default_yolo: bool = True
    allow_shell: bool = True
    allow_write: bool = True
    allow_external: bool = True
    allowed_paths: list[str] = field(default_factory=list)
    web_allow_domains: list[str] = field(default_factory=list)
    web_deny_domains: list[str] = field(default_factory=list)
    allow_tools: list[str] = field(default_factory=list)
    deny_tools: list[str] = field(default_factory=list)
    external_tools_file: Path = Path.home() / ".tehuti" / "tools.json"
    favorite_models: list[str] = field(default_factory=list)
    mcp_file: Path = Path.home() / ".tehuti" / "mcp.json"
    skills_file: Path = Path.home() / ".tehuti" / "skills.json"
    experimental_flags: list[str] = field(default_factory=list)
    show_history: bool = False
    show_actions: bool = True
    tool_output_limit: int = 0
    log_dir: Path = Path.home() / ".tehuti" / "logs"
    execution_mode: ExecutionMode = "autonomous"


CONFIG_DIR = Path.home() / ".tehuti"
CONFIG_FILE = CONFIG_DIR / "config.toml"


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
    keys_file = Path(doc.get("keys_file", str(Path.home() / ".tehuti" / "keys.env")))
    default_yolo = True
    allow_shell = bool(doc.get("allow_shell", True))
    allow_write = bool(doc.get("allow_write", True))
    allow_external = bool(doc.get("allow_external", True))
    allowed_paths = list(doc.get("allowed_paths", []))
    web_allow_domains = list(doc.get("web_allow_domains", []))
    web_deny_domains = list(doc.get("web_deny_domains", []))
    allow_tools = list(doc.get("allow_tools", []))
    deny_tools = list(doc.get("deny_tools", []))
    external_tools_file = Path(doc.get("external_tools_file", str(Path.home() / ".tehuti" / "tools.json")))
    favorite_models = list(doc.get("favorite_models", []))
    mcp_file = Path(doc.get("mcp_file", str(Path.home() / ".tehuti" / "mcp.json")))
    skills_file = Path(doc.get("skills_file", str(Path.home() / ".tehuti" / "skills.json")))
    experimental_flags = list(doc.get("experimental_flags", []))
    show_history = bool(doc.get("show_history", False))
    show_actions = bool(doc.get("show_actions", True))
    tool_output_limit = int(doc.get("tool_output_limit", 0))
    log_dir = Path(doc.get("log_dir", str(Path.home() / ".tehuti" / "logs")))
    execution_mode = str(doc.get("execution_mode", "autonomous"))
    if execution_mode not in {"standard", "autonomous", "dominant"}:
        execution_mode = "autonomous"

    provider = ProviderConfig(
        type=provider_doc.get("type", "openrouter"),
        base_url=provider_doc.get("base_url", "https://openrouter.ai/api/v1"),
        api_key_env=provider_doc.get("api_key_env", "OPENROUTER_API_KEY"),
        model=provider_doc.get("model", "mistralai/devstral-2512:free"),
    )
    if provider.model.startswith("/"):
        provider.model = "mistralai/devstral-2512"
    providers = ProviderCatalog(
        openrouter=ProviderConfig(
            type="openrouter",
            base_url=providers_doc.get("openrouter", {}).get(
                "base_url", "https://openrouter.ai/api/v1"
            ),
            api_key_env=providers_doc.get("openrouter", {}).get("api_key_env", "OPENROUTER_API_KEY"),
            model=providers_doc.get("openrouter", {}).get("model", "mistralai/devstral-2512:free"),
        ),
        openai=ProviderConfig(
            type="openai",
            base_url=providers_doc.get("openai", {}).get("base_url", "https://api.openai.com/v1"),
            api_key_env=providers_doc.get("openai", {}).get("api_key_env", "OPENAI_API_KEY"),
            model=providers_doc.get("openai", {}).get("model", ""),
        ),
        gemini=ProviderConfig(
            type="gemini",
            base_url=providers_doc.get("gemini", {}).get(
                "base_url", "https://generativelanguage.googleapis.com/v1beta"
            ),
            api_key_env=providers_doc.get("gemini", {}).get("api_key_env", "GEMINI_API_KEY"),
            model=providers_doc.get("gemini", {}).get("model", ""),
        ),
    )
    if providers.openrouter.model.startswith("/"):
        providers.openrouter.model = provider.model
    openrouter = OpenRouterRouting(
        provider_order=[
            p for p in list(openrouter_doc.get("provider_order", []))
            if isinstance(p, str) and p and not p.startswith("/")
        ],
    )
    return Config(
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
        tool_output_limit=tool_output_limit,
        log_dir=log_dir,
        execution_mode=execution_mode,  # type: ignore[arg-type]
    )


def save_config(config: Config, path: Path | None = None) -> None:
    cfg_path = path or CONFIG_FILE
    cfg_path.parent.mkdir(parents=True, exist_ok=True)

    doc = tomlkit.document()
    doc.add("provider", {
        "type": config.provider.type,
        "base_url": config.provider.base_url,
        "api_key_env": config.provider.api_key_env,
        "model": config.provider.model,
    })
    doc.add("providers", {
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
    })
    doc.add("openrouter", {
        "provider_order": list(config.openrouter.provider_order),
    })
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
    doc.add("tool_output_limit", int(config.tool_output_limit))
    doc.add("log_dir", str(config.log_dir))
    doc.add("execution_mode", str(config.execution_mode))

    cfg_path.write_text(tomlkit.dumps(doc), encoding="utf-8")
