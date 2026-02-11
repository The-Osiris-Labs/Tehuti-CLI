# Troubleshooting Guide

This guide covers common issues you might encounter when using Tehuti and how to resolve them.

---

## Installation Issues

### "Command not found: tehuti"

**Problem:** After installation, the `tehuti` command isn't available.

**Solutions:**

1. **Verify installation:**
   ```bash
   pip install -e .
   which tehuti  # Linux/Mac
   where tehuti  # Windows
   ```

2. **Check your virtual environment is activated:**
   ```bash
   source .venv/bin/activate  # Linux/Mac
   .venv\Scripts\activate      # Windows
   ```

3. **Reinstall the package:**
   ```bash
   pip uninstall tehuti-cli
   pip install -e .
   ```

4. **Add to PATH manually** (if using pipx or custom install):
   ```bash
   export PATH="$HOME/.local/bin:$PATH"  # or your pip install location
   ```

---

### Python Version Error

**Problem:** Tehuti requires Python 3.11 or later.

**Check your version:**
```bash
python --version
```

**Solutions:**

1. **Install Python 3.11+** from [python.org](https://python.org/downloads)

2. **Using pyenv:**
   ```bash
   pyenv install 3.12
   pyenv local 3.12
   ```

3. **Using conda:**
   ```bash
   conda create -n tehuti python=3.12
   conda activate tehuti
   ```

---

## Configuration Issues

### "Provider type not recognized"

**Problem:** Tehuti doesn't recognize your provider setting.

**Example error:**
```
Error: Provider type 'OpenRouter' not recognized
```

**Solution:** Provider type must be lowercase:

```toml
# Wrong
[provider]
type = "OpenRouter"

# Correct
[provider]
type = "openrouter"
```

Valid providers: `openrouter`, `openai`, `gemini`

---

### "API key not found"

**Problem:** Tehuti can't find your API key.

**Solutions:**

1. **Verify `keys.env` exists:**
   ```bash
   cat ~/.tehuti/keys.env
   ```

2. **Check environment variable name matches config:**
   ```toml
   # config.toml
   api_key_env = "OPENROUTER_API_KEY"

   # keys.env
   OPENROUTER_API_KEY=your-key-here
   ```

3. **Verify the key is valid:**
   ```bash
   echo $OPENROUTER_API_KEY
   ```

4. **Ensure file permissions are correct:**
   ```bash
   chmod 600 ~/.tehuti/keys.env
   ```

---

### "Path not allowed"

**Problem:** Tehuti can't access the path you specified.

**Example:**
```
Error: Path '/project' is not in allowed_paths
```

**Solutions:**

1. **Use absolute paths:**
   ```toml
   # Wrong
   allowed_paths = ["."]

   # Correct
   allowed_paths = ["/home/user/projects/my-project"]
   ```

2. **Add the path to config:**
   ```toml
   [paths]
   allowed_paths = ["/home/user/projects", "/work/code"]
   ```

3. **Check path exists:**
   ```bash
   ls -la /your/path
   ```

---

### "Web fetch blocked"

**Problem:** Tehuti can't access a website.

**Example:**
```
Error: Domain 'api.example.com' is not in allowed domains
```

**Solutions:**

1. **Add the domain to config:**
   ```toml
   [web]
   web_allow_domains = ["api.github.com", "docs.example.com"]
   ```

2. **Or use YOLO mode for unrestricted access** (use with caution):
   ```toml
   [permissions]
   default_yolo = true
   ```

---

## Runtime Issues

### "Tool execution denied"

**Problem:** Tehuti doesn't have permission to run a tool.

**Solutions:**

1. **Enable YOLO mode:**
   ```
   𓅞  /yolo
   ```

2. **Or allow specific operations:**
   ```
   𓅞  /allow-all
   ```

3. **Check current permissions:**
   ```
   𓅞  /permissions
   ```

4. **Update config for permanent fix:**
   ```toml
   [permissions]
   default_yolo = true
   ```

---

### "Model returned empty response"

**Problem:** The AI model didn't return a response.

**Solutions:**

1. **Check API key validity:**
   ```bash
   cat ~/.tehuti/keys.env
   ```

2. **Verify API key has credits/usage available**

3. **Try a different model:**
   ```toml
   [provider]
   model = "anthropic/claude-sonnet-4-20250514"
   ```

4. **Check provider status** (OpenRouter status page, OpenAI status page)

---

### "Context window full"

**Problem:** The conversation context is full.

**Solutions:**

1. **Start a new session:**
   ```
   𓅞  /new
   ```

2. **Clear context:**
   ```
   𓅞  /clear
   ```

3. **Check context usage:**
   ```
   𓅞  /context
   ```

---

### "File not found"

**Problem:** Tehuti can't find a file.

**Solutions:**

1. **List current directory:**
   ```
   𓅞  List files in the current directory
   ```

2. **Use absolute paths:**
   ```
   𓅞  Read /absolute/path/to/file.txt
   ```

3. **Check the path in your message**

---

### "Permission denied" (Unix)

**Problem:** Can't read/write a file due to permissions.

**Solutions:**

1. **Check file permissions:**
   ```bash
   ls -la filename
   ```

2. **Fix permissions:**
   ```bash
   chmod 644 filename  # for reading
   chmod 666 filename  # for reading and writing
   ```

3. **Or run as appropriate user:**
   ```bash
   sudo chown user:group filename
   ```

---

## Docker Issues

### "Docker not found"

**Problem:** Tehuti can't access Docker.

**Solutions:**

1. **Install Docker:** [docker.com](https://docker.com)

2. **Add user to docker group:**
   ```bash
   sudo usermod -aG docker $USER
   newgrp docker  # or log out/in
   ```

3. **Start Docker daemon:**
   ```bash
   sudo systemctl start docker
   ```

---

### "Cannot connect to Docker daemon"

**Problem:** Docker daemon isn't running.

**Solutions:**

1. **Start Docker Desktop** (macOS/Windows)

2. **Start Docker daemon** (Linux):
   ```bash
   sudo systemctl start docker
   sudo systemctl enable docker
   ```

3. **Check Docker status:**
   ```bash
   docker info
   ```

---

## Database Connection Issues

### "Connection refused" (PostgreSQL/MySQL)

**Problem:** Can't connect to database.

**Solutions:**

1. **Verify database is running:**
   ```bash
   sudo systemctl status postgresql  # PostgreSQL
   sudo systemctl status mysql       # MySQL
   ```

2. **Check connection parameters:**
   ```bash
   psql -h localhost -U postgres -d mydb
   ```

3. **Ensure database accepts connections** (check pg_hba.conf for PostgreSQL)

---

### "Redis connection refused"

**Problem:** Can't connect to Redis.

**Solutions:**

1. **Start Redis:**
   ```bash
   sudo systemctl start redis
   ```

2. **Check Redis is listening:**
   ```bash
   redis-cli ping
   ```

---

## Git Issues

### "Not a git repository"

**Problem:** Current directory isn't a Git repository.

**Solutions:**

1. **Navigate to a git repository:**
   ```bash
   cd /path/to/your/repo
   ```

2. **Initialize a new repository:**
   ```
   𓅞  Initialize a git repository
   ```

3. **Clone a repository:**
   ```
   𓅞  Clone https://github.com/user/repo.git
   ```

---

### "Authentication failed" (Git push)

**Problem:** Can't push to remote repository.

**Solutions:**

1. **Check remote URL (HTTPS vs SSH):**
   ```bash
   git remote -v
   ```

2. **For HTTPS:** Update credentials or use token:
   ```bash
   git remote set-url origin https://TOKEN@github.com/user/repo.git
   ```

3. **For SSH:** Configure SSH keys:
   ```bash
   ssh-keygen -t ed25519 -C "your@email.com"
   ssh-add ~/.ssh/id_ed25519
   ```

4. **Add SSH key to GitHub:** [GitHub SSH settings](https://github.com/settings/keys)

---

## Performance Issues

### Slow Responses

**Problem:** Tehuti takes too long to respond.

**Solutions:**

1. **Try a faster model:**
   ```toml
   [provider]
   model = "anthropic/claude-sonnet-4-20250514"  # Faster than some options
   ```

2. **Reduce context size:**
   - Start new sessions frequently
   - Avoid sending large files

3. **Check network connection**

4. **Check provider API status**

---

### High Memory Usage

**Problem:** Tehuti is using too much memory.

**Solutions:**

1. **Restart Tehuti:**
   ```
   𓅞  /exit
   tehuti  # Restart
   ```

2. **Clear cache:**
   ```bash
   rm -rf ~/.tehuti/cache/*
   ```

3. **Limit session history** in config

---

## Web UI Issues

### "Web server failed to start"

**Problem:** `tehuti web` command fails.

**Solutions:**

1. **Check port availability:**
   ```bash
   lsof -i :5494
   ```

2. **Use a different port:**
   ```bash
   tehuti web --port 8080
   ```

3. **Check firewall settings**

---

### "Connection refused" (Web UI)

**Problem:** Can't access http://localhost:5494.

**Solutions:**

1. **Verify web server is running:**
   ```bash
   tehuti web
   ```

2. **Check the correct port**

3. **Try accessing from browser directly**

4. **Disable firewall temporarily for testing**

---

## Shell/PTY Issues

### "Interactive command stuck"

**Problem:** A shell command or PTY session is frozen.

**Solutions:**

1. **Cancel with Ctrl+C**

2. **Kill the process:**
   ```
   𓅞  Kill process on port 8080
   ```

3. **Close PTY session:**
   ```
   𓅞  Close session abc123
   ```

---

### "Command timed out"

**Problem:** A command took too long to execute.

**Solutions:**

1. **Increase timeout in config:**
   ```toml
   [execution]
   max_turns = 20
   ```

2. **Break complex commands into smaller steps**

3. **Run simpler commands first**

---

## Getting More Help

### Enable Debug Mode

For detailed logging:

```bash
export TEHUTI_LOG_LEVEL=DEBUG
tehuti
```

### Check Logs

Tehuti logs are stored in:
```bash
~/.tehuti/logs/
```

### Run Diagnostics

```
𓅞  /diagnostics
```

### Collect System Info

```bash
# Python version
python --version

# Pip version
pip --version

# Tehuti version
tehuti --version

# Operating system
uname -a  # Linux/Mac
systeminfo  # Windows
```

---

## Common Error Messages

| Error | Solution |
|-------|----------|
| `Provider type not recognized` | Use lowercase: `openrouter`, `openai`, or `gemini` |
| `API key not found` | Verify `keys.env` exists and contains correct key |
| `Path not allowed` | Add path to `allowed_paths` in config |
| `Web fetch blocked` | Add domain to `web_allow_domains` |
| `Tool execution denied` | Enable YOLO mode or allow specific tools |
| `Model returned empty response` | Check API key validity and credits |
| `Context window full` | Start new session with `/new` |
| `File not found` | Use absolute paths |
| `Docker not found` | Install Docker and add user to docker group |
| `Not a git repository` | Navigate to or initialize a git repo |

---

## Still Need Help?

1. **Search existing issues:** [GitHub Issues](https://github.com/yourusername/project-tehuti/issues)
2. **Create a new issue** with:
   - Error message
   - Steps to reproduce
   - System information
   - Configuration (remove API keys!)

---

**Remember:** *"You do not debug; you restore order."* 𓅞
