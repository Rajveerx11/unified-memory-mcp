# Contributing to Unified Memory MCP

Thank you for your interest in contributing. This project welcomes bug reports, documentation improvements, and pull requests.

## Getting started

1. Fork the repository and clone your fork.
2. Install dependencies and build:
   ```powershell
   npm install
   npm run build
   ```
3. Copy the example configuration and adjust paths:
   ```powershell
   Copy-Item config.example.json config.json
   ```
4. Run the server locally:
   ```powershell
   .\scripts\start.ps1
   ```

## Development workflow

- Use **Node.js 20+** and the existing TypeScript setup (`npm run build`, `npm run dev` for watch mode).
- Keep changes focused; prefer small, reviewable PRs.
- Match existing code style (strict TypeScript, ES modules, minimal comments unless logic is non-obvious).
- Do not commit `config.json`, `.env`, logs, archives, or personal data.

## Pull requests

1. Create a branch from `main` with a descriptive name (e.g. `fix/parser-zip-encoding`).
2. Ensure `npm run build` passes.
3. Update documentation if you change configuration, tools, or behavior.
4. Describe **what** changed and **why** in the PR body.
5. Link related issues when applicable.

## Reporting bugs

Use [GitHub Issues](https://github.com/Rajveerx11/unified-memory-mcp/issues) and include:

- OS version (this project targets Windows 11)
- Node.js version (`node -v`)
- Steps to reproduce
- Expected vs actual behavior
- Relevant log excerpts from your configured logs directory (redact personal content)

## Feature requests

Open an issue first for larger features so we can align on scope before you invest significant time.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating, you agree to uphold it.
