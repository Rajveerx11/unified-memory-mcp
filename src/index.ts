import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import { loadConfig, Config } from "./config.js";
import { logger } from "./logger.js";
import { dataStore } from "./store/data-store.js";
import { scanClaudeCodeLogs } from "./parsers/claudecode-parser.js";
import { scanObsidianVault } from "./parsers/obsidian-parser.js";
import { scanMemoryExports } from "./parsers/memory-parser.js";
import { Watcher } from "./watcher.js";
import { startMcpServer, RunningServer } from "./server.js";
import { startHttpBridge, RunningHttpBridge } from "./http-bridge.js";
import { pathExists, listDir } from "./utils/helpers.js";
import { llmRegistry } from "./llm/index.js";
import { runtime } from "./runtime.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

async function countClaudeCodeFiles(root: string): Promise<{ projects: number; sessions: number }> {
  if (!(await pathExists(root))) return { projects: 0, sessions: 0 };
  const dirs = await listDir(root);
  let projects = 0;
  let sessions = 0;
  for (const d of dirs) {
    const full = path.join(root, d);
    try {
      const stat = await fs.stat(full);
      if (!stat.isDirectory()) continue;
      projects++;
      const files = await listDir(full);
      sessions += files.filter((f) => f.endsWith(".jsonl")).length;
    } catch {
      // ignore
    }
  }
  return { projects, sessions };
}

async function countMemoryFiles(root: string): Promise<number> {
  if (!(await pathExists(root))) return 0;
  const files = await listDir(root);
  let n = 0;
  for (const f of files) {
    const lower = f.toLowerCase();
    if (lower.endsWith(".json") || lower.endsWith(".zip")) n++;
  }
  return n;
}

async function countObsidianFiles(root: string): Promise<number | null> {
  if (!(await pathExists(root))) return null;
  const { glob } = await import("glob");
  const files = await glob("**/*.md", { cwd: root, nodir: true });
  return files.length;
}

async function printStartupHealth(config: Config): Promise<void> {
  const cc = await countClaudeCodeFiles(config.claudeCodeLogsPath);
  const memCount = await countMemoryFiles(config.memoryExportPath);
  const obCount = await countObsidianFiles(config.obsidianVaultPath);
  const state = dataStore.getState();

  const line = "═".repeat(60);
  logger.info("startup", line);
  logger.info("startup", "Unified Memory MCP Server v1.0.0");
  logger.info("startup", line);
  logger.info("startup", `Claude Code logs:  ${config.claudeCodeLogsPath} (${cc.projects} project dirs, ${cc.sessions} session files)`);
  logger.info("startup", `Memory exports:    ${config.memoryExportPath} (${memCount === 0 ? "empty — waiting for first export" : `${memCount} files`})`);
  if (obCount === null) {
    logger.info("startup", `Obsidian vault:    ${config.obsidianVaultPath} (NOT FOUND — skipping, set path in config.json)`);
  } else {
    logger.info("startup", `Obsidian vault:    ${config.obsidianVaultPath} (${obCount} markdown files)`);
  }
  logger.info("startup", `Archive:           ${config.archivePath} (last updated ${state.lastUpdated})`);
  const provStatus = llmRegistry.getStatus();
  const provLabel = provStatus.kind === "noop"
    ? "none — synthesis disabled"
    : `${provStatus.kind} (${provStatus.model})${provStatus.kind === "ollama" ? " — local" : ""}`;
  logger.info("startup", `LLM provider:      ${provLabel}`);
  logger.info("startup", `File watchers:     ${config.watchEnabled ? "active (3 sources)" : "disabled"}`);
  logger.info("startup", `HTTP bridge:       ${config.httpBridgeEnabled ? `active on http://localhost:${config.httpBridgePort}` : "disabled"}`);
  logger.info("startup", line);
  logger.info("startup", "MCP server ready on stdio. Waiting for connections...");
}

function resolveConfigPath(): string {
  const fromEnv = process.env.UNIFIED_MEMORY_CONFIG?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(PROJECT_ROOT, "config.json");
}

async function main(): Promise<void> {
  const configPath = resolveConfigPath();
  try {
    await fs.access(configPath);
  } catch {
    const example = path.join(PROJECT_ROOT, "config.example.json");
    console.error(
      `Configuration not found: ${configPath}\n\n` +
        `Copy the example file and edit paths for your machine:\n` +
        `  cp config.example.json config.json\n\n` +
        `Or set UNIFIED_MEMORY_CONFIG to a custom config file path.\n` +
        `Example template: ${example}`
    );
    process.exit(1);
  }
  const config = await loadConfig(configPath);
  await logger.init(config.logsPath);
  logger.info("index", `loaded config from ${configPath}`);
  runtime.setConfig(config);

  await dataStore.init(config.archivePath);
  await llmRegistry.init(config);

  const watcher = new Watcher(config);

  if (config.processOnStartup) {
    logger.info("index", "running initial scan of all sources...");
    await Promise.all([
      scanClaudeCodeLogs(config.claudeCodeLogsPath, config.archivePath),
      scanObsidianVault(config.obsidianVaultPath),
      scanMemoryExports(config.memoryExportPath, config.archivePath),
    ]);
    if (llmRegistry.getActive().kind !== "noop") {
      watcher.scheduleSynthesis();
    }
  }

  watcher.start();
  const server: RunningServer = await startMcpServer();
  const bridge: RunningHttpBridge | null = startHttpBridge(config);
  if (bridge) {
    logger.info("index", `HTTP bridge listening on http://localhost:${bridge.port}`);
  }
  await printStartupHealth(config);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("index", `received ${signal}, shutting down...`);
    try {
      await watcher.closeAll();
      await dataStore.flush();
      if (bridge) await bridge.close();
      await server.close();
      await logger.close();
    } catch (err: any) {
      logger.error("index", `shutdown error: ${err?.message ?? err}`);
    }
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGHUP", () => void shutdown("SIGHUP"));
}

main().catch(async (err: any) => {
  console.error("fatal:", err?.stack ?? err);
  try { await logger.close(); } catch { /* noop */ }
  process.exit(1);
});
