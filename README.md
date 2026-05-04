# Second Brain MCP Server

A locally hosted Model Context Protocol (MCP) server for Windows 11 that ingests three sources, synthesizes them with an LLM (local Ollama or Anthropic API), and exposes second-brain tools to any MCP client (Claude Desktop, Claude Code, etc.) over stdio.

## Sources

1. **Claude.ai memory exports** — JSON or ZIP files dropped into `C:/Users/rajve/SecondBrain/memory-exports`
2. **Claude Code session logs** — `.jsonl` files under `C:/Users/rajve/.claude/projects` (auto-deleted at 30 days, so the server archives parsed summaries)
3. **Obsidian vault** — `C:/Users/rajve/ObsidianVault` (set this to your real vault path in `config.json`)

## Tools

All return JSON in MCP `text` content.

- `get_projects(filter?)`
- `get_thinking_patterns()`
- `get_todos({status?, source?})`
- `get_insights()`
- `get_weekly_summary({weeks_back?})`
- `search_brain({query, source?})`
- `get_dashboard_data()`
- `get_brain_status()` — provider, sources, last thinking run, stats
- `switch_provider({provider, model?})` — runtime LLM switch (does not persist to config.json)

## LLM Providers

The synthesis layer supports three backends:

- **`ollama`** — local, free, private (default). Talks to a running Ollama daemon at `http://localhost:11434/v1/chat/completions` (OpenAI-compatible).
- **`ollama-cloud`** — Ollama's hosted API at `https://ollama.com/v1/chat/completions`. Same OpenAI-compatible shape; bigger models, no local GPU needed. Requires an API key.
- **`anthropic`** — Claude API. Requires `ANTHROPIC_API_KEY`.

If the configured provider is unavailable on startup the server **falls back** through the others in order, then to a noop (raw data only, no synthesis). `switch_provider` swaps the active backend at runtime.

```json
"llm": {
  "provider": "ollama",
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "model": "gemma4:e4b",
    "contextWindow": 131072,
    "temperature": 0.3,
    "timeout": 120000
  },
  "ollamaCloud": {
    "baseUrl": "https://ollama.com",
    "apiKey": "env:OLLAMA_API_KEY",
    "model": "gpt-oss:120b",
    "temperature": 0.3,
    "timeout": 120000
  },
  "anthropic": {
    "apiKey": "env:ANTHROPIC_API_KEY",
    "model": "claude-sonnet-4-6",
    "maxTokens": 8000,
    "temperature": 0.3
  }
}
```

### Provider behavior

- `provider` selects the active backend (`"ollama"` or `"anthropic"`).
- On startup, if the configured provider is unavailable, the server **automatically falls back** to the other provider.
- If neither is available, the server still runs — tools just return raw parsed data with no AI synthesis.
- `switch_provider` swaps the active backend at runtime (in memory only — restart reverts to config default).

### Ollama setup (default — local, free, private)

1. Install Ollama: <https://ollama.com>
2. Pull the configured model: `ollama pull gemma4:e4b`
3. Make sure Ollama is running (`ollama serve` or its tray app).
4. `llm.provider: "ollama"` is the default — no further config needed.

### Recommended Ollama models

| Model | Disk (Q4) | Quality for this task | Speed |
|-------|-----------|-----------------------|-------|
| `gemma4:e4b` (4.5B effective) | ~9.6 GB | Default. Strong JSON output, edge-friendly | Fast |
| `gemma4:latest` (8B) | ~9.6 GB | Strong structured output | Fast |
| `qwen2.5:14b` | ~10 GB | Strongest instruction-following at this size | Medium |
| `qwen2.5:7b` | ~5 GB | Fast, decent JSON | Fast |
| `llama3.1:8b` | ~5 GB | Lightweight baseline, weaker at complex JSON | Fast |

