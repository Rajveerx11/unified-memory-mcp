# AGENTS.md

Setup contract for coding agents (Cursor, Antigravity, Hermes, PI Agent, Claude Code, Claude Desktop, Codex, generic MCP clients). Goal: zero human steps. Each command is idempotent — re-run on failure.

Server identity:
- MCP server name: `unified-memory` (registered in `src/server.ts`).
- Transport: **stdio** (primary) + read-only HTTP bridge on `localhost:3001`.
- Config env var: `UNIFIED_MEMORY_CONFIG` (overrides default `<repo>/config.json`).
- Entry point after build: `<REPO>/dist/index.js`.

Substitute placeholders before running:
- `<REPO>` — absolute path to the local clone (Windows: forward slashes are accepted in JSON, e.g. `C:/unified-memory-mcp`).
- `<HOME>` — user home directory (`$env:USERPROFILE` on Windows, `$HOME` on POSIX).

---

## 1. Preflight (run once per machine)

```powershell
# Windows / PowerShell
node -v   # must report v20.x or higher; if missing, install Node.js 20+ before continuing
git --version
```

If Node.js < 20 or missing: **stop and surface the failure**. Do not auto-install Node — that requires admin rights and is out of scope for this MCP setup.

Optional (only if local synthesis is desired):
```powershell
where.exe ollama 2>$null
# if missing, agent may install: winget install Ollama.Ollama
ollama pull gemma4:e4b
```

---

## 2. Clone, build, configure

```powershell
git clone https://github.com/Rajveerx11/unified-memory-mcp.git <REPO>
cd <REPO>
npm install
npm run build                              # produces dist/index.js
Copy-Item config.example.json config.json -ErrorAction SilentlyContinue
```

Then edit `<REPO>/config.json`. Required keys (all paths support `~`):

| Key | Default | Required |
|-----|---------|----------|
| `memoryExportPath` | `~/UnifiedMemory/memory-exports` | yes (dir auto-created) |
| `claudeCodeLogsPath` | `~/.claude/projects` | yes (must exist or scan returns 0) |
| `obsidianVaultPath` | `~/Documents/ObsidianVault` | optional — set to existing vault or accept skip |
| `archivePath` | `~/UnifiedMemory/archive` | yes (dir auto-created) |
| `llm.provider` | `ollama` | one of `ollama`, `ollama-cloud`, `anthropic` |
| `httpBridgeEnabled` | `true` | set `false` if port 3001 conflicts |
| `httpBridgePort` | `3001` | change on conflict |

Provider fallback order at runtime: configured → other two → `noop` (no synthesis, raw data only). Missing API keys do not crash startup.

POSIX equivalent for clone/build:
```bash
git clone https://github.com/Rajveerx11/unified-memory-mcp.git <REPO>
cd <REPO> && npm ci && npm run build
cp -n config.example.json config.json
```

---

## 3. API keys (optional)

Only required if `llm.provider` is `anthropic` or `ollama-cloud`. Config references env vars via the `env:VAR_NAME` convention — keys never live in `config.json` itself.

```powershell
# Persist for user (no admin needed). New shells pick this up; restart the agent process after setting.
[Environment]::SetEnvironmentVariable("ANTHROPIC_API_KEY", "<key>", "User")
[Environment]::SetEnvironmentVariable("OLLAMA_API_KEY",   "<key>", "User")
```

POSIX:
```bash
echo 'export ANTHROPIC_API_KEY=<key>' >> ~/.bashrc
echo 'export OLLAMA_API_KEY=<key>'   >> ~/.bashrc
```

---

## 4. Smoke test before registering

```powershell
cd <REPO>
node dist/index.js
# wait ~3 s, then in another shell:
Invoke-WebRequest http://localhost:3001/api/status -UseBasicParsing | Select-Object -Expand Content
# 200 → ready; 202 with {"status":"initializing"} → still scanning, retry in 5–30 s; connection refused → server crashed, read <archivePath>/../logs/server.log
# stop with Ctrl+C
```

If the smoke test fails, **do not** proceed to client registration — the client will silently fail too.

---

## 5. Per-client registration

All clients launch the server the same way: `node <REPO>/dist/index.js` over stdio. Only the config-file location and shape differ.

### 5.1 Claude Desktop

