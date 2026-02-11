# Getting Started with Tehuti

## Welcome! 👋

So you've decided to give Tehuti a try — excellent choice! This guide will walk you through everything you need to get up and running, even if you've never used an AI coding assistant before.

By the end of this guide, you'll be having real conversations with Tehuti and getting actual work done.

---

## Part 1: Installation

### Step 1: Check Your Python Version

Tehuti needs Python 3.11 or later:

```bash
python --version
```

If you see something like `Python 3.12.3`, you're good to go. If not, [download Python](https://python.org/downloads) first.

### Step 2: Clone and Install

```bash
# Clone the repository (or use your fork)
git clone https://github.com/yourusername/project-tehuti.git
cd project-tehuti

# Create a virtual environment (keeps Tehuti's dependencies isolated)
python -m venv .venv

# Activate it
# On Linux/Mac:
source .venv/bin/activate

# On Windows:
.venv\Scripts\activate

# Install Tehuti in development mode
pip install -e .
```

### Step 3: Verify It Works

```bash
tehuti --help
```

You should see Tehuti's help message. Congratulations! 🎉

---

## Part 2: Configuration (Almost Done!)

Tehuti needs to know which AI model to use and how to talk to it. This takes about 2 minutes.

### Create Your Config Directory

```bash
mkdir -p ~/.tehuti
```

### Create the Config File

Create `~/.tehuti/config.toml` with your preferred provider:

**Option A: OpenRouter (Recommended for starters)**

OpenRouter aggregates many models and gives you free credits to start.

```toml
[provider]
type = "openrouter"
model = "stepfun/step-3.5-flash:free"  # Great free model!
api_key_env = "OPENROUTER_API_KEY"

# Let Tehuti do its thing without constant asking
default_yolo = true

# Where Tehuti can read/write
allowed_paths = ["/your/project/directory"]
```

**Option B: OpenAI (If you have an API key)**

```toml
[provider]
type = "openai"
model = "gpt-4o"
api_key_env = "OPENAI_API_KEY"

default_yolo = true
allowed_paths = ["/your/project/directory"]
```

**Option C: Google Gemini**

```toml
[provider]
type = "gemini"
model = "gemini-2.0-flash-exp"
api_key_env = "GEMINI_API_KEY"

default_yolo = true
allowed_paths = ["/your/project/directory"]
```

### Add Your API Key

Create `~/.tehuti/keys.env`:

```bash
# For OpenRouter
OPENROUTER_API_KEY=sk-or-v1-your-key-here

# For OpenAI
OPENAI_API_KEY=sk-your-key-here

# For Gemini
GEMINI_API_KEY=your-gemini-key-here
```

> **🔐 Security Note:** Your API keys are stored in `keys.env`, which is gitignored. Never commit this file to version control!

---

## Part 3: Your First Conversation

### Launch Tehuti

```bash
tehuti
```

You should see something like:

```
╭──────────────────────────────────────────────────────────╮
│                                                          │
│              ████████╗███████╗██╗  ██╗██╗   ██╗████████╗ │
│              ╚══██╔══╝██╔════╝██║  ██║██║   ██║╚══██╔══╝ │
│                 ██║   █████╗  ███████║██║   ██║   ██║    │
│                 ██║   ██╔══╝  ██╔══██║██║   ██║   ██║    │
│                 ██║   ███████╗██║  ██║╚██████╔╝   ██║    │
│                 ╚═╝   ╚══════╝╚═╝  ╚═╝ ╚═════╝    ╚═╝    │
│                                                          │
│                    𓅞  Thoth, Architect of Truth         │
│                                                          │
╰──────────────────────────────────────────────────────────╯

𓅞  Ready for the next instruction.
```

### Try These Starter Commands

Here are some safe, fun commands to try first:

**1. List files in the current directory**
```
𓅞  List all files here
```

**2. Read a file**
```
𓅞  Read the README file
```

**3. Search for something**
```
𓅞  Search the web for Python list comprehensions best practices
```

**4. Check system information**
```
𓅞  Show me how much disk space is free
```

**5. Run a quick calculation**
```
𓅞  What is 42 times 17?
```

---

## Part 4: Natural Language is Your Friend

