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
- Strict TypeScript, ES modules, minimal comments unless logic is non-obvious.
- Do not commit `config.json`, `.env`, logs, archives, or personal data.

## Verification pipeline

Every push to `main` (direct or via PR) runs the same three checks both locally (pre-push hook) and in CI:

```powershell
npm run verify     # typecheck + format:check + build
```

Individual steps:

| Script              | What it does                                                            |
|---------------------|-------------------------------------------------------------------------|
| `npm run typecheck` | `tsc --noEmit` — fails on any TypeScript error                          |
| `npm run format:check` | `prettier --check` against `.prettierrc.json` — fails on style drift |
| `npm run format`    | `prettier --write` — fix style drift in place                           |
| `npm run build`     | `tsc` — emit `dist/` and fail on type errors                            |

`npm install` runs the `prepare` script which points git at `.githooks/` so the **pre-push hook** is installed automatically. The hook runs `npm run verify` before every push to GitHub. A failing verify aborts the push; fix locally, recommit, push again.

Bypass the hook only in genuine emergencies with `git push --no-verify` — CI will still block the merge if verify is broken.

## Pull requests

1. Create a branch from `main` with a descriptive name (e.g. `fix/parser-zip-encoding`).
2. Run `npm run verify` locally — must pass before push.
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
