# Tools Reference

## 224+ Tools at Your Fingertips

Tehuti comes packed with 224+ built-in tools including delegates, project context, task graphs, blueprints, and automations.

---

## Core Tools

These are the bread and butter — tools you'll use constantly.

### read

Read a file from disk.

```json
{"type":"tool","name":"read","args":{"path":"README.md"}}
```

**What you might say:**
```
𓅞  Read the config file
𓅞  Show me package.json
𓅞  Display the last 100 lines of server.log
```

---

### write

Create or completely overwrite a file.

```json
{"type":"tool","name":"write","args":{"path":"hello.txt","content":"Hello, World!"}}
```

**What you might say:**
```
𓅞  Create a new Python file with a hello function
𓅞  Write the output to results.txt
𓅞  Save this content to a new file
```

---

### edit ✨ NEW

Make precise, surgical changes to existing files. Shows color-coded diffs!

```json
{
  "type":"tool","name":"edit",
  "args":{
    "path":"src/main.py",
    "old_string":"def hello():\n    print('Hello')",
    "new_string":"def hello(name):\n    print(f'Hello, {name}!')"
  }
}
```

**What you might say:**
```
𓅞  Change the greeting from "Hello" to "Welcome"
𓅞  Add error handling to the login function
𓅞  Update the version from 1.0 to 1.1
```

**Output shows:**
```
- def hello():
-     print('Hello')
+ def hello(name):
+     print(f'Hello, {name}!')
```

---

### shell

Run any shell command. Full system access.

```json
{"type":"tool","name":"shell","args":{"command":"ls -la"}}
```

**What you might say:**
```
𓅞  List all files in long format
𓅞  Run make build
𓅞  Kill process on port 8080
𓅞  Find all Python files
```

---

### fetch

Simple HTTP GET requests.

```json
{"type":"tool","name":"fetch","args":{"url":"https://api.github.com"}}
```

**What you might say:**
```
𓅞  Fetch the GitHub API
𓅞  Get the contents of https://example.com
```

---

## PTY Interactive Tools

For truly interactive programs (vim, nano, python REPL, etc.).

### pty.spawn

Start an interactive terminal session.

```json
{"type":"tool","name":"pty.spawn","args":{"command":"python"}}
```

**Returns:** A session ID you can use with send/read/close.

### pty.send

Send input to an interactive session.

```json
{"type":"tool","name":"pty.send","args":{"session_id":"abc123","input":"print('hello')\n"}}
```

### pty.read

Read output from an interactive session.

```json
{"type":"tool","name":"pty.read","args":{"session_id":"abc123"}}
```

### pty.close

Close an interactive session.

```json
{"type":"tool","name":"pty.close","args":{"session_id":"abc123"}}
```

---

## File Operations

### glob

Find files matching a glob pattern.

```json
{"type":"tool","name":"glob","args":{"pattern":"**/*.py","recursive":true,"limit":100}}
```

**What you might say:**
```
𓅞  Find all Python files
𓅞  List all JSON files in config/
𓅞  Show me all test_*.py files
```

---

### find

Search files with various criteria.

```json
{"type":"tool","name":"find","args":{"path":".","name":"*.log","type":"f","mtime":7}}
```

---

### grep

Search text within files.

```json
{"type":"tool","name":"grep","args":{"pattern":"TODO","path":".","recursive":true,"ignore_case":false}}
```

**What you might say:**
```
𓅞  Find all TODO comments
𓅞  Search for "FIXME" in the code
𓅞  Count occurrences of "error" in log files
```

---

### sed

Stream editor for quick substitutions.

```json
{"type":"tool","name":"sed","args":{"expression":"s/old/new/g","file":"file.txt","in_place":true}}
```

---

### awk

Pattern scanning and processing.

```json
{"type":"tool","name":"awk","args":{"script":"{print $1}","file":"data.txt"}}
```

---

### cat, head, tail

View file contents.

```json
{"type":"tool","name":"head","args":{"file":"file.txt","lines":20}}
```

