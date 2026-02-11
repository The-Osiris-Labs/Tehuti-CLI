# Project Tehuti Codebase Analysis

## Overview

Project Tehuti is an AI-powered development environment that combines natural language interaction with a comprehensive toolkit for software engineering tasks. Named after Thoth (Tehuti), the Egyptian god of wisdom and writing, it aims to provide a seamless AI development partner experience.

**Current Version**: 0.2.0

## Core Architecture

### High-Level System Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                     User Interfaces                                 │
├─────────────────────────────────────────────────────────────────────┤
│ - Interactive Chat Shell (Currently Disabled)                       │
│ - Print Mode (Non-interactive)                                      │
│ - Web UI (FastAPI + Browser)                                        │
│ - Wire Server (JSON Lines over STDIO)                               │
│ - CLI Commands                                                      │
└─────────────────────────────────────────────────────────────────────┘
                          ▲
                          │
┌─────────────────────────────────────────────────────────────────────┐
│                     Application Layer                               │
├─────────────────────────────────────────────────────────────────────┤
│ - TehutiApp (Core Orchestration)                                    │
│ - CLI Command Handlers                                              │
│ - PrintUI (Text Output)                                             │
│ - Web Application (FastAPI)                                         │
└─────────────────────────────────────────────────────────────────────┘
                          ▲
                          │
┌─────────────────────────────────────────────────────────────────────┐
│                     Runtime & Execution                              │
├─────────────────────────────────────────────────────────────────────┤
│ - ToolRuntime (Tool Execution Engine)                               │
│ - ToolSandbox (Security & Isolation)                                │
│ - ToolRegistry (Tool Catalog - 100+ tools)                          │
│ - Approval System (Safety Controls)                                 │
└─────────────────────────────────────────────────────────────────────┘
                          ▲
                          │
┌─────────────────────────────────────────────────────────────────────┐
│                     LLM Integration                                 │
├─────────────────────────────────────────────────────────────────────┤
│ - TehutiLLM (Unified LLM Client)                                    │
│ - OpenRouter Provider                                               │
│ - OpenAI Provider                                                  │
│ - Gemini Provider                                                  │
└─────────────────────────────────────────────────────────────────────┘
                          ▲
                          │
┌─────────────────────────────────────────────────────────────────────┐
│                     Tool Suites                                      │
├─────────────────────────────────────────────────────────────────────┤
│ - Advanced Tools (Shell, Docker, Git, Cloud, etc.)                   │
│ - Browser Tools (Playwright automation)                              │
│ - Vision Tools (OCR, Image Analysis)                                │
│ - Enhanced Web Tools (Scraping, APIs)                                │
│ - MCP Tools (Model Context Protocol)                                │
│ - Streaming Tools (File Operations)                                  │
│ - Tool Builder (Custom Tool Creation)                               │
│ - Project Context (PROJECT.md management)                            │
│ - Task Graph (Workflow Management)                                  │
│ - Blueprints (Planning)                                             │
│ - Automations (Triggers & Actions)                                  │
│ - Delegates (Minion Tasks)                                          │
└─────────────────────────────────────────────────────────────────────┘
                          ▲
                          │
