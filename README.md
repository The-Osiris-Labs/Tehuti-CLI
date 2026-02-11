# Project Tehuti

## Meet Your New AI Development Partner

Hey there! 👋 Welcome to Project Tehuti — named after Thoth (Tehuti), the Egyptian god of wisdom, writing, and knowledge. Think of Tehuti as your personal AI assistant who's actually *good* at coding, DevOps, system administration, and pretty much anything you throw at it.

**Our motto:** *"You do not debug; you restore order."*

---

## What Can Tehuti Actually Do?

Glad you asked! Tehuti isn't just another CLI tool — it's a full-blown AI-powered development environment. Here's the rundown:

### 🤖 Built for AI First
Everything about Tehuti was designed with LLMs in mind. Structured JSON protocols? Check. 106 execution tools? You bet. Real-time streaming so you're never staring at a blank screen? Absolutely.

### 🔧 106+ Execution Tools
From reading files to managing Docker containers, querying databases, running Kubernetes commands, searching the web, and everything in between — Tehuti's got you covered.

### 🌐 Web Superpowers
Need to search for something? Tehuti's got DuckDuckGo built right in. Want to fetch a URL with custom headers and methods? Done.

### 🐳 Docker & Kubernetes
Manage containers, build images, run docker-compose, deploy to Kubernetes — all through natural conversation.

### 💻 Interactive Terminals
Spawn PTY sessions for interactive programs like vim, nano, or python. It's like having a terminal that talks back.

### 🎨 It's Actually Nice to Look At
Forget those boring monochrome terminals. Tehuti greets you with an Egyptian-inspired gold-on-obsidian theme. Yes, aesthetics matter.

---

## Getting Started (The Easy Way)

### Prerequisites
- Python 3.11 or later
- Git (because you're a developer, right?)
- An API key for your LLM provider

### Installation

```bash
# Clone and enter the directory
git clone <your-repo-url>
cd project-tehuti

# Create a virtual environment
python -m venv .venv

# Activate it (Linux/Mac)
source .venv/bin/activate
# On Windows: .venv\Scripts\activate

# Install Tehuti
pip install -e .
```

### Configuration (Two Minutes Flat)

Create `~/.tehuti/config.toml`:

```toml
[provider]
type = "openrouter"              # or "openai", "gemini"
model = "stepfun/step-3.5-flash:free"
api_key_env = "OPENROUTER_API_KEY"

# YOLO mode = auto-approve everything (convenient but use wisely!)
default_yolo = true

# What Tehuti is allowed to touch
allowed_paths = ["/your/projects"]
```

Create `~/.tehuti/keys.env`:

```bash
OPENROUTER_API_KEY=your-key-here
```

---

## Your First Conversation

### Interactive Mode (Recommended)

```bash
tehuti
```

You'll see a beautiful welcome screen, then just... talk to it:

```
𓅞  List all Python files in the src directory
```

Tehuti will figure out what you need, run the appropriate tools, and show you results with inline diffs, formatted tables, and progress indicators.

### Quick One-Liner

```bash
tehuti --print -p "List all files in the current directory"
```

Perfect for quick tasks without entering the interactive shell.

### Web UI (Beta)

```bash
tehuti web
```

Opens a browser-based interface at `http://localhost:5494`.

---

## Talking to Tehuti

### Natural Language (The Best Way)

Just... talk. Seriously.

```
𓅞  Find all Python files modified last week
𓅞  Create a new API endpoint for user registration
𓅞  Run the tests and show me what's failing
𓅞  Deploy this to production
```

Tehuti understands context, follows your project structure, and learns as you work together.

### Slash Commands (Quick Access)

Type `/` to see available commands:

| Command | What It Does |
|---------|--------------|
| `/models` | Pick a different AI model |
| `/provider` | Switch LLM providers |
| `/permissions` | Control what Tehuti can do |
| `/summary` | See what we've done this session |
| `/status` | Current configuration and context |
| `/yolo` | Toggle auto-approve mode |
| `/thoth:status` | Project progress tracking |
| `/exit` | Bye! 👋 |

---

## Tool Categories at a Glance

| Category | Tools | Example Use |
|----------|-------|-------------|
| **Files** | read, write, edit, glob | "Read config.py" |
| **Shell** | shell, bash_script | "Run make build" |
| **Web** | web_search, fetch | "Search for React patterns" |
| **Docker** | ps, run, build, exec | "Start a PostgreSQL container" |
| **Databases** | psql, mysql, redis | "Query users table" |
| **Git** | status, log, diff, push | "Show me recent commits" |
| **Kubernetes** | kubectl | "Get pods in default namespace" |
| **Testing** | pytest, jest, go_test | "Run the test suite" |
| **System** | ps, df, free, top | "Show me memory usage" |
| **Code** | python, node, ruby | "Evaluate this expression" |

---

## The "Edit" Tool (A Game Changer)

Finally, an AI assistant that can make precise code changes:

```json
{
  "type": "tool",
  "name": "edit",
  "args": {
    "path": "src/main.py",
    "old_string": "def hello():\n    print('Hello')",
    "new_string": "def hello(name):\n    print(f'Hello, {name}!')"
  }
}
```

Tehuti shows you exactly what changed with color-coded diffs:
- Red lines: Removed
- Green lines: Added

No more guessing what the AI actually did to your code.

---

## Configuration Options

Want to fine-tune Tehuti's behavior? Here's what you can customize:

```toml
[provider]
type = "openrouter"              # openrouter, openai, or gemini
model = "stepfun/step-3.5-flash:free"
api_key_env = "OPENROUTER_API_KEY"

[permissions]
default_yolo = false             # Auto-approve everything?
allow_shell = true               # Run shell commands?
allow_write = true               # Write files?
allow_external = true            # Use external tools?

[paths]
allowed_paths = ["/projects"]    # Where Tehuti can work

[web]
web_allow_domains = ["github.com"]  # Allowed domains
web_deny_domains = ["evil.com"]     # Blocked domains
```

---

## Why "Tehuti"?

In Egyptian mythology, Thoth (Tehuti) was the scribe of the gods, god of wisdom, and the inventor of writing. He was believed to maintain the universe's balance and served as the mediator between good and evil.

We chose this name because building software should feel like restoring order — not fighting with your tools. Tehuti is here to help you think, create, and restore balance to your codebase.

---

## Need Help?

- **Something broken?** Check the [troubleshooting guide](docs/TROUBLESHOOTING.md)
- **Want to configure everything?** See the [configuration reference](docs/CONFIGURATION.md)
- **Tool reference?** We've got you covered in [TOOLS.md](docs/TOOLS.md)
- **Just getting started?** Head to [GETTING_STARTED.md](docs/GETTING_STARTED.md)

---

## License

MIT — use it, break it, improve it. Open source forever.

---

**𓅞 Thoth, Architect of Truth**

*"You do not debug; you restore order."*
