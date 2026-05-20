# Unified Memory MCP

[![CI](https://github.com/Rajveerx11/unified-memory-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Rajveerx11/unified-memory-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)

A **local** [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for Windows that **unifies** Claude memory exports, Claude Code session logs, and Obsidian notes into one store, optionally synthesizes them with an LLM, and exposes query tools to any MCP client (Claude Desktop, Claude Code, Cursor, etc.) over stdio.

All data stays on your machine unless you enable a cloud LLM provider.

## Features

- **Three ingest sources** — Claude.ai memory exports, Claude Code session logs, and an Obsidian vault
- **File watchers** — incremental updates when sources change
- **LLM synthesis** — local Ollama (default), Ollama Cloud, or Anthropic Claude API, with automatic fallback
- **Nine MCP tools** — projects, todos, insights, patterns, search, weekly summary, dashboard, status, and runtime provider switch
- **HTTP bridge** — read-only JSON API for local dashboards (`localhost`)
- **Windows-friendly** — PowerShell scripts for foreground run and logon startup via Scheduled Task

## Requirements

- **Windows 10/11** (primary target; paths use `~` home expansion)
- **Node.js 20+**
- At least one configured data source (others are optional)
- For AI synthesis: [Ollama](https://ollama.com) (recommended, local) and/or API keys for cloud providers

## Quick start

```powershell
git clone https://github.com/Rajveerx11/unified-memory-mcp.git
cd unified-memory-mcp
npm install
.\scripts\setup-config.ps1   # creates config.json from template
# Edit config.json — set memoryExportPath, claudeCodeLogsPath, obsidianVaultPath, archivePath
npm run build
.\scripts\start.ps1
```

Or copy the config manually:

```powershell
Copy-Item config.example.json config.json
```

Point `config.json` at your real folders. Paths support `~` for your user profile (e.g. `~/UnifiedMemory/archive`).

Override the config file location:

```powershell
$env:UNIFIED_MEMORY_CONFIG = "D:\configs\my-unified-memory.json"
node dist/index.js
```

## Data sources

| Source | Typical path (customize in `config.json`) | Notes |
|--------|-------------------------------------------|--------|
| Claude.ai memory exports | `~/UnifiedMemory/memory-exports` | Drop JSON or ZIP exports here |
| Claude Code session logs | `~/.claude/projects` | `.jsonl` sessions; summaries archived before 30-day cleanup |
| Obsidian vault | `~/Documents/ObsidianVault` | Markdown notes; optional if vault not used |

The server creates archive and log directories under the parent of `archivePath` (e.g. `~/UnifiedMemory/logs`, `~/UnifiedMemory/archive/`).

## MCP tools

All tools return JSON in MCP `text` content.

| Tool | Description |
|------|-------------|
| `get_projects` | Active projects (`filter?`) |
| `get_thinking_patterns` | Recurring themes and patterns |
| `get_todos` | Todos (`status?`, `source?`) |
| `get_insights` | Synthesized insights |
| `get_weekly_summary` | Weekly rollups (`weeks_back?`) |
| `search_brain` | Full-text search (`query`, `source?`) |
| `get_dashboard_data` | Combined dashboard payload |
| `get_brain_status` | Provider, sources, last run, stats |
| `switch_provider` | Runtime LLM switch (`provider`, `model?`) — in-memory only |

## LLM providers

| Provider | Cost | Privacy | Requirement |
|----------|------|---------|-------------|
| `ollama` (default) | Free | Local | Ollama running at `http://localhost:11434` |
| `ollama-cloud` | Paid | Cloud | `OLLAMA_API_KEY` |
| `anthropic` | Paid | Cloud | `ANTHROPIC_API_KEY` |

On startup, if the configured provider is unavailable, the server **falls back** through the others, then to a noop mode (raw parsed data only). Use `switch_provider` or the HTTP API to change the active backend at runtime.

### Example `config.json` LLM section

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

API keys use the `env:VAR_NAME` convention in config, or set environment variables directly. See [.env.example](.env.example).

### Ollama (local, recommended)

1. Install [Ollama](https://ollama.com)
2. Pull your model: `ollama pull gemma4:e4b`
3. Ensure Ollama is running (`ollama serve` or the tray app)
4. Keep `"provider": "ollama"` in `config.json`

| Model | Approx. size | Notes |
|-------|--------------|--------|
| `gemma4:e4b` | ~9.6 GB | Default; strong JSON output |
| `gemma4:latest` | ~9.6 GB | 8B variant |
| `qwen2.5:14b` | ~10 GB | Strong instruction-following |
| `qwen2.5:7b` | ~5 GB | Faster, lighter |
| `llama3.1:8b` | ~5 GB | Lightweight baseline |

### Ollama Cloud

1. Create an API key at [ollama.com/settings/keys](https://ollama.com/settings/keys)
2. Set `OLLAMA_API_KEY` in your user environment
3. Set `"provider": "ollama-cloud"` or use `switch_provider`

### Anthropic

```powershell
[Environment]::SetEnvironmentVariable("ANTHROPIC_API_KEY", "sk-ant-...", "User")
```

Restart terminals after setting user environment variables.

## Claude Desktop

Add to `%APPDATA%\Claude\claude_desktop_config.json` (adjust the path to your clone):

```json
{
  "mcpServers": {
    "unified-memory": {
      "command": "node",
      "args": ["C:/path/to/unified-memory-mcp/dist/index.js"]
    }
  }
}
```

Restart Claude Desktop. Tools appear under the `unified-memory` server.

Similar MCP configuration works in **Claude Code**, **Cursor**, and other MCP-capable clients.

## HTTP bridge (local dashboards)

When `httpBridgeEnabled` is `true` (default), a read-only API listens on `http://localhost:3001` (configurable via `httpBridgePort`):

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/dashboard` | Combined dashboard data |
| GET | `/api/projects` | Projects |
| GET | `/api/todos` | Todos |
| GET | `/api/insights` | Insights |
| GET | `/api/patterns` | Thinking patterns |
| GET | `/api/summary` | Weekly summary |
| GET | `/api/search?q=...` | Search |
| GET | `/api/status` | Brain status |
| GET | `/api/providers` | Provider list and key status |
| POST | `/api/provider/switch` | Body `{ "provider", "model?" }` |

CORS allows `http://localhost:3000`. Endpoints return `202 { "status": "initializing" }` until the first scan completes. Disable with `"httpBridgeEnabled": false`.

## Run on Windows logon (optional)

Hidden background start via Scheduled Task:

```powershell
npm run build
.\scripts\install-startup.ps1
```

Stop or remove:

```powershell
.\scripts\stop.ps1
.\scripts\uninstall-startup.ps1
```

## Project layout

```
unified-memory-mcp/
├── config.example.json   # Template — copy to config.json (gitignored)
├── src/
│   ├── index.ts          # Entry point
│   ├── server.ts         # MCP stdio server
│   ├── http-bridge.ts    # Local HTTP API
│   ├── parsers/          # Source parsers
│   ├── tools/            # MCP tool handlers
│   └── llm/              # Provider implementations
└── scripts/              # PowerShell helpers
```

## Logs and state

Paths derive from `archivePath` in your config (e.g. if `archivePath` is `~/UnifiedMemory/archive`):

- **Logs:** `~/UnifiedMemory/logs/server.log` (rotated, 5 × 5 MB)
- **State:** `~/UnifiedMemory/archive/brain-state.json` (+ `.backup.json`)
- **Per-source archives:** `~/UnifiedMemory/archive/{claudecode,obsidian,memory,synthesis}/`

## Privacy and security

- The server only reads paths you configure and only calls LLM endpoints you enable.
- Do **not** commit `config.json`, `.env`, exports, or archives to git.
- Report security issues privately — see [SECURITY.md](SECURITY.md).

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE) — Copyright (c) 2026 Rajveerx11
