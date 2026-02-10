from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse

from tehuti_cli.providers.llm import TehutiLLM
from tehuti_cli.storage.config import load_config, save_config
from tehuti_cli.storage.session import create_session, load_last_session


def create_app() -> FastAPI:
    app = FastAPI(title="Project Tehuti Web")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/")
    def index() -> HTMLResponse:
        html = """
        <html>
        <head>
          <title>Project Tehuti</title>
          <style>
            body { background:#0b0b0d; color:#d4af37; font-family: ui-monospace, monospace; }
            .wrap { max-width: 900px; margin: 30px auto; padding: 20px; }
            textarea { width:100%; height:120px; background:#121214; color:#f4e7c5; border:1px solid #d4af37; }
            button { background:#d4af37; color:#0b0b0d; padding:8px 16px; border:none; cursor:pointer; }
            select { background:#121214; color:#f4e7c5; border:1px solid #d4af37; }
            pre { background:#121214; padding:12px; white-space:pre-wrap; }
          </style>
        </head>
        <body>
          <div class="wrap">
            <h1>Project Tehuti</h1>
            <div>
              <label>Provider</label>
              <select id="provider">
                <option value="openrouter">openrouter</option>
                <option value="openai">openai</option>
                <option value="gemini">gemini</option>
              </select>
              <label>Model</label>
              <select id="model"></select>
              <button id="refresh">Refresh Models</button>
            </div>
            <p></p>
            <textarea id="prompt" placeholder="Decree..."></textarea>
            <p><button id="send">Send</button></p>
            <pre id="out"></pre>
          </div>
          <script>
            async function loadConfig() {
              const res = await fetch('/api/config');
              const cfg = await res.json();
              document.getElementById('provider').value = cfg.provider;
            }
            async function loadModels() {
              const provider = document.getElementById('provider').value;
              const res = await fetch('/api/models?provider=' + provider);
              const data = await res.json();
              const modelSel = document.getElementById('model');
              modelSel.innerHTML = '';
              for (const m of data.data) {
                const id = m.id || m.name || m.model || '';
                if (!id) continue;
                const opt = document.createElement('option');
                opt.value = id;
                opt.textContent = id;
                modelSel.appendChild(opt);
              }
            }
            async function sendPrompt() {
              const prompt = document.getElementById('prompt').value;
              const provider = document.getElementById('provider').value;
              const model = document.getElementById('model').value;
              await fetch('/api/config', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({provider, model})});
              const res = await fetch('/api/prompt', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({prompt})});
              const data = await res.json();
              document.getElementById('out').textContent = data.response || '';
            }
            document.getElementById('send').addEventListener('click', sendPrompt);
            document.getElementById('refresh').addEventListener('click', loadModels);
            loadConfig().then(loadModels);
          </script>
        </body>
        </html>
        """
        return HTMLResponse(html)

    @app.get("/api/models")
    def models(refresh: bool = False, provider: str | None = None) -> dict[str, Any]:
        cfg = load_config()
        if provider:
            cfg.provider.type = provider
        llm = TehutiLLM(cfg)
        return {"data": llm.list_models(refresh=refresh)}

    @app.get("/api/providers")
    def providers(refresh: bool = False) -> dict[str, Any]:
        cfg = load_config()
        llm = TehutiLLM(cfg)
        return {"data": llm.list_providers(refresh=refresh)}

    @app.post("/api/prompt")
    def prompt(payload: dict[str, Any]) -> dict[str, Any]:
        text = str(payload.get("prompt", ""))
        work_dir = Path(payload.get("work_dir") or Path.cwd())
        session = load_last_session(work_dir) or create_session(work_dir)
        cfg = load_config()
        llm = TehutiLLM(cfg)
        response = llm.chat_messages([{"role": "user", "content": text}])
        session.append_context("user", text)
        session.append_context("assistant", response)
        return {"response": response, "session_id": session.id}

    @app.get("/api/config")
    def get_config() -> dict[str, Any]:
        cfg = load_config()
        return {
            "provider": cfg.provider.type,
            "model": cfg.provider.model,
            "openrouter_provider_order": cfg.openrouter.provider_order,
        }

    @app.post("/api/config")
    def set_config(payload: dict[str, Any]) -> dict[str, Any]:
        cfg = load_config()
        provider = payload.get("provider")
        model = payload.get("model")
        if provider:
            cfg.provider.type = str(provider)
        if model:
            cfg.provider.model = str(model)
        save_config(cfg)
        return {"ok": True}

    return app