---

### ls, mkdir, cp, mv, rm

Basic file operations.

```json
{"type":"tool","name":"ls","args":{"path":".","long":true,"all":false,"human":true}}
```

---

### chmod, chown, ln

Permissions and links.

---

### tar, zip, unzip

Archive management.

```json
{"type":"tool","name":"tar","args":{"action":"create","archive":"backup.tar.gz","files":["file1","file2"]}}
```

---

### wc, sort, uniq, diff

Text processing utilities.

---

### sha256sum, md5sum

Checksums and file verification.

---

## Web & Search

### web_search

Search the web using DuckDuckGo.

```json
{"type":"tool","name":"web_search","args":{"query":"Python async await tutorial","num_results":10}}
```

**What you might say:**
```
𓅞  Search for React hooks best practices
𓅞  Look up Docker best practices 2024
𓅞  Find examples of Python type hints
```

---

### web_fetch

Advanced HTTP with full method support.

```json
{
  "type":"tool","name":"web_fetch",
  "args":{
    "url":"https://api.example.com/data",
    "method":"POST",
    "headers":{"Authorization":"Bearer token"},
    "data":"{\"key\":\"value\"}",
    "timeout":30
  }
}
```

**What you might say:**
```
𓅞  POST JSON data to the API
𓅞  Fetch with custom authentication headers
𓅞  Make a DELETE request to remove the resource
```

---

## Docker Tools

### docker_ps

List containers.

```json
{"type":"tool","name":"docker_ps","args":{"all":true}}
```

**What you might say:**
```
𓅞  List all Docker containers
𓅞  Show running containers only
```

---

### docker_images

List Docker images.

```json
{"type":"tool","name":"docker_images"}
```

---

### docker_run

Run a new container.

```json
{
  "type":"tool","name":"docker_run",
  "args":{
    "image":"nginx",
    "command":"",
    "detach":true,
    "ports":["8080:80"],
    "volumes":["/host:/container"],
    "env":{"NODE_ENV":"production"},
    "name":"web"
  }
}
```

**What you might say:**
```
𓅞  Run nginx on port 8080
𓅞  Start PostgreSQL with a volume
𓅞  Run a container in detached mode
```

---

### docker_build

Build an image from Dockerfile.

```json
{"type":"tool","name":"docker_build","args":{"path":".","tag":"myapp:latest"}}
```

**What you might say:**
```
𓅞  Build the Docker image
𓅞  Build with tag myapp:v1.0
```

---

### docker_exec

Execute command in running container.

```json
{"type":"tool","name":"docker_exec","args":{"container":"web","command":"ls -la"}}
```

---

### docker_logs

Get container logs.

```json
{"type":"tool","name":"docker_logs","args":{"container":"web","tail":100,"follow":false}}
```

---

### docker_compose

Run docker-compose commands.

```json
{"type":"tool","name":"docker_compose","args":{"command":"up -d","file":"docker-compose.yml"}}
```

**What you might say:**
```
𓅞  Run docker-compose up
𓅞  Start all services in detached mode
𓅞  Stop all containers
```

---

## Database Tools

### psql

PostgreSQL queries.

```json
{
  "type":"tool","name":"psql",
  "args":{
    "database":"mydb",
    "query":"SELECT * FROM users",
    "host":"localhost",
    "port":5432,
    "username":"postgres"
  }
}
```

**What you might say:**
```
𓅞  Query the PostgreSQL database
𓅞  Show all tables in the database
𓅞  Count rows in the users table
```

---

### mysql

MySQL queries.

```json
{"type":"tool","name":"mysql","args":{"database":"mydb","query":"SELECT * FROM users"}}
```

---

### redis_cli

Redis commands.

```json
{"type":"tool","name":"redis_cli","args":{"command":"KEYS *","host":"localhost","port":6379}}
```

**What you might say:**
```
𓅞  Get all Redis keys
𓅞  Set a value in Redis
𓅞  Show Redis info
```

