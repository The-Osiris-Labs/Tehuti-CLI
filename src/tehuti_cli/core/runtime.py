from __future__ import annotations

import os
import shlex
import subprocess
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

from tehuti_cli.storage.config import Config
from tehuti_cli.core.tools import ToolRegistry
from tehuti_cli.core.pty import PtyManager
from tehuti_cli.advanced_tools import ToolResult, AdvancedToolSuite
from tehuti_cli.vision_tools import VisionTools
from tehuti_cli.browser_tools import BrowserTools
from tehuti_cli.enhanced_web_tools import EnhancedWebTools
from tehuti_cli.mcp_tools import MCPTools
from tehuti_cli.tool_builder import ToolBuilder
from tehuti_cli.streaming_tools import StreamingTools
from tehuti_cli.core.delegates import DelegateManager, DelegateState
from tehuti_cli.core.project_context import ProjectContext
from tehuti_cli.core.task_graph import TaskGraph, TaskStatus, TaskPriority
from tehuti_cli.core.blueprint import BlueprintManager, BlueprintStatus, BlueprintSectionType
from tehuti_cli.core.automations import AutomationManager, AutomationState, Trigger, Action, TriggerType, ActionType


class ToolSandbox:
    def __init__(self, config: Config, work_dir: Path):
        self.config = config
        self.work_dir = work_dir.resolve()

    def _is_path_allowed(self, path: Path) -> bool:
        if self.config.default_yolo:
            return True
        allowed = [self.work_dir] + [Path(p).resolve() for p in self.config.allowed_paths]
        resolved = path.resolve()
        return any(str(resolved).startswith(str(base)) for base in allowed)

    def read_file(self, path: Path) -> ToolResult:
        if not self._is_path_allowed(path):
            return ToolResult(False, "Path is outside allowed sandbox.")
        if not path.exists():
            return ToolResult(False, "File not found.")
        return ToolResult(True, path.read_text(encoding="utf-8", errors="replace"))

    def write_file(self, path: Path, content: str) -> ToolResult:
        if not self.config.allow_write and not self.config.default_yolo:
            return ToolResult(False, "Write tool disabled. Use /allow-all or /permissions write on.")
        if not self._is_path_allowed(path):
            return ToolResult(False, "Path is outside allowed sandbox.")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return ToolResult(True, "OK")

    def edit_file(self, path: Path, old_string: str, new_string: str) -> ToolResult:
        if not self.config.allow_write and not self.config.default_yolo:
            return ToolResult(False, "Write tool disabled. Use /allow-all or /permissions write on.")
        if not self._is_path_allowed(path):
            return ToolResult(False, "Path is outside allowed sandbox.")
        if not path.exists():
            return ToolResult(False, "File not found.")
        try:
            content = path.read_text(encoding="utf-8")
            if old_string not in content:
                return ToolResult(False, "String to replace not found in file.")
            new_content = content.replace(old_string, new_string, 1)
            path.write_text(new_content, encoding="utf-8")
            return ToolResult(True, "OK")
        except UnicodeDecodeError:
            return ToolResult(False, "File is not a valid UTF-8 text file.")
        except Exception as exc:
            return ToolResult(False, str(exc))

    def run_shell(self, command: str) -> ToolResult:
        if not self.config.allow_shell and not self.config.default_yolo:
            return ToolResult(False, "Shell disabled. Use /allow-all or /permissions shell on.")
        try:
            proc = subprocess.run(
                command,
                shell=True,
                cwd=str(self.work_dir),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                env=os.environ.copy(),
            )
            return ToolResult(proc.returncode == 0, proc.stdout or "")
        except Exception as exc:
            return ToolResult(False, str(exc))

    def fetch_url(self, url: str) -> ToolResult:
        if self.config.default_yolo:
            # Full access in YOLO mode.
            pass
        parsed = urlparse(url)
        domain = parsed.netloc
        if self.config.web_deny_domains and domain in self.config.web_deny_domains:
            return ToolResult(False, "Domain denied by web_deny_domains.")
        if self.config.web_allow_domains and domain not in self.config.web_allow_domains:
            return ToolResult(False, "Domain not allowed by web_allow_domains.")
        try:
            with httpx.Client(timeout=30.0, follow_redirects=True) as client:
                resp = client.get(url)
                resp.raise_for_status()
                return ToolResult(True, resp.text)
        except Exception as exc:
            return ToolResult(False, str(exc))