┌─────────────────────────────────────────────────────────────────────┐
│                     Storage & Configuration                          │
├─────────────────────────────────────────────────────────────────────┤
│ - Config (TOML file + Environment Variables)                        │
│ - Session Management                                                │
│ - Checkpoints                                                       │
│ - Cache                                                             │
│ - External Tools Database                                           │
└─────────────────────────────────────────────────────────────────────┘
```

## Key Features & Capabilities

### 1. **100+ Built-in Tools**

The tool ecosystem is categorized into:

#### **Core Operations**
- File operations: read, write, edit, glob, grep, find, etc.
- Shell execution: shell commands, bash scripts
- Web fetching: HTTP requests with custom headers/methods

#### **Web & Search**
- DuckDuckGo search
- Advanced web scraping with CSS selectors
- API endpoints (REST & GraphQL)
- Browser automation (Playwright)
- Website status monitoring

#### **Container Management**
- Docker: containers, images, builds, exec, logs
- Docker Compose
- Kubernetes (kubectl)

#### **Database Operations**
- PostgreSQL (psql)
- MySQL
- Redis

#### **Version Control**
- Git: status, log, diff, push, pull, clone, branch
- GitHub CLI (gh)
- GitLab CLI (glab)

#### **Package Management**
- pip (Python)
- npm (Node.js)
- apt (Debian/Ubuntu)

#### **Build & Deployment**
- Make, CMake
- Gradle, Maven
- Terraform
- Ansible Playbooks
- SSH, rsync

#### **Testing**
- pytest (Python)
- unittest (Python)
- Jest (JavaScript)
- Cargo test (Rust)
- Go test (Go)

#### **System Administration**
- Process management: ps, kill, top
- System info: df, free, uptime, uname
- Network: ping, traceroute, nmap, tcpdump
- Services: systemctl, service
- Logs: journalctl
- Cron jobs: crontab

#### **Cloud & Infrastructure**
- AWS CLI
- Google Cloud CLI
- Azure CLI
- Kubernetes operations

#### **Vision & Image Processing**
- OCR (Tesseract + Cloud Vision APIs)
- Image analysis (LLM-based)
- Barcode/QR code detection
- Image resizing, conversion
- Screenshot capture

#### **Advanced Features**
- PTY sessions (interactive terminals)
- Custom tool creation (shell, Python, API)
- MCP (Model Context Protocol) integration
- Streaming file operations
- Project context management (PROJECT.md)
- Task graph management (workflow orchestration)
- Blueprints (planning documents)
- Automations (triggers & actions)
- Delegates (parallel task execution)

### 2. **Safety & Security**

#### **Sandbox System**
- Path whitelisting with `allowed_paths` configuration
- Write restrictions with `allow_write` flag
- Shell execution restrictions with `allow_shell` flag
- YOLO mode (auto-approve all operations)

#### **Approval System**
- Four approval modes:
  - `auto`: Auto-approve most operations
  - `smart`: Block high-risk operations
  - `manual`: Require explicit approval
  - `chat_only`: Chat mode only, no tool execution

#### **High-Risk Tool Detection**
Automatically identifies risky operations like:
- File modifications (write, edit, rm, mv)
- Package installations (apt, pip, npm)
- Cloud deployments (terraform, ansible)
- System changes (systemctl, service)
- Network operations (ssh, rsync)

#### **Web Safety**
- Domain allow/deny lists
- URL validation
- Safe browsing defaults

### 3. **LLM Integration**

#### **Supported Providers**
- **OpenRouter**: Access to 100+ models (default)
- **OpenAI**: GPT models
- **Gemini**: Google's models

#### **Features**
- Model selection and switching
- Streaming responses
- Model fallback (e.g., from free to paid tier)
- Caching of model lists
- API key management via environment variables or keys file

#### **Configuration**
```toml
[provider]
type = "openrouter"
model = "stepfun/step-3.5-flash:free"
api_key_env = "OPENROUTER_API_KEY"

[permissions]
default_yolo = false
allow_shell = true
allow_write = true
allow_external = true

[paths]
allowed_paths = ["/projects"]