---

## Git Tools

### git_status

Working tree status.

```json
{"type":"tool","name":"git_status"}
```

---

### git_log

Commit history.

```json
{"type":"tool","name":"git_log","args":{"num":10,"oneline":true}}
```

---

### git_branch

List branches.

```json
{"type":"tool","name":"git_branch","args":{"all":true}}
```

---

### git_diff

Show changes.

```json
{"type":"tool","name":"git_diff","args":{"staged":false,"file":null}}
```

---

### git_add, git_commit, git_push, git_pull

Standard git operations.

```json
{"type":"tool","name":"git_push","args":{"remote":"origin","branch":"main"}}
```

---

### git_clone

Clone a repository.

```json
{"type":"tool","name":"git_clone","args":{"url":"https://github.com/user/repo.git","directory":"myrepo"}}
```

---

## Build & Test Tools

### make

Run make targets.

```json
{"type":"tool","name":"make","args":{"target":"build","jobs":4}}
```

---

### cmake

Run CMake.

```json
{"type":"tool","name":"cmake","args":{"source_dir":".","build_dir":"build"}}
```

---

### gradle

Run Gradle tasks.

```json
{"type":"tool","name":"gradle","args":{"task":"build"}}
```

---

### maven

Run Maven goals.

```json
{"type":"tool","name":"maven","args":{"goal":"package"}}
```

---

### pytest

Run pytest.

```json
{"type":"tool","name":"pytest","args":{"path":".","verbose":true,"cov":"src"}}
```

**What you might say:**
```
𓅞  Run pytest
𓅞  Run tests with coverage
𓅞  Run a specific test file
```

---

### unittest, jest, cargo_test, go_test

Other testing frameworks.

---

## Deployment Tools

### ssh

Remote execution via SSH.

```json
{
  "type":"tool","name":"ssh",
  "args":{
    "host":"server.com",
    "command":"uptime",
    "user":"admin",
    "port":22
  }
}
```

---

### rsync

File synchronization.

```json
{"type":"tool","name":"rsync","args":{"source":"/local/","destination":"user@server:/remote/","delete":false}}
```

---

### kubectl

Kubernetes operations.

```json
{"type":"tool","name":"kubectl","args":{"command":"get pods","namespace":"default"}}
```

**What you might say:**
```
𓅞  Get all pods
𓅞  Apply the deployment
𓅞  Scale to 3 replicas
```

---

### terraform

Infrastructure as code.

```json
{"type":"tool","name":"terraform","args":{"command":"plan"}}
```

---

### ansible_playbook

Configuration management.

```json
{"type":"tool","name":"ansible_playbook","args":{"playbook":"site.yml","inventory":"hosts"}}
```

---

## System Tools

### Service Management

```json
{"type":"tool","name":"systemctl","args":{"action":"restart","service":"nginx"}}
```

- `systemctl` - systemd services
- `service` - init.d-style services

### Process Management

```json
{"type":"tool","name":"ps","args":{"aux":true}}
{"type":"tool","name":"kill","args":{"pid":1234,"signal":"TERM"}}
```

### Disk & Memory

```json
{"type":"tool","name":"df","args":{"human":true}}
{"type":"tool","name":"du","args":{"path":".","human":true,"summarize":true}}
{"type":"tool","name":"free","args":{"human":true}}
```

### Network

```json
{"type":"tool","name":"ping","args":{"host":"google.com","count":4}}
{"type":"tool","name":"curl","args":{"url":"https://example.com","method":"GET"}}
{"type":"tool","name":"netstat","args":{"listening":true,"numeric":true}}
{"type":"tool","name":"lsof","args":{"port":8080}}
```

### System Info

```json
{"type":"tool","name":"uptime"}
{"type":"tool","name":"whoami"}
{"type":"tool","name":"uname","args":{"all":true}}
{"type":"tool","name":"env"}
```

---

## Code Execution

### python

Execute Python code inline.

