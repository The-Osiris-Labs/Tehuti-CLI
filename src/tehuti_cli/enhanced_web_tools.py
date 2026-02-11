"""
Tehuti Enhanced Web Tools - Advanced Web Fetching with JavaScript Rendering

Provides tools for:
- Web fetching with full JavaScript rendering
- Content extraction and parsing
- API interaction
- Web scraping with proper handling
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

import httpx

from tehuti_cli.storage.config import Config
from tehuti_cli.advanced_tools import ToolResult


class EnhancedWebTools:
    """Enhanced web tools with JavaScript rendering support."""

    def __init__(self, config: Config, work_dir: Path):
        self.config = config
        self.work_dir = work_dir.resolve()

    def web_fetch_render(
        self,
        url: str,
        wait_for_selector: str | None = None,
        wait_for_network_idle: bool = True,
        timeout: int = 60000,
        output_format: str = "text",
    ) -> ToolResult:
        """Fetch a URL with full JavaScript rendering."""
        try:
            from playwright.sync_api import sync_playwright

            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                page = browser.new_page()

                page.set_viewport_size({"width": 1280, "height": 800})

                if wait_for_network_idle:
                    page.goto(url, wait_until="networkidle", timeout=timeout)
                else:
                    page.goto(url, timeout=timeout)

                if wait_for_selector:
                    page.wait_for_selector(wait_for_selector, timeout=timeout // 2)

                if output_format == "text":
                    content = page.inner_text("body")
                elif output_format == "html":
                    content = page.content()
                elif output_format == "markdown":
                    content = self._html_to_markdown(page.content())
                else:
                    content = page.inner_text("body")

                browser.close()

                output = f"## Rendered Fetch: {url}\n\n"
                output += f"**Format:** {output_format}\n"
                output += f"**Wait for:** {wait_for_selector or 'page load'}\n"
                output += f"**Content length:** {len(content)} chars\n\n"
                output += "---\n\n"
                output += content[:15000]

                if len(content) > 15000:
                    output += f"\n\n... and {len(content) - 15000} more characters"

                return ToolResult(True, output)

        except ImportError:
            return ToolResult(
                False,
                "Playwright not installed. Install with: pip install playwright && playwright install chromium",
            )
        except Exception as exc:
            return ToolResult(False, f"Render fetch failed: {str(exc)}")

    def web_scrape(
        self,
        url: str,
        selectors: dict[str, str],
        output_format: str = "json",
        render: bool = False,
        timeout: int = 30000,
    ) -> ToolResult:
        """Scrape specific elements from a webpage."""
        try:
            from selectolax.parser import HTMLParser

            if render:
                from playwright.sync_api import sync_playwright

                with sync_playwright() as p:
                    browser = p.chromium.launch(headless=True)
                    page = browser.new_page()
                    page.goto(url, timeout=timeout)
                    html = page.content()
                    browser.close()
            else:
                with httpx.Client(timeout=timeout) as client:
                    resp = client.get(url, follow_redirects=True)
                    resp.raise_for_status()
                    html = resp.text

            parser = HTMLParser(html)

            results = {}
            for key, selector in selectors.items():
                try:
                    element = parser.css_first(selector)
                    if element:
                        results[key] = {
                            "text": element.text(strip=True),
                            "html": element.html,
                            "attributes": dict(element.attrs) if element.attrs else {},
                        }
                    else:
                        results[key] = None
                except Exception as e:
                    results[key] = {"error": str(e)}

            if output_format == "json":
                output = json.dumps(results, indent=2)
            else:
                output = f"## Scraped Data from {url}\n\n"
                for key, value in results.items():
                    output += f"### {key}\n\n"
                    if value is None:
                        output += "Not found\n"
                    elif isinstance(value, dict) and "error" in value:
                        output += f"Error: {value['error']}\n"
                    else:
                        output += f"Text: {value.get('text', 'N/A')}\n"

            return ToolResult(True, output)

        except ImportError:
            return ToolResult(
                False,
                "selectolax not installed. Install with: pip install selectolax",
            )
        except Exception as exc:
            return ToolResult(False, f"Scraping failed: {str(exc)}")

    def api_get(
        self,
        url: str,
        headers: dict[str, str] | None = None,
        params: dict[str, str] | None = None,
        timeout: int = 30,
        format_response: bool = True,
    ) -> ToolResult:
        """Make a GET request to an API endpoint."""
        try:
            default_headers = {
                "User-Agent": "Tehuti/0.2.0",
                "Accept": "application/json",
                "Accept-Encoding": "gzip, deflate",
            }
            if headers:
                default_headers.update(headers)

            with httpx.Client(timeout=timeout) as client:
                resp = client.get(url, headers=default_headers, params=params)
                resp.raise_for_status()

                output = f"## API GET: {url}\n\n"
                output += f"**Status:** {resp.status_code}\n"
                output += f"**Headers:**\n"
                for key, value in resp.headers.items():
                    if key.lower() not in ["content-encoding", "transfer-encoding"]:
                        output += f"  {key}: {value}\n"

                if format_response:
                    try:
                        data = resp.json()
                        output += f"\n**Response (JSON):**\n"
                        output += json.dumps(data, indent=2)[:5000]
                    except Exception:
                        output += f"\n**Response:**\n{resp.text[:5000]}"
                else:
                    output += f"\n**Response:**\n{resp.text[:10000]}"

                return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"API GET failed: {str(exc)}")

    def api_post(
        self,
        url: str,
        data: dict[str, Any] | str | None = None,
        json_data: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        timeout: int = 30,
    ) -> ToolResult:
        """Make a POST request to an API endpoint."""
        try:
            default_headers = {
                "User-Agent": "Tehuti/0.2.0",
                "Accept": "application/json",
            }
            if headers:
                default_headers.update(headers)

            with httpx.Client(timeout=timeout) as client:
                kwargs = {"headers": default_headers}

                if json_data is not None:
                    kwargs["json"] = json_data
                elif data is not None:
                    kwargs["data"] = data

                resp = client.post(url, **kwargs)
                resp.raise_for_status()

                output = f"## API POST: {url}\n\n"
                output += f"**Status:** {resp.status_code}\n"

                if json_data:
                    output += f"\n**Request Body:**\n{json.dumps(json_data, indent=2)}\n"

                try:
                    data = resp.json()
                    output += f"\n**Response (JSON):**\n{json.dumps(data, indent=2)}"
                except Exception:
                    output += f"\n**Response:**\n{resp.text[:5000]}"

                return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"API POST failed: {str(exc)}")

    def apigraphql(
        self,
        url: str,
        query: str,
        variables: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        timeout: int = 30,
    ) -> ToolResult:
        """Execute a GraphQL query."""
        try:
            default_headers = {
                "User-Agent": "Tehuti/0.2.0",
                "Content-Type": "application/json",
                "Accept": "application/json",
            }
            if headers:
                default_headers.update(headers)

            payload = {"query": query}
            if variables:
                payload["variables"] = variables

            with httpx.Client(timeout=timeout) as client:
                resp = client.post(url, json=payload, headers=default_headers)
                resp.raise_for_status()

                data = resp.json()

                output = f"## GraphQL Query: {url}\n\n"
                output += f"**Status:** {resp.status_code}\n\n"
                output += "### Query\n\n"
                output += f"```graphql\n{query}\n```\n"

                if variables:
                    output += "\n### Variables\n\n"
                    output += f"```json\n{json.dumps(variables, indent=2)}\n```\n"

                output += "\n### Response\n\n"
                output += json.dumps(data, indent=2)

                errors = data.get("errors")
                if errors:
                    output += "\n### Errors\n\n"
                    for error in errors:
                        output += f"- {error.get('message', str(error))}\n"

                return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"GraphQL query failed: {str(exc)}")

    def extract_text(
        self,
        url: str,
        selectors: list[str] | None = None,
        render: bool = False,
        timeout: int = 30000,
    ) -> ToolResult:
        """Extract clean text from a webpage."""
        try:
            from selectolax.parser import HTMLParser

            if render:
                from playwright.sync_api import sync_playwright

                with sync_playwright() as p:
                    browser = p.chromium.launch(headless=True)
                    page = browser.new_page()
                    page.goto(url, timeout=timeout)
                    html = page.content()
                    browser.close()
            else:
                with httpx.Client(timeout=timeout) as client:
                    resp = client.get(url, follow_redirects=True)
                    resp.raise_for_status()
                    html = resp.text

            parser = HTMLParser(html)

            output = f"## Extracted Text from {url}\n\n"

            if selectors:
                for selector in selectors:
                    try:
                        element = parser.css_first(selector)
                        if element:
                            text = element.text(strip=True)
                            output += f"### {selector}\n\n{text[:5000]}\n\n"
                        else:
                            output += f"### {selector}\n\nNot found\n\n"
                    except Exception as e:
                        output += f"### {selector}\n\nError: {e}\n\n"
            else:
                text = parser.text(strip=True)
                output += f"**Length:** {len(text)} chars\n\n"
                output += "---\n\n"
                output += text[:20000]
                if len(text) > 20000:
                    output += f"\n\n... and {len(text) - 20000} more characters"

            return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"Text extraction failed: {str(exc)}")

    def extract_links(
        self,
        url: str,
        selector: str = "a",
        attribute: str = "href",
        filter_pattern: str | None = None,
        render: bool = False,
        timeout: int = 30000,
    ) -> ToolResult:
        """Extract links from a webpage."""
        try:
            from selectolax.parser import HTMLParser

            if render:
                from playwright.sync_api import sync_playwright

                with sync_playwright() as p:
                    browser = p.chromium.launch(headless=True)
                    page = browser.new_page()
                    page.goto(url, timeout=timeout)
                    html = page.content()
                    browser.close()
            else:
                with httpx.Client(timeout=timeout) as client:
                    resp = client.get(url, follow_redirects=True)
                    resp.raise_for_status()
                    html = resp.text

            parser = HTMLParser(html)
            elements = parser.css(selector)

            links = []
            for elem in elements:
                attr_value = elem.attributes.get(attribute)
                if attr_value:
                    text = elem.text(strip=True)[:100]
                    links.append({"text": text, attribute: attr_value})

            if filter_pattern:
                import re

                links = [l for l in links if re.search(filter_pattern, l[attribute])]

            output = f"## Links from {url}\n\n"
            output += f"**Total found:** {len(links)}\n\n"

            output += "| # | Text | Link |\n"
            output += "|-----|------|\n"

            for i, link in enumerate(links[:100], 1):
                display_link = link[attribute][:80]
                output += f"| {i} | {link['text'][:30]} | {display_link} |\n"

            if len(links) > 100:
                output += f"\n... and {len(links) - 100} more links"

            output += f"\n\n**Raw URLs:**\n"
            for link in links[:20]:
                output += f"- {link[attribute]}\n"

            return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"Link extraction failed: {str(exc)}")

    def extract_images(
        self,
        url: str,
        selector: str = "img",
        attributes: list[str] | None = None,
        render: bool = False,
        timeout: int = 30000,
    ) -> ToolResult:
        """Extract images from a webpage."""
        try:
            from selectolax.parser import HTMLParser

            attrs = attributes or ["src", "alt", "title", "width", "height"]

            if render:
                from playwright.sync_api import sync_playwright

                with sync_playwright() as p:
                    browser = p.chromium.launch(headless=True)
                    page = browser.new_page()
                    page.goto(url, timeout=timeout)
                    html = page.content()
                    browser.close()
            else:
                with httpx.Client(timeout=timeout) as client:
                    resp = client.get(url, follow_redirects=True)
                    resp.raise_for_status()
                    html = resp.text

            parser = HTMLParser(html)
            elements = parser.css(selector)

            images = []
            for elem in elements:
                img_data = {}
                for attr in attrs:
                    value = elem.attributes.get(attr)
                    if value:
                        img_data[attr] = value
                if img_data:
                    images.append(img_data)

            output = f"## Images from {url}\n\n"
            output += f"**Total found:** {len(images)}\n\n"

            output += "| # | "
            for attr in attrs[:4]:
                output += f"{attr} | "
            output += "\n"

            output += "|"
            for _ in attrs[:4]:
                output += "-----|"
            output += "\n"

            for i, img in enumerate(images[:20], 1):
                row = f"| {i} | "
                for attr in attrs[:4]:
                    val = img.get(attr, "")[:20]
                    row += f"{val} | "
                output += row + "\n"

            return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"Image extraction failed: {str(exc)}")

    def check_website_status(
        self,
        url: str,
        follow_redirects: bool = True,
        timeout: int = 10,
    ) -> ToolResult:
        """Check the status and basic info of a website."""
        try:
            with httpx.Client(timeout=timeout) as client:
                redirects = []
                final_url = url

                def log_redirect(response):
                    redirects.append(f"{response.status_code} -> {response.url}")

                resp = client.get(url, follow_redirects=follow_redirects, on_redirects=log_redirect)
                resp.raise_for_status()

                output = f"## Website Status: {url}\n\n"
                output += f"**Final URL:** {resp.url}\n"
                output += f"**Status Code:** {resp.status_code}\n"
                output += f"**Status Text:** {resp.reason_phrase}\n"
                output += f"**Final URL:** {resp.url}\n\n"

                if redirects:
                    output += "### Redirect Chain\n\n"
                    output += f"{url}\n"
                    for redirect in redirects:
                        output += f"  -> {redirect}\n"
                    output += "\n"

                output += "### Response Headers\n\n"
                important_headers = [
                    "content-type",
                    "content-length",
                    "server",
                    "date",
                    "cache-control",
                    "location",
                ]
                for key, value in resp.headers.items():
                    if key.lower() in important_headers:
                        output += f"- {key}: {value}\n"

                output += f"\n**Total headers:** {len(resp.headers)}\n"

                return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"Status check failed: {str(exc)}")

    def _html_to_markdown(self, html: str) -> str:
        """Convert HTML to Markdown."""
        try:
            import trafilatura

            result = trafilatura.html_to_markdown(html)
            return result or html
        except Exception:
            return html


class WebSearchTools:
    """Advanced web search tools."""

    def __init__(self, config: Config, work_dir: Path):
        self.config = config
        self.work_dir = work_dir.resolve()

    def search_with_serpapi(
        self,
        query: str,
        api_key: str | None = None,
        num_results: int = 10,
        engine: str = "google",
    ) -> ToolResult:
        """Search using SerpAPI (requires API key)."""
        try:
            import os

            key = api_key or os.getenv("SERPAPI_API_KEY")
            if not key:
                return ToolResult(
                    False,
                    "SERPAPI_API_KEY not set. Get one at: https://serpapi.com/",
                )

            params = {
                "q": query,
                "num": num_results,
                "api_key": key,
                "engine": engine,
            }

            with httpx.Client(timeout=30) as client:
                resp = client.get(
                    "https://serpapi.com/search",
                    params=params,
                )
                resp.raise_for_status()
                data = resp.json()

            results = data.get("organic_results", [])

            output = f"## Search Results: {query}\n\n"
            output += f"**Engine:** {engine}\n"
            output += f"**Total results:** {len(results)}\n\n"

            for i, result in enumerate(results[:num_results], 1):
                output += f"### {i}. {result.get('title', 'N/A')}\n\n"
                output += f"**URL:** {result.get('link', 'N/A')}\n"
                output += f"**Snippet:** {result.get('snippet', 'N/A')}\n\n"

            return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"SerpAPI search failed: {str(exc)}")

    def search_with_ddg(
        self,
        query: str,
        num_results: int = 10,
        region: str = "com-en",
    ) -> ToolResult:
        """Search using DuckDuckGo (no API key required)."""
        try:
            url = f"https://duckduckgo.com/html/?q={query}&kl={region}"

            with httpx.Client(timeout=30) as client:
                resp = client.get(url, follow_redirects=True)
                resp.raise_for_status()

            import re

            pattern = r'<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>.*?<a[^>]*class="result__snippet"[^>]*>(.*?)</a>'
            matches = re.findall(pattern, resp.text, re.DOTALL)

            results = []
            for link, title, snippet in matches[:num_results]:
                title = re.sub(r"<[^>]+>", "", title)
                snippet = re.sub(r"<[^>]+>", "", snippet)
                results.append(
                    {
                        "title": title.strip(),
                        "url": link,
                        "snippet": snippet.strip()[:200],
                    }
                )

            output = f"## DuckDuckGo Search: {query}\n\n"
            output += f"**Results:** {len(results)}\n\n"

            for i, result in enumerate(results, 1):
                output += f"### {i}. {result['title']}\n\n"
                output += f"**URL:** {result['url']}\n"
                output += f"**Snippet:** {result['snippet']}\n\n"

            return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"DuckDuckGo search failed: {str(exc)}")

    def search_code(
        self,
        query: str,
        language: str | None = None,
        max_results: int = 10,
    ) -> ToolResult:
        """Search for code examples."""
        try:
            import urllib.parse

            search_query = query
            if language:
                search_query = f"{query} {language} code example"

            url = f"https://duckduckgo.com/html/?q={urllib.parse.quote(search_query)}"

            with httpx.Client(timeout=30) as client:
                resp = client.get(url)
                resp.raise_for_status()

            output = f"## Code Search: {query}\n\n"
            if language:
                output += f"**Language filter:** {language}\n\n"
            output += resp.text[:5000]

            return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"Code search failed: {str(exc)}")

    def search_github(
        self,
        query: str,
        language: str | None = None,
        sort: str = "stars",
        max_results: int = 10,
    ) -> ToolResult:
        """Search GitHub repositories."""
        try:
            import os

            token = os.getenv("GITHUB_TOKEN") or os.getenv("GH_TOKEN")

            headers = {
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            }
            if token:
                headers["Authorization"] = f"Bearer {token}"

            params = {
                "q": query,
                "sort": sort,
                "per_page": max_results,
            }
            if language:
                params["q"] += f" language:{language}"

            with httpx.Client(timeout=30) as client:
                resp = client.get(
                    "https://api.github.com/search/repositories",
                    headers=headers,
                    params=params,
                )
                resp.raise_for_status()
                data = resp.json()

            repos = data.get("items", [])

            output = f"## GitHub Search: {query}\n\n"
            output += f"**Total found:** {data.get('total_count', 0)}\n"
            output += f"**Language:** {language or 'Any'}\n"
            output += f"**Sort:** {sort}\n\n"

            for i, repo in enumerate(repos, 1):
                output += f"### {i}. {repo.get('full_name', 'N/A')}\n\n"
                output += f"**Stars:** {repo.get('stargazers_count', 0)}\n"
                output += f"**Forks:** {repo.get('forks_count', 0)}\n"
                output += f"**Description:** {repo.get('description', 'N/A')}\n"
                output += f"**URL:** {repo.get('html_url', 'N/A')}\n\n"

            return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"GitHub search failed: {str(exc)}")

    def search_npm(
        self,
        query: str,
        max_results: int = 10,
    ) -> ToolResult:
        """Search npm registry."""
        try:
            with httpx.Client(timeout=30) as client:
                resp = client.get(f"https://registry.npmjs.org/-/v1/search?text={query}&size={max_results}")
                resp.raise_for_status()
                data = resp.json()

            packages = data.get("objects", [])

            output = f"## npm Search: {query}\n\n"
            output += f"**Results:** {len(packages)}\n\n"

            for i, pkg in enumerate(packages, 1):
                info = pkg.get("package", {})
                output += f"### {i}. {info.get('name', 'N/A')}\n\n"
                output += f"**Version:** {info.get('version', 'N/A')}\n"
                output += f"**Description:** {info.get('description', 'N/A')}\n"
                output += f"**Keywords:** {', '.join(info.get('keywords', [])[:5])}\n"
                output += f"**NPM:** https://www.npmjs.com/package/{info.get('name', '')}\n\n"

            return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"npm search failed: {str(exc)}")

    def search_pypi(
        self,
        query: str,
        max_results: int = 10,
    ) -> ToolResult:
        """Search PyPI registry."""
        try:
            with httpx.Client(timeout=30) as client:
                resp = client.get(f"https://pypi.org/search/?q={query}&size={max_results}")
                resp.raise_for_status()

            import re

            pattern = r'<a[^>]*class="package-snippet"[^>]*href="([^"]+)"[^>]*>.*?<p[^>]*class="package-snippet__description"[^>]*>([^<]+)</p>'
            matches = re.findall(pattern, resp.text, re.DOTALL)

            output = f"## PyPI Search: {query}\n\n"
            output += f"**Results:** {len(matches)}\n\n"

            for i, (url, desc) in enumerate(matches[:max_results], 1):
                output += f"### {i}. {url.split('/')[-2] if url else 'N/A'}\n\n"
                output += f"**URL:** https://pypi.org{url}\n"
                output += f"**Description:** {desc.strip()}\n\n"

            return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"PyPI search failed: {str(exc)}")

    def search_dockerhub(
        self,
        query: str,
        max_results: int = 10,
    ) -> ToolResult:
        """Search Docker Hub."""
        try:
            with httpx.Client(timeout=30) as client:
                resp = client.get(
                    "https://hub.docker.com/api/v1.0/repositories/search",
                    params={"query": query, "page_size": max_results},
                )
                if resp.status_code != 200:
                    return ToolResult(False, f"Docker Hub API error: {resp.status_code}")

                data = resp.json()

            results = data.get("results", [])

            output = f"## Docker Hub Search: {query}\n\n"
            output += f"**Results:** {len(results)}\n\n"

            for i, result in enumerate(results, 1):
                output += f"### {i}. {result.get('name', 'N/A')}\n\n"
                output += f"**Description:** {result.get('description', 'N/A')}\n"
                output += f"**Star Count:** {result.get('star_count', 0)}\n"
                output += f"**Pull Count:** {result.get('pull_count', 0)}\n"
                output += f"**Official:** {'Yes' if result.get('is_official', False) else 'No'}\n\n"

            return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"Docker Hub search failed: {str(exc)}")
