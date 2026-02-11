# User Guide

## Welcome to the Full Guide

This guide covers everything you need to know to become a Tehuti power user. We'll go from basics to advanced techniques, with plenty of examples along the way.

---

## The Philosophy: Talk Like a Human

Tehuti is designed around a simple idea: you should be able to describe what you want in natural language, and Tehuti figures out how to do it.

**Instead of:**
```json
{"type":"tool","name":"find","args":{"path":"src","name":"*.py"}}
```

**You just say:**
```
𓅞  Find all Python files in the src directory
```

Tehuti understands context, follows your project structure, and learns as you work together.

---

## Core Concepts

### The Agent Loop

When you send a message, Tehuti:

1. **Understands** what you're asking for
2. **Plans** which tools to use
3. **Executes** tools one by one
4. **Shows you** what happened (with diffs, tables, progress)
5. **Responds** with a summary or asks clarifying questions

### Session Memory

Tehuti remembers your conversation. This means:

```
You:  Read config.py
Tehuti: (shows you the file)

You:  Change the database URL to use localhost
Tehuti: (knows you mean config.py, makes the change)

You:  Run the tests
Tehuti: (still knows you're in the same project)
```

### Context Window

LLMs have a "memory" limit (context window). Tehuti shows you how much you've used in the status bar. If it gets full, start a new session or use `/clear`.

---

## Working with Files

### Reading Files

The simplest thing — just ask:

```
𓅞  Read the README file
𓅞  Show me what's in src/main.py
𓅞  Display the last 50 lines of the log file
```

For large files, Tehuti will show you a summary with the option to see more.

### Writing Files

Create new files by describing what you want:

```
𓅞  Create a new file called hello.py that prints "Hello, World!"
𓅞  Write a README with installation instructions
𓅞  Create a config.yaml with database settings for PostgreSQL
```

### Editing Files (The Good Stuff)

This is where Tehuti shines. You can make precise, surgical changes:

```
𓅞  In src/main.py, change the greeting message from "Hello" to "Welcome"
𓅞  Add error handling to the login function
𓅞  Update the version number from 1.0 to 1.1
```

Tehuti shows you a **color-coded diff**:
- **Red lines**: What was removed
- **Green lines**: What was added

No more wondering what the AI actually changed!

### Finding Files

Use glob patterns to find files:

```
𓅞  Find all Python files
𓅞  List all JSON files in the config directory
𓅞  Show me all test files
```

Behind the scenes, Tehuti uses the `glob` tool for pattern matching.

### Searching Within Files

Find text across multiple files:

```
𓅞  Search for "TODO" in all Python files
𓅞  Find where the login function is defined
𓅞  Show me all places that use the database connection
```

---

## Shell Commands

### Running Commands

Just describe what you want:

```
𓅞  Run the test suite
𓅞  List files in long format
𓅞  Show disk usage
𓅞  Kill the process on port 8080
```

Or be more specific:

```
𓅞  Run pytest with verbose output
𓅞  Use make to build the project with 4 jobs
𓅞  Install numpy and pandas
```

### Multiple Commands

Chain commands together:

```
𓅞  Run the tests and if they pass, deploy to production
𓅞  Build the Docker image and push it to the registry
𓅞  Check git status, then show me recent commits
```

---

## Web Operations

### Searching the Web

```
𓅞  Search for React hooks best practices
𓅞  Look up how to configure PostgreSQL for production
𓅞  Find examples of Python async code
```

Results include titles, URLs, and snippets — clickable if you're in the web UI.

### Fetching URLs

```
𓅞  Fetch the contents of https://api.github.com
𓅞  GET https://httpbin.org/get
𓅞  POST to https://httpbin.org/post with JSON data
```

---

## Docker & Containers

### Basic Operations

```
𓅞  List all Docker containers
𓅞  Show me running Docker images
𓅞  Start nginx on port 8080
𓅞  Stop the old container
```

