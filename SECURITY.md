# Security Policy

## Supported versions

Security fixes are applied to the latest release on the `main` branch.

| Version | Supported |
| ------- | --------- |
| latest  | yes       |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Instead, report them privately:

1. Open a [GitHub Security Advisory](https://github.com/Rajveerx11/unified-memory-mcp/security/advisories/new) on this repository, or
2. Email the maintainer via the contact address on their GitHub profile.

Include:

- A description of the issue and potential impact
- Steps to reproduce
- Affected versions or commits, if known
- Suggested fix or mitigation, if you have one

We aim to acknowledge reports within **5 business days** and will work with you on a fix and coordinated disclosure when appropriate.

## Scope notes

Unified Memory MCP is designed to run **locally** on your machine. It reads files from paths you configure (memory exports, Claude Code logs, Obsidian vault) and may send synthesized content to LLM providers you enable (Ollama local/cloud, Anthropic). Treat `config.json`, API keys, and archive data as sensitive. Do not commit secrets or personal data to the repository.