class ToolRuntime:
    def __init__(self, config: Config, work_dir: Path):
        self.config = config
        self.work_dir = work_dir
        self.sandbox = ToolSandbox(config, work_dir)
        self.registry = ToolRegistry(config)
        self.pty = PtyManager()
        self.advanced = AdvancedToolSuite(config, work_dir)
        self.vision = VisionTools(config, work_dir)
        self.browser = BrowserTools(config, work_dir)
        self.enhanced_web = EnhancedWebTools(config, work_dir)
        self.mcp = MCPTools(config, work_dir)
        self.tool_builder = ToolBuilder(config, work_dir)
        self.streaming = StreamingTools(config, work_dir)
        self.delegates = DelegateManager(config, work_dir)
        self.project_context = ProjectContext(work_dir, config)
        self.task_graph = TaskGraph(config, work_dir)
        self.blueprints = BlueprintManager(config, work_dir)
        self.automations = AutomationManager(config, work_dir)

    def _truncate_output_lines(
        self,
        output: str,
        max_lines: int = 60,
        head: int = 30,
        tail: int = 20,
    ) -> str:
        lines = (output or "").splitlines()
        total = len(lines)
        if total <= max_lines:
            return output
        head_lines = lines[:head]
        tail_lines = lines[-tail:] if tail > 0 else []
        omitted = total - len(head_lines) - len(tail_lines)
        mid = [f"... +{omitted} lines omitted ..."] if omitted > 0 else []
        return "\n".join(head_lines + mid + tail_lines).strip()

    def host_discovery(self, profile: str = "basic") -> ToolResult:
        if not self.config.allow_shell and not self.config.default_yolo:
            return ToolResult(False, "Shell disabled. Discovery requires shell access.")

        profile = (profile or "basic").strip().lower()
        if profile not in {"basic", "extended"}:
            profile = "basic"

        run_id = str(uuid.uuid4())[:8]
        started_at = datetime.now().astimezone()
        total_start = time.perf_counter()
        commands: list[tuple[str, str]] = [
            ("whoami", "identity"),
            ("pwd", "cwd"),
            ("date -Is", "time"),
            ("uname -a", "os"),
            ("uptime", "uptime"),
            ("df -h -x tmpfs -x overlay", "disk"),
            ("free -h", "memory"),
            ("ps aux --sort=-%cpu | head -6", "processes"),
        ]
        if profile == "extended":
            commands.extend(
                [
                    ("ss -tulpn 2>/dev/null | head -20", "sockets"),
                    ("ip -o addr show 2>/dev/null | head -20", "network"),
                ]
            )

        findings: list[str] = []
        warnings: list[str] = []
        snapshot: dict[str, str] = {}
        failed = 0
        for idx, (cmd, key) in enumerate(commands, start=1):
            cmd_start = time.perf_counter()
            result = self.sandbox.run_shell(cmd)
            elapsed_ms = int((time.perf_counter() - cmd_start) * 1000)
            if not result.ok:
                failed += 1
                warnings.append(f"{cmd} failed")
            output = self._truncate_output_lines(result.output or "", max_lines=40, head=20, tail=12).strip()
            snapshot[key] = output
            status_tag = "ok" if result.ok else "fail"
            findings.append(f"{idx}. $ {cmd}  [{status_tag} {elapsed_ms}ms]\n{output or '(no output)'}")

        total_elapsed_ms = int((time.perf_counter() - total_start) * 1000)
        ended_at = datetime.now().astimezone()
        status = "pass" if failed == 0 else f"partial ({failed} command failures)"

        user = (snapshot.get("identity", "").splitlines() or ["unknown"])[0].strip() or "unknown"
        cwd = (snapshot.get("cwd", "").splitlines() or [str(self.work_dir)])[0].strip() or str(self.work_dir)
        os_line = (snapshot.get("os", "").splitlines() or ["unknown"])[0].strip() or "unknown"
        uptime_line = (snapshot.get("uptime", "").splitlines() or ["unknown"])[0].strip() or "unknown"
        disk_lines = [line for line in snapshot.get("disk", "").splitlines() if line.strip()]
        disk_summary = disk_lines[1].strip() if len(disk_lines) > 1 else (disk_lines[0].strip() if disk_lines else "unknown")
        mem_lines = [line for line in snapshot.get("memory", "").splitlines() if line.strip()]
        mem_summary = mem_lines[1].strip() if len(mem_lines) > 1 else (mem_lines[0].strip() if mem_lines else "unknown")
        proc_lines = [line for line in snapshot.get("processes", "").splitlines() if line.strip()]
        proc_summary = proc_lines[1].strip() if len(proc_lines) > 1 else "no process sample"

        report = (
            "Discovery report:\n\n"
            f"- Run id: {run_id}\n"
            f"- Started: {started_at.isoformat()}\n"
            f"- Finished: {ended_at.isoformat()}\n"
            f"- Duration: {total_elapsed_ms}ms\n"
            f"- Working directory: {self.work_dir}\n"
            f"- Status: {status}\n"
            "- Safety: Read-only discovery commands only.\n"
            + (f"- Warnings: {'; '.join(warnings)}\n" if warnings else "")
            + "\nTL;DR findings:\n"
            f"- User: {user}\n"
            f"- CWD: {cwd}\n"
            f"- Host/Kernel: {os_line}\n"
            f"- Uptime: {uptime_line}\n"
            f"- Disk sample: {disk_summary}\n"
            f"- Memory sample: {mem_summary}\n"
            f"- Top CPU sample: {proc_summary}\n\n"
            "Evidence:\n"
            + "\n\n".join(findings)
        )
        return ToolResult(True, report)

    def approve(self, tool: str, args: dict[str, Any]) -> bool:
        if self.config.deny_tools and tool in self.config.deny_tools:
            return False
        if self.config.allow_tools and tool not in self.config.allow_tools:
            return False

        approval_mode = getattr(self.config, "approval_mode", "auto")
        if approval_mode == "chat_only":
            return False
        if approval_mode == "manual":
            # Manual mode requires explicit permissive toggle.
            return bool(self.config.default_yolo)
        if approval_mode == "smart" and self._is_high_risk_tool(tool, args):
            return False

        if self.config.default_yolo:
            return True
        return True

    def _is_high_risk_tool(self, tool: str, args: dict[str, Any]) -> bool:
        mutating = {
            "write",
            "edit",
            "rm",
            "mv",
            "cp",
            "mkdir",
            "chmod",
            "chown",
            "ln",
            "docker_run",
            "docker_build",
            "docker_exec",
            "docker_compose",
            "apt_install",
            "pip_install",
            "npm_install",
            "git_push",
            "git_pull",
            "git_clone",
            "terraform",
            "ansible_playbook",
            "systemctl",
            "service",
            "kill",
            "crontab",
            "python_file",
            "node_file",
            "bash_script",
            "tool_create_shell",
            "tool_create_python",
            "tool_create_api",
            "tool_edit",
            "tool_delete",
            "tool_import",
            "stream_chat",
            "stream_append",
            "stream_lines",
            "stream_json",
            "stream_jsonl",
            "stream_csv",
            "stream_xml",
            "stream_yaml",
            "stream_markdown",
            "stream_table",
            "stream_diff",
            "stream_log",
        }
        if tool in mutating:
            return True
        if tool == "shell":
            cmd = str(args.get("command", "")).lower()
            risky_tokens = (" rm ", " mv ", " chmod ", " chown ", " git push", " docker run", " pip install")
            normalized = f" {cmd} "
            return any(token in normalized for token in risky_tokens)
        if tool.startswith("automation_") or tool.startswith("delegate_"):
            return True
        return False

    def execute(self, tool: str, args: dict[str, Any]) -> ToolResult:
        if not self.approve(tool, args):
            return ToolResult(False, "Denied by approval.")
        match tool:
            case "read":
                return self.sandbox.read_file(Path(args["path"]))
            case "write":
                return self.sandbox.write_file(Path(args["path"]), args.get("content", ""))
            case "edit":
                return self.sandbox.edit_file(
                    Path(args["path"]),
                    args.get("old_string", ""),
                    args.get("new_string", ""),
                )
            case "shell":
                command = args.get("command") or args.get("cmd")
                if not command:
                    return ToolResult(False, "Missing required arg: command")
                return self.sandbox.run_shell(str(command))
            case "fetch":
                return self.sandbox.fetch_url(args["url"])
            case "host_discovery":
                return self.host_discovery(args.get("profile", "basic"))
            case "pty.spawn":
                ok, out = self.pty.spawn(args.get("command", ""))
                return ToolResult(ok, out)
            case "pty.send":
                ok, out = self.pty.send(args.get("session_id", ""), args.get("input", ""))
                return ToolResult(ok, out)
            case "pty.read":
                ok, out = self.pty.read(args.get("session_id", ""))
                return ToolResult(ok, out)
            case "pty.close":
                ok, out = self.pty.close(args.get("session_id", ""))
                return ToolResult(ok, out)
            # Web & Search Tools
            case "web_search":
                query = args.get("query") or args.get("q") or ""
                return self.advanced.web_search(
                    query,
                    args.get("engine", "duckduckgo"),
                    args.get("num_results", 10),
                )
            case "web_fetch":
                return self.advanced.web_fetch(
                    args.get("url", ""),
                    args.get("method", "GET"),
                    args.get("headers"),
                    args.get("data"),
                    args.get("timeout", 30),
                )
            # Docker Tools
            case "docker_ps":
                return self.advanced.docker_ps(args.get("all", True))
            case "docker_images":
                return self.advanced.docker_images()
            case "docker_run":
                return self.advanced.docker_run(
                    args.get("image"),
                    args.get("command"),
                    args.get("detach", False),
                    args.get("ports"),
                    args.get("volumes"),
                    args.get("env"),
                    args.get("name"),
                )
            case "docker_build":
                return self.advanced.docker_build(args.get("path", "."), args.get("tag"), args.get("dockerfile"))
            case "docker_exec":
                return self.advanced.docker_exec(args.get("container"), args.get("command"))
            case "docker_logs":
                return self.advanced.docker_logs(
                    args.get("container"),
                    args.get("tail", 100),
                    args.get("follow", False),
                )
            case "docker_compose":
                return self.advanced.docker_compose(args.get("command"), args.get("file"))
            # Package Management
            case "apt_install":
                return self.advanced.apt_install(args.get("packages", []), args.get("update_first", True))
            case "pip_install":
                return self.advanced.pip_install(args.get("packages", []), args.get("upgrade", False))
            case "npm_install":
                return self.advanced.npm_install(args.get("packages"), args.get("global", False))
            # Database Tools
            case "psql":
                return self.advanced.psql(
                    args.get("database"),
                    args.get("query"),
                    args.get("host", "localhost"),
                    args.get("port", 5432),
                    args.get("username", "postgres"),
                )
            case "mysql":
                return self.advanced.mysql(
                    args.get("database"),
                    args.get("query"),
                    args.get("host", "localhost"),
                    args.get("port", 3306),
                    args.get("username", "root"),
                )
            case "redis_cli":
                return self.advanced.redis_cli(
                    args.get("command"),
                    args.get("host", "localhost"),
                    args.get("port", 6379),
                )
            # Extended Git Operations
            case "git_status":
                return self.advanced.git_status()
            case "git_log":
                return self.advanced.git_log(args.get("num", 10), args.get("oneline", True))
            case "git_branch":
                return self.advanced.git_branch(args.get("all", True))
            case "git_diff":
                return self.advanced.git_diff(args.get("staged", False), args.get("file"))
            case "git_push":
                return self.advanced.git_push(args.get("remote", "origin"), args.get("branch"))
            case "git_pull":
                return self.advanced.git_pull(args.get("remote", "origin"), args.get("branch"))
            case "git_clone":
                return self.advanced.git_clone(args.get("url"), args.get("directory"), args.get("branch"))
            # Build Tools
            case "make":
                return self.advanced.make(args.get("target"), args.get("jobs"))
            case "cmake":
                return self.advanced.cmake(args.get("source_dir", "."), args.get("build_dir", "build"))
            case "gradle":
                return self.advanced.gradle(args.get("task", "build"))
            case "maven":
                return self.advanced.maven(args.get("goal", "package"))
            # Testing
            case "pytest":
                return self.advanced.pytest(args.get("path", "."), args.get("verbose", True), args.get("cov"))
            case "unittest":
                return self.advanced.unittest(args.get("path", "."), args.get("pattern", "test*.py"))
            case "jest":
                return self.advanced.jest(args.get("path", "."), args.get("watch", False))
            case "cargo_test":
                return self.advanced.cargo_test(args.get("package"))
            case "go_test":
                return self.advanced.go_test(args.get("path", "./..."), args.get("verbose", True))
            # Deployment & Cloud
            case "ssh":
                return self.advanced.ssh(
                    args.get("host"),
                    args.get("command"),
                    args.get("user"),
                    args.get("port", 22),
                    args.get("key"),
                )
            case "rsync":
                return self.advanced.rsync(
                    args.get("source"),
                    args.get("destination"),
                    args.get("delete", False),
                    args.get("exclude"),
                )
            case "kubectl":
                return self.advanced.kubectl(args.get("command"), args.get("namespace"))
            case "terraform":
                return self.advanced.terraform(args.get("command", "plan"))
            case "ansible_playbook":
                return self.advanced.ansible_playbook(args.get("playbook"), args.get("inventory"))
            # System Operations
            case "systemctl":
                return self.advanced.systemctl(args.get("action"), args.get("service"))
            case "service":
                return self.advanced.service(args.get("name"), args.get("action"))
            case "journalctl":
                return self.advanced.journalctl(
                    args.get("service"),
                    args.get("lines", 100),
                    args.get("follow", False),
                )
            case "crontab":
                return self.advanced.crontab(args.get("user"), args.get("list", True))
            case "netstat":
                return self.advanced.netstat(args.get("listening", True), args.get("numeric", True))
            case "ss":
                return self.advanced.ss(args.get("listening", True))
            case "lsof":
                return self.advanced.lsof(args.get("port"), args.get("pid"))
            case "ps":
                return self.advanced.ps(args.get("aux", True))
            case "kill":
                return self.advanced.kill(args.get("pid"), args.get("signal", "TERM"))
            case "df":
                return self.advanced.df(args.get("human", True))
            case "du":
                return self.advanced.du(
                    args.get("path", "."),
                    args.get("human", True),
                    args.get("summarize", False),
                )
            case "free":
                return self.advanced.free(args.get("human", True))
            case "top":
                return self.advanced.top(args.get("batch", True), args.get("iterations", 1))
            case "uptime":
                return self.advanced.uptime()
            case "whoami":
                return self.advanced.whoami()
            case "id":
                return self.advanced.id(args.get("user"))
            case "uname":
                return self.advanced.uname(args.get("all", True))
            case "env":
                return self.advanced.env()
            case "which":
                return self.advanced.which(args.get("command"))
            # File Operations
            case "find":
                return self.advanced.find(
                    args.get("path", "."),
                    args.get("name"),
                    args.get("type"),
                    args.get("size"),
                    args.get("mtime"),
                )
            case "glob":
                return self.advanced.glob(
                    args.get("pattern"),
                    args.get("path", "."),
                    args.get("recursive", True),
                    args.get("limit", 100),
                )
            case "grep":
                return self.advanced.grep(
                    args.get("pattern"),
                    args.get("path", "."),
                    args.get("recursive", True),
                    args.get("ignore_case", False),
                    args.get("line_numbers", True),
                )
            case "sed":
                return self.advanced.sed(
                    args.get("expression"),
                    args.get("file"),
                    args.get("in_place", False),
                )
            case "awk":
                return self.advanced.awk(args.get("script"), args.get("file"))
            case "tar":
                return self.advanced.tar(args.get("action"), args.get("archive"), args.get("files", []))
            case "zip":
                return self.advanced.zip(args.get("archive"), args.get("files", []))
            case "unzip":
                return self.advanced.unzip(args.get("archive"), args.get("destination"))
            case "chmod":
                return self.advanced.chmod(args.get("mode"), args.get("path"), args.get("recursive", False))
            case "chown":
                return self.advanced.chown(args.get("owner"), args.get("path"), args.get("recursive", False))
            case "ln":
                return self.advanced.ln(args.get("target"), args.get("link"), args.get("symbolic", True))
            case "mkdir":
                return self.advanced.mkdir(args.get("path"), args.get("parents", True))
            case "rm":
                return self.advanced.rm(
                    args.get("path"),
                    args.get("recursive", False),
                    args.get("force", False),
                )
            case "cp":
                return self.advanced.cp(
                    args.get("source"),
                    args.get("destination"),
                    args.get("recursive", False),
                )
            case "mv":
                return self.advanced.mv(args.get("source"), args.get("destination"))
            case "ls":
                return self.advanced.ls(
                    args.get("path", "."),
                    args.get("long", True),
                    args.get("all", False),
                    args.get("human", True),
                )
            case "cat":
                return self.advanced.cat(args.get("file"))
            case "head":
                return self.advanced.head(args.get("file"), args.get("lines", 10))
            case "tail":
                return self.advanced.tail(args.get("file"), args.get("lines", 10), args.get("follow", False))
            case "wc":
                return self.advanced.wc(
                    args.get("file"),
                    args.get("lines", True),
                    args.get("words", True),
                    args.get("bytes", False),
                )
            case "sort":
                return self.advanced.sort(
                    args.get("file"),
                    args.get("reverse", False),
                    args.get("numeric", False),
                    args.get("unique", False),
                )
            case "uniq":
                return self.advanced.uniq(args.get("file"), args.get("count", False))
            case "diff":
                return self.advanced.diff(args.get("file1"), args.get("file2"), args.get("unified", True))
            case "sha256sum":
                return self.advanced.sha256sum(args.get("file"))
            case "md5sum":
                return self.advanced.md5sum(args.get("file"))
            # Network Operations
            case "ping":
                return self.advanced.ping(args.get("host"), args.get("count", 4))
            case "curl":
                return self.advanced.curl(
                    args.get("url"),
                    args.get("method", "GET"),
                    args.get("headers"),
                    args.get("data"),
                    args.get("follow", True),
                )
            case "wget":
                return self.advanced.wget(args.get("url"), args.get("output"))
            case "nslookup":
                return self.advanced.nslookup(args.get("host"))
            case "dig":
                return self.advanced.dig(args.get("domain"), args.get("type", "A"))
            case "traceroute":
                return self.advanced.traceroute(args.get("host"))
            case "netcat":
                return self.advanced.netcat(args.get("host"), args.get("port"), args.get("listen", False))
            case "tcpdump":
                return self.advanced.tcpdump(args.get("interface", "any"), args.get("count", 10))
            case "nmap":
                return self.advanced.nmap(args.get("target"), args.get("ports"))
            # Interpreters
            case "python":
                return self.advanced.python(args.get("code"))
            case "python_file":
                return self.advanced.python_file(args.get("file"), args.get("args"))
            case "node":
                return self.advanced.node(args.get("code"))
            case "node_file":
                return self.advanced.node_file(args.get("file"), args.get("args"))
            case "ruby":
                return self.advanced.ruby(args.get("code"))
            case "perl":
                return self.advanced.perl(args.get("code"))
            case "bash_script":
                return self.advanced.bash_script(args.get("script"))
            # GitHub/GitLab CLI
            case "gh":
                return self.advanced.gh(args.get("command"))
            case "glab":
                return self.advanced.glab(args.get("command"))
            # Vision Tools
            case "image_analyze":
                return self.vision.image_analyze(
                    args.get("image_path", ""),
                    args.get("prompt", "Describe this image in detail"),
                    args.get("detail_level", "high"),
                )
            case "image_ocr":
                return self.vision.image_ocr(
                    args.get("image_path", ""),
                    args.get("language", "eng"),
                    args.get("extract_tables", False),
                )
            case "image_ocr_cloud":
                return self.vision.image_ocr_cloud(
                    args.get("image_path", ""),
                    args.get("service", "google"),
                )
            case "image_screenshot":
                return self.vision.image_screenshot(
                    args.get("url", ""),
                    args.get("output_path", ""),
                    args.get("full_page", False),
                )
            case "image_describe":
                return self.vision.image_describe(
                    args.get("image_path", ""),
                    args.get("concise", False),
                )
            case "image_compare":
                return self.vision.image_compare(
                    args.get("image1", ""),
                    args.get("image2", ""),
                    args.get("threshold", 0.01),
                )
            case "image_resize":
                return self.vision.image_resize(
                    args.get("image_path", ""),
                    args.get("width"),
                    args.get("height"),
                    args.get("output_path"),
                )
            case "image_convert":
                return self.vision.image_convert(
                    args.get("image_path", ""),
                    args.get("format", "PNG"),
                    args.get("output_path"),
                )
            case "barcode_detect":
                return self.vision.barcode_detect(args.get("image_path", ""))
            case "qrcode_read":
                return self.vision.qrcode_read(args.get("image_path", ""))
            case "qrcode_generate":
                return self.vision.qrcode_generate(
                    args.get("data", ""),
                    args.get("output_path", ""),
                )
            # Browser Tools
            case "browser_navigate":
                return self.browser.browser_navigate(
                    args.get("url", ""),
                    args.get("wait_until", "networkidle"),
                    args.get("timeout"),
                )
            case "browser_click":
                return self.browser.browser_click(
                    args.get("selector", ""),
                    args.get("timeout", 10000),
                    args.get("force", False),
                )
            case "browser_fill":
                return self.browser.browser_fill(
                    args.get("selector", ""),
                    args.get("value", ""),
                    args.get("timeout", 10000),
                )
            case "browser_type":
                return self.browser.browser_type(
                    args.get("selector", ""),
                    args.get("text", ""),
                    args.get("delay", 100),
                    args.get("timeout", 10000),
                )
            case "browser_press":
                return self.browser.browser_press(
                    args.get("selector", ""),
                    args.get("key", ""),
                    args.get("timeout", 10000),
                )
            case "browser_screenshot":
                return self.browser.browser_screenshot(
                    args.get("output_path", ""),
                    args.get("selector"),
                    args.get("full_page", False),
                )
            case "browser_html":
                return self.browser.browser_html(args.get("selector"))
            case "browser_text":
                return self.browser.browser_text(args.get("selector"))
            case "browser_links":
                return self.browser.browser_links()
            case "browser_forms":
                return self.browser.browser_forms()
            case "browser_evaluate":
                return self.browser.browser_evaluate(args.get("script", ""))
            case "browser_download":
                return self.browser.browser_download(args.get("url", ""))
            case "browser_cookies":
                return self.browser.browser_cookies(args.get("action", "get"))
            case "browser_pdf":
                return self.browser.browser_pdf(args.get("output_path", ""))
            case "browser_console":
                return self.browser.browser_console()
            # Enhanced Web Tools
            case "web_fetch_render":
                return self.enhanced_web.web_fetch_render(
                    args.get("url", ""),
                    args.get("wait_for_selector"),
                    args.get("wait_for_network_idle", True),
                    args.get("timeout", 60000),
                    args.get("output_format", "text"),
                )
            case "web_scrape":
                return self.enhanced_web.web_scrape(
                    args.get("url", ""),
                    args.get("selectors", {}),
                    args.get("output_format", "json"),
                    args.get("render", False),
                    args.get("timeout", 30000),
                )
            case "api_get":
                return self.enhanced_web.api_get(
                    args.get("url", ""),
                    args.get("headers"),
                    args.get("params"),
                    args.get("timeout", 30),
                    args.get("format_response", True),
                )
            case "api_post":
                return self.enhanced_web.api_post(
                    args.get("url", ""),
                    args.get("data"),
                    args.get("json_data"),
                    args.get("headers"),
                    args.get("timeout", 30),
                    args.get("format_response", True),
                )
            case "api_graphql":
                return self.enhanced_web.api_graphql(
                    args.get("url", ""),
                    args.get("query", ""),
                    args.get("variables"),
                    args.get("timeout", 30),
                    args.get("format_response", True),
                )
            case "extract_text":
                return self.enhanced_web.extract_text(
                    args.get("url", ""),
                    args.get("render", False),
                )
            case "extract_links":
                return self.enhanced_web.extract_links(
                    args.get("url", ""),
                    args.get("render", False),
                )
            case "extract_images":
                return self.enhanced_web.extract_images(
                    args.get("url", ""),
                    args.get("render", False),
                )
            case "check_website_status":
                return self.enhanced_web.check_website_status(args.get("url", ""))
            case "search_ddg":
                query = args.get("query") or args.get("q") or ""
                return self.advanced.web_search(
                    query,
                    "duckduckgo",
                    args.get("num_results", 10),
                )
            case "search_github":
                return self.enhanced_web.search_github(
                    args.get("query", ""),
                    args.get("type", "repo"),
                    args.get("num_results", 10),
                )
            case "search_npm":
                return self.enhanced_web.search_npm(
                    args.get("query", ""),
                    args.get("num_results", 10),
                )
            case "search_pypi":
                return self.enhanced_web.search_pypi(
                    args.get("query", ""),
                    args.get("num_results", 10),
                )
            case "search_dockerhub":
                return self.enhanced_web.search_dockerhub(
                    args.get("query", ""),
                    args.get("num_results", 10),
                )
            # MCP Tools
            case "mcp_list_servers":
                return self.mcp.mcp_list_servers()
            case "mcp_connect":
                return self.mcp.mcp_connect(
                    args.get("server_name", ""),
                    args.get("command", ""),
                    args.get("args"),
                    args.get("env_vars"),
                )
            case "mcp_disconnect":
                return self.mcp.mcp_disconnect(args.get("server_name", ""))
            case "mcp_list_tools":
                return self.mcp.mcp_list_tools(args.get("server_name"))
            case "mcp_call_tool":
                return self.mcp.mcp_call_tool(
                    args.get("server_name", ""),
                    args.get("tool_name", ""),
                    args.get("arguments"),
                )
            case "mcp_list_resources":
                return self.mcp.mcp_list_resources(args.get("server_name"))
            case "mcp_read_resource":
                return self.mcp.mcp_read_resource(
                    args.get("server_name", ""),
                    args.get("uri", ""),
                )
            case "mcp_list_prompts":
                return self.mcp.mcp_list_prompts(args.get("server_name"))
            case "mcp_get_prompt":
                return self.mcp.mcp_get_prompt(
                    args.get("server_name", ""),
                    args.get("prompt_name", ""),
                    args.get("arguments"),
                )
            case "mcp_configure":
                return self.mcp.mcp_configure(
                    args.get("server_name", ""),
                    args.get("command", ""),
                    args.get("args"),
                    args.get("env_vars"),
                )
            # Tool Builder
            case "tool_create_shell":
                return self.tool_builder.tool_create_shell(
                    args.get("name", ""),
                    args.get("command", ""),
                    args.get("description", ""),
                    args.get("arguments"),
                    args.get("output_file"),
                )
            case "tool_create_python":
                return self.tool_builder.tool_create_python(
                    args.get("name", ""),
                    args.get("code", ""),
                    args.get("description", ""),
                    args.get("function_name", "run"),
                    args.get("output_file"),
                )
            case "tool_create_api":
                return self.tool_builder.tool_create_api(
                    args.get("name", ""),
                    args.get("base_url", ""),
                    args.get("endpoints", []),
                    args.get("description", ""),
                    args.get("output_file"),
                )
            case "tool_list":
                return self.tool_builder.tool_list()
            case "tool_delete":
                return self.tool_builder.tool_delete(args.get("name", ""))
            case "tool_edit":
                return self.tool_builder.tool_edit(
                    args.get("name", ""),
                    args.get("command"),
                    args.get("description"),
                )
            case "tool_export":
                return self.tool_builder.tool_export(
                    args.get("name", ""),
                    args.get("format", "json"),
                    args.get("output_path", ""),
                )
            case "tool_import":
                return self.tool_builder.tool_import(
                    args.get("source_path", ""),
                    args.get("format", "json"),
                )
            case "tool_clone":
                return self.tool_builder.tool_clone(
                    args.get("source_name", ""),
                    args.get("new_name", ""),
                )
            case "tool_validate":
                return self.tool_builder.tool_validate(
                    args.get("command", ""),
                    args.get("description", ""),
                )
            case "tool_template":
                return self.tool_builder.tool_template(
                    args.get("tool_type", "shell"),
                    args.get("name", ""),
                )
            # Streaming Tools
            case "stream_chat":
                return self.streaming.stream_chat(
                    args.get("prompt", ""),
                    args.get("output_path", ""),
                    args.get("model"),
                    args.get("context_prompt"),
                    args.get("append", False),
                )
            case "stream_append":
                return self.streaming.stream_append(
                    args.get("content", ""),
                    args.get("output_path", ""),
                )
            case "stream_lines":
                return self.streaming.stream_lines(
                    args.get("lines", []),
                    args.get("output_path", ""),
                )
            case "stream_json":
                return self.streaming.stream_json(
                    args.get("data", {}),
                    args.get("output_path", ""),
                    args.get("indent", 2),
                )
            case "stream_jsonl":
                return self.streaming.stream_jsonl(
                    args.get("records", []),
                    args.get("output_path", ""),
                )
            case "stream_csv":
                return self.streaming.stream_csv(
                    args.get("headers", []),
                    args.get("rows", []),
                    args.get("output_path", ""),
                )
            case "stream_xml":
                return self.streaming.stream_xml(
                    args.get("root_element", ""),
                    args.get("records", []),
                    args.get("output_path", ""),
                    args.get("root_attributes"),
                )
            case "stream_yaml":
                return self.streaming.stream_yaml(
                    args.get("data", {}),
                    args.get("output_path", ""),
                )
            case "stream_markdown":
                return self.streaming.stream_markdown(
                    args.get("headers", []),
                    args.get("rows", []),
                    args.get("output_path", ""),
                )
            case "stream_table":
                return self.streaming.stream_table(
                    args.get("headers", []),
                    args.get("rows", []),
                    args.get("output_path", ""),
                    args.get("format", "grid"),
                )
            case "stream_diff":
                return self.streaming.stream_diff(
                    args.get("file1", ""),
                    args.get("file2", ""),
                    args.get("output_path", ""),
                )
            case "stream_log":
                return self.streaming.stream_log(
                    args.get("message", ""),
                    args.get("level", "info"),
                    args.get("output_path", ""),
                )
            case "file_tail":
                return self.streaming.file_tail(
                    args.get("path", ""),
                    args.get("lines", 10),
                    args.get("follow", False),
                )
            case "file_watch":
                return self.streaming.file_watch(
                    args.get("path", ""),
                    args.get("pattern", ""),
                    args.get("timeout", 30),
                )
            # Delegate/Minion Tools
            case "delegate_create":
                return ToolResult(
                    True,
                    self.delegates.create_delegate(
                        args.get("name", ""),
                        args.get("prompt", ""),
                        args.get("parent_id"),
                        args.get("metadata"),
                    ),
                )
            case "delegate_list":
                state_filter = args.get("state")
                if state_filter:
                    state_enum = DelegateState(state_filter)
                    delegates = self.delegates.list_delegates(state=state_enum)
                else:
                    delegates = self.delegates.list_delegates()
                return ToolResult(True, "\n".join([d.to_dict() for d in delegates]))
            case "delegate_get":
                delegate = self.delegates.get_delegate(args.get("delegate_id", ""))
                if delegate:
                    return ToolResult(True, delegate.to_dict())
                return ToolResult(False, "Delegate not found")
            case "delegate_cancel":
                return ToolResult(
                    True,
                    str(self.delegates.cancel_delegate(args.get("delegate_id", ""))),
                )
            case "delegate_tree":
                tree = self.delegates.get_delegate_tree(args.get("root_id", ""))
                return ToolResult(True, "\n".join([t.to_dict() for t in tree]))
            # Project Context Tools
            case "context_load":
                content = self.project_context.load(force=args.get("force", False))
                if content:
                    return ToolResult(True, content)
                return ToolResult(False, "No PROJECT.md found")
            case "context_summary":
                summary = self.project_context.get_summary()
                return ToolResult(True, str(summary))
            case "context_sections":
                sections = self.project_context.extract_sections()
                return ToolResult(True, "\n".join([f"## {k}\n{v}" for k, v in sections.items()]))
            case "context_rules":
                rules = self.project_context.get_global_rules()
                return ToolResult(True, "\n".join([f"- {r}" for r in rules]))
            case "context_personas":
                personas = self.project_context.get_personas()
                return ToolResult(True, "\n".join([p["content"] for p in personas]))
            # Task Graph Tools
            case "task_create":
                from datetime import datetime

                due_date = args.get("due_date")
                if due_date:
                    due_date = datetime.fromisoformat(due_date)
                return ToolResult(
                    True,
                    self.task_graph.create_task(
                        args.get("title", ""),
                        args.get("description", ""),
                        TaskPriority(args.get("priority", 2)),
                        args.get("assignee"),
                        args.get("tags"),
                        due_date,
                        args.get("metadata"),
                    ),
                )
            case "task_get":
                task = self.task_graph.get_task(args.get("task_id", ""))
                if task:
                    return ToolResult(True, task.to_dict())
                return ToolResult(False, "Task not found")
            case "task_update":
                status_val = args.get("status")
                status = TaskStatus(status_val) if status_val else None
                priority_val = args.get("priority")
                priority = TaskPriority(priority_val) if priority_val else None
                return ToolResult(
                    True,
                    str(
                        self.task_graph.update_task(
                            args.get("task_id", ""),
                            args.get("title"),
                            args.get("description"),
                            status,
                            priority,
                            args.get("assignee"),
                            args.get("tags"),
                            None,
                            args.get("metadata"),
                        )
                    ),
                )
            case "task_add_dep":
                return ToolResult(
                    True,
                    str(
                        self.task_graph.add_dependency(
                            args.get("task_id", ""),
                            args.get("depends_on_id", ""),
                        )
                    ),
                )
            case "task_schedulable":
                tasks = self.task_graph.get_schedulable_tasks()
                return ToolResult(True, "\n".join([t.to_dict() for t in tasks]))
            case "task_blocked":
                tasks = self.task_graph.get_blocked_tasks()
                return ToolResult(True, "\n".join([t.to_dict() for t in tasks]))
            case "task_stats":
                stats = self.task_graph.get_statistics()
                return ToolResult(True, str(stats))
            # Blueprint Tools
            case "blueprint_create":
                return ToolResult(
                    True,
                    self.blueprints.create_blueprint(
                        args.get("name", ""),
                        args.get("description", ""),
                        args.get("version", "1.0.0"),
                        args.get("metadata"),
                    ),
                )
            case "blueprint_get":
                blueprint = self.blueprints.get_blueprint(args.get("blueprint_id", ""))
                if blueprint:
                    return ToolResult(True, blueprint.to_dict())
                return ToolResult(False, "Blueprint not found")
            case "blueprint_add_section":
                section_type = BlueprintSectionType(args.get("section_type", "note"))
                return ToolResult(
                    True,
                    self.blueprints.add_section(
                        args.get("blueprint_id", ""),
                        args.get("title", ""),
                        section_type,
                        args.get("content", ""),
                        args.get("priority", 0),
                        args.get("parent_id"),
                        args.get("metadata"),
                    )
                    or "Failed to add section",
                )
            case "blueprint_export":
                blueprint_id = args.get("blueprint_id", "")
                output_path = args.get("output_path")
                if output_path:
                    output_path = Path(output_path)
                markdown = self.blueprints.export_to_file(blueprint_id, output_path)
                return ToolResult(True, markdown)
            case "blueprint_list":
                blueprints = self.blueprints.list_blueprints()
                return ToolResult(True, "\n".join([b.to_dict() for b in blueprints]))
            # Automation Tools
            case "automation_create":
                return ToolResult(
                    True,
                    self.automations.create_automation(
                        args.get("name", ""),
                        args.get("description", ""),
                        None,
                        None,
                        AutomationState(args.get("state", "active")),
                        args.get("metadata"),
                    ),
                )
            case "automation_get":
                automation = self.automations.get_automation(args.get("automation_id", ""))
                if automation:
                    return ToolResult(True, automation.to_dict())
                return ToolResult(False, "Automation not found")
            case "automation_list":
                automations = self.automations.list_automations()
                return ToolResult(True, "\n".join([a.to_dict() for a in automations]))
            case "automation_add_trigger":
                trigger = Trigger(
                    TriggerType(args.get("trigger_type", "command")),
                    args.get("condition", "True"),
                    args.get("params", {}),
                )
                return ToolResult(
                    True,
                    str(self.automations.add_trigger(args.get("automation_id", ""), trigger)),
                )
            case "automation_add_action":
                action = Action(
                    ActionType(args.get("action_type", "notify")),
                    args.get("params", {}),
                    args.get("continue_on_failure", False),
                )
                return ToolResult(
                    True,
                    str(self.automations.add_action(args.get("automation_id", ""), action)),
                )
            case "automation_stats":
                stats = self.automations.get_statistics()
                return ToolResult(True, str(stats))

        spec = self.registry.get(tool)
        if spec and spec.kind == "external":
            if not self.config.allow_external and not self.config.default_yolo:
                return ToolResult(
                    False,
                    "External tools disabled. Use /allow-all or /permissions external on.",
                )
            if not spec.command:
                return ToolResult(False, "External tool is missing command.")
            # Command templates can reference args by {key}
            try:
                command = spec.command.format(**args)
            except KeyError as exc:
                return ToolResult(False, f"Missing argument for tool: {exc}")
            return self.sandbox.run_shell(command)

        return ToolResult(False, f"Unknown tool: {tool}")