### Building & Deploying

```
𓅞  Build a Docker image from the Dockerfile
𓅞  Run docker-compose to start all services
𓅞  Execute a command in the running container
𓅞  Show me the container logs
```

---

## Databases

### PostgreSQL

```
𓅞  Query all users from the postgres database
𓅞  Run a SQL count on the orders table
𓅞  Show me the schema for the users table
```

### MySQL

```
𓅞  Query the mysql database
𓅞  List all tables in the database
```

### Redis

```
𓅞  Get all Redis keys
𓅞  Set a value in Redis
𓅞  Show me the Redis config
```

---

## Git Operations

```
𓅞  Show git status
𓅞  Show me recent commits
𓅞  What branch am I on?
𓅞  Create a new branch called feature/login
𓅞  Show the git diff for unstaged changes
𓅞  Commit my changes with a good message
𓅞  Push to origin
𓅞  Pull the latest changes
```

---

## Kubernetes

```
𓅞  Get all pods in the default namespace
𓅞  Show me deployments
𓅞  Scale the app to 3 replicas
𓅞  Get logs from the web-app pod
𓅞  Describe the service
𓅞  Apply the new config
```

---

## Testing

```
𓅞  Run pytest
𓅞  Run Jest tests
𓅞  Execute Go tests
𓅞  Run cargo test
𓅞  Run tests with coverage
```

---

## Code Execution

Execute code snippets directly:

### Python

```
𓅞  Calculate the sum of 1 to 100
𓅞  Parse this JSON and show me the keys
```

### Node.js

```
𓅞  Evaluate this JavaScript expression
𓅞  Run a Node script
```

### Other Languages

```
𓅞  Run this Ruby code
𓅞  Execute the Perl script
𓅞  Run the Bash script
```

---

## Interactive PTY Sessions

For truly interactive programs (vim, nano, python REPL, etc.):

```
𓅞  Spawn a Python REPL
```

Tehuti gives you a session ID. Then:

```
𓅞  Send "print('hello')" to session abc123
𓅞  Read output from session abc123
𓅞  Close session abc123
```

---

## Slash Commands Reference

Type `/` to see the menu. Here are the most useful:

### Essential Commands

| Command | What It Does |
|---------|--------------|
| `/models` | Pick a different AI model |
| `/summary` | See what you've done this session |
| `/status` | Current configuration |
| `/context` | Context window usage |
| `/yolo` | Toggle auto-approve mode |

### Project Commands

| Command | What It Does |
|---------|--------------|
| `/thoth:status` | Project progress |
| `/thoth:commit` | Create atomic git commit |
| `/checkpoints` | Save/restore progress |
| `/plan` | Create or show session plan |

### Utility Commands

| Command | What It Does |
|---------|--------------|
| `/diff` | Git diff summary |
| `/transcript` | Full session history |
| `/tools` | Show tool registry |
| `/diagnostics` | Run system check |
| `/permissions` | Control what Tehuti can do |

---

## Permissions & Security

Tehuti has a permission system to keep you safe.

### Permission Levels

1. **YOLO Mode** (`default_yolo = true`)
   - Everything is auto-approved
   - Convenient but use with caution

2. **Interactive Mode**
   - Tehuti asks before running risky commands
   - Safer for shared machines

3. **Lockdown Mode** (`/lockdown`)
   - Most tools disabled
   - Safe for reviewing code

### Managing Permissions

```
𓅞  /yolo                    # Toggle auto-approve
𓅞  /allow-all               # Enable everything
𓅞  /lockdown                # Disable everything
𓅞  /allow-tool docker_run   # Enable specific tool
𓅞  /deny-tool shell         # Disable specific tool
```

### Path Restrictions

Control where Tehuti can read/write:

```toml
[paths]
allowed_paths = ["/projects", "/work"]
denied_paths = ["/etc", "/root", "/home/*/.ssh"]
```