```json
{"type":"tool","name":"python","args":{"code":"print(sum(range(1, 101)))"}}
```

---

### python_file

Execute a Python file.

```json
{"type":"tool","name":"python_file","args":{"file":"script.py","args":["arg1","arg2"]}}
```

---

### node, node_file

Node.js execution.

```json
{"type":"tool","name":"node","args":{"code":"console.log('hello')"}}
```

---

### ruby, perl, bash_script

Other language interpreters.

---

## Package Management

### apt_install

System package installation.

```json
{"type":"tool","name":"apt_install","args":{"packages":["nginx","postgresql"],"update_first":true}}
```

---

### pip_install

Python packages.

```json
{"type":"tool","name":"pip_install","args":{"packages":["requests","numpy"],"upgrade":false}}
```

---

### npm_install

Node.js packages.

```json
{"type":"tool","name":"npm_install","args":{"packages":["express"],"global":false}}
```

---

## Platform CLI

### gh

GitHub CLI.

```json
{"type":"tool","name":"gh","args":{"command":"repo list"}}
```

**What you might say:**
```
𓅞  Create a GitHub issue
𓅞  List repositories
𓅞  Open a PR
```

---

### glab

GitLab CLI.

---

## Vision Tools

Computer vision and image analysis capabilities.

### image_analyze

Analyze images using vision-capable LLMs with detailed descriptions.

```json
{"type":"tool","name":"image_analyze","args":{"image_path":"screenshot.png","prompt":"Describe this UI","detail_level":"high"}}
```

**What you might say:**
```
𓅞 Analyze this screenshot and describe the UI elements
𓅞 What objects are in this photo?
𓅞 Extract text and labels from this image
```

### image_ocr

Extract text from images using Tesseract OCR.

```json
{"type":"tool","name":"image_ocr","args":{"image_path":"document.png","language":"eng","extract_tables":false}}
```

### image_screenshot

Capture screenshots of web pages using browser automation.

```json
{"type":"tool","name":"image_screenshot","args":{"url":"https://example.com","output_path":"screenshot.png","full_page":false}}
```

### image_describe

Get concise image descriptions for quick understanding.

```json
{"type":"tool","name":"image_describe","args":{"image_path":"photo.jpg","concise":true}}
```

### image_compare

Compare two images and detect differences.

```json
{"type":"tool","name":"image_compare","args":{"image1":"before.png","image2":"after.png","threshold":0.01}}
```

### image_resize, image_convert

Resize and convert images to different formats.

```json
{"type":"tool","name":"image_resize","args":{"image_path":"photo.jpg","width":800,"height":600,"output_path":"photo_small.jpg"}}
```

### barcode_detect, qrcode_read, qrcode_generate

Barcode and QR code operations.

```json
{"type":"tool","name":"qrcode_generate","args":{"data":"https://example.com","output_path":"qr.png"}}
```

---

## Browser Tools

Full browser automation with Playwright.

### browser_navigate

Navigate to a URL with configurable wait conditions.

```json
{"type":"tool","name":"browser_navigate","args":{"url":"https://example.com","wait_until":"networkidle","timeout":30000}}
```

### browser_click, browser_fill, browser_type, browser_press

Interact with page elements by CSS selector.

```json
{"type":"tool","name":"browser_click","args":{"selector":"#submit-button","timeout":10000}}
{"type":"tool","name":"browser_fill","args":{"selector":"#email","value":"test@example.com"}}
{"type":"tool","name":"browser_type","args":{"selector":"#search","text":"query","delay":100}}
{"type":"tool","name":"browser_press","args":{"selector":"body","key":"Enter"}}
```

### browser_screenshot

Capture screenshots of pages or specific elements.

```json
{"type":"tool","name":"browser_screenshot","args":{"output_path":"page.png","selector":".modal","full_page":false}}
```

### browser_html, browser_text

Extract HTML or text content from elements.

```json
{"type":"tool","name":"browser_html","args":{"selector":".article-content"}}
{"type":"tool","name":"browser_text","args":{"selector":"h1"}}
```

