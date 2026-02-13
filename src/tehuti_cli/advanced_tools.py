"""
Tehuti Advanced Tools - Maximum Execution Capabilities

Provides tools for:
- Advanced shell execution with full system access
- Web search and browsing
- Database operations
- Container management (Docker)
- Package management
- Git operations
- Build and deployment
- Testing frameworks
- Cloud operations
"""

from __future__ import annotations

import json
import os
import re
import shlex
import shutil
import subprocess
import time
import urllib.parse
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

import httpx

from tehuti_cli.storage.config import Config


# ToolResult is defined here to avoid circular imports with runtime.py
@dataclass
class ToolResult:
    ok: bool
    output: str
    error_code: str | None = None
    error_category: str | None = None
    retryable: bool | None = None


# External tools that require availability checks
EXTERNAL_TOOLS = {
    "docker": "docker",
    "docker_compose": "docker-compose",
    "kubectl": "kubectl",
    "terraform": "terraform",
    "ansible_playbook": "ansible-playbook",
    "nmap": "nmap",
    "tcpdump": "tcpdump",
    "gh": "gh",
    "glab": "glab",
    "cargo": "cargo",
    "go": "go",
    "node": "node",
    "npm": "npm",
    "ruby": "ruby",
    "perl": "perl",
    "psql": "psql",
    "mysql": "mysql",
    "redis_cli": "redis-cli",
    "gradle": "gradle",
    "maven": "mvn",
    "helm": "helm",
    "aws": "aws",
    "gcloud": "gcloud",
    "azure": "az",
}

INSTALL_HINTS = {
    "docker": "Install Docker from https://docker.com/",
    "docker_compose": "Install Docker Compose with 'pip install docker-compose'",
    "kubectl": "Install kubectl from https://kubernetes.io/docs/tasks/tools/",
    "terraform": "Install Terraform from https://www.terraform.io/",
    "ansible_playbook": "Install Ansible with 'pip install ansible'",
    "nmap": "Install nmap with 'apt install nmap'",
    "tcpdump": "Install tcpdump with 'apt install tcpdump'",
    "gh": "Install GitHub CLI from https://cli.github.com/",
    "glab": "Install GitLab CLI from https://gitlab.com/gitlab-org/cli",
    "cargo": "Install Rust from https://rustup.rs/",
    "go": "Install Go from https://golang.org/",
    "node": "Install Node.js from https://nodejs.org/",
    "npm": "Install npm with Node.js",
    "ruby": "Install Ruby from https://ruby-lang.org/",
    "perl": "Install Perl",
    "psql": "Install PostgreSQL client with 'apt install postgresql-client'",
    "mysql": "Install MySQL client with 'apt install mysql-client'",
    "redis_cli": "Install Redis with 'apt install redis-tools'",
    "gradle": "Install Gradle from https://gradle.org/",
    "maven": "Install Maven from https://maven.apache.org/",
    "helm": "Install Helm from https://helm.sh/",
    "aws": "Install AWS CLI from https://aws.amazon.com/cli/",
    "gcloud": "Install gcloud CLI from https://cloud.google.com/sdk",
    "azure": "Install Azure CLI from https://docs.microsoft.com/cli/azure/install-azure-cli",
}


