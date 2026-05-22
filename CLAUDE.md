# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm install` — install deps (Node.js 20+ required; CI uses Node 22 on Windows). Runs `prepare`, which sets `git config core.hooksPath .githooks` so the pre-push hook is active.
- `npm run verify` — **required before push**: `typecheck` → `format:check` → `build`. Same pipeline runs in CI and in `.githooks/pre-push`.
- `npm run typecheck` — `tsc --noEmit`.
- `npm run format` / `npm run format:check` — Prettier 3 against `src/**/*.ts`, `scripts/**/*.ts`, and root `*.json` (see `.prettierrc.json`; markdown is excluded).
- `npm run build` — TypeScript compile to `dist/` via `tsc` (ES modules, strict).
- `npm run dev` — `tsc --watch`.
- `npm start` — `node dist/index.js`. Requires `config.json` next to repo root or `UNIFIED_MEMORY_CONFIG` env var pointing at one.
- `.\scripts\start.ps1` — foreground run (asserts `dist/index.js` exists).
- `.\scripts\setup-config.ps1` (or `npm run setup`) — bootstrap `config.json` from `config.example.json`.
- `.\scripts\install-startup.ps1` / `uninstall-startup.ps1` — Scheduled Task install for hidden logon start; `stop.ps1` kills running instances. Do not combine with MCP-client-spawned servers (port/state conflict).
- Ad-hoc parser/synthesis scripts: `scripts/test-parsers.ts` and `scripts/run-thinking.ts` (not wired into `package.json`; run via `npx tsx` or similar). They reuse `src/` and require a valid `config.json`.

There is no Jest/Vitest suite. Validation is `npm run verify` plus optional manual runs of the parser scripts against real local data. End-user / agent setup steps live in **`AGENTS.md`** (smoke test, per-client MCP registration, verification checklist).

## Architecture

Long-running Node process exposing a personal-knowledge MCP server. Two transports run in the same process:

1. **MCP stdio server** (`src/server.ts`) — registers nine tools (`get_projects`, `get_thinking_patterns`, `get_todos`, `get_insights`, `get_weekly_summary`, `search_brain`, `get_dashboard_data`, `get_brain_status`, `switch_provider`). Consumers: Claude Desktop, Claude Code, Cursor.
2. **HTTP bridge** (`src/http-bridge.ts`) — read-only JSON API on `localhost:3001` (or `httpBridgePort`) for local dashboards. CORS pinned to `http://localhost:3000`. Returns `202 { status: "initializing" }` until the first scan finishes. Disable with `httpBridgeEnabled: false`. On `EADDRINUSE`, logs and continues with the bridge off for that run.

### Data flow

```
sources → parsers → dataStore (brain-state.json) → thinking layer (LLM) → synthesis → tools/HTTP
                          ▲                                                       │
                          └──────── chokidar Watcher (debounced) ◄────────────────┘
```

- **Parsers** (`src/parsers/*`) read three sources independently:
  - `claudecode-parser` — `.jsonl` session logs under `claudeCodeLogsPath` (typically `~/.claude/projects`). Archives summaries before 30-day cleanup.
  - `obsidian-parser` — `**/*.md` under `obsidianVaultPath`, ignoring `.obsidian/`. Extracts frontmatter, wikilinks, todos.
  - `memory-parser` — `.json`/`.zip` Claude.ai memory exports under `memoryExportPath`.
- **`dataStore`** (`src/store/data-store.ts`) is an in-memory singleton persisted atomically to `brain-state.json` (tmp + rename, with `.backup.json`). All tool handlers read from this singleton — they never re-parse on demand.
- **`Watcher`** (`src/watcher.ts`) wraps `chokidar` for the three source roots, debounces synthesis runs by **5 minutes**, and serializes them via `synthRunning`.
- **Thinking layer** (`src/thinking.ts`) aggregates state into tiered buckets (memory → recent CC/Obsidian → mid → old) capped at **300 KB** of JSON before being sent to the active LLM. `truncated: true` is set when items are dropped. Synthesis result replaces `state.synthesis` and is archived.

