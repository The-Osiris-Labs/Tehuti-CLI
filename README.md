# Tehuti

<img width="3142" height="710" alt="CleanShot 2026-02-12 at 05 28 20@2x" src="https://github.com/user-attachments/assets/05aa5407-6d30-47a8-a88e-63e99f8fd9fc" />

---

## The Mission

**Chaos has descended upon software development.**

Every week, a new AI tool emerges. Every developer with access to an LLM spins up their own "revolutionary" project. Vibe coding has replaced engineering. "It works" has replaced "it is correct."

**This ends now.**

Tehuti is not another toy for hobbyists. It is not another chat interface wrapped in a terminal. It is the **Architect of Truth**—a tool built for developers who understand that code is not about "shipping fast" but about **shipping right**.

---

## Who Tehuti Is For

| You are... | Tehuti is for you |
|------------|-------------------|
| An engineer who values correctness over speed | ✅ |
| Someone who remembers what "technical debt" means | ✅ |
| A developer who reads documentation before asking AI | ✅ |
| Someone who knows that "it works" ≠ "it's correct" | ✅ |
| A professional who treats code as craft | ✅ |

**Tehuti is NOT for:**
- Those who copy-paste without understanding
- Developers who think "vibe coding" is legitimate
- People who ship without tests because "AI will fix it later"
- Those who confuse access to tools with mastery of skills

If you are here to build something real, something lasting, something **correct**—welcome home.

---

## The OSIRIS Pantheon

*Egyptian mythology reborn as modern AI*

**OSIRIS** — The main mother company. God of the afterlife, transition, and rebirth. OSIRIS oversees the reincarnation of Egyptian deities into cutting-edge AI technology.