class AdvancedToolSuite:
    """Advanced tools for maximum execution capabilities."""

    def __init__(self, config: Config, work_dir: Path):
        self.config = config
        self.work_dir = work_dir.resolve()
        self._env = os.environ.copy()
        self._env["PYTHONIOENCODING"] = "utf-8"
        self._env["DEBIAN_FRONTEND"] = "noninteractive"
        self._tool_cache: dict[str, bool] = {}

    def _is_tool_available(self, tool_command: str) -> bool:
        """Check if a tool is available in PATH with caching."""
        if tool_command in self._tool_cache:
            return self._tool_cache[tool_command]

        available = shutil.which(tool_command) is not None
        self._tool_cache[tool_command] = available
        return available

    def _check_external_tool(self, tool_name: str) -> ToolResult:
        """Check if an external tool is available, return error if not."""
        command = EXTERNAL_TOOLS.get(tool_name, tool_name)
        if not self._is_tool_available(command):
            hint = INSTALL_HINTS.get(
                tool_name, f"Install {tool_name} to use this feature."
            )
            return ToolResult(
                False,
                f"Tool '{tool_name}' is not installed or not in PATH.\n{hint}\n"
                f"Run 'tehuti tools' to check available tools.",
            )
        return ToolResult(True, "")

    def _run_command(
        self,
        command: str | list[str],
        shell: bool = True,
        cwd: Optional[Path] = None,
        timeout: int = 300,
        capture_output: bool = True,
        env: Optional[dict] = None,
    ) -> ToolResult:
        """Execute a command with full capability support."""
        try:
            working_dir = cwd or self.work_dir

            # Merge environment
            run_env = self._env.copy()
            if env:
                run_env.update(env)

            if isinstance(command, list):
                cmd = command
                shell = False
            else:
                cmd = command
                shell = True

            if capture_output:
                proc = subprocess.run(
                    cmd,
                    shell=shell,
                    cwd=str(working_dir),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    env=run_env,
                    timeout=timeout,
                )
                return ToolResult(proc.returncode == 0, proc.stdout or "")
            else:
                # For interactive commands, just run and return success
                proc = subprocess.Popen(
                    cmd,
                    shell=shell,
                    cwd=str(working_dir),
                    env=run_env,
                )
                return_code = proc.wait(timeout=timeout)
                return ToolResult(
                    return_code == 0, f"Process completed with code {return_code}"
                )

        except subprocess.TimeoutExpired:
            return ToolResult(False, f"Command timed out after {timeout}s")
        except Exception as exc:
            return ToolResult(False, f"Execution error: {str(exc)}")

    # =========================================================================
    # WEB SEARCH & BROWSING
    # =========================================================================

    def web_search(
        self, query: str, engine: str = "duckduckgo", num_results: int = 10
    ) -> ToolResult:
        """Search the web using various search engines."""
        try:
            if engine == "duckduckgo":
                return self._search_duckduckgo(query, num_results)
            elif engine == "google":
                return self._search_google(query, num_results)
            elif engine == "bing":
                return self._search_bing(query, num_results)
            else:
                return ToolResult(False, f"Unknown search engine: {engine}")
        except Exception as exc:
            return ToolResult(False, f"Search error: {str(exc)}")

    def _search_duckduckgo(self, query: str, num_results: int) -> ToolResult:
        """Search using DuckDuckGo HTML interface."""
        try:
            url = f"https://html.duckduckgo.com/html/?q={urllib.parse.quote(query)}"

            with httpx.Client(timeout=30.0, follow_redirects=True) as client:
                headers = {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                }
                resp = client.get(url, headers=headers)
                resp.raise_for_status()

                # Parse results
                html = resp.text
                results = []

                # Extract results using regex
                result_blocks = re.findall(
                    r'<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>.*?<a[^>]*class="result__snippet"[^>]*>(.*?)</a>',
                    html,
                    re.DOTALL | re.IGNORECASE,
                )

                for i, (link, title, snippet) in enumerate(
                    result_blocks[:num_results], 1
                ):
                    # Clean up HTML entities
                    title = re.sub(r"<[^>]+>", "", title)
                    snippet = re.sub(r"<[^>]+>", "", snippet)
                    title = title.replace("&quot;", '"').replace("&amp;", "&")
                    snippet = snippet.replace("&quot;", '"').replace("&amp;", "&")

                    results.append(
                        {
                            "rank": i,
                            "title": title.strip(),
                            "url": link,
                            "snippet": snippet.strip()[:200] + "..."
                            if len(snippet) > 200
                            else snippet.strip(),
                        }
                    )

                output = f"Search results for: '{query}'\n\n"
                for r in results:
                    output += f"{r['rank']}. {r['title']}\n"
                    output += f"   URL: {r['url']}\n"
                    output += f"   {r['snippet']}\n\n"

                return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"DuckDuckGo search failed: {str(exc)}")

    def _search_google(self, query: str, num_results: int) -> ToolResult:
        """Search using Google (requires API key or scraping)."""
        # For now, return a message about using DuckDuckGo
        return ToolResult(
            False, "Google search requires API key. Use engine='duckduckgo' instead."
        )

    def _search_bing(self, query: str, num_results: int) -> ToolResult:
        """Search using Bing (requires API key)."""
        return ToolResult(
            False, "Bing search requires API key. Use engine='duckduckgo' instead."
        )

    def web_fetch(
        self,
        url: str,
        method: str = "GET",
        headers: Optional[dict] = None,
        data: Optional[str] = None,
        timeout: int = 30,
    ) -> ToolResult:
        """Advanced web fetching with full HTTP capability."""
        try:
            default_headers = {
                "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5",
                "Accept-Encoding": "gzip, deflate, br",
                "DNT": "1",
                "Connection": "keep-alive",
            }

            if headers:
                default_headers.update(headers)

            with httpx.Client(timeout=timeout, follow_redirects=True) as client:
                if method.upper() == "GET":
                    resp = client.get(url, headers=default_headers)
                elif method.upper() == "POST":
                    resp = client.post(url, headers=default_headers, data=data)
                elif method.upper() == "PUT":
                    resp = client.put(url, headers=default_headers, data=data)
                elif method.upper() == "DELETE":
                    resp = client.delete(url, headers=default_headers)
                else:
                    return ToolResult(False, f"Unsupported HTTP method: {method}")

                # Format response
                output = f"Status: {resp.status_code}\n"
                output += f"Headers:\n"
                for key, value in resp.headers.items():
                    output += f"  {key}: {value}\n"
                output += f"\nBody:\n{resp.text[:10000]}"  # Limit to 10k chars

                return ToolResult(resp.status_code < 400, output)

        except Exception as exc:
            return ToolResult(False, f"Fetch error: {str(exc)}")

    # =========================================================================
    # CONTAINER MANAGEMENT (Docker)
    # =========================================================================

    def docker_ps(self, all_containers: bool = True) -> ToolResult:
        """List Docker containers."""
        check = self._check_external_tool("docker")
        if not check.ok:
            return check
        cmd = "docker ps"
        if all_containers:
            cmd += " -a"
        return self._run_command(cmd)

    def docker_images(self) -> ToolResult:
        """List Docker images."""
        check = self._check_external_tool("docker")
        if not check.ok:
            return check
        return self._run_command("docker images")

    def docker_run(
        self,
        image: str,
        command: Optional[str] = None,
        detach: bool = False,
        ports: Optional[list] = None,
        volumes: Optional[list] = None,
        env: Optional[dict] = None,
        name: Optional[str] = None,
    ) -> ToolResult:
        """Run a Docker container."""
        check = self._check_external_tool("docker")
        if not check.ok:
            return check
        cmd_parts = ["docker run"]

        if detach:
            cmd_parts.append("-d")
        if name:
            cmd_parts.extend(["--name", name])
        if ports:
            for port in ports:
                cmd_parts.extend(["-p", port])
        if volumes:
            for vol in volumes:
                cmd_parts.extend(["-v", vol])
        if env:
            for key, value in env.items():
                cmd_parts.extend(["-e", f"{key}={value}"])

        cmd_parts.append(image)
        if command:
            cmd_parts.append(command)

        return self._run_command(" ".join(cmd_parts))

    def docker_build(
        self, path: str, tag: str, dockerfile: Optional[str] = None
    ) -> ToolResult:
        """Build a Docker image."""
        check = self._check_external_tool("docker")
        if not check.ok:
            return check
        cmd_parts = ["docker build", "-t", tag]
        if dockerfile:
            cmd_parts.extend(["-f", dockerfile])
        cmd_parts.append(path)
        return self._run_command(" ".join(cmd_parts))

    def docker_exec(self, container: str, command: str) -> ToolResult:
        """Execute command in running container."""
        check = self._check_external_tool("docker")
        if not check.ok:
            return check
        return self._run_command(f"docker exec {container} {command}")

    def docker_logs(
        self, container: str, tail: int = 100, follow: bool = False
    ) -> ToolResult:
        """Get container logs."""
        check = self._check_external_tool("docker")
        if not check.ok:
            return check
        cmd = f"docker logs --tail {tail}"
        if follow:
            cmd += " -f"
        cmd += f" {container}"
        return self._run_command(cmd)

    def docker_compose(self, command: str, file: Optional[str] = None) -> ToolResult:
        """Run docker-compose commands."""
        check = self._check_external_tool("docker_compose")
        if not check.ok:
            return check
        cmd = "docker-compose"
        if file:
            cmd += f" -f {file}"
        cmd += f" {command}"
        return self._run_command(cmd)

    # =========================================================================
    # PACKAGE MANAGEMENT
    # =========================================================================

    def apt_install(self, packages: list[str], update_first: bool = True) -> ToolResult:
        """Install packages using apt."""
        if update_first:
            self._run_command("apt-get update", timeout=120)

        cmd = f"apt-get install -y {' '.join(packages)}"
        return self._run_command(cmd, timeout=300)

    def pip_install(self, packages: list[str], upgrade: bool = False) -> ToolResult:
        """Install Python packages using pip."""
        cmd = "pip install"
        if upgrade:
            cmd += " --upgrade"
        cmd += f" {' '.join(packages)}"
        return self._run_command(cmd, timeout=180)

    def npm_install(
        self, packages: Optional[list[str]] = None, global_install: bool = False
    ) -> ToolResult:
        """Install npm packages."""
        if packages:
            cmd = "npm install"
            if global_install:
                cmd += " -g"
            cmd += f" {' '.join(packages)}"
        else:
            cmd = "npm install"
        return self._run_command(cmd, timeout=180)

    # =========================================================================
    # DATABASE OPERATIONS
    # =========================================================================

    def psql(
        self,
        database: str,
        query: str,
        host: str = "localhost",
        port: int = 5432,
        username: str = "postgres",
    ) -> ToolResult:
        """Execute PostgreSQL query."""
        check = self._check_external_tool("psql")
        if not check.ok:
            return check
        cmd = f"PGPASSWORD=$PGPASSWORD psql -h {host} -p {port} -U {username} -d {database} -c '{query}'"
        return self._run_command(cmd)

    def mysql(
        self,
        database: str,
        query: str,
        host: str = "localhost",
        port: int = 3306,
        username: str = "root",
    ) -> ToolResult:
        """Execute MySQL query."""
        check = self._check_external_tool("mysql")
        if not check.ok:
            return check
        cmd = f"mysql -h {host} -P {port} -u {username} -p$MYSQL_PASSWORD {database} -e '{query}'"
        return self._run_command(cmd)

    def redis_cli(
        self, command: str, host: str = "localhost", port: int = 6379
    ) -> ToolResult:
        """Execute Redis command."""
        check = self._check_external_tool("redis_cli")
        if not check.ok:
            return check
        cmd = f"redis-cli -h {host} -p {port} {command}"
        return self._run_command(cmd)

    # =========================================================================
    # GIT OPERATIONS
    # =========================================================================

    def git_status(self) -> ToolResult:
        """Get git status."""
        return self._run_command("git status")

    def git_log(self, num_commits: int = 10, oneline: bool = True) -> ToolResult:
        """Get git log."""
        cmd = f"git log -n {num_commits}"
        if oneline:
            cmd += " --oneline"
        return self._run_command(cmd)

    def git_branch(self, all_branches: bool = True) -> ToolResult:
        """List git branches."""
        cmd = "git branch"
        if all_branches:
            cmd += " -a"
        return self._run_command(cmd)

    def git_diff(self, staged: bool = False, file: Optional[str] = None) -> ToolResult:
        """Show git diff."""
        cmd = "git diff"
        if staged:
            cmd += " --staged"
        if file:
            cmd += f" {file}"
        return self._run_command(cmd)

    def git_push(
        self, remote: str = "origin", branch: Optional[str] = None
    ) -> ToolResult:
        """Push to remote."""
        cmd = f"git push {remote}"
        if branch:
            cmd += f" {branch}"
        return self._run_command(cmd)

    def git_pull(
        self, remote: str = "origin", branch: Optional[str] = None
    ) -> ToolResult:
        """Pull from remote."""
        cmd = f"git pull {remote}"
        if branch:
            cmd += f" {branch}"
        return self._run_command(cmd)

    def git_clone(
        self, url: str, directory: Optional[str] = None, branch: Optional[str] = None
    ) -> ToolResult:
        """Clone a repository."""
        cmd = f"git clone"
        if branch:
            cmd += f" -b {branch}"
        cmd += f" {url}"
        if directory:
            cmd += f" {directory}"
        return self._run_command(cmd, timeout=300)

    # =========================================================================
    # BUILD TOOLS
    # =========================================================================

    def make(
        self, target: Optional[str] = None, jobs: Optional[int] = None
    ) -> ToolResult:
        """Run make."""
        cmd = "make"
        if jobs:
            cmd += f" -j{jobs}"
        if target:
            cmd += f" {target}"
        return self._run_command(cmd, timeout=300)

    def cmake(self, source_dir: str = ".", build_dir: str = "build") -> ToolResult:
        """Run cmake."""
        cmd = f"cmake -B {build_dir} -S {source_dir}"
        return self._run_command(cmd, timeout=120)

    def gradle(self, task: str = "build") -> ToolResult:
        """Run Gradle."""
        check = self._check_external_tool("gradle")
        if not check.ok:
            return check
        return self._run_command(f"./gradlew {task}", timeout=300)

    def maven(self, goal: str = "package") -> ToolResult:
        """Run Maven."""
        check = self._check_external_tool("maven")
        if not check.ok:
            return check
        return self._run_command(f"mvn {goal}", timeout=300)

    # =========================================================================
    # TESTING FRAMEWORKS
    # =========================================================================

    def pytest(
        self, path: str = ".", verbose: bool = True, cov: Optional[str] = None
    ) -> ToolResult:
        """Run pytest."""
        cmd = "pytest"
        if verbose:
            cmd += " -v"
        if cov:
            cmd += f" --cov={cov}"
        cmd += f" {path}"
        return self._run_command(cmd, timeout=300)

    def unittest(self, path: str = ".", pattern: str = "test*.py") -> ToolResult:
        """Run Python unittest."""
        cmd = f"python -m unittest discover -s {path} -p '{pattern}' -v"
        return self._run_command(cmd, timeout=300)

    def jest(self, path: str = ".", watch: bool = False) -> ToolResult:
        """Run Jest tests."""
        cmd = "jest"
        if watch:
            cmd += " --watch"
        cmd += f" {path}"
        return self._run_command(cmd, timeout=300)

    def cargo_test(self, package: Optional[str] = None) -> ToolResult:
        """Run Rust tests."""
        check = self._check_external_tool("cargo")
        if not check.ok:
            return check
        cmd = "cargo test"
        if package:
            cmd += f" -p {package}"
        return self._run_command(cmd, timeout=300)

    def go_test(self, path: str = "./...", verbose: bool = True) -> ToolResult:
        """Run Go tests."""
        check = self._check_external_tool("go")
        if not check.ok:
            return check
        cmd = "go test"
        if verbose:
            cmd += " -v"
        cmd += f" {path}"
        return self._run_command(cmd, timeout=300)

    # =========================================================================
    # DEPLOYMENT & CLOUD
    # =========================================================================

    def ssh(
        self,
        host: str,
        command: str,
        user: Optional[str] = None,
        port: int = 22,
        key: Optional[str] = None,
    ) -> ToolResult:
        """Execute SSH command."""
        cmd = "ssh"
        if port != 22:
            cmd += f" -p {port}"
        if key:
            cmd += f" -i {key}"
        if user:
            cmd += f" {user}@{host}"
        else:
            cmd += f" {host}"
        cmd += f" '{command}'"
        return self._run_command(cmd, timeout=300)

    def rsync(
        self,
        source: str,
        destination: str,
        delete: bool = False,
        exclude: Optional[list] = None,
    ) -> ToolResult:
        """Sync files with rsync."""
        cmd = "rsync -avz"
        if delete:
            cmd += " --delete"
        if exclude:
            for pattern in exclude:
                cmd += f" --exclude='{pattern}'"
        cmd += f" {source} {destination}"
        return self._run_command(cmd, timeout=300)

    def kubectl(self, command: str, namespace: Optional[str] = None) -> ToolResult:
        """Run kubectl commands."""
        check = self._check_external_tool("kubectl")
        if not check.ok:
            return check
        cmd = f"kubectl {command}"
        if namespace:
            cmd += f" -n {namespace}"
        return self._run_command(cmd, timeout=120)

    def terraform(self, command: str = "plan") -> ToolResult:
        """Run Terraform."""
        check = self._check_external_tool("terraform")
        if not check.ok:
            return check
        return self._run_command(f"terraform {command}", timeout=300)

    def ansible_playbook(
        self, playbook: str, inventory: Optional[str] = None
    ) -> ToolResult:
        """Run Ansible playbook."""
        check = self._check_external_tool("ansible_playbook")
        if not check.ok:
            return check
        cmd = f"ansible-playbook"
        if inventory:
            cmd += f" -i {inventory}"
        cmd += f" {playbook}"
        return self._run_command(cmd, timeout=600)

    # =========================================================================
    # SYSTEM OPERATIONS
    # =========================================================================

    def systemctl(self, action: str, service: str) -> ToolResult:
        """Control systemd services."""
        return self._run_command(f"systemctl {action} {service}", timeout=60)

    def service(self, name: str, action: str) -> ToolResult:
        """Control services."""
        return self._run_command(f"service {name} {action}", timeout=60)

    def journalctl(
        self, service: Optional[str] = None, lines: int = 100, follow: bool = False
    ) -> ToolResult:
        """View system logs."""
        cmd = "journalctl"
        if service:
            cmd += f" -u {service}"
        cmd += f" -n {lines}"
        if follow:
            cmd += " -f"
        return self._run_command(cmd, timeout=60)

    def crontab(self, user: Optional[str] = None, list_only: bool = True) -> ToolResult:
        """Manage cron jobs."""
        cmd = "crontab"
        if user:
            cmd += f" -u {user}"
        if list_only:
            cmd += " -l"
        return self._run_command(cmd)

    def netstat(self, listening: bool = True, numeric: bool = True) -> ToolResult:
        """Show network connections."""
        cmd = "netstat"
        if listening:
            cmd += " -l"
        if numeric:
            cmd += " -n"
        cmd += " -t -u -p"
        return self._run_command(cmd)

    def ss(self, listening: bool = True) -> ToolResult:
        """Show socket statistics."""
        cmd = "ss"
        if listening:
            cmd += " -l"
        cmd += " -t -u -n -p"
        return self._run_command(cmd)

    def lsof(self, port: Optional[int] = None, pid: Optional[int] = None) -> ToolResult:
        """List open files."""
        cmd = "lsof"
        if port:
            cmd += f" -i :{port}"
        if pid:
            cmd += f" -p {pid}"
        if not port and not pid:
            cmd += " -n -P"
        return self._run_command(cmd, timeout=60)

    def ps(self, aux: bool = True) -> ToolResult:
        """List processes."""
        cmd = "ps"
        if aux:
            cmd += " aux"
        return self._run_command(cmd)

    def kill(self, pid: int, signal: str = "TERM") -> ToolResult:
        """Kill a process."""
        return self._run_command(f"kill -{signal} {pid}")

    def df(self, human_readable: bool = True) -> ToolResult:
        """Show disk usage."""
        cmd = "df"
        if human_readable:
            cmd += " -h"
        return self._run_command(cmd)

    def du(
        self, path: str = ".", human_readable: bool = True, summarize: bool = False
    ) -> ToolResult:
        """Show directory usage."""
        cmd = "du"
        if human_readable:
            cmd += " -h"
        if summarize:
            cmd += " -s"
        cmd += f" {path}"
        return self._run_command(cmd, timeout=120)

    def free(self, human_readable: bool = True) -> ToolResult:
        """Show memory usage."""
        cmd = "free"
        if human_readable:
            cmd += " -h"
        return self._run_command(cmd)

    def top(self, batch_mode: bool = True, iterations: int = 1) -> ToolResult:
        """Show system processes."""
        cmd = "top"
        if batch_mode:
            cmd += " -b"
        cmd += f" -n {iterations}"
        return self._run_command(cmd, timeout=60)

    def uptime(self) -> ToolResult:
        """Show system uptime."""
        return self._run_command("uptime")

    def whoami(self) -> ToolResult:
        """Show current user."""
        return self._run_command("whoami")

    def id(self, user: Optional[str] = None) -> ToolResult:
        """Show user ID info."""
        cmd = "id"
        if user:
            cmd += f" {user}"
        return self._run_command(cmd)

    def uname(self, all_info: bool = True) -> ToolResult:
        """Show system information."""
        cmd = "uname"
        if all_info:
            cmd += " -a"
        return self._run_command(cmd)

    def env(self) -> ToolResult:
        """Show environment variables."""
        return self._run_command("env | sort")

    def which(self, command: str) -> ToolResult:
        """Find command path."""
        return self._run_command(f"which {command}")

    # =========================================================================
    # FILE OPERATIONS
    # =========================================================================

    def find(
        self,
        path: str = ".",
        name: Optional[str] = None,
        type: Optional[str] = None,
        size: Optional[str] = None,
        mtime: Optional[int] = None,
    ) -> ToolResult:
        """Find files."""
        cmd = f"find {path}"
        if name:
            cmd += f" -name '{name}'"
        if type:
            cmd += f" -type {type}"
        if size:
            cmd += f" -size {size}"
        if mtime:
            cmd += f" -mtime {mtime}"
        return self._run_command(cmd, timeout=120)

    def glob(
        self,
        pattern: str,
        path: str = ".",
        recursive: bool = True,
        limit: int = 100,
    ) -> ToolResult:
        """Find files matching a glob pattern (e.g., '**/*.py')."""
        try:
            search_path = Path(path)
            if not search_path.exists():
                return ToolResult(False, f"Path not found: {path}")

            matches: list[str] = []
            if recursive:
                for p in search_path.rglob(pattern):
                    if len(matches) >= limit:
                        break
                    matches.append(str(p.relative_to(search_path)))
            else:
                for p in search_path.glob(pattern):
                    if len(matches) >= limit:
                        break
                    matches.append(str(p.relative_to(search_path)))

            matches.sort()
            if len(matches) >= limit:
                output = f"Found {len(matches)} files (showing first {limit}):\n\n"
                output += "\n".join(matches)
                output += f"\n\n... and {len(matches) - limit} more"
            else:
                output = f"Found {len(matches)} file(s):\n\n"
                output += "\n".join(matches)

            return ToolResult(True, output)
        except Exception as exc:
            return ToolResult(False, f"Glob error: {str(exc)}")

    def grep(
        self,
        pattern: str,
        path: str = ".",
        recursive: bool = True,
        ignore_case: bool = False,
        line_numbers: bool = True,
    ) -> ToolResult:
        """Search files with grep."""
        cmd = "grep"
        if recursive:
            cmd += " -r"
        if ignore_case:
            cmd += " -i"
        if line_numbers:
            cmd += " -n"
        cmd += f" '{pattern}' {path}"
        return self._run_command(cmd, timeout=120)

    def sed(self, expression: str, file: str, in_place: bool = False) -> ToolResult:
        """Stream editor."""
        cmd = "sed"
        if in_place:
            cmd += " -i"
        cmd += f" '{expression}' {file}"
        return self._run_command(cmd)

    def awk(self, script: str, file: str) -> ToolResult:
        """Pattern scanning."""
        return self._run_command(f"awk '{script}' {file}")

    def tar(self, action: str, archive: str, files: list[str]) -> ToolResult:
        """Create/extract tar archives."""
        if action == "create":
            cmd = f"tar -czf {archive} {' '.join(files)}"
        elif action == "extract":
            cmd = f"tar -xzf {archive}"
        else:
            return ToolResult(False, f"Unknown tar action: {action}")
        return self._run_command(cmd, timeout=300)

    def zip(self, archive: str, files: list[str]) -> ToolResult:
        """Create zip archive."""
        return self._run_command(f"zip -r {archive} {' '.join(files)}", timeout=300)

    def unzip(self, archive: str, destination: Optional[str] = None) -> ToolResult:
        """Extract zip archive."""
        cmd = f"unzip {archive}"
        if destination:
            cmd += f" -d {destination}"
        return self._run_command(cmd, timeout=300)

    def chmod(self, mode: str, path: str, recursive: bool = False) -> ToolResult:
        """Change file permissions."""
        cmd = "chmod"
        if recursive:
            cmd += " -R"
        cmd += f" {mode} {path}"
        return self._run_command(cmd)

    def chown(self, owner: str, path: str, recursive: bool = False) -> ToolResult:
        """Change file owner."""
        cmd = "chown"
        if recursive:
            cmd += " -R"
        cmd += f" {owner} {path}"
        return self._run_command(cmd)

    def ln(self, target: str, link: str, symbolic: bool = True) -> ToolResult:
        """Create links."""
        cmd = "ln"
        if symbolic:
            cmd += " -s"
        cmd += f" {target} {link}"
        return self._run_command(cmd)

    def mkdir(self, path: str, parents: bool = True) -> ToolResult:
        """Create directories."""
        cmd = "mkdir"
        if parents:
            cmd += " -p"
        cmd += f" {path}"
        return self._run_command(cmd)

    def rm(self, path: str, recursive: bool = False, force: bool = False) -> ToolResult:
        """Remove files/directories."""
        cmd = "rm"
        if recursive:
            cmd += " -r"
        if force:
            cmd += " -f"
        cmd += f" {path}"
        return self._run_command(cmd)

    def cp(self, source: str, destination: str, recursive: bool = False) -> ToolResult:
        """Copy files."""
        cmd = "cp"
        if recursive:
            cmd += " -r"
        cmd += f" {source} {destination}"
        return self._run_command(cmd)

    def mv(self, source: str, destination: str) -> ToolResult:
        """Move files."""
        return self._run_command(f"mv {source} {destination}")

    def ls(
        self,
        path: str = ".",
        long_format: bool = True,
        all_files: bool = False,
        human_readable: bool = True,
    ) -> ToolResult:
        """List directory contents."""
        cmd = "ls"
        if long_format:
            cmd += " -l"
        if all_files:
            cmd += " -a"
        if human_readable:
            cmd += " -h"
        cmd += f" {path}"
        return self._run_command(cmd)

    def cat(self, file: str) -> ToolResult:
        """Display file contents."""
        return self._run_command(f"cat {file}")

    def head(self, file: str, lines: int = 10) -> ToolResult:
        """Show first lines of file."""
        return self._run_command(f"head -n {lines} {file}")

    def tail(self, file: str, lines: int = 10, follow: bool = False) -> ToolResult:
        """Show last lines of file."""
        cmd = f"tail -n {lines}"
        if follow:
            cmd += " -f"
        cmd += f" {file}"
        return self._run_command(cmd, timeout=60 if follow else 10)

    def wc(
        self, file: str, lines: bool = True, words: bool = True, bytes: bool = False
    ) -> ToolResult:
        """Count lines, words, bytes."""
        cmd = "wc"
        if lines:
            cmd += " -l"
        if words:
            cmd += " -w"
        if bytes:
            cmd += " -c"
        cmd += f" {file}"
        return self._run_command(cmd)

    def sort(
        self,
        file: str,
        reverse: bool = False,
        numeric: bool = False,
        unique: bool = False,
    ) -> ToolResult:
        """Sort lines."""
        cmd = "sort"
        if reverse:
            cmd += " -r"
        if numeric:
            cmd += " -n"
        if unique:
            cmd += " -u"
        cmd += f" {file}"
        return self._run_command(cmd)

    def uniq(self, file: str, count: bool = False) -> ToolResult:
        """Report unique lines."""
        cmd = "uniq"
        if count:
            cmd += " -c"
        cmd += f" {file}"
        return self._run_command(cmd)

    def diff(self, file1: str, file2: str, unified: bool = True) -> ToolResult:
        """Compare files."""
        cmd = "diff"
        if unified:
            cmd += " -u"
        cmd += f" {file1} {file2}"
        return self._run_command(cmd)

    def sha256sum(self, file: str) -> ToolResult:
        """Calculate SHA256 checksum."""
        return self._run_command(f"sha256sum {file}")

    def md5sum(self, file: str) -> ToolResult:
        """Calculate MD5 checksum."""
        return self._run_command(f"md5sum {file}")

    # =========================================================================
    # NETWORK OPERATIONS
    # =========================================================================

    def ping(self, host: str, count: int = 4) -> ToolResult:
        """Ping a host."""
        return self._run_command(f"ping -c {count} {host}", timeout=60)

    def curl(
        self,
        url: str,
        method: str = "GET",
        headers: Optional[dict] = None,
        data: Optional[str] = None,
        follow_redirects: bool = True,
    ) -> ToolResult:
        """Transfer data with curl."""
        cmd = "curl"
        if follow_redirects:
            cmd += " -L"
        cmd += f" -X {method.upper()}"

        if headers:
            for key, value in headers.items():
                cmd += f" -H '{key}: {value}'"

        if data:
            cmd += f" -d '{data}'"

        cmd += f" '{url}'"
        return self._run_command(cmd, timeout=60)

    def wget(self, url: str, output: Optional[str] = None) -> ToolResult:
        """Download files."""
        cmd = "wget"
        if output:
            cmd += f" -O {output}"
        cmd += f" '{url}'"
        return self._run_command(cmd, timeout=300)

    def nslookup(self, host: str) -> ToolResult:
        """DNS lookup."""
        return self._run_command(f"nslookup {host}")

    def dig(self, domain: str, record_type: str = "A") -> ToolResult:
        """DNS query."""
        return self._run_command(f"dig {domain} {record_type}")

    def traceroute(self, host: str) -> ToolResult:
        """Trace route."""
        return self._run_command(f"traceroute {host}", timeout=120)

    def netcat(self, host: str, port: int, listen: bool = False) -> ToolResult:
        """Network connections."""
        if listen:
            return self._run_command(f"nc -l {port}", timeout=60)
        else:
            return self._run_command(f"nc {host} {port}", timeout=10)

    def tcpdump(self, interface: str = "any", count: int = 10) -> ToolResult:
        """Network packet analyzer."""
        return self._run_command(f"tcpdump -i {interface} -c {count}", timeout=60)

    def nmap(self, target: str, ports: Optional[str] = None) -> ToolResult:
        """Network scanner."""
        cmd = "nmap"
        if ports:
            cmd += f" -p {ports}"
        cmd += f" {target}"
        return self._run_command(cmd, timeout=300)

    # =========================================================================
    # INTERPRETERS & RUNTIMES
    # =========================================================================

    def python(self, code: str) -> ToolResult:
        """Execute Python code."""
        return self._run_command(f"python3 -c '{code}'", timeout=60)

    def python_file(self, file: str, args: Optional[list] = None) -> ToolResult:
        """Execute Python file."""
        cmd = f"python3 {file}"
        if args:
            cmd += f" {' '.join(args)}"
        return self._run_command(cmd, timeout=300)

    def node(self, code: str) -> ToolResult:
        """Execute Node.js code."""
        check = self._check_external_tool("node")
        if not check.ok:
            return check
        return self._run_command(f"node -e '{code}'", timeout=60)

    def node_file(self, file: str, args: Optional[list] = None) -> ToolResult:
        """Execute Node.js file."""
        check = self._check_external_tool("node")
        if not check.ok:
            return check
        cmd = f"node {file}"
        if args:
            cmd += f" {' '.join(args)}"
        return self._run_command(cmd, timeout=300)

    def ruby(self, code: str) -> ToolResult:
        """Execute Ruby code."""
        return self._run_command(f"ruby -e '{code}'", timeout=60)

    def perl(self, code: str) -> ToolResult:
        """Execute Perl code."""
        return self._run_command(f"perl -e '{code}'", timeout=60)

    def bash_script(self, script: str) -> ToolResult:
        """Execute bash script."""
        return self._run_command(f"bash -c '{script}'", timeout=300)

    # =========================================================================
    # VERSION CONTROL (Extended)
    # =========================================================================

    def gh(self, command: str) -> ToolResult:
        """GitHub CLI."""
        return self._run_command(f"gh {command}", timeout=120)

    def glab(self, command: str) -> ToolResult:
        """GitLab CLI."""
        return self._run_command(f"glab {command}", timeout=120)
