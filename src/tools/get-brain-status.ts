import { promises as fs } from "node:fs";
import * as path from "node:path";
import { dataStore } from "../store/data-store.js";
import { llmRegistry } from "../llm/index.js";
import { runtime } from "../runtime.js";
import { listDir, pathExists } from "../utils/helpers.js";

async function countDirContents(p: string, predicate: (name: string) => boolean): Promise<number> {
  if (!(await pathExists(p))) return 0;
  const files = await listDir(p);
  return files.filter(predicate).length;
}

async function countClaudeCodeSessions(p: string): Promise<{ projects: number; sessions: number }> {
  if (!(await pathExists(p))) return { projects: 0, sessions: 0 };
  const dirs = await listDir(p);
  let projects = 0;
  let sessions = 0;
  for (const d of dirs) {
    const full = path.join(p, d);
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

async function countObsidian(p: string): Promise<number | null> {
  if (!(await pathExists(p))) return null;
  const { glob } = await import("glob");
  const files = await glob("**/*.md", { cwd: p, nodir: true });
  return files.length;
}

export const getBrainStatusTool = {
  name: "get_brain_status",
  description:
    "Returns the current status of the unified memory system: which LLM provider is active, which data sources are connected, last processing time, and data statistics.",
  inputSchema: {},
  handler: async () => {
    const config = runtime.requireConfig();
    const state = dataStore.getState();
    const provider = llmRegistry.getStatus();

    const cc = await countClaudeCodeSessions(config.claudeCodeLogsPath);
    const memCount = await countDirContents(
      config.memoryExportPath,
      (n) => n.toLowerCase().endsWith(".json") || n.toLowerCase().endsWith(".zip"),
    );
    const obCount = await countObsidian(config.obsidianVaultPath);

    const totalTodos =
      state.rawSources.obsidian.reduce((sum, n) => sum + n.todos.length, 0) + (state.synthesis?.todos.length ?? 0);

    const status = {
      provider: {
        kind: provider.kind,
        model: provider.model,
        lastSwitchAt: provider.lastSwitchAt,
        lastSwitchReason: provider.lastSwitchReason,
      },
      sources: {
        claudeCode: {
          path: config.claudeCodeLogsPath,
          exists: await pathExists(config.claudeCodeLogsPath),
          projectDirs: cc.projects,
          sessionFiles: cc.sessions,
          parsedSessions: state.rawSources.claudeCode.length,
        },
        memory: {
          path: config.memoryExportPath,
          exists: await pathExists(config.memoryExportPath),
          fileCount: memCount,
          parsedExports: state.rawSources.memory.length,
        },
        obsidian: {
          path: config.obsidianVaultPath,
          exists: obCount !== null,
          markdownFiles: obCount ?? 0,
          parsedNotes: state.rawSources.obsidian.length,
        },
      },
      lastThinkingRun: state.synthesis?.generatedAt ?? null,
      lastDataUpdate: state.lastUpdated,
      synthesisTruncated: state.synthesis?.truncated ?? false,
      stats: {
        totalNotes: state.rawSources.obsidian.length,
        totalSessions: state.rawSources.claudeCode.length,
        totalMemoryExports: state.rawSources.memory.length,
        totalTodos,
        totalInsights: state.synthesis?.insights.length ?? 0,
        totalProjects: state.synthesis?.activeProjects.length ?? 0,
      },
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(status, null, 2) }],
    };
  },
};