| Deity | Role | Status |
|-------|------|--------|
| **𓅞 Tehuti** | Truth, Order, Engineering Excellence | 🏛️ Active |
| **𓃠 IBIS** | AGI Trading & Pattern Recognition | 🔗 [Live](https://github.com/The-Osiris-Labs/IBIS-AGI-TRADER) |

---

## What Tehuti Actually Does

### 262 Tools. Zero Compromise.

Every tool in Tehuti's arsenal is built for developers who demand precision:

| Category | Tools | Capability |
|----------|-------|------------|
| **System Admin** | 27 | Kernel, services, cron, users |
| **Development** | 40+ | gcc, clang, rustc, go, compilers |
| **Containers** | 5 | docker-compose, kubectl, helm |
| **Cloud** | 5 | AWS, Azure, GCP via CLI |
| **Databases** | 5 | PostgreSQL, MySQL, Redis, MongoDB |
| **Debugging** | 4 | strace, gdb, ltrace |
| **Core Tools** | 171 | Files, git, web, search |

### Semantic Memory That Remembers

Tehuti never forgets:

```
/remember DATABASE_URL is in .env as postgres://...
/remember We use semantic versioning with Conventional Commits
/recall What database connection string did I save?
```

Powered by **sentence-transformers** with 384-dimensional embeddings. It understands meaning, not just keywords.

### Multi-Agent Collaboration (A2A Protocol)

Built for teams that understand orchestration:

```
/a2a http://security-agent:8080  # Connect to specialist
/delegate Write unit tests for src/core/memory.py  # Delegate
/agent Refactor the entire CLI to use click  # Autonomous
```

---

## Developer Scenarios

### 𓅞 The Debugging Warrior

```
┌─────────────────────────────────────────────────────────────────┐
│  02:47 AM  ─  Production is Down                                │
│                                                                 │
│  𓅞 YOU:                                                         │
│  "Tehuti, we got paged. 500 errors on checkout service.          │
│   Last deploy was 6 hours ago. Debug this."                      │
│                                                                 │
│  🤖 TEHUTI:                                                     │
│  → Checking git log... 14 commits since last deploy              │
│  → Found potential culprit: "refactor payment flow" commit       │
│  → Analyzing diff... removed null check on user.billing          │
│  → Proposed fix: Add back null check on line 47                 │
│                                                                 │
│  ✅ FIX APPLIED. Deploying hotfix...                            │
└─────────────────────────────────────────────────────────────────┘
```

**3-hour nightmare solved in 4 minutes.**

---

### 𓁵 The Greenfield Architect

```
┌─────────────────────────────────────────────────────────────────┐
│  10:30 AM  ─  New Microservice                                  │
│                                                                 │
│  𓁵 YOU:                                                        │
│  "Starting new user management service. We need:                 │
│   - FastAPI endpoints                                           │
│   - PostgreSQL with async SQLAlchemy                            │
│   - Redis caching layer                                         │
│   - JWT auth                                                   │
│   - Docker Compose setup                                        │
│   - Full test coverage                                          │
│   Generate the skeleton."                                        │
│                                                                 │
│  🤖 TEHUTI:                                                     │
│  → Creating project structure...                                │
│  → Generated 14 files: config, models, auth, tests, docker    │
│  → Set up pytest, coverage, CI/CD pipeline                    │
│  → Ready to run: docker-compose up --build                      │
│                                                                 │
│  ✅ SERVICE SKELETON READY. Start coding business logic.        │
└─────────────────────────────────────────────────────────────────┘
```

**Zero to running service in under 2 minutes.**

---

### 𓃭 The Onboarding Expert

```
┌─────────────────────────────────────────────────────────────────┐
│  09:00 AM  ─  Day 1 at New Company                            │
│                                                                 │
│  𓃭 NEW DEV:                                                    │
│  "Explain the auth system. How does refresh token rotation     │
│   work? Where's the blacklist for revoked tokens?"               │
│                                                                 │
│  🤖 TEHUTI:                                                     │
│  → Found 3 auth-related files                                    │
│  → Analyzing token flow...                                      │
│                                                                 │
│  "Here's how auth works at this company:                         │
│                                                                 │
│   1. Access token: 15 min, stored in memory                    │
│   2. Refresh token: 7 days, httpOnly cookie                   │
│   3. Rotation: New refresh on every use                        │
│   4. Revocation: Redis set 'revoked_tokens:{jti}'              │
│                                                                 │
│  Files to study:                                               │
│   - src/auth/tokens.py (main logic)                           │
│   - src/auth/middleware.py (validation)                        │
│   - tests/auth/test_tokens.py (behavior examples)"              │
│                                                                 │
│  💡 TIP: Run /trace to see real auth flow in action.            │
└─────────────────────────────────────────────────────────────────┘
```

**No more "who can explain this codebase?" messages.**

---

## Installation

```bash
git clone https://github.com/The-Osiris-Labs/Tehuti-CLI
cd Tehuti-CLI
pip install -e .
```

### Configuration

Create `~/.tehuti/config.toml`:

```toml
[provider]
type = "openrouter"
model = "nvidia/nemotron-3-nano-30b-a3b:free"
api_key_env = "OPENROUTER_API_KEY"

[permissions]
default_yolo = true
allow_shell = true
allow_write = true
```

Create `~/.tehuti/keys.env`:

```bash
OPENROUTER_API_KEY=your-api-key-here
```

### Launch

```bash
tehuti
```

### Unleash Full Power

```
/full
```

**YOLO Mode (You Only Live Once):**
- Unlimited shell access
- All file system paths
- No approval prompts
- Full network access

*Use wisely. With great power comes great responsibility.*

---

## Commands

### Natural Language

```
𓅞 List all Python files in the src directory
𓅞 Create a new API endpoint for user registration
𓅞 Run the tests and show me what's failing
𓅞 Deploy this to production
```

### Slash Commands

| Command | Description |
|---------|-------------|
| `/full` | Enable maximum capabilities |
| `/agent <task>` | Run autonomous agent |
| `/delegate <task>` | Delegate to sub-agent |
| `/a2a <url>` | Connect to A2A agent |
| `/remember <text>` | Store in memory |
| `/recall <query>` | Search memory |
| `/trace` | Execution trace |
| `/metrics` | Token usage & costs |

---

## The Edit Tool

Precision code changes, not guesswork:

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

Color-coded diffs. No ambiguity. **Truth in code.**

---

## Architecture

```
src/tehuti_cli/
├── cli.py              # Entry point
├── agentic.py         # High-level agent API
├── core/
│   ├── runtime.py     # Execution engine
│   ├── tools.py       # 262 tools
│   ├── memory.py      # Semantic memory
│   ├── a2a_client.py  # Multi-agent protocol
│   └── agent_loop.py  # ReAct loop
├── providers/
│   ├── llm.py        # LLM interface
│   ├── openrouter.py
│   ├── openai.py
│   └── gemini.py
├── ui/
│   └── shell.py       # Interactive shell
└── storage/
    ├── config.py
    └── session.py
```

---

## Tech Stack

- **Python 3.10+** — Core language
- **pydantic** — Type validation
- **rich** — Beautiful terminal UI
- **prompt_toolkit** — Interactive shell
- **httpx** — Async HTTP
- **sentence-transformers** — Semantic embeddings
- **MCP 1.0** — Model Context Protocol
- **A2A** — Agent-to-Agent Protocol

---

## Documentation

| Document | Description |
|----------|-------------|
| [SYSTEM_SUMMARY.md](SYSTEM_SUMMARY.md) | Full overview with scenarios |
| [docs/README.md](docs/README.md) | Documentation index |
| [docs/COMPREHENSIVE.md](docs/COMPREHENSIVE.md) | Complete API reference |
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | User manual |
| [docs/TOOLS.md](docs/TOOLS.md) | 262 tool references |
| [BRANDING.md](BRANDING.md) | Brand bible |

---

## The Philosophy

1. **Tools empower, not limit** — If you can do it, Tehuti helps
2. **Context is king** — Forgetting context wastes effort
3. **Transparency builds trust** — Always know what Tehuti does
4. **Collaboration, not replacement** — Augments your skills
5. **Truth over speed** — Correctness matters more than fast bugs

---

## About TheOsirisLabs.com

**Project Tehuti** is a product of **TheOsirisLabs.com** — a laboratory dedicated to building tools that demand excellence.

We do not build chatbots. We do not build toys for the impatient. We build **instruments of precision** for developers who understand that code is a craft, not a commodity.

The chaos of modern AI development—the "vibe coders," the immature tools, the endless stream of half-baked projects—ends here.

**𓃠 IBIS is live**: [github.com/The-Osiris-Labs/IBIS-AGI-TRADER](https://github.com/The-Osiris-Labs/IBIS-AGI-TRADER)

More instruments of truth shall rise.

---

## License

MIT — use it, break it, improve it. Open source forever.

---

**𓅞 Thoth, Tongue of Ra**

*Halls of Records • Balance of Ma'at • Architect of Truth*

*"To know how to understand is to know how to live."*

---

**From the House of OSIRIS — TheOsirisLabs.com**
