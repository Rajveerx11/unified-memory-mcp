import { promises as fs } from "node:fs";
import * as path from "node:path";
import { logger } from "../logger.js";

export interface ClaudeCodeSessionSummary {
  sessionId: string;
  project: string;
  cwd: string | null;
  fileMtime: string;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  turns: Array<{ role: "user" | "assistant"; text: string; timestamp: string | null }>;
}

export interface ObsidianNote {
  path: string;
  title: string;
  tags: string[];
  wikilinks: string[];
  todos: Array<{ done: boolean; text: string }>;
  summary: string;
  fullText: string;
  modified: string;
  frontmatter: Record<string, unknown>;
}

export interface MemoryExport {
  source: string;
  importedAt: string;
  conversations: Array<{ title: string; updated: string | null; snippet: string }>;
  raw: Record<string, unknown>;
}

export interface Synthesis {
  generatedAt: string;
  activeProjects: Array<{ name: string; status: string; nextSteps: string[]; sources: string[] }>;
  thinkingPatterns: Array<{ category: string; description: string; examples: string[] }>;
  todos: Array<{ text: string; source: string; status: "pending" | "completed"; project?: string }>;
  insights: Array<{ category: string; insight: string; sources: string[] }>;
  weeklySummary: string;
  truncated: boolean;
}

export interface BrainState {
  rawSources: {
    claudeCode: ClaudeCodeSessionSummary[];
    obsidian: ObsidianNote[];
    memory: MemoryExport[];
  };
  synthesis: Synthesis | null;
  lastUpdated: string;
}

function createEmptyState(): BrainState {
  return {
    rawSources: { claudeCode: [], obsidian: [], memory: [] },
    synthesis: null,
    lastUpdated: new Date(0).toISOString(),
  };
}

function isValidState(s: any): s is BrainState {
  return (
    s != null &&
    typeof s === "object" &&
    s.rawSources &&
    Array.isArray(s.rawSources.claudeCode) &&
    Array.isArray(s.rawSources.obsidian) &&
    Array.isArray(s.rawSources.memory) &&
    typeof s.lastUpdated === "string"
  );
}

class DataStore {
  private state: BrainState = createEmptyState();
  private archiveRoot: string = "";
  private statePath: string = "";
  private backupPath: string = "";
  private writePending: Promise<void> = Promise.resolve();

  async init(archiveRoot: string): Promise<void> {
    this.archiveRoot = archiveRoot;
    this.statePath = path.join(archiveRoot, "brain-state.json");
    this.backupPath = path.join(archiveRoot, "brain-state.backup.json");
    await fs.mkdir(archiveRoot, { recursive: true });
    await this.load();
  }

  private async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.statePath, "utf-8");
      const parsed = JSON.parse(raw);
      if (!isValidState(parsed)) throw new Error("invalid state shape");
      this.state = parsed;
      logger.info("data-store", `loaded brain-state.json (last updated ${this.state.lastUpdated})`);
      return;
    } catch (err: any) {
      if (err?.code !== "ENOENT") {
        logger.warn("data-store", `primary state corrupt: ${err?.message ?? err}`);
      }
    }
    try {
      const raw = await fs.readFile(this.backupPath, "utf-8");
      const parsed = JSON.parse(raw);
      if (!isValidState(parsed)) throw new Error("invalid backup shape");
      this.state = parsed;
      logger.info("data-store", "recovered from backup state file");
      return;
    } catch (err: any) {
      if (err?.code !== "ENOENT") {
        logger.warn("data-store", `backup state corrupt: ${err?.message ?? err}`);
      }
    }
    this.state = createEmptyState();
    logger.info("data-store", "no valid state found, starting fresh");
  }

  getState(): BrainState {
    return this.state;
  }

  async setClaudeCodeSessions(sessions: ClaudeCodeSessionSummary[]): Promise<void> {
    this.state.rawSources.claudeCode = sessions;
    this.state.lastUpdated = new Date().toISOString();
    await this.flush();
  }

  async setObsidianNotes(notes: ObsidianNote[]): Promise<void> {
    this.state.rawSources.obsidian = notes;
    this.state.lastUpdated = new Date().toISOString();
    await this.flush();
  }

  async setMemoryExports(exports: MemoryExport[]): Promise<void> {
    this.state.rawSources.memory = exports;
    this.state.lastUpdated = new Date().toISOString();
    await this.flush();
  }

  async setSynthesis(synthesis: Synthesis | null): Promise<void> {
    this.state.synthesis = synthesis;
    this.state.lastUpdated = new Date().toISOString();
    await this.flush();
  }

  async flush(): Promise<void> {
    this.writePending = this.writePending.then(() => this.writeNow()).catch((err) => {
      logger.error("data-store", `write failed: ${err?.message ?? err}`);
    });
    await this.writePending;
  }

  private async writeNow(): Promise<void> {
    const tmp = this.statePath + ".tmp";
    const data = JSON.stringify(this.state, null, 2);
    await fs.writeFile(tmp, data, "utf-8");
    await fs.rename(tmp, this.statePath);
    try {
      await fs.copyFile(this.statePath, this.backupPath);
    } catch (err: any) {
      logger.warn("data-store", `backup copy failed: ${err?.message ?? err}`);
    }
  }
}

export const dataStore = new DataStore();