The best thing about Tehuti? You don't need to learn some special syntax. Just... ask.

### ✅ Good Examples

```
𓅞  Find all Python files in the src directory
𓅞  Create a new file called hello.py that prints "Hello, World!"
𓅞  Show me the git diff for changes I made
𓅞  Run pytest to see if tests pass
𓅞  Start a Docker container with nginx on port 8080
𓅞  What's in the config file? Just show me the important parts.
```

### 🎯 Pro Tips

**Be specific when it matters:**

```
Good: "Find all Python files that import requests module"
Better: "Find all Python files that use requests.get()"
```

**Tell Tehuti what you want, not how to do it:**

```
Bad: "Use the grep tool to search for 'TODO' in src/"
Good: "Find all TODO comments in the source code"
```

**Chain tasks together:**

```
𓅞  Read the config file, then tell me what the model is set to
```

---

## Part 5: Understanding the Interface

### The Prompt

```
𓅞  _
```

That's where you type. The `𓅞` is Tehuti's "agent" symbol — like a little scribe.

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Send your message |
| `Tab` | Autocomplete (file paths, commands) |
| `↑/↓` | Command history |
| `/` | Show slash commands menu |
| `?` | Show keyboard shortcuts |
| `Ctrl+C` | Cancel current operation |
| `Ctrl+D` | Exit Tehuti |

### The Status Bar (Bottom)

Shows useful information:
- **Provider**: Which AI model you're using
- **Model**: The specific model name
- **Session**: Your session ID
- **Permissions**: What's allowed (shell, write, etc.)
- **Context**: How much of the context window you've used

---

## Part 6: Your First "Real" Task

Let's do something useful. Suppose you have a Python project and want to understand it:

```
𓅞  Find all Python files in this project
```

Tehuti will search and show you a list. Then:

```
𓅞  Show me the file structure, like a tree
```

Or to dive deeper into a specific file:

```
𓅞  Read src/main.py and summarize what it does
```

Want to make a change?

```
𓅞  In src/main.py, find the function that handles users and explain it to me
```

---

## Part 7: Configuration Deep Dive

### Understanding YOLO Mode

`default_yolo = true` means Tehuti will automatically approve all tool executions. This is convenient but use with caution!

For more control, use `/yolo` to toggle it on/off during your session.

### Path Restrictions

By default, Tehuti can only access paths you specify:

```toml
[paths]
allowed_paths = ["/home/me/projects", "/work/project"]
denied_paths = ["/etc", "/root/.ssh"]  # Never touch these
```

### Web Access

Control which websites Tehuti can fetch:

```toml
[web]
web_allow_domains = ["github.com", "api.example.com"]
web_deny_domains = ["malicious-site.com"]
```

---

## Part 8: Getting Unstuck

### "Tool execution denied"

Tehuti needs permission to do things. Try:

```
𓅞  /yolo
```

Or more selectively:

```
𓅞  /allow-all
```

### "Model returned empty response"

Check your API key:
```bash
cat ~/.tehuti/keys.env
```

Make sure it's valid and has credits/usage available.

### "File not found"

Check the path:
```
𓅞  List files in the current directory
```

And use absolute paths if unsure:
```
𓅞  Read /absolute/path/to/file.txt
```

### Context Window Full

If Tehuti says the context is full:

```
𓅞  /summary
```

Or start a fresh session (your session history is preserved).

---

## What's Next?

You've got the basics down! Here are some next steps:

1. **Try the edit tool** — Tehuti can make precise code changes:
   ```
   𓅞  Change the function greeting to say "Hello" instead of "Hi"
   ```

2. **Explore tools** — 106 of them! Try:
   ```
   𓅞  Show me all Docker containers running
   𓅞  Run a SQL query on the database
   𓅞  Deploy this to Kubernetes
   ```

3. **Check your session summary**:
   ```
   𓅞  /summary
   ```

4. **Read the full user guide** → [USER_GUIDE.md](USER_GUIDE.md)

---

## Need Help?

- **Commands not working?** See [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
- **Want to configure everything?** See [CONFIGURATION.md](CONFIGURATION.md)
- **Tool reference?** See [TOOLS.md](TOOLS.md)

---

**🎉 You're all set! Go restore some order.**