### LLM provider abstraction

- `src/llm/provider.ts` defines `LLMProvider` (`kind`, `model`, `isAvailable()`, plus synthesis methods). Implementations: `ollama-provider`, `ollama-cloud-provider`, `anthropic-provider`, and `NoopProvider` (returns raw data only).
- `llmRegistry` (`src/llm/index.ts`) is the source of truth for the active provider. On `init()` it tries the configured `provider`, then the remaining two in fixed order, then `noop`. `switchTo(kind, modelOverride?)` performs an availability check before swapping; switches are **in-memory only** (not written back to `config.json`).
- API keys come from `config.json` as `env:VAR_NAME` and are resolved at load time into `resolvedApiKey` fields. Never log the resolved keys.

### Config and runtime

- `src/config.ts` parses `config.json` with a Zod v4 schema, normalizes `~` to the user homedir, ensures dirs exist, and derives `logsPath` as `dirname(archivePath)/logs`. `archivePath`'s parent (`dataRoot`) is the implicit root for logs and per-source archive subdirs (`claudecode/`, `obsidian/`, `memory/`, `synthesis/`).
- `runtime.setConfig(config)` exposes the loaded config to modules that can't receive it through their call chain (e.g. tool handlers reached via the HTTP bridge).
- Config file path resolution: `UNIFIED_MEMORY_CONFIG` env var → `<repo>/config.json`. `config.json` is gitignored; commit changes via `config.example.json` only.

### Crash resilience

The server is designed to keep running through localized failures:

- `src/index.ts` installs `process.on("unhandledRejection")` and `process.on("uncaughtException")` handlers that **log via the file logger and return** instead of crashing. New code should still prefer explicit try/catch; these are a safety net, not a license to swallow errors.
- `src/http-bridge.ts` attaches `server.on("error", ...)` and a `clientError` handler. `EADDRINUSE` on the configured port is logged and the bridge is left disabled for the rest of the run — the MCP stdio server keeps serving tools.
- `src/logger.ts` guards `rotate()` with a `rotating` flag and skips writes while rotation is in flight, preventing concurrent rotations from writing to an ended stream under log floods.
- `src/watcher.ts` wraps every chokidar event handler in a `safe(label, fn)` helper that catches the resulting promise rejection and logs it with the offending file path. A single bad file no longer leaks an unhandled rejection.

When debugging a stuck server, grep `<logsPath>/server.log` for `unhandledRejection`, `uncaughtException`, `EADDRINUSE`, or `watcher` error lines — these mark degraded-but-running states rather than a clean exit.

### Adding a new MCP tool

1. Create `src/tools/<name>.ts` exporting `{ name, description, inputSchema, handler }`. `inputSchema` is a Zod object; `handler(args)` returns `{ content: [{ type: "text", text: JSON.stringify(...) }] }`.
2. Register it in the `tools` array in `src/server.ts`.
3. If it should be reachable from the dashboard, wire an HTTP route in `src/http-bridge.ts` via `callTool(handler, args)`.

## Conventions

- ES modules everywhere — internal imports use the `.js` extension on `.ts` files (TypeScript NodeNext resolution).
- Strict TypeScript. Minimal comments unless logic is non-obvious (matches `CONTRIBUTING.md`).
- Logger is a single singleton (`src/logger.ts`) writing rotated files to `logsPath`. Use `logger.info/warn/error(component, msg)`, not `console.log`, in long-running code paths.
- Windows is the primary target: paths use `path.join`, `~` expansion is handled in `expandHome`, and helper scripts are PowerShell. Don't introduce POSIX-only assumptions.
- Never commit `config.json`, `.env`, `dist/`, logs, archives, or memory exports — `.gitignore` covers them.