### browser_links, browser_forms

Extract all links or forms from a page.

```json
{"type":"tool","name":"browser_links"}
{"type":"tool","name":"browser_forms"}
```

### browser_evaluate

Execute JavaScript in page context.

```json
{"type":"tool","name":"browser_evaluate","args":{"script":"return document.title"}}
```

### browser_console

Get console logs from page execution.

```json
{"type":"tool","name":"browser_console"}
```

---

## Enhanced Web Tools

Advanced web fetching and scraping capabilities.

### web_fetch_render

Fetch URLs with full JavaScript rendering.

```json
{"type":"tool","name":"web_fetch_render","args":{"url":"https://example.com","wait_for_selector":".content","output_format":"text"}}
```

### web_scrape

Scrape specific elements using CSS selectors.

```json
{"type":"tool","name":"web_scrape","args":{"url":"https://news.com","selectors":{"title":"h1.title","links":".article a"},"output_format":"json"}}
```

### api_get, api_post, api_graphql

REST and GraphQL API calls.

```json
{"type":"tool","name":"api_get","args":{"url":"https://api.github.com/users/octocat"}}
{"type":"tool","name":"api_post","args":{"url":"https://api.example.com/data","json_data":{"key":"value"}}}
{"type":"tool","name":"api_graphql","args":{"url":"https://api.github.com/graphql","query":"query { viewer { login } }"}}
```

### extract_text, extract_links, extract_images

Extract specific content from web pages.

```json
{"type":"tool","name":"extract_links","args":{"url":"https://example.com"}}
{"type":"tool","name":"extract_images","args":{"url":"https://example.com"}}
```

### search_ddg, search_github, search_npm, search_pypi, search_dockerhub

Search across multiple platforms.

```json
{"type":"tool","name":"search_github","args":{"query":"react hooks","type":"repo","num_results":10}}
{"type":"tool","name":"search_npm","args":{"query":"lodash","num_results":5}}
{"type":"tool","name":"search_pypi","args":{"query":"requests","num_results":5}}
```

---

## MCP Tools

Model Context Protocol integration for external tools and resources.

### mcp_list_servers

List configured MCP servers.

```json
{"type":"tool","name":"mcp_list_servers"}
```

### mcp_connect, mcp_disconnect

Connect to or disconnect from MCP servers.

```json
{"type":"tool","name":"mcp_connect","args":{"server_name":"filesystem","command":"uvx","args":["mcp-server-filesync"]}}
{"type":"tool","name":"mcp_disconnect","args":{"server_name":"filesystem"}}
```

### mcp_list_tools, mcp_call_tool

List and call tools from connected MCP servers.

```json
{"type":"tool","name":"mcp_list_tools","args":{"server_name":"filesystem"}}
{"type":"tool","name":"mcp_call_tool","args":{"server_name":"filesystem","tool_name":"read_file","arguments":{"path":"/test.txt"}}}
```

### mcp_list_resources, mcp_read_resource

List and read resources from MCP servers.

```json
{"type":"tool","name":"mcp_list_resources","args":{"server_name":"filesystem"}}
{"type":"tool","name":"mcp_read_resource","args":{"server_name":"filesystem","uri":"file:///test.txt"}}
```

### mcp_list_prompts, mcp_get_prompt

List and get prompt templates from MCP servers.

```json
{"type":"tool","name":"mcp_list_prompts","args":{"server_name":"custom"}}
{"type":"tool","name":"mcp_get_prompt","args":{"server_name":"custom","prompt_name":"summarize","arguments":{"text":"..."}}}
```

---

## Tool Builder

Create and manage custom tools at runtime.

### tool_create_shell, tool_create_python, tool_create_api

Create custom tools of different types.