[web]
web_allow_domains = ["github.com"]
web_deny_domains = ["evil.com"]
```

### 4. **Session Management**

- Session persistence
- Session resumption by ID
- Last session tracking per working directory
- Session history and context retention

### 5. **Storage System**

#### **Configuration Files**
- `~/.tehuti/config.toml`: Main configuration
- `~/.tehuti/keys.env`: API keys and secrets
- `~/.tehuti/tools.json`: External custom tools
- `~/.tehuti/mcp.json`: MCP server configurations
- `~/.tehuti/skills.json`: Skills database
- `~/.tehuti/logs/`: Session logs and execution records

#### **Session Storage**
- Checkpoints for task graphs
- Planning documents (blueprints)
- Automation configurations
- Delegate task records

### 6. **Web UI**

FastAPI-based web interface with:
- Prompt configuration
- Model selection
- Session management
- Browser-based interaction
- Runs on port 5494 by default

### 7. **Wire Server**

Minimal JSON lines server for programmatic access:
- Reads JSON commands from stdio
- Returns JSON responses
- Supports ACP (Agent Communication Protocol)
- Enables integration with other tools and systems

## Technical Stack

### **Languages**
- Python 3.10+ (primary)
- JavaScript/TypeScript (web UI)

### **Core Libraries**
- **Typer**: CLI framework
- **Rich**: Terminal styling and UI
- **Prompt Toolkit**: Interactive prompts
- **Pydantic**: Data validation
- **FastAPI**: Web framework
- **Uvicorn**: ASGI server
- **Playwright**: Browser automation
- **Pillow**: Image processing
- **NumPy**: Numerical operations
- **Trafilatura**: Web scraping
- **Selectolax**: HTML parsing
- **MCP**: Model Context Protocol
- **Boto3, Google Cloud, Azure SDKs**: Cloud integration
- **PyYAML**: YAML handling

### **Architecture Patterns**
- **Dependency Injection**: Through config and runtime instances
- **Command Pattern**: Tool execution
- **Observer Pattern**: Session management
- **Factory Pattern**: LLM provider creation
- **Strategy Pattern**: Tool dispatch

## Current State Analysis

### **Interactive Shell**
The interactive chat shell is currently disabled. The `run_shell` method in `TehutiApp` returns "Interactive shell mode is not available." and exits with code 1.

### **Print Mode**
The non-interactive print mode is operational:
- Reads prompt from command line or stdin
- Sends to LLM
- Prints response with Rich formatting
- Handles errors gracefully

### **Web UI**
The web interface is operational but minimal. It provides:
- Prompt input field
- Model selection
- Response display
- Session management

### **CLI Commands**
All CLI commands are operational:
- `tehuti`: Main entry point (shell or print mode)
- `tehuti web`: Start web UI
- `tehuti wire`: Start wire server
- `tehuti acp`: Alias for wire server
- `tehuti tools`: Check tool availability
- `tehuti doctor`: System diagnostics

## Full Potential of Project Tehuti

### **What It Can Become**

With the interactive shell implemented, Project Tehuti has the potential to be:

1. **Full-Spectrum AI Development Partner**
   - Natural language interface for all development tasks
   - Context-aware assistance that understands project structure
   - Learning capabilities from user interactions
   - Seamless integration with existing workflows

2. **Autonomous Development Agent**
   - Project scoping and planning (blueprints)
   - Task decomposition and execution (task graph)
   - Parallel task execution (delegates)
   - Continuous integration and delivery (CI/CD)
   - Bug detection and fixing
   - Code optimization and refactoring

3. **DevOps Automation Platform**
   - Infrastructure provisioning (Terraform, Cloud APIs)
   - Container orchestration (Docker, Kubernetes)
   - Deployment automation
   - System monitoring and troubleshooting
   - Log analysis and debugging

4. **Security & Compliance Auditor**
   - Vulnerability scanning
   - Security policy enforcement
   - Compliance checking
   - Audit trail generation

5. **Collaborative Team Assistant**
   - Shared sessions and context
   - Role-based permissions
   - Knowledge management (PROJECT.md)
   - Code review assistance
   - Documentation generation

6. **Learning Platform**
   - Code examples and best practices
   - Tutorial generation
   - Concept explanation
   - Interactive coding exercises

### **Key Differentiators**

1. **Comprehensive Toolkit**: 100+ tools covering all aspects of software development
2. **Safety First**: Advanced sandbox and approval system
3. **Flexible Architecture**: Modular design with plugin support
4. **Multi-Provider LLM Support**: OpenRouter, OpenAI, and Gemini
5. **Project Context Awareness**: Understands repository structure and history
6. **Interactive Capabilities**: PTY sessions for interactive tools
7. **Extensibility**: Custom tool creation and MCP integration

## Recommendations for Enhancement

### **1. Interactive Shell Implementation**
- Implement a rich, interactive chat interface with:
  - Command history
  - Autocompletion
  - Syntax highlighting
  - Context preservation
  - Session management

### **2. Enhanced Context Management**
- Improve project context understanding with:
  - Codebase analysis
  - Dependency graph building
  - Test coverage analysis
  - Performance profiling
  - Security scanning

### **3. Advanced Planning & Execution**
- Enhance the workflow system with:
  - Visual task graph representation
  - Parallel execution strategies
  - Error recovery mechanisms
  - Progress tracking and reporting
  - Resource allocation optimization

### **4. Improved User Experience**
- Create a modern, intuitive UI with:
  - Dashboard with project overview
  - Real-time execution monitoring
  - Visual tool output (charts, tables, diffs)
  - Customizable themes
  - Accessibility improvements

### **5. Collaboration Features**
- Add team collaboration capabilities:
  - Shared workspaces
  - Role-based access control
  - Multi-user sessions
  - Knowledge sharing
  - Code review integration

### **6. Performance Optimization**
- Optimize tool execution with:
  - Caching mechanisms
  - Parallel processing
  - Resource pooling
  - Execution profiling

### **7. Ecosystem Expansion**
- Grow the plugin ecosystem with:
  - More tool categories
  - Community-contributed tools
  - Marketplace for custom tools
  - Integration with popular services

## Conclusion

Project Tehuti is a sophisticated AI-powered development environment with a comprehensive toolkit and advanced safety features. While the interactive shell is currently disabled, the foundation is strong and well-architected. With the interactive interface implemented, Tehuti has the potential to become an indispensable AI development partner that understands project context, automates complex tasks, and provides intelligent assistance throughout the software development lifecycle.

The system's strengths lie in its:
- Comprehensive tool coverage
- Advanced safety and security features
- Flexible architecture
- Multi-provider LLM support
- Context-aware operations

With the right investments in the interactive shell and enhanced features, Project Tehuti could redefine how developers interact with AI for software engineering tasks.
