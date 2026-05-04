import chokidar, { FSWatcher } from "chokidar";
import * as path from "node:path";
import { Config } from "./config.js";
import { logger } from "./logger.js";
import { sleep } from "./utils/helpers.js";
import { parseSingleFile } from "./parsers/claudecode-parser.js";
import { parseSingleNote, removeNote } from "./parsers/obsidian-parser.js";
import { parseSingleExport } from "./parsers/memory-parser.js";
import { runThinkingLayer } from "./thinking.js";
import { dataStore } from "./store/data-store.js";

const READ_DELAY_MS = 1000;
const SYNTHESIS_DEBOUNCE_MS = 5 * 60 * 1000;

export class Watcher {
  private watchers: FSWatcher[] = [];
  private synthTimer: NodeJS.Timeout | null = null;
  private synthRunning = false;

  constructor(private config: Config) {}

  start(): void {
    if (!this.config.watchEnabled) {
      logger.info("watcher", "file watching disabled in config");
      return;
    }

    const ccWatcher = chokidar.watch(this.config.claudeCodeLogsPath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 200 },
    });
    ccWatcher.on("add", (p) => this.handleClaudeCode(p));
    ccWatcher.on("change", (p) => this.handleClaudeCode(p));
    ccWatcher.on("error", (err) => logger.warn("watcher", `claudecode watcher error: ${err}`));
    this.watchers.push(ccWatcher);

    const obWatcher = chokidar.watch(this.config.obsidianVaultPath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 200 },
      ignored: (p: string) => p.includes(`${path.sep}.obsidian${path.sep}`),
    });
    obWatcher.on("add", (p) => this.handleObsidian(p));
    obWatcher.on("change", (p) => this.handleObsidian(p));
    obWatcher.on("unlink", (p) => this.handleObsidianRemove(p));
    obWatcher.on("error", (err) => logger.warn("watcher", `obsidian watcher error: ${err}`));
    this.watchers.push(obWatcher);

    const memWatcher = chokidar.watch(this.config.memoryExportPath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 200 },
    });
    memWatcher.on("add", (p) => this.handleMemory(p));
    memWatcher.on("change", (p) => this.handleMemory(p));
    memWatcher.on("error", (err) => logger.warn("watcher", `memory watcher error: ${err}`));
    this.watchers.push(memWatcher);

    logger.info("watcher", `active (${this.watchers.length} sources)`);
  }

  private async handleClaudeCode(filePath: string): Promise<void> {
    if (!filePath.endsWith(".jsonl")) return;
    await sleep(READ_DELAY_MS);
    logger.info("watcher", `claudecode change: ${filePath}`);
    await parseSingleFile(filePath, this.config.claudeCodeLogsPath, this.config.archivePath);
    this.scheduleSynthesis();
  }

  private async handleObsidian(filePath: string): Promise<void> {
    if (!filePath.endsWith(".md")) return;
    await sleep(READ_DELAY_MS);
    logger.info("watcher", `obsidian change: ${filePath}`);
    await parseSingleNote(filePath, this.config.obsidianVaultPath);
    this.scheduleSynthesis();
  }

  private async handleObsidianRemove(filePath: string): Promise<void> {
    if (!filePath.endsWith(".md")) return;
    logger.info("watcher", `obsidian removed: ${filePath}`);
    await removeNote(filePath);
    this.scheduleSynthesis();
  }

  private async handleMemory(filePath: string): Promise<void> {
    await sleep(READ_DELAY_MS);
    logger.info("watcher", `memory change: ${filePath}`);
    await parseSingleExport(filePath, this.config.archivePath);
    this.scheduleSynthesis();
  }

  scheduleSynthesis(): void {
    if (this.synthTimer) clearTimeout(this.synthTimer);
    this.synthTimer = setTimeout(() => this.runSynthesis(), SYNTHESIS_DEBOUNCE_MS);
  }

  async runSynthesisNow(): Promise<void> {
    await this.runSynthesis();
  }

  private async runSynthesis(): Promise<void> {
    if (this.synthRunning) return;
    this.synthRunning = true;
    try {
      const synth = await runThinkingLayer(this.config);
      await dataStore.setSynthesis(synth);
    } catch (err: any) {
      logger.error("watcher", `synthesis run failed: ${err?.message ?? err}`);
    } finally {
      this.synthRunning = false;
    }
  }

  async closeAll(): Promise<void> {
    if (this.synthTimer) {
      clearTimeout(this.synthTimer);
      this.synthTimer = null;
    }
    await Promise.all(this.watchers.map((w) => w.close().catch(() => undefined)));
    this.watchers = [];
  }
}
