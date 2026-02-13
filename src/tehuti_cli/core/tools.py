from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from tehuti_cli.storage.config import Config

RiskClass = Literal["low", "medium", "high", "critical"]
IdempotencyClass = Literal["safe_read", "idempotent_write", "mutating_write", "system_exec"]
ApprovalPolicy = Literal["auto", "manual", "never"]
RetryPolicy = Literal["never", "transient", "always"]


@dataclass
class ToolSpec:
    name: str
    description: str
    kind: str  # "builtin" or "external"
    command: str | None = None
    risk_class: RiskClass = "medium"
    idempotency: IdempotencyClass = "system_exec"
    approval_policy: ApprovalPolicy = "auto"
    latency_budget_ms: int = 30000
    retry_policy: RetryPolicy = "transient"
    max_retries: int = 1


class ToolRegistry:
    def __init__(self, config: Config):
        self.config = config
        self._tools: dict[str, ToolSpec] = {}
        self._load_builtin()
        self._load_external()
        self._finalize_tool_metadata()

    def _finalize_tool_metadata(self) -> None:
        for spec in self._tools.values():
            spec.risk_class = self._infer_risk_class(spec)
            spec.idempotency = self._infer_idempotency(spec)
            spec.approval_policy = self._infer_approval_policy(spec)
            spec.latency_budget_ms = self._infer_latency_budget_ms(spec)
            spec.retry_policy = self._infer_retry_policy(spec)
            spec.max_retries = self._infer_max_retries(spec)

    def _infer_idempotency(self, spec: ToolSpec) -> IdempotencyClass:
        name = spec.name
        read_only_tools = {
            "read",
            "fetch",
            "web_search",
            "web_fetch",
            "git_status",
            "git_log",
            "git_branch",
            "git_diff",
            "docker_ps",
            "docker_images",
            "docker_logs",
            "host_discovery",
            "ls",
            "find",
            "grep",
            "glob",
            "web_fetch_render",
            "web_scrape",
            "api_get",
            "extract_text",
            "extract_links",
            "extract_images",
            "check_website_status",
            "search_ddg",
            "search_github",
            "search_npm",
            "search_pypi",
            "search_dockerhub",
            "file_tail",
            "file_watch",
            "mcp_list_servers",
            "mcp_list_tools",
            "mcp_list_resources",
            "mcp_list_prompts",
            "mcp_get_prompt",
            "context_load",
            "context_summary",
            "context_sections",
            "context_rules",
            "context_personas",
            "task_get",
            "task_schedulable",
            "task_blocked",
            "task_stats",
            "blueprint_get",
            "blueprint_list",
            "automation_get",
            "automation_list",
            "automation_stats",
            "delegate_list",
            "delegate_get",
            "delegate_tree",
            "tool_list",
            "tool_validate",
            "tool_template",
        }
        if name in read_only_tools or name.startswith("context_"):
            return "safe_read"
        if name in {"write", "edit"} or name.startswith("stream_") or name.startswith("tool_") or name.startswith("automation_"):
            return "mutating_write"
        if name in {"task_create", "task_update", "task_add_dep", "blueprint_create", "blueprint_add_section"}:
            return "idempotent_write"
        return "system_exec"

    def _infer_risk_class(self, spec: ToolSpec) -> RiskClass:
        name = spec.name
        if spec.kind == "external":
            return "high"
        critical = {
            "rm",
            "shutdown",
            "reboot",
            "halt",
            "mkfs",
            "dd",
            "userdel",
            "groupdel",
            "fdisk",
            "parted",
            "iptables",
            "firewall-cmd",
            "ufw",
            "terraform",
            "kubectl",
            "systemctl",
            "service",
            "chown",
        }
        high = {
            "write",
            "edit",
            "shell",
            "docker_run",
            "docker_exec",
            "docker_build",
            "git_push",
            "git_pull",
            "git_clone",
            "ssh",
            "apt_install",
            "pip_install",
            "npm_install",
            "automation_create",
            "automation_add_action",
            "automation_add_trigger",
            "delegate_create",
            "delegate_cancel",
            "tool_create_shell",
            "tool_create_python",
            "tool_create_api",
            "tool_delete",
            "tool_edit",
            "tool_import",
            "tool_clone",
        }
        medium = {
            "fetch",
            "web_fetch",
            "web_fetch_render",
            "api_get",
            "api_post",
            "api_graphql",
            "mcp_connect",
            "mcp_call_tool",
            "mcp_read_resource",
            "mcp_disconnect",
            "browser_navigate",
            "browser_click",
            "browser_fill",
            "browser_type",
            "browser_press",
            "browser_download",
            "browser_evaluate",
        }
        if name in critical:
            return "critical"
        if name in high or name.startswith("stream_"):
            return "high"
        if name in medium:
            return "medium"
        return "low"

    def _infer_approval_policy(self, spec: ToolSpec) -> ApprovalPolicy:
        if spec.risk_class in {"high", "critical"}:
            return "manual"
        return "auto"

    def _infer_latency_budget_ms(self, spec: ToolSpec) -> int:
        name = spec.name
        if name.startswith("stream_") or name in {"browser_pdf", "docker_build", "terraform", "kubectl", "pytest", "go_test", "cargo_test"}:
            return 120000
        if name in {"web_fetch_render", "browser_navigate", "browser_screenshot", "api_post", "api_graphql", "mcp_call_tool"}:
            return 60000
        return 30000

    def _infer_retry_policy(self, spec: ToolSpec) -> RetryPolicy:
        if spec.idempotency == "mutating_write" or spec.risk_class in {"high", "critical"}:
            return "never"
        if spec.idempotency == "safe_read":
            return "transient"
        return "transient"

    def _infer_max_retries(self, spec: ToolSpec) -> int:
        if spec.retry_policy == "never":
            return 0
        if spec.idempotency == "safe_read":
            return 2
        return 1

    def _load_builtin(self) -> None:
        # Core tools
        self._tools["read"] = ToolSpec("read", "Read a file from disk", "builtin")
        self._tools["write"] = ToolSpec("write", "Write a file to disk", "builtin")
        self._tools["edit"] = ToolSpec("edit", "Edit a file by replacing old_string with new_string", "builtin")
        self._tools["shell"] = ToolSpec("shell", "Run a shell command", "builtin")
        self._tools["fetch"] = ToolSpec("fetch", "Fetch a URL over HTTP", "builtin")
        self._tools["host_discovery"] = ToolSpec(
            "host_discovery",
            "Run read-only host discovery commands and produce a findings report",
            "builtin",
        )
        self._tools["pty.spawn"] = ToolSpec("pty.spawn", "Spawn interactive PTY session", "builtin")
        self._tools["pty.send"] = ToolSpec("pty.send", "Send input to PTY session", "builtin")
        self._tools["pty.read"] = ToolSpec("pty.read", "Read output from PTY session", "builtin")
        self._tools["pty.close"] = ToolSpec("pty.close", "Close PTY session", "builtin")

        # Web & Search
        self._tools["web_search"] = ToolSpec("web_search", "Search the web (DuckDuckGo)", "builtin")
        self._tools["web_fetch"] = ToolSpec("web_fetch", "Advanced HTTP fetch with methods/headers", "builtin")

        # Docker
        self._tools["docker_ps"] = ToolSpec("docker_ps", "List Docker containers", "builtin")
        self._tools["docker_images"] = ToolSpec("docker_images", "List Docker images", "builtin")
        self._tools["docker_run"] = ToolSpec("docker_run", "Run Docker container", "builtin")
        self._tools["docker_build"] = ToolSpec("docker_build", "Build Docker image", "builtin")
        self._tools["docker_exec"] = ToolSpec("docker_exec", "Execute command in container", "builtin")
        self._tools["docker_logs"] = ToolSpec("docker_logs", "Get container logs", "builtin")
        self._tools["docker_compose"] = ToolSpec("docker_compose", "Run docker-compose commands", "builtin")

        # Package Management
        self._tools["apt_install"] = ToolSpec("apt_install", "Install packages with apt", "builtin")
        self._tools["pip_install"] = ToolSpec("pip_install", "Install Python packages", "builtin")
        self._tools["npm_install"] = ToolSpec("npm_install", "Install npm packages", "builtin")

        # Databases
        self._tools["psql"] = ToolSpec("psql", "Execute PostgreSQL query", "builtin")
        self._tools["mysql"] = ToolSpec("mysql", "Execute MySQL query", "builtin")
        self._tools["redis_cli"] = ToolSpec("redis_cli", "Execute Redis command", "builtin")

        # Extended Git
        self._tools["git_status"] = ToolSpec("git_status", "Show git status", "builtin")
        self._tools["git_log"] = ToolSpec("git_log", "Show git commit history", "builtin")
        self._tools["git_branch"] = ToolSpec("git_branch", "List git branches", "builtin")
        self._tools["git_diff"] = ToolSpec("git_diff", "Show git diff", "builtin")
        self._tools["git_push"] = ToolSpec("git_push", "Push to remote", "builtin")
        self._tools["git_pull"] = ToolSpec("git_pull", "Pull from remote", "builtin")
        self._tools["git_clone"] = ToolSpec("git_clone", "Clone repository", "builtin")

        # Build Tools
        self._tools["make"] = ToolSpec("make", "Run make", "builtin")
        self._tools["cmake"] = ToolSpec("cmake", "Run cmake", "builtin")
        self._tools["gradle"] = ToolSpec("gradle", "Run Gradle", "builtin")
        self._tools["maven"] = ToolSpec("maven", "Run Maven", "builtin")

        # Testing
        self._tools["pytest"] = ToolSpec("pytest", "Run pytest", "builtin")
        self._tools["unittest"] = ToolSpec("unittest", "Run Python unittest", "builtin")
        self._tools["jest"] = ToolSpec("jest", "Run Jest tests", "builtin")
        self._tools["cargo_test"] = ToolSpec("cargo_test", "Run Rust tests", "builtin")
        self._tools["go_test"] = ToolSpec("go_test", "Run Go tests", "builtin")

        # Deployment
        self._tools["ssh"] = ToolSpec("ssh", "Execute SSH command", "builtin")
        self._tools["rsync"] = ToolSpec("rsync", "Sync files with rsync", "builtin")
        self._tools["kubectl"] = ToolSpec("kubectl", "Run kubectl commands", "builtin")
        self._tools["terraform"] = ToolSpec("terraform", "Run Terraform", "builtin")
        self._tools["ansible_playbook"] = ToolSpec("ansible_playbook", "Run Ansible playbook", "builtin")

        # System
        self._tools["systemctl"] = ToolSpec("systemctl", "Control systemd services", "builtin")
        self._tools["service"] = ToolSpec("service", "Control services", "builtin")
        self._tools["journalctl"] = ToolSpec("journalctl", "View system logs", "builtin")
        self._tools["crontab"] = ToolSpec("crontab", "Manage cron jobs", "builtin")
        self._tools["netstat"] = ToolSpec("netstat", "Show network connections", "builtin")
        self._tools["ss"] = ToolSpec("ss", "Show socket statistics", "builtin")
        self._tools["lsof"] = ToolSpec("lsof", "List open files", "builtin")
        self._tools["ps"] = ToolSpec("ps", "List processes", "builtin")
        self._tools["kill"] = ToolSpec("kill", "Kill process", "builtin")
        self._tools["df"] = ToolSpec("df", "Show disk usage", "builtin")
        self._tools["du"] = ToolSpec("du", "Show directory usage", "builtin")
        self._tools["free"] = ToolSpec("free", "Show memory usage", "builtin")
        self._tools["top"] = ToolSpec("top", "Show system processes", "builtin")
        self._tools["uptime"] = ToolSpec("uptime", "Show system uptime", "builtin")
        self._tools["whoami"] = ToolSpec("whoami", "Show current user", "builtin")
        self._tools["id"] = ToolSpec("id", "Show user info", "builtin")
        self._tools["uname"] = ToolSpec("uname", "Show system info", "builtin")
        self._tools["env"] = ToolSpec("env", "Show environment variables", "builtin")
        self._tools["which"] = ToolSpec("which", "Find command path", "builtin")

        # File Operations
        self._tools["find"] = ToolSpec("find", "Find files", "builtin")
        self._tools["glob"] = ToolSpec("glob", "Find files matching glob pattern", "builtin")
        self._tools["grep"] = ToolSpec("grep", "Search files", "builtin")
        self._tools["sed"] = ToolSpec("sed", "Stream editor", "builtin")
        self._tools["awk"] = ToolSpec("awk", "Pattern scanning", "builtin")
        self._tools["tar"] = ToolSpec("tar", "Create/extract tar archives", "builtin")
        self._tools["zip"] = ToolSpec("zip", "Create zip archive", "builtin")
        self._tools["unzip"] = ToolSpec("unzip", "Extract zip archive", "builtin")
        self._tools["chmod"] = ToolSpec("chmod", "Change file permissions", "builtin")
        self._tools["chown"] = ToolSpec("chown", "Change file owner", "builtin")
        self._tools["ln"] = ToolSpec("ln", "Create links", "builtin")
        self._tools["mkdir"] = ToolSpec("mkdir", "Create directories", "builtin")
        self._tools["rm"] = ToolSpec("rm", "Remove files/directories", "builtin")
        self._tools["cp"] = ToolSpec("cp", "Copy files", "builtin")
        self._tools["mv"] = ToolSpec("mv", "Move files", "builtin")
        self._tools["ls"] = ToolSpec("ls", "List directory", "builtin")
        self._tools["cat"] = ToolSpec("cat", "Display file contents", "builtin")
        self._tools["head"] = ToolSpec("head", "Show first lines", "builtin")
        self._tools["tail"] = ToolSpec("tail", "Show last lines", "builtin")
        self._tools["wc"] = ToolSpec("wc", "Count lines/words/bytes", "builtin")
        self._tools["sort"] = ToolSpec("sort", "Sort lines", "builtin")
        self._tools["uniq"] = ToolSpec("uniq", "Report unique lines", "builtin")
        self._tools["diff"] = ToolSpec("diff", "Compare files", "builtin")
        self._tools["sha256sum"] = ToolSpec("sha256sum", "Calculate SHA256 checksum", "builtin")
        self._tools["md5sum"] = ToolSpec("md5sum", "Calculate MD5 checksum", "builtin")

        # Network
        self._tools["ping"] = ToolSpec("ping", "Ping host", "builtin")
        self._tools["curl"] = ToolSpec("curl", "Transfer data with curl", "builtin")
        self._tools["wget"] = ToolSpec("wget", "Download files", "builtin")
        self._tools["nslookup"] = ToolSpec("nslookup", "DNS lookup", "builtin")
        self._tools["dig"] = ToolSpec("dig", "DNS query", "builtin")
        self._tools["traceroute"] = ToolSpec("traceroute", "Trace route", "builtin")
        self._tools["netcat"] = ToolSpec("netcat", "Network connections", "builtin")
        self._tools["tcpdump"] = ToolSpec("tcpdump", "Network packet analyzer", "builtin")
        self._tools["nmap"] = ToolSpec("nmap", "Network scanner", "builtin")

        # Interpreters
        self._tools["python"] = ToolSpec("python", "Execute Python code", "builtin")
        self._tools["python_file"] = ToolSpec("python_file", "Execute Python file", "builtin")
        self._tools["node"] = ToolSpec("node", "Execute Node.js code", "builtin")
        self._tools["node_file"] = ToolSpec("node_file", "Execute Node.js file", "builtin")
        self._tools["ruby"] = ToolSpec("ruby", "Execute Ruby code", "builtin")
        self._tools["perl"] = ToolSpec("perl", "Execute Perl code", "builtin")
        self._tools["bash_script"] = ToolSpec("bash_script", "Execute bash script", "builtin")

        # GitHub/GitLab CLI
        self._tools["gh"] = ToolSpec("gh", "GitHub CLI", "builtin")
        self._tools["glab"] = ToolSpec("glab", "GitLab CLI", "builtin")

        # Vision Tools
        self._tools["image_analyze"] = ToolSpec("image_analyze", "Analyze image using vision-capable LLM", "builtin")
        self._tools["image_ocr"] = ToolSpec("image_ocr", "Extract text from images using Tesseract OCR", "builtin")
        self._tools["image_ocr_cloud"] = ToolSpec(
            "image_ocr_cloud", "Extract text using cloud vision APIs (Google/AWS)", "builtin"
        )
        self._tools["image_screenshot"] = ToolSpec(
            "image_screenshot", "Capture screenshot of URL using browser", "builtin"
        )
        self._tools["image_describe"] = ToolSpec("image_describe", "Get concise description of image", "builtin")
        self._tools["image_compare"] = ToolSpec("image_compare", "Compare two images and detect differences", "builtin")
        self._tools["image_resize"] = ToolSpec("image_resize", "Resize image to specified dimensions", "builtin")
        self._tools["image_convert"] = ToolSpec("image_convert", "Convert image to different format", "builtin")
        self._tools["barcode_detect"] = ToolSpec("barcode_detect", "Detect and decode barcodes in image", "builtin")
        self._tools["qrcode_read"] = ToolSpec("qrcode_read", "Read QR code from image", "builtin")
        self._tools["qrcode_generate"] = ToolSpec("qrcode_generate", "Generate QR code and save to file", "builtin")

        # Browser Tools
        self._tools["browser_navigate"] = ToolSpec("browser_navigate", "Navigate to a URL", "builtin")
        self._tools["browser_click"] = ToolSpec("browser_click", "Click element by CSS selector", "builtin")
        self._tools["browser_fill"] = ToolSpec("browser_fill", "Fill form field by selector", "builtin")
        self._tools["browser_type"] = ToolSpec("browser_type", "Type text into element with delay", "builtin")
        self._tools["browser_press"] = ToolSpec("browser_press", "Press key or key combination", "builtin")
        self._tools["browser_screenshot"] = ToolSpec(
            "browser_screenshot", "Take screenshot of page or element", "builtin"
        )
        self._tools["browser_html"] = ToolSpec("browser_html", "Get HTML content of element", "builtin")
        self._tools["browser_text"] = ToolSpec("browser_text", "Get text content of element", "builtin")
        self._tools["browser_links"] = ToolSpec("browser_links", "Extract all links from page", "builtin")
        self._tools["browser_forms"] = ToolSpec("browser_forms", "Extract all forms from page", "builtin")
        self._tools["browser_evaluate"] = ToolSpec("browser_evaluate", "Execute JavaScript in page context", "builtin")
        self._tools["browser_download"] = ToolSpec("browser_download", "Download file from URL", "builtin")
        self._tools["browser_cookies"] = ToolSpec("browser_cookies", "Get or set browser cookies", "builtin")
        self._tools["browser_pdf"] = ToolSpec("browser_pdf", "Save page as PDF", "builtin")
        self._tools["browser_console"] = ToolSpec("browser_console", "Get console logs from page", "builtin")

        # Enhanced Web Tools
        self._tools["web_fetch_render"] = ToolSpec(
            "web_fetch_render", "Fetch URL with full JavaScript rendering", "builtin"
        )
        self._tools["web_scrape"] = ToolSpec(
            "web_scrape", "Scrape elements from webpage using CSS selectors", "builtin"
        )
        self._tools["api_get"] = ToolSpec("api_get", "Make GET request to API endpoint", "builtin")
        self._tools["api_post"] = ToolSpec("api_post", "Make POST request to API endpoint", "builtin")
        self._tools["api_graphql"] = ToolSpec("api_graphql", "Execute GraphQL query", "builtin")
        self._tools["extract_text"] = ToolSpec("extract_text", "Extract text content from webpage", "builtin")
        self._tools["extract_links"] = ToolSpec("extract_links", "Extract all links from webpage", "builtin")
        self._tools["extract_images"] = ToolSpec("extract_images", "Extract all image URLs from webpage", "builtin")
        self._tools["check_website_status"] = ToolSpec(
            "check_website_status", "Check if website is accessible", "builtin"
        )
        self._tools["search_ddg"] = ToolSpec("search_ddg", "Search DuckDuckGo", "builtin")
        self._tools["search_github"] = ToolSpec("search_github", "Search GitHub repositories", "builtin")
        self._tools["search_npm"] = ToolSpec("search_npm", "Search npm registry", "builtin")
        self._tools["search_pypi"] = ToolSpec("search_pypi", "Search PyPI packages", "builtin")
        self._tools["search_dockerhub"] = ToolSpec("search_dockerhub", "Search Docker Hub images", "builtin")

        # MCP Tools
        self._tools["mcp_list_servers"] = ToolSpec("mcp_list_servers", "List configured MCP servers", "builtin")
        self._tools["mcp_connect"] = ToolSpec("mcp_connect", "Connect to an MCP server", "builtin")
        self._tools["mcp_disconnect"] = ToolSpec("mcp_disconnect", "Disconnect from MCP server", "builtin")
        self._tools["mcp_list_tools"] = ToolSpec("mcp_list_tools", "List available tools from MCP servers", "builtin")
        self._tools["mcp_call_tool"] = ToolSpec("mcp_call_tool", "Call a tool on an MCP server", "builtin")
        self._tools["mcp_list_resources"] = ToolSpec("mcp_list_resources", "List resources from MCP server", "builtin")
        self._tools["mcp_read_resource"] = ToolSpec("mcp_read_resource", "Read resource from MCP server", "builtin")
        self._tools["mcp_list_prompts"] = ToolSpec("mcp_list_prompts", "List prompts from MCP server", "builtin")
        self._tools["mcp_get_prompt"] = ToolSpec("mcp_get_prompt", "Get prompt from MCP server", "builtin")
        self._tools["mcp_configure"] = ToolSpec("mcp_configure", "Configure MCP server", "builtin")

        # Tool Builder
        self._tools["tool_create_shell"] = ToolSpec("tool_create_shell", "Create custom shell-based tool", "builtin")
        self._tools["tool_create_python"] = ToolSpec("tool_create_python", "Create custom Python-based tool", "builtin")
        self._tools["tool_create_api"] = ToolSpec("tool_create_api", "Create custom API-based tool", "builtin")
        self._tools["tool_list"] = ToolSpec("tool_list", "List all custom tools", "builtin")
        self._tools["tool_delete"] = ToolSpec("tool_delete", "Delete a custom tool", "builtin")
        self._tools["tool_edit"] = ToolSpec("tool_edit", "Edit a custom tool", "builtin")
        self._tools["tool_export"] = ToolSpec("tool_export", "Export custom tool to file", "builtin")
        self._tools["tool_import"] = ToolSpec("tool_import", "Import custom tool from file", "builtin")
        self._tools["tool_clone"] = ToolSpec("tool_clone", "Clone an existing custom tool", "builtin")
        self._tools["tool_validate"] = ToolSpec("tool_validate", "Validate tool definition", "builtin")
        self._tools["tool_template"] = ToolSpec("tool_template", "Generate tool template", "builtin")

        # Streaming Tools
        self._tools["stream_chat"] = ToolSpec("stream_chat", "Stream LLM response directly to file", "builtin")
        self._tools["stream_append"] = ToolSpec("stream_append", "Append content to file", "builtin")
        self._tools["stream_lines"] = ToolSpec("stream_lines", "Write multiple lines to file", "builtin")
        self._tools["stream_json"] = ToolSpec("stream_json", "Write JSON data to file", "builtin")
        self._tools["stream_jsonl"] = ToolSpec("stream_jsonl", "Write JSONL (JSON Lines) to file", "builtin")
        self._tools["stream_csv"] = ToolSpec("stream_csv", "Write CSV data to file", "builtin")
        self._tools["stream_xml"] = ToolSpec("stream_xml", "Write XML to file", "builtin")
        self._tools["stream_yaml"] = ToolSpec("stream_yaml", "Write YAML to file", "builtin")
        self._tools["stream_markdown"] = ToolSpec("stream_markdown", "Write markdown table to file", "builtin")
        self._tools["stream_table"] = ToolSpec("stream_table", "Write formatted table to file", "builtin")
        self._tools["stream_diff"] = ToolSpec("stream_diff", "Write diff output to file", "builtin")
        self._tools["stream_log"] = ToolSpec("stream_log", "Write log entry to file", "builtin")
        self._tools["file_tail"] = ToolSpec("file_tail", "Show last lines of file", "builtin")
        self._tools["file_watch"] = ToolSpec("file_watch", "Watch file for changes", "builtin")

        # Delegate/Minion Tools
        self._tools["delegate_create"] = ToolSpec("delegate_create", "Create a new delegate/minion task", "builtin")
        self._tools["delegate_list"] = ToolSpec(
            "delegate_list", "List all delegates with optional state filter", "builtin"
        )
        self._tools["delegate_get"] = ToolSpec("delegate_get", "Get delegate details by ID", "builtin")
        self._tools["delegate_cancel"] = ToolSpec("delegate_cancel", "Cancel a running delegate", "builtin")
        self._tools["delegate_tree"] = ToolSpec(
            "delegate_tree", "Get complete tree of delegate and its children", "builtin"
        )

        # Project Context Tools
        self._tools["context_load"] = ToolSpec("context_load", "Load PROJECT.md content for context", "builtin")
        self._tools["context_summary"] = ToolSpec("context_summary", "Get summary of PROJECT.md", "builtin")
        self._tools["context_sections"] = ToolSpec(
            "context_sections", "Extract all sections from PROJECT.md", "builtin"
        )
        self._tools["context_rules"] = ToolSpec("context_rules", "Get global rules from PROJECT.md", "builtin")
        self._tools["context_personas"] = ToolSpec("context_personas", "Get all personas from PROJECT.md", "builtin")

        # Task Graph Tools
        self._tools["task_create"] = ToolSpec("task_create", "Create a new task with dependencies", "builtin")
        self._tools["task_get"] = ToolSpec("task_get", "Get task details by ID", "builtin")
        self._tools["task_update"] = ToolSpec("task_update", "Update task properties", "builtin")
        self._tools["task_add_dep"] = ToolSpec("task_add_dep", "Add dependency between tasks", "builtin")
        self._tools["task_schedulable"] = ToolSpec(
            "task_schedulable", "Get all tasks with satisfied dependencies", "builtin"
        )
        self._tools["task_blocked"] = ToolSpec("task_blocked", "Get all blocked tasks", "builtin")
        self._tools["task_stats"] = ToolSpec("task_stats", "Get task graph statistics", "builtin")

        # Blueprint Tools
        self._tools["blueprint_create"] = ToolSpec("blueprint_create", "Create a new blueprint for planning", "builtin")
        self._tools["blueprint_get"] = ToolSpec("blueprint_get", "Get blueprint details", "builtin")
        self._tools["blueprint_add_section"] = ToolSpec("blueprint_add_section", "Add section to blueprint", "builtin")
        self._tools["blueprint_export"] = ToolSpec("blueprint_export", "Export blueprint to markdown file", "builtin")
        self._tools["blueprint_list"] = ToolSpec("blueprint_list", "List all blueprints", "builtin")

        # Automation Tools
        self._tools["automation_create"] = ToolSpec(
            "automation_create", "Create new automation with triggers and actions", "builtin"
        )
        self._tools["automation_get"] = ToolSpec("automation_get", "Get automation details", "builtin")
        self._tools["automation_list"] = ToolSpec("automation_list", "List all automations", "builtin")
        self._tools["automation_add_trigger"] = ToolSpec(
            "automation_add_trigger", "Add trigger to automation", "builtin"
        )
        self._tools["automation_add_action"] = ToolSpec("automation_add_action", "Add action to automation", "builtin")
        self._tools["automation_stats"] = ToolSpec("automation_stats", "Get automation statistics", "builtin")

        # System Administration Tools
        self._tools["sysctl"] = ToolSpec("sysctl", "View/modify kernel parameters", "builtin")
        self._tools["modprobe"] = ToolSpec("modprobe", "Load kernel modules", "builtin")
        self._tools["lsmod"] = ToolSpec("lsmod", "List loaded kernel modules", "builtin")
        self._tools["insmod"] = ToolSpec("insmod", "Install kernel module", "builtin")
        self._tools["rmmod"] = ToolSpec("rmmod", "Remove kernel module", "builtin")
        self._tools["service"] = ToolSpec("service", "Manage system services", "builtin")
        self._tools["systemctl"] = ToolSpec("systemctl", "Control systemd services", "builtin")
        self._tools["init"] = ToolSpec("init", "Change system runlevel", "builtin")
        self._tools["shutdown"] = ToolSpec("shutdown", "Shutdown the system", "builtin")
        self._tools["reboot"] = ToolSpec("reboot", "Reboot the system", "builtin")
        self._tools["halt"] = ToolSpec("halt", "Halt the system", "builtin")

        # User Management
        self._tools["useradd"] = ToolSpec("useradd", "Create new user account", "builtin")
        self._tools["usermod"] = ToolSpec("usermod", "Modify user account", "builtin")
        self._tools["userdel"] = ToolSpec("userdel", "Delete user account", "builtin")
        self._tools["groupadd"] = ToolSpec("groupadd", "Create new group", "builtin")
        self._tools["groupdel"] = ToolSpec("groupdel", "Delete group", "builtin")

        # File Attributes
        self._tools["chattr"] = ToolSpec("chattr", "Change file attributes", "builtin")
        self._tools["lsattr"] = ToolSpec("lsattr", "List file attributes", "builtin")

        # Storage Management
        self._tools["mount"] = ToolSpec("mount", "Mount filesystem", "builtin")
        self._tools["umount"] = ToolSpec("umount", "Unmount filesystem", "builtin")
        self._tools["fdisk"] = ToolSpec("fdisk", "Partition table manipulator", "builtin")
        self._tools["parted"] = ToolSpec("parted", "GNU Parted for partitions", "builtin")
        self._tools["mkfs"] = ToolSpec("mkfs", "Create filesystem", "builtin")
        self._tools["dd"] = ToolSpec("dd", "Data duplicator/convert", "builtin")

        # Networking
        self._tools["nc"] = ToolSpec("nc", "Netcat - network utility", "builtin")
        self._tools["socat"] = ToolSpec("socat", "SOcket CAT - multipurpose relay", "builtin")
        self._tools["iptables"] = ToolSpec("iptables", "IPv4 firewall administration", "builtin")
        self._tools["ufw"] = ToolSpec("ufw", "Uncomplicated Firewall", "builtin")
        self._tools["firewall-cmd"] = ToolSpec("firewall-cmd", "Firewalld command", "builtin")

        # Process & System Monitoring
        self._tools["cron"] = ToolSpec("cron", "Schedule periodic tasks", "builtin")
        self._tools["crontab"] = ToolSpec("crontab", "Manage cron tables", "builtin")
        self._tools["at"] = ToolSpec("at", "Schedule one-time tasks", "builtin")
        self._tools["journalctl"] = ToolSpec("journalctl", "Query systemd journal", "builtin")
        self._tools["dmesg"] = ToolSpec("dmesg", "Print kernel messages", "builtin")
        self._tools["strace"] = ToolSpec("strace", "Trace system calls", "builtin")
        self._tools["ltrace"] = ToolSpec("ltrace", "Trace library calls", "builtin")
        self._tools["gdb"] = ToolSpec("gdb", "GNU Debugger", "builtin")

        # Database Tools
        self._tools["mongosh"] = ToolSpec("mongosh", "MongoDB shell", "builtin")
        self._tools["mongo"] = ToolSpec("mongo", "Legacy MongoDB client", "builtin")

        # Container Tools
        self._tools["docker-compose"] = ToolSpec("docker-compose", "Docker Compose", "builtin")
        self._tools["kubectl"] = ToolSpec("kubectl", "Kubernetes CLI", "builtin")
        self._tools["helm"] = ToolSpec("helm", "Kubernetes package manager", "builtin")
        self._tools["crictl"] = ToolSpec("crictl", "CRI container tool", "builtin")
        self._tools["nerdctl"] = ToolSpec("nerdctl", "nerdctl Docker-compatible CLI", "builtin")

        # Cloud CLI Tools
        self._tools["aws"] = ToolSpec("aws", "AWS CLI", "builtin")
        self._tools["az"] = ToolSpec("az", "Azure CLI", "builtin")
        self._tools["gcloud"] = ToolSpec("gcloud", "Google Cloud CLI", "builtin")
        self._tools["packer"] = ToolSpec("packer", "HashiCorp Packer", "builtin")

        # Compilers & Build Tools
        self._tools["gcc"] = ToolSpec("gcc", "GNU C Compiler", "builtin")
        self._tools["g++"] = ToolSpec("g++", "GNU C++ Compiler", "builtin")
        self._tools["clang"] = ToolSpec("clang", "LLVM C Compiler", "builtin")
        self._tools["rustc"] = ToolSpec("rustc", "Rust Compiler", "builtin")
        self._tools["go"] = ToolSpec("go", "Go Programming Language", "builtin")
        self._tools["javac"] = ToolSpec("javac", "Java Compiler", "builtin")
        self._tools["make"] = ToolSpec("make", "GNU Make", "builtin")
        self._tools["cmake"] = ToolSpec("cmake", "CMake build system", "builtin")
        self._tools["meson"] = ToolSpec("meson", "Meson build system", "builtin")
        self._tools["ninja"] = ToolSpec("ninja", "Ninja build system", "builtin")

    def _load_external(self) -> None:
        path = self.config.external_tools_file
        if not path.exists():
            return
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return
        for item in data.get("tools", []):
            name = str(item.get("name", "")).strip()
            if not name:
                continue
            description = str(item.get("description", "")).strip()
            command = str(item.get("command", "")).strip()
            if not command:
                continue
            self._tools[name] = ToolSpec(name, description, "external", command=command)

    def list_tools(self) -> list[ToolSpec]:
        return list(self._tools.values())

    def get(self, name: str) -> ToolSpec | None:
        return self._tools.get(name)
