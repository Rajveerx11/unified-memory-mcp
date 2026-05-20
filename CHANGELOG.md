# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `AGENTS.md` — zero-touch MCP setup contract for Claude Desktop, Claude Code, Cursor, Codex, Antigravity, Hermes, PI Agent, and generic MCP clients.
- `CLAUDE.md` — architecture and command reference for Claude Code agents.
- Verification pipeline: `npm run verify` runs typecheck (`tsc --noEmit`), `prettier --check`, and `npm run build`. Pre-push git hook in `.githooks/pre-push` blocks pushes when verify fails; same checks run in CI on push and pull request.
- Prettier 3 configured via `.prettierrc.json` and `.prettierignore`. New scripts: `typecheck`, `format`, `format:check`, `verify`. `prepare` script auto-wires `core.hooksPath` on `npm install`.

### Changed

- HTTP bridge now tolerates `EADDRINUSE` on the configured port (logs and continues with the bridge disabled) instead of crashing the whole process.
- Logger `rotate()` is now re-entrant — concurrent rotation attempts under log floods are dropped instead of writing to an ended stream.
- Chokidar watcher event handlers are wrapped to catch rejected promises and log the offending file path.
- Process-level `unhandledRejection` and `uncaughtException` handlers log via the file logger so unknown async failures no longer exit the server silently.
- CI workflow renamed to `verify` and now runs typecheck and `prettier --check` in addition to the existing build step.
- Entire `src/` and `scripts/` codebase reformatted with Prettier to establish the new style baseline.

## [1.0.0] - 2026-05-20

### Added

- MCP stdio server with nine unified-memory tools
- Ingestion from Claude.ai memory exports, Claude Code session logs, and Obsidian vaults
- LLM synthesis via local Ollama, Ollama Cloud, and Anthropic (with provider fallback)
- HTTP bridge for local dashboard consumption
- Windows PowerShell scripts for run, stop, and logon startup
- Open-source documentation, MIT license, and CI workflow

[1.0.0]: https://github.com/Rajveerx11/unified-memory-mcp/releases/tag/v1.0.0
