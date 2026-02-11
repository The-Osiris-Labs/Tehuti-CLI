"""
Tehuti Browser Tools - Full Browser Automation

Provides tools for:
- Page navigation and interaction
- Form filling and submission
- Screenshot capture
- JavaScript execution
- Element extraction and analysis
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from tehuti_cli.storage.config import Config
from tehuti_cli.advanced_tools import ToolResult


@dataclass
class BrowserConfig:
    """Browser configuration."""

    headless: bool = True
    viewport_width: int = 1280
    viewport_height: int = 800
    user_agent: str = (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
    timeout: int = 30000
    accept_downloads: bool = True
    bypass_csp: bool = False


class BrowserTools:
    """Full browser automation using Playwright."""

    def __init__(self, config: Config, work_dir: Path):
        self.config = config
        self.work_dir = work_dir.resolve()
        self._browser = None
        self._context = None
        self._page = None
        self._browser_config = BrowserConfig()

    def _ensure_browser(self):
        """Ensure browser is initialized."""
        if self._browser is None:
            from playwright.sync_api import sync_playwright

            p = sync_playwright().start()
            self._browser = p.chromium.launch(headless=self._browser_config.headless)
            self._context = self._browser.new_context(
                viewport={
                    "width": self._browser_config.viewport_width,
                    "height": self._browser_config.viewport_height,
                },
                user_agent=self._browser_config.user_agent,
                accept_downloads=self._browser_config.accept_downloads,
                bypass_csp=self._browser_config.bypass_csp,
            )
            self._page = self._context.new_page()

    def browser_navigate(
        self,
        url: str,
        wait_until: str = "networkidle",
        timeout: int | None = None,
    ) -> ToolResult:
        """Navigate to a URL."""
        try:
            from playwright.sync_api import sync_playwright

            with sync_playwright() as p:
                browser = p.chromium.launch(headless=self._browser_config.headless)
                context = browser.new_context()
                page = context.new_page()

                timeout_ms = timeout or self._browser_config.timeout
                page.goto(url, wait_until=wait_until, timeout=timeout_ms)

                title = page.title()
                current_url = page.url()

                browser.close()

                output = f"## Navigation Successful\n\n"
                output += f"**URL:** {current_url}\n"
                output += f"**Title:** {title}\n"
                output += f"**Wait Condition:** {wait_until}\n"

                return ToolResult(True, output)

        except ImportError:
            return ToolResult(
                False,
                "Playwright not installed. Install with: pip install playwright && playwright install chromium",
            )
        except Exception as exc:
            return ToolResult(False, f"Navigation failed: {str(exc)}")

    def browser_click(
        self,
        selector: str,
        timeout: int = 10000,
        force: bool = False,
    ) -> ToolResult:
        """Click an element by selector."""
        try:
            from playwright.sync_api import sync_playwright

            with sync_playwright() as p:
                browser = p.chromium.launch(headless=self._browser_config.headless)
                page = browser.new_page()

                page.goto("about:blank", wait_until="domcontentloaded")

                element = page.locator(selector)
                element.wait_for(timeout=timeout)

                if force:
                    element.click(force=True)
                else:
                    element.click()

                url = page.url()
                title = page.title()

                browser.close()

                output = f"## Click Successful\n\n"
                output += f"**Selector:** {selector}\n"
                output += f"**Current URL:** {url}\n"
                output += f"**Page Title:** {title}\n"

                return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"Click failed: {str(exc)}")

    def browser_fill(
        self,
        selector: str,
        value: str,
        timeout: int = 10000,
    ) -> ToolResult:
        """Fill a form field."""
        try:
            from playwright.sync_api import sync_playwright

            with sync_playwright() as p:
                browser = p.chromium.launch(headless=self._browser_config.headless)
                page = browser.new_page()

                page.goto("about:blank", wait_until="domcontentloaded")

                element = page.locator(selector)
                element.wait_for(timeout=timeout)

                element.fill(value)

                browser.close()

                output = f"## Form Filled\n\n"
                output += f"**Selector:** {selector}\n"
                output += f"**Value:** {value}\n"

                return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"Fill failed: {str(exc)}")

    def browser_type(
        self,
        selector: str,
        text: str,
        delay: int = 100,
        timeout: int = 10000,
    ) -> ToolResult:
        """Type text into an element."""
        try:
            from playwright.sync_api import sync_playwright

            with sync_playwright() as p:
                browser = p.chromium.launch(headless=self._browser_config.headless)
                page = browser.new_page()

                page.goto("about:blank", wait_until="domcontentloaded")

                element = page.locator(selector)
                element.wait_for(timeout=timeout)

                element.type(text, delay=delay)

                browser.close()

                output = f"## Text Typed\n\n"
                output += f"**Selector:** {selector}\n"
                output += f"**Text:** {text}\n"
                output += f"**Delay:** {delay}ms\n"

                return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"Type failed: {str(exc)}")

    def browser_press(
        self,
        selector: str,
        key: str,
        timeout: int = 10000,
    ) -> ToolResult:
        """Press a key on an element."""
        try:
            from playwright.sync_api import sync_playwright

            with sync_playwright() as p:
                browser = p.chromium.launch(headless=self._browser_config.headless)
                page = browser.new_page()

                page.goto("about:blank", wait_until="domcontentloaded")

                element = page.locator(selector)
                element.wait_for(timeout=timeout)

                element.press(key)

                browser.close()

                output = f"## Key Pressed\n\n"
                output += f"**Selector:** {selector}\n"
                output += f"**Key:** {key}\n"

                return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"Press failed: {str(exc)}")

    def browser_screenshot(
        self,
        url: str,
        output_path: str | None = None,
        selector: str | None = None,
        full_page: bool = False,
        wait_until: str = "networkidle",
        timeout: int = 30000,
    ) -> ToolResult:
        """Take a screenshot of a webpage."""
        try:
            from playwright.sync_api import sync_playwright

            if not output_path:
                import time

                output_path = str(self.work_dir / f"screenshot_{int(time.time())}.png")

            Path(output_path).parent.mkdir(parents=True, exist_ok=True)

            with sync_playwright() as p:
                browser = p.chromium.launch(headless=self._browser_config.headless)
                page = browser.new_page()

                page.goto(url, wait_until=wait_until, timeout=timeout)

                if selector:
                    element = page.locator(selector)
                    element.screenshot(path=output_path)
                else:
                    if full_page:
                        page.screenshot(path=output_path, full_page=True)
                    else:
                        page.screenshot(path=output_path)

                browser.close()

                output = f"## Screenshot Captured\n\n"
                output += f"**URL:** {url}\n"
                output += f"**Output:** {output_path}\n"
                if selector:
                    output += f"**Element:** {selector}\n"
                output += f"**Full Page:** {full_page}\n"

                return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"Screenshot failed: {str(exc)}")

    def browser_html(
        self,
        url: str,
        selector: str | None = None,
        wait_until: str = "networkidle",
        timeout: int = 30000,
        pretty: bool = True,
    ) -> ToolResult:
        """Get HTML content from a page."""
        try:
            from playwright.sync_api import sync_playwright
            from selectolax.parser import HTMLParser

            with sync_playwright() as p:
                browser = p.chromium.launch(headless=self._browser_config.headless)
                page = browser.new_page()

                page.goto(url, wait_until=wait_until, timeout=timeout)

                if selector:
                    html = page.locator(selector).inner_html()
                else:
                    html = page.content()

                browser.close()

                if pretty:
                    parser = HTMLParser(html)
                    if parser.css_first("html"):
                        html = parser.css_first("html").text()

                output = f"## HTML Content\n\n"
                output += f"**URL:** {url}\n"
                if selector:
                    output += f"**Selector:** {selector}\n"
                output += f"**Size:** {len(html)} bytes\n\n"
                output += "---\n\n"
                output += html[:10000]

                if len(html) > 10000:
                    output += f"\n\n... and {len(html) - 10000} more characters"

                return ToolResult(True, output)

        except ImportError:
            return ToolResult(
                False,
                "selectolax not installed. Install with: pip install selectolax",
            )
        except Exception as exc:
            return ToolResult(False, f"HTML extraction failed: {str(exc)}")

    def browser_text(
        self,
        url: str,
        selector: str | None = None,
        wait_until: str = "networkidle",
        timeout: int = 30000,
    ) -> ToolResult:
        """Get text content from a page."""
        try:
            from playwright.sync_api import sync_playwright

            with sync_playwright() as p:
                browser = p.chromium.launch(headless=self._browser_config.headless)
                page = browser.new_page()

                page.goto(url, wait_until=wait_until, timeout=timeout)

                if selector:
                    text = page.locator(selector).inner_text()
                else:
                    text = page.inner_text("body")

                browser.close()

                output = f"## Text Content\n\n"
                output += f"**URL:** {url}\n"
                if selector:
                    output += f"**Selector:** {selector}\n"
                output += f"**Length:** {len(text)} characters\n\n"
                output += "---\n\n"
                output += text[:10000]

                if len(text) > 10000:
                    output += f"\n\n... and {len(text) - 10000} more characters"

                return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"Text extraction failed: {str(exc)}")

    def browser_links(
        self,
        url: str,
        wait_until: str = "networkidle",
        timeout: int = 30000,
    ) -> ToolResult:
        """Extract all links from a page."""
        try:
            from playwright.sync_api import sync_playwright

            with sync_playwright() as p:
                browser = p.chromium.launch(headless=self._browser_config.headless)
                page = browser.new_page()

                page.goto(url, wait_until=wait_until, timeout=timeout)

                links = page.locator("a").all()

                output = f"## Links Found\n\n"
                output += f"**URL:** {url}\n"
                output += f"**Total Links:** {len(links)}\n\n"
                output += "| # | Text | URL |\n"
                output += "|-----|------|\n"

                for i, link in enumerate(links[:100], 1):
                    href = link.get_attribute("href") or ""
                    text = link.inner_text()[:50]
                    output += f"| {i} | {text} | {href[:80]} |\n"

                if len(links) > 100:
                    output += f"\n... and {len(links) - 100} more links"

                browser.close()

                return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"Link extraction failed: {str(exc)}")

    def browser_forms(
        self,
        url: str,
        wait_until: str = "networkidle",
        timeout: int = 30000,
    ) -> ToolResult:
        """Extract form details from a page."""
        try:
            from playwright.sync_api import sync_playwright

            with sync_playwright() as p:
                browser = p.chromium.launch(headless=self._browser_config.headless)
                page = browser.new_page()

                page.goto(url, wait_until=wait_until, timeout=timeout)

                forms = page.locator("form").all()

                output = f"## Forms Found\n\n"
                output += f"**URL:** {url}\n"
                output += f"**Total Forms:** {len(forms)}\n\n"

                for i, form in enumerate(forms, 1):
                    action = form.get_attribute("action") or ""
                    method = form.get_attribute("method") or "GET"
                    inputs = form.locator("input").all()
                    textareas = form.locator("textarea").all()
                    selects = form.locator("select").all()

                    output += f"### Form {i}\n\n"
                    output += f"**Action:** {action}\n"
                    output += f"**Method:** {method}\n"
                    output += f"**Inputs:** {len(inputs)}\n"
                    output += f"**Textareas:** {len(textareas)}\n"
                    output += f"**Selects:** {len(selects)}\n\n"

                    if inputs:
                        output += "| Name | Type | Required |\n"
                        output += "|-----|------|----------|\n"
                        for inp in inputs[:20]:
                            name = inp.get_attribute("name") or ""
                            itype = inp.get_attribute("type") or "text"
                            req = inp.get_attribute("required") or ""
                            output += f"| {name} | {itype} | {'Yes' if req else 'No'} |\n"

                    output += "\n"

                browser.close()

                return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"Form extraction failed: {str(exc)}")

    def browser_evaluate(
        self,
        url: str,
        script: str,
        wait_until: str = "networkidle",
        timeout: int = 30000,
    ) -> ToolResult:
        """Execute JavaScript and return result."""
        try:
            from playwright.sync_api import sync_playwright
            import json

            with sync_playwright() as p:
                browser = p.chromium.launch(headless=self._browser_config.headless)
                page = browser.new_page()

                page.goto(url, wait_until=wait_until, timeout=timeout)

                result = page.evaluate(script)

                browser.close()

                output = f"## JavaScript Execution\n\n"
                output += f"**URL:** {url}\n\n"
                output += "### Script\n\n"
                output += f"```javascript\n{script}\n```\n\n"
                output += "### Result\n\n"
                output += f"```json\n{json.dumps(result, indent=2)}\n```\n"

                return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"JavaScript execution failed: {str(exc)}")

    def browser_wait(
        self,
        selector: str,
        state: str = "visible",
        timeout: int = 30000,
    ) -> ToolResult:
        """Wait for an element."""
        try:
            from playwright.sync_api import sync_playwright

            with sync_playwright() as p:
                browser = p.chromium.launch(headless=self._browser_config.headless)
                page = browser.new_page()

                page.goto("about:blank", wait_until="domcontentloaded")

                element = page.locator(selector)
                element.wait_for(state=state, timeout=timeout)

                browser.close()

                output = f"## Wait Complete\n\n"
                output += f"**Selector:** {selector}\n"
                output += f"**State:** {state}\n"

                return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"Wait failed: {str(exc)}")

    def browser_download(
        self,
        url: str,
        output_path: str | None = None,
        timeout: int = 60000,
    ) -> ToolResult:
        """Download a file from URL."""
        try:
            import httpx

            if not output_path:
                from urllib.parse import urlparse

                parsed = urlparse(url)
                output_path = str(self.work_dir / (parsed.path.split("/")[-1] or "download"))

            Path(output_path).parent.mkdir(parents=True, exist_ok=True)

            with httpx.Client(timeout=timeout) as client:
                response = client.get(url, follow_redirects=True)
                response.raise_for_status()

                with open(output_path, "wb") as f:
                    f.write(response.content)

                output = f"## Download Complete\n\n"
                output += f"**URL:** {url}\n"
                output += f"**Output:** {output_path}\n"
                output += f"**Size:** {len(response.content)} bytes\n"

                return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"Download failed: {str(exc)}")

    def browser_cookies(
        self,
        url: str,
        as_json: bool = True,
        wait_until: str = "networkidle",
        timeout: int = 30000,
    ) -> ToolResult:
        """Get cookies from a page."""
        try:
            from playwright.sync_api import sync_playwright
            import json

            with sync_playwright() as p:
                browser = p.chromium.launch(headless=self._browser_config.headless)
                context = browser.new_context()
                page = context.new_page()

                page.goto(url, wait_until=wait_until, timeout=timeout)

                cookies = context.cookies()

                browser.close()

                output = f"## Cookies\n\n"
                output += f"**URL:** {url}\n"
                output += f"**Total Cookies:** {len(cookies)}\n\n"

                if as_json:
                    output += f"```json\n{json.dumps(cookies, indent=2)}\n```\n"
                else:
                    for cookie in cookies:
                        output += f"**{cookie['name']}**\n"
                        output += f"  Domain: {cookie.get('domain', 'N/A')}\n"
                        output += f"  Value: {cookie.get('value', '')[:100]}\n\n"

                return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"Cookie extraction failed: {str(exc)}")

    def browser_pdf(
        self,
        url: str,
        output_path: str | None = None,
        wait_until: str = "networkidle",
        timeout: int = 30000,
        format: str = "A4",
        landscape: bool = False,
        margins: dict | None = None,
    ) -> ToolResult:
        """Print page to PDF."""
        try:
            from playwright.sync_api import sync_playwright

            if not output_path:
                import time

                output_path = str(self.work_dir / f"page_{int(time.time())}.pdf")

            Path(output_path).parent.mkdir(parents=True, exist_ok=True)

            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                page = browser.new_page()

                page.goto(url, wait_until=wait_until, timeout=timeout)

                page.pdf(
                    path=output_path,
                    format=format,
                    landscape=landscape,
                    margins=margins or {"top": "1cm", "right": "1cm", "bottom": "1cm", "left": "1cm"},
                )

                browser.close()

                output = f"## PDF Generated\n\n"
                output += f"**URL:** {url}\n"
                output += f"**Output:** {output_path}\n"
                output += f"**Format:** {format}\n"
                output += f"**Landscape:** {landscape}\n"

                return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"PDF generation failed: {str(exc)}")

    def browser_console(
        self,
        url: str,
        wait_until: str = "networkidle",
        timeout: int = 30000,
    ) -> ToolResult:
        """Capture console messages from page."""
        try:
            from playwright.sync_api import sync_playwright
            import json

            console_messages = []

            with sync_playwright() as p:
                browser = p.chromium.launch(headless=self._browser_config.headless)
                context = browser.new_context()
                page = context.new_page()

                def handle_console(msg):
                    console_messages.append(
                        {
                            "type": msg.type,
                            "text": msg.text,
                            "location": str(msg.location) if msg.location else "",
                        }
                    )

                page.on("console", handle_console)

                page.goto(url, wait_until=wait_until, timeout=timeout)

                browser.close()

                output = f"## Console Messages\n\n"
                output += f"**URL:** {url}\n"
                output += f"**Total Messages:** {len(console_messages)}\n\n"

                logs = [m for m in console_messages if m["type"] == "log"]
                warnings = [m for m in console_messages if m["type"] == "warning"]
                errors = [m for m in console_messages if m["type"] == "error"]

                output += f"**Logs:** {len(logs)}\n"
                output += f"**Warnings:** {len(warnings)}\n"
                output += f"**Errors:** {len(errors)}\n\n"

                if console_messages:
                    output += "### Messages\n\n"
                    for msg in console_messages[:50]:
                        icon = {"log": "📋", "warning": "⚠️", "error": "❌", "info": "ℹ️"}.get(msg["type"], "📋")
                        output += f"{icon} **{msg['type']}**: {msg['text'][:200]}\n"

                return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"Console capture failed: {str(exc)}")

    def browser_session(
        self,
        action: str,
        session_name: str = "default",
    ) -> ToolResult:
        """Manage browser sessions."""
        try:
            from playwright.sync_api import sync_playwright
            import json

            sessions_dir = self.work_dir / ".browser_sessions"
            sessions_dir.mkdir(exist_ok=True)
            session_file = sessions_dir / f"{session_name}.json"

            if action == "start":
                browser = sync_playwright().start().chromium.launch(headless=True)
                context = browser.new_context()
                page = context.new_page()

                session_data = {
                    "session_name": session_name,
                    "started_at": str(datetime.now()),
                    "browser": "chromium",
                }

                with open(session_file, "w") as f:
                    json.dump(session_data, f)

                return ToolResult(True, f"Session '{session_name}' started")

            elif action == "save":
                if not session_file.exists():
                    return ToolResult(False, f"Session '{session_name}' not found")

                with open(session_file, "r") as f:
                    data = json.load(f)

                return ToolResult(True, json.dumps(data, indent=2))

            elif action == "end":
                if session_file.exists():
                    session_file.unlink()
                    return ToolResult(True, f"Session '{session_name}' ended")

                return ToolResult(True, f"Session '{session_name}' was not active")

            else:
                return ToolResult(False, f"Unknown action: {action}")

        except Exception as exc:
            return ToolResult(False, f"Session management failed: {str(exc)}")


from datetime import datetime