File: `%APPDATA%\Claude\claude_desktop_config.json` (Windows), `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS).

```json
{
  "mcpServers": {
    "unified-memory": {
      "command": "node",
      "args": ["<REPO>/dist/index.js"],
      "env": {
        "UNIFIED_MEMORY_CONFIG": "<REPO>/config.json"
      }
    }
  }
}
```

Merge into existing `mcpServers` object — never overwrite the whole file. Restart Claude Desktop after the edit.

### 5.2 Claude Code (CLI)

User-scope registration (preferred, no project pollution):
```bash
claude mcp add unified-memory --scope user -- node <REPO>/dist/index.js
claude mcp list   # verify "unified-memory" appears
```

Or project-scope via `<REPO>/.mcp.json`:
```json
{
  "mcpServers": {
    "unified-memory": {
      "command": "node",
      "args": ["<REPO>/dist/index.js"]
    }
  }
}
```

### 5.3 Cursor

File: `~/.cursor/mcp.json` (global) or `<project>/.cursor/mcp.json` (project-local). Same shape as Claude Desktop:

```json
{
  "mcpServers": {
    "unified-memory": {
      "command": "node",
      "args": ["<REPO>/dist/index.js"],
      "env": { "UNIFIED_MEMORY_CONFIG": "<REPO>/config.json" }
    }
  }
}
```

Reload Cursor: `Cmd/Ctrl+Shift+P` → `MCP: Reload Servers`.

### 5.4 Codex CLI (OpenAI)

File: `~/.codex/config.toml`. TOML, not JSON:

```toml
[mcp_servers.unified-memory]
command = "node"
args = ["<REPO>/dist/index.js"]
env = { UNIFIED_MEMORY_CONFIG = "<REPO>/config.json" }
```

### 5.5 Google Antigravity

File: `~/.antigravity/mcp.json` (or workspace-level `<project>/.antigravity/mcp.json`). Same JSON shape as Cursor. Reload via the agent palette after edit.

### 5.6 Hermes Agent

Use Hermes' agent-config file (typically `~/.hermes/agents.yaml` or the equivalent JSON loader exposed by the build). Add an MCP server entry:

```yaml
mcp_servers:
  unified-memory:
    command: node
    args:
      - <REPO>/dist/index.js
    env:
      UNIFIED_MEMORY_CONFIG: <REPO>/config.json
```

If Hermes only accepts JSON, translate the above 1:1.

### 5.7 PI Agent

PI Agent reads MCP servers from `~/.pi/config.json` (`mcpServers` field, same shape as Claude Desktop). Restart the PI runtime after the edit.

### 5.8 Generic MCP client

If the client documents an "MCP server" section that takes a command and args, use:
- `command`: `node`
- `args`: `["<REPO>/dist/index.js"]`
- `env.UNIFIED_MEMORY_CONFIG`: `<REPO>/config.json` (only if the config is not at the default path)
- `transport`: `stdio`

Tool names exposed: `get_projects`, `get_thinking_patterns`, `get_todos`, `get_insights`, `get_weekly_summary`, `search_brain`, `get_dashboard_data`, `get_brain_status`, `switch_provider`.

---

## 6. Optional: run-on-logon (Windows)

For agents that expect the server to be already running (e.g. a dashboard that hits `localhost:3001` without launching MCP stdio):

```powershell
cd <REPO>
.\scripts\install-startup.ps1     # creates a hidden Scheduled Task at logon
.\scripts\uninstall-startup.ps1   # remove
.\scripts\stop.ps1                # kill the running task
```

Do **not** install this if any MCP client is already configured to spawn the server itself — two parallel instances will fight over `brain-state.json` and the HTTP port.

---

## 7. Verification checklist (agent must run all)

1. `node -v` reports >= 20.
2. `<REPO>/dist/index.js` exists (rerun `npm run build` if absent).
3. `<REPO>/config.json` exists and parses (`node -e "JSON.parse(require('fs').readFileSync('config.json'))"`).
4. Smoke test (§4) returns 200 within 30 seconds.
5. Client config file lists `unified-memory` under `mcpServers` (or the client-specific equivalent) and points at `<REPO>/dist/index.js`.
6. After client restart, the client lists the nine tools above.

If step 6 fails, read `<archivePath>/../logs/server.log` (default `<HOME>/UnifiedMemory/logs/server.log`). The most common causes: stale `dist/` from before a code change (rebuild), `config.json` schema mismatch (re-copy from `config.example.json`), and port 3001 already in use.

### 7.1 Expected log signals (non-fatal)

These messages indicate degraded state, not failure — MCP stdio continues to work for the client:

- `port 3001 already in use — HTTP bridge disabled for this run` — another process owns the port. Dashboard endpoints are unreachable; MCP tools are still fine. To restore the bridge, free the port or change `httpBridgePort` and restart.
- `no LLM provider available — synthesis disabled, raw data still served` — Ollama not running and no cloud keys set. Tools return raw parsed data without synthesis. Start Ollama or set an API key, then call `switch_provider`.
- `unhandledRejection` / `uncaughtException` lines — server logged an internal error but **did not exit**. Treat as a bug report: capture the stack from `server.log` and attach to an issue.

Hard failures (process exits): missing `dist/index.js`, missing `config.json`, schema-invalid `config.json`. These print to stderr before exit code 1.

---

## 8. Safety rules for agents

- **Never** commit `config.json`, `.env`, anything under `archivePath`, or anything under `logsPath` — `.gitignore` covers these; do not bypass.
- **Never** log resolved API keys. The config exposes them as `resolvedApiKey` after `env:` lookup; treat as secret.
- **Never** install the Scheduled Task and an MCP-client-spawned server simultaneously.
- **Do not** edit `config.json` in place to insert keys — use environment variables and the `env:VAR_NAME` reference instead.
- Provider switches via the `switch_provider` MCP tool are **in-memory only** and revert on restart. To persist, edit `llm.provider` in `config.json`.