---

## Session Management

### Check Your Progress

```
𓅞  /summary
```

Shows:
- Session ID and working directory
- Provider and model
- Message count
- Tools used
- Files read/written/edited
- Current permissions

### Start Fresh

```
𓅞  /new
```

Creates a new session (old one is preserved).

### Save/Restore Progress

```
𓅞  /checkpoint "完成了登录功能"   # Save checkpoint
𓅞  /checkpoints                 # List checkpoints
𓅞  /resume 1                    # Resume from checkpoint
```

---

## Configuration Deep Dive

### Provider Settings

```toml
[provider]
type = "openrouter"              # openrouter, openai, or gemini
model = "stepfun/step-3.5-flash:free"
base_url = "https://openrouter.ai/api/v1"
api_key_env = "OPENROUTER_API_KEY"
```

### Execution Settings

```toml
[execution]
default_yolo = false             # Auto-approve everything?
execution_mode = "autonomous"    # standard, autonomous, dominant
max_turns = 10                   # Max back-and-forths per task
```

### UI Settings

```toml
[ui]
show_banner = true               # Show welcome banner
show_history = true              # Show recent messages
show_actions = true              # Show tool execution details
```

---

## Tips & Tricks

### 1. Be Specific About Outcomes

```
Good: "Add input validation to the email field"
Better: "Add email validation that checks for @ symbol and rejects empty strings"
```

### 2. Break Complex Tasks into Steps

Instead of:
```
𓅞  Build a complete e-commerce site with cart, checkout, and payment integration
```

Try:
```
𓅞  Create the project structure for an e-commerce site
𓅞  Add a product model with name, price, and description
𓅞  Create the shopping cart functionality
...
```

### 3. Use Context to Your Advantage

```
𓅞  Read the user model (Tehuti remembers you're working on e-commerce)
𓅞  Add a "phone" field
𓅞  Add validation for phone numbers
```

### 4. Review Changes Before Committing

```
𓅞  Show me the git diff
𓅞  /thoth:commit "Add phone field to user model"
```

### 5. Ask for Explanations

```
𓅞  Read this complex function and explain what it does
𓅞  Why was this code written this way?
𓅞  Suggest improvements for performance
```

---

## Troubleshooting

### "Tool execution denied"

You don't have permission. Try:
```
𓅞  /yolo
# or
𓅞  /allow-all
```

### "Model returned empty response"

Check your API key:
```bash
cat ~/.tehuti/keys.env
```

Make sure it has credits available.

### "File not found"

Check your path:
```
𓅞  List files in the current directory
```

Use absolute paths if needed.

### Context window full

Start a new session:
```
𓅞  /new
```

### Web fetch blocked

Add the domain to allowed list in `config.toml`:
```toml
[web]
web_allow_domains = ["api.github.com", "docs.example.com"]
```

---

## Advanced: Direct Tool Calls

While natural language is preferred, you can call tools directly:

```json
{"type":"tool","name":"shell","args":{"command":"ls -la"}}
```

For multiple tools:
```json
{
  "type": "tools",
  "calls": [
    {"type":"tool","name":"read","args":{"path":"file.txt"}},
    {"type":"tool","name":"shell","args":{"command":"wc -l file.txt"}}
  ]
}
```

For final responses:
```json
{"type":"final","content":"All done!"}
```

---

## Summary

You've made it to the end! Here's the quick reference:

| Task | How to Do It |
|------|--------------|
| Read a file | `𓅞  Read filename` |
| Write/Edit | `𓅞  Change X to Y in file` |
| Run commands | `𓅞  Run command` |
| Search | `𓅞  Find pattern in files` |
| Docker | `𓅞  Manage containers` |
| Git | `𓅞  Git operations` |
| Summary | `𓅞  /summary` |
| Help | `𓅞  ?` |

---

**Now go forth and restore order! 🏛️**
