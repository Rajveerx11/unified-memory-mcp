import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.js";
import { logger } from "../src/logger.js";
import { dataStore } from "../src/store/data-store.js";
import { scanClaudeCodeLogs } from "../src/parsers/claudecode-parser.js";
import { scanObsidianVault } from "../src/parsers/obsidian-parser.js";
import { scanMemoryExports } from "../src/parsers/memory-parser.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

async function main(): Promise<void> {
  const configPath = path.join(PROJECT_ROOT, "config.json");
  const config = await loadConfig(configPath);
  await logger.init(config.logsPath);
  await dataStore.init(config.archivePath);

  console.log("=== Testing Claude Code Parser ===");
  console.log(`Path: ${config.claudeCodeLogsPath}`);
  await scanClaudeCodeLogs(config.claudeCodeLogsPath, config.archivePath);
  const cc = dataStore.getState().rawSources.claudeCode;
  const projects = new Set(cc.map((s) => s.project));
  console.log(`Parsed ${cc.length} sessions across ${projects.size} project dirs`);
  if (cc.length > 0) {
    const first = cc[0];
    console.log(`Sample project (raw dir): ${first.project}`);
    console.log(`Sample cwd:               ${first.cwd ?? "(none)"}`);
    console.log(`Sample session id:        ${first.sessionId}`);
    console.log(`Sample turn count:        ${first.turns.length}`);
    const userTurn = first.turns.find((t) => t.role === "user");
    const asstTurn = first.turns.find((t) => t.role === "assistant");
    if (userTurn) console.log(`First user turn:    ${userTurn.text.slice(0, 200).replace(/\n/g, " ")}`);
    if (asstTurn) console.log(`First asst turn:    ${asstTurn.text.slice(0, 200).replace(/\n/g, " ")}`);
  }

  console.log("\n=== Testing Obsidian Parser ===");
  console.log(`Path: ${config.obsidianVaultPath}`);
  await scanObsidianVault(config.obsidianVaultPath);
  const ob = dataStore.getState().rawSources.obsidian;
  const totalTodos = ob.reduce((n, x) => n + x.todos.length, 0);
  console.log(`Parsed ${ob.length} notes, ${totalTodos} todos`);
  if (ob.length > 0) {
    const sample = ob[0];
    console.log(`Sample note: ${sample.title} (tags: ${sample.tags.join(",") || "none"})`);
  }

  console.log("\n=== Testing Memory Parser ===");
  console.log(`Path: ${config.memoryExportPath}`);
  await scanMemoryExports(config.memoryExportPath, config.archivePath);
  const mem = dataStore.getState().rawSources.memory;
  const totalConvos = mem.reduce((n, m) => n + m.conversations.length, 0);
  console.log(`Parsed ${mem.length} export(s), ${totalConvos} conversation summaries`);

  const debugPath = path.join(config.archivePath, "debug-parser-output.json");
  const state = dataStore.getState();
  await fs.writeFile(
    debugPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        counts: {
          claudeCodeSessions: state.rawSources.claudeCode.length,
          obsidianNotes: state.rawSources.obsidian.length,
          memoryExports: state.rawSources.memory.length,
        },
        sample: {
          claudeCode: state.rawSources.claudeCode.slice(0, 2),
          obsidian: state.rawSources.obsidian.slice(0, 2),
          memory: state.rawSources.memory.slice(0, 1),
        },
      },
      null,
      2,
    ),
    "utf-8",
  );
  console.log(`\nDebug output: ${debugPath}`);

  await logger.close();
}

main().catch((err) => {
  console.error("test-parsers failed:", err?.stack ?? err);
  process.exit(1);
});