If the configured Ollama model isn't pulled yet, the server logs:
```
Model 'gemma4:e4b' not found in Ollama. Run: ollama pull gemma4:e4b
```
and falls back to the next provider in the chain.

### Ollama Cloud setup (cloud-hosted, paid)

Cloud-hosted Ollama runs the same OpenAI-compatible endpoints as a local daemon, just with a different base URL and bearer-token auth. Useful when the local machine can't host the model size you want.

1. Create an API key at <https://ollama.com/settings/keys>
2. Set the env var:
   ```powershell
   [Environment]::SetEnvironmentVariable("OLLAMA_API_KEY", "your-key-here", "User")
   ```
3. Pick a cloud-hosted model from <https://ollama.com/search?c=cloud> (e.g. `gpt-oss:120b`, `qwen3-coder:480b-cloud`, `deepseek-v3.1:671b-cloud`) and set it under `llm.ollamaCloud.model`.
4. Set `llm.provider: "ollama-cloud"` (or leave on `"ollama"` and use `switch_provider` at runtime).

The cloud provider hits `https://ollama.com/v1/chat/completions` with `Authorization: Bearer $OLLAMA_API_KEY`. No additional dependencies — same `fetch` path the local provider uses.

### Anthropic setup (optional fallback — cloud, paid)

```powershell
[Environment]::SetEnvironmentVariable("ANTHROPIC_API_KEY", "sk-ant-...", "User")
```

The synthesis layer uses `claude-sonnet-4-6` by default. Change `llm.anthropic.model` in `config.json` to override.

## Build and run

```powershell
cd C:\secondbrainmcp
npm install
npm run build
.\scripts\start.ps1
```

## Run on logon (hidden, no console window)

```powershell
.\scripts\install-startup.ps1
```

To stop:

```powershell
.\scripts\stop.ps1
```

To uninstall:

```powershell
.\scripts\uninstall-startup.ps1
```

## Hook up to Claude Desktop

Add to `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "secondbrain": {
      "command": "node",
      "args": ["C:/secondbrainmcp/dist/index.js"]
    }
  }
}
```

Restart Claude Desktop. The nine tools should appear under the secondbrain server.

## HTTP bridge (for browser dashboards)

Alongside the MCP stdio interface, the server exposes a small read-only JSON API on `http://localhost:3001` so a browser-based dashboard can fetch the same data the MCP tools return:

```
GET  /api/dashboard            projects + todos + insights + weekly summary
GET  /api/projects             get_projects output
GET  /api/todos                get_todos output
GET  /api/insights             get_insights output
GET  /api/patterns             get_thinking_patterns output
GET  /api/summary              get_weekly_summary output
GET  /api/search?q=...         search_brain output
GET  /api/status               get_brain_status output
GET  /api/providers            list providers + active + per-kind model + keyPresent flags
POST /api/provider/switch      body { provider, model? } — switches active LLM
```

The `providers` + `provider/switch` endpoints back a dashboard dropdown that lets the user pick local Ollama, Ollama Cloud, or Anthropic at runtime. `GET /api/providers` returns enough for the dashboard to render the menu (label, configured model, whether the required API key is present); `POST /api/provider/switch` swaps the active backend and returns 200 on success or 409 with a reason (e.g. missing API key, model not pulled). Provider routes are not gated by the `initializing` 202 response, so the dashboard can switch backends before the first scan finishes.

CORS is open to `http://localhost:3000`. While the data store is empty (first scan still running) endpoints return `202` with `{ status: "initializing" }`. Disable with `"httpBridgeEnabled": false` or change the port via `"httpBridgePort"` in `config.json`.

## Logs and state

- Logs: `C:/Users/rajve/SecondBrain/logs/server.log` (rotated, 5 × 5MB)
- State: `C:/Users/rajve/SecondBrain/archive/brain-state.json` (with `.backup.json` companion)
- Per-source archives: `C:/Users/rajve/SecondBrain/archive/{claudecode,obsidian,memory,synthesis}/`
