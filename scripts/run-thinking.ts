import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.js";
import { logger } from "../src/logger.js";
import { dataStore } from "../src/store/data-store.js";
import { runtime } from "../src/runtime.js";
import { llmRegistry } from "../src/llm/index.js";
import { runThinkingLayer } from "../src/thinking.js";
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
  runtime.setConfig(config);
  await dataStore.init(config.archivePath);
  await llmRegistry.init(config);

  const provider = llmRegistry.getActive();
  console.log(`Active provider: ${provider.kind}/${provider.model}`);
  if (provider.kind === "noop") {
    console.error("No LLM provider available — set ANTHROPIC_API_KEY or start Ollama with the configured model");
    process.exit(1);
  }

  console.log("Refreshing source data...");
  await Promise.all([
    scanClaudeCodeLogs(config.claudeCodeLogsPath, config.archivePath),
    scanObsidianVault(config.obsidianVaultPath),
    scanMemoryExports(config.memoryExportPath, config.archivePath),
  ]);

  const state = dataStore.getState();
  console.log(`Sources: ${state.rawSources.claudeCode.length} cc sessions, ${state.rawSources.obsidian.length} obsidian notes, ${state.rawSources.memory.length} memory exports`);

  console.log("Running thinking layer...");
  const t0 = Date.now();
  const synthesis = await runThinkingLayer(config);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`Thinking layer completed in ${dt}s`);

  if (!synthesis) {
    console.error("Synthesis returned null — see logs for details");
    process.exit(2);
  }

  await dataStore.setSynthesis(synthesis);

  console.log(`Active projects:    ${synthesis.activeProjects.length}`);
  console.log(`Thinking patterns:  ${synthesis.thinkingPatterns.length}`);
  console.log(`Todos:              ${synthesis.todos.length}`);
  console.log(`Insights:           ${synthesis.insights.length}`);
  console.log(`Weekly summary:     ${synthesis.weeklySummary.length} chars`);
  console.log(`Truncated:          ${synthesis.truncated}`);
  console.log("\n--- First project ---");
  console.log(JSON.stringify(synthesis.activeProjects[0] ?? null, null, 2));
  console.log("\n--- Weekly summary (first 500 chars) ---");
  console.log(synthesis.weeklySummary.slice(0, 500));

  console.log(`\nState persisted to ${path.join(config.archivePath, "brain-state.json")}`);
  await logger.close();
}

main().catch((err) => {
  console.error("run-thinking failed:", err?.stack ?? err);
  process.exit(1);
});