```json
{"type":"tool","name":"tool_create_shell","args":{"name":"my-tool","command":"echo {{message}}","description":"Echo a message"}}
{"type":"tool","name":"tool_create_python","args":{"name":"my-python-tool","code":"def run(args):\n    return {\"ok\": True, \"output\": \"Hello\"}","description":"Python tool example"}}
{"type":"tool","name":"tool_create_api","args":{"name":"my-api","base_url":"https://api.example.com","endpoints":[{"path":"/users","method":"GET"}]}}
```

### tool_list, tool_delete, tool_edit

Manage existing custom tools.

```json
{"type":"tool","name":"tool_list"}
{"type":"tool","name":"tool_delete","args":{"name":"old-tool"}}
```

### tool_export, tool_import, tool_clone

Export, import, and clone tools.

```json
{"type":"tool","name":"tool_export","args":{"name":"my-tool","format":"json","output_path":"/tools/my-tool.json"}}
{"type":"tool","name":"tool_import","args":{"source_path":"/tools/my-tool.json"}}
{"type":"tool","name":"tool_clone","args":{"source_name":"original","new_name":"copy"}}
```

---

## Streaming Tools

Stream LLM responses and write content to files.

### stream_chat

Stream LLM response directly to file.

```json
{"type":"tool","name":"stream_chat","args":{"prompt":"Write a detailed report on...","output_path":"/reports/report.md","append":false}}
```

### stream_append, stream_lines, stream_json, stream_jsonl, stream_csv

Write content in various formats.

```json
{"type":"tool","name":"stream_append","args":{"content":"New entry\n","output_path":"/logs/app.log"}}
{"type":"tool","name":"stream_json","args":{"data":{"key":"value"},"output_path":"/data/output.json"}}
{"type":"tool","name":"stream_jsonl","args":{"records":[{"id":1},{"id":2}],"output_path":"/data/data.jsonl"}}
{"type":"tool","name":"stream_csv","args":{"headers":["name","age"],"rows":[["Alice",30],["Bob",25]],"output_path":"/data/people.csv"}}
```

### stream_xml, stream_yaml, stream_markdown, stream_table

Write structured data formats.

```json
{"type":"tool","name":"stream_yaml","args":{"data":{"key":"value"},"output_path":"/config/config.yaml"}}
{"type":"tool","name":"stream_table","args":{"headers":["Name","Score"],"rows":[["Alice",90],["Bob",85]],"output_path":"/reports/table.txt","format":"grid"}}
```

### file_tail, file_watch

Monitor files in real-time.

```json
{"type":"tool","name":"file_tail","args":{"path":"/var/log/app.log","lines":50,"follow":true}}
{"type":"tool","name":"file_watch","args":{"path":"/data","pattern":"*.json","timeout":30}}
```

---

## Tool Response Format

All tools return a `ToolResult`:

```json
{
  "ok": true,
  "output": "command output here"
}
```

On error:
```json
{
  "ok": false,
  "output": "Error message here"
}
```

---

## Quick Reference Table

| Category | Tools | Example |
|----------|-------|---------|
| Files | read, write, edit, glob | "Find all .py files" |
| Shell | shell, bash_script | "Run make build" |
| Web | fetch, web_search, web_fetch | "Search the web" |
| Docker | ps, run, build, exec | "Start container" |
| Databases | psql, mysql, redis | "Query database" |
| Git | status, log, diff, push | "Show commits" |
| K8s | kubectl | "Get pods" |
| Test | pytest, jest, go_test | "Run tests" |
| System | ps, df, free, ping | "Show processes" |
| Code | python, node, ruby | "Execute code" |
| Vision | image_analyze, image_ocr | "Analyze screenshot" |
| Browser | navigate, click, fill | "Fill form and submit" |
| Enhanced Web | fetch_render, scrape | "Scrape dynamic content" |
| MCP | connect, list_tools, call | "Use MCP server tools" |
| Tool Builder | create_shell, create_python | "Create custom tools" |
| Streaming | stream_chat, stream_json | "Stream to file" |

---

**Total: 224+ tools** — one for every occasion.

---

## Delegate/Minion Tools

Manage sub-agents for parallel task execution.

### delegate_create

