# Getting Started

This is the fastest reliable path from zero to a working Tehuti session.

## 1. Create and activate a virtual environment

```bash
cd /root/project-tehuti
python3 -m venv .venv
source .venv/bin/activate
```

## 2. Install Tehuti

```bash
pip install -e .
```

## 3. Configure your API key

Create `~/.tehuti/keys.env` (or `$TEHUTI_HOME/keys.env`):

```bash
OPENROUTER_API_KEY=your_api_key_here
```

## 4. Verify installation

```bash
tehuti --help
tehuti doctor
```

## 5. Run Tehuti

Interactive:

```bash
tehuti
```

Single prompt mode:

```bash
tehuti --print --prompt "inspect this repository and summarize risks"
```

## 6. First commands to learn

Inside Tehuti:

```text
/status
/status-all
/tools
/smoke
```

## 7. If your environment is unusual

If `~/.tehuti` is not writable, set:

```bash
export TEHUTI_HOME=/path/to/writable/.tehuti
```

Then rerun setup.
