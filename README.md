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

The synthesis layer supports two backends. Configure in `config.json` under `llm`:

```json
"llm": {
  "provider": "ollama",
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "model": "gemma4:27b",
    "contextWindow": 131072,
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

### Ollama setup (local, free, private)

1. Install Ollama: <https://ollama.com>
2. Pull a model: `ollama pull gemma4:27b`
3. Make sure Ollama is running (`ollama serve` or its tray app).
4. Set `llm.provider: "ollama"` in `config.json`.

### Recommended Ollama models

| Model | VRAM (rough) | Quality for this task | Speed |
|-------|--------------|-----------------------|-------|
| `gemma4:31b` | ~20 GB | Best open-source option, strong structured output | Slow |
| `gemma4:26b` | ~16 GB | MoE variant, efficient, good reasoning | Medium |
| `qwen2.5:14b` | ~10 GB | Strong instruction-following, good JSON output | Fast |
| `gemma4:e4b` | ~4 GB | Lightweight, decent for simple summaries | Very fast |
| `llama3.1:8b` | ~6 GB | Decent baseline, weaker at complex JSON | Fast |

VRAM estimates assume Q4 quantization; actual usage depends on your model tag.

If the configured Ollama model isn't pulled yet, the server logs:
```
Model 'gemma4:27b' not found in Ollama. Run: ollama pull gemma4:27b
```
and falls back to the Anthropic provider.

### Anthropic setup (cloud, paid)

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

## Logs and state

- Logs: `C:/Users/rajve/SecondBrain/logs/server.log` (rotated, 5 × 5MB)
- State: `C:/Users/rajve/SecondBrain/archive/brain-state.json` (with `.backup.json` companion)
- Per-source archives: `C:/Users/rajve/SecondBrain/archive/{claudecode,obsidian,memory,synthesis}/`