Create a new delegate/minion task.

```json
{"type":"tool","name":"delegate_create","args":{"name":"research-agent","prompt":"Research competitor features and summarize","parent_id":"abc12345","metadata":{"priority":"high"}}}
```

### delegate_list, delegate_get, delegate_cancel, delegate_tree

Manage and monitor delegates.

```json
{"type":"tool","name":"delegate_list","args":{"state":"running"}}
{"type":"tool","name":"delegate_get","args":{"delegate_id":"abc12345"}}
{"type":"tool","name":"delegate_cancel","args":{"delegate_id":"abc12345"}}
{"type":"tool","name":"delegate_tree","args":{"root_id":"abc12345"}}
```

---

## Project Context Tools

Load and extract information from PROJECT.md.

### context_load

Load PROJECT.md content for context.

```json
{"type":"tool","name":"context_load","args":{"force":false}}
```

### context_summary, context_sections, context_rules, context_personas

Extract specific sections from PROJECT.md.

```json
{"type":"tool","name":"context_summary","args":{}}
{"type":"tool","name":"context_sections","args":{}}
{"type":"tool","name":"context_rules","args":{}}
{"type":"tool","name":"context_personas","args":{}}
```

---

## Task Graph Tools

Manage tasks with dependencies.

### task_create

Create a new task with optional dependencies.

```json
{"type":"tool","name":"task_create","args":{"title":"Implement API endpoint","description":"Create user registration endpoint","priority":3,"assignee":"backend-team","tags":["api","backend"]}}
```

### task_get, task_update

Manage task lifecycle.

```json
{"type":"tool","name":"task_get","args":{"task_id":"task123"}}
{"type":"tool","name":"task_update","args":{"task_id":"task123","status":"in_progress","priority":4}}
```

### task_add_dep, task_schedulable, task_blocked, task_stats

Manage dependencies and get statistics.

```json
{"type":"tool","name":"task_add_dep","args":{"task_id":"task123","depends_on_id":"task456"}}
{"type":"tool","name":"task_schedulable","args":{}}
{"type":"tool","name":"task_blocked","args":{}}
{"type":"tool","name":"task_stats","args":{}}
```

---

## Blueprint Tools

Create and manage planning documents.

### blueprint_create

Create a new blueprint for planning.

```json
{"type":"tool","name":"blueprint_create","args":{"name":"API Redesign","description":"Plan API version 2 migration","version":"2.0.0"}}
```

### blueprint_get, blueprint_add_section, blueprint_export, blueprint_list

Manage blueprint sections and export to markdown.

```json
{"type":"tool","name":"blueprint_get","args":{"blueprint_id":"bp123"}}
{"type":"tool","name":"blueprint_add_section","args":{"blueprint_id":"bp123","title":"Authentication","section_type":"feature","content":"Implement OAuth2 flow","priority":1}}
{"type":"tool","name":"blueprint_export","args":{"blueprint_id":"bp123","output_path":"/docs/blueprint.md"}}
{"type":"tool","name":"blueprint_list","args":{}}
```

---

## Automation Tools

Create deterministic workflows with triggers and actions.

### automation_create

Create new automation with triggers and actions.

```json
{"type":"tool","name":"automation_create","args":{"name":"Auto-format on Save","description":"Run formatter when Python files change","state":"active"}}
```

### automation_get, automation_list

Manage and list automations.

```json
{"type":"tool","name":"automation_get","args":{"automation_id":"auto123"}}
{"type":"tool","name":"automation_list","args":{}}
```

### automation_add_trigger, automation_add_action, automation_stats

Configure automation behavior.

```json
{"type":"tool","name":"automation_add_trigger","args":{"automation_id":"auto123","trigger_type":"file_change","condition":"path.endswith('.py')"}}
{"type":"tool","name":"automation_add_action","args":{"automation_id":"auto123","action_type":"run_command","params":{"command":"black {path}"}}}
{"type":"tool","name":"automation_stats","args":{}}
```
