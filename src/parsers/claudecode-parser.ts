import { promises as fs } from "node:fs";
import * as path from "node:path";
import { logger } from "../logger.js";
import { safeReadFile, listDir, pathExists } from "../utils/helpers.js";
import { archiveJson } from "../utils/archive.js";
import { dataStore, ClaudeCodeSessionSummary } from "../store/data-store.js";

interface JsonlLine {
  type?: string;
  message?: {
    role?: string;
    content?: unknown;
  };
  timestamp?: string;
  cwd?: string;
  sessionId?: string;
}

function extractAssistantText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
    else if (b.type === "thinking" && typeof b.thinking === "string") parts.push(`[thinking] ${b.thinking}`);
  }
  return parts.join("\n");
}

function extractUserText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
    else if (b.type === "tool_result") {
      // skip tool results — too noisy
    }
  }
  return parts.join("\n");
}

async function parseSessionFile(filePath: string, projectName: string): Promise<ClaudeCodeSessionSummary | null> {
  const text = await safeReadFile(filePath);
  if (text === null) return null;

  const stat = await fs.stat(filePath);
  const turns: ClaudeCodeSessionSummary["turns"] = [];
  let sessionId = path.basename(filePath, ".jsonl");
  let cwd: string | null = null;
  let firstTs: string | null = null;
  let lastTs: string | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.trim().length === 0) continue;
    let line: JsonlLine;
    try {
      line = JSON.parse(rawLine);
    } catch {
      continue;
    }
    if (line.sessionId && typeof line.sessionId === "string") sessionId = line.sessionId;
    if (line.cwd && typeof line.cwd === "string") cwd = line.cwd;

    if (line.type === "user") {
      const txt = extractUserText(line.message?.content).trim();
      if (txt.length === 0) continue;
      const ts = typeof line.timestamp === "string" ? line.timestamp : null;
      turns.push({ role: "user", text: txt, timestamp: ts });
      if (!firstTs && ts) firstTs = ts;
      if (ts) lastTs = ts;
    } else if (line.type === "assistant") {
      const txt = extractAssistantText(line.message?.content).trim();
      if (txt.length === 0) continue;
      const ts = typeof line.timestamp === "string" ? line.timestamp : null;
      turns.push({ role: "assistant", text: txt, timestamp: ts });
      if (!firstTs && ts) firstTs = ts;
      if (ts) lastTs = ts;
    }
  }

  if (turns.length === 0) return null;

  return {
    sessionId,
    project: projectName,
    cwd,
    fileMtime: stat.mtime.toISOString(),
    firstTimestamp: firstTs,
    lastTimestamp: lastTs,
    turns,
  };
}

export async function scanClaudeCodeLogs(rootPath: string, archiveRoot: string): Promise<void> {
  if (!(await pathExists(rootPath))) {
    logger.warn("claudecode-parser", `path not found: ${rootPath}`);
    await dataStore.setClaudeCodeSessions([]);
    return;
  }

  const projectDirs = await listDir(rootPath);
  const sessions: ClaudeCodeSessionSummary[] = [];

  for (const projDir of projectDirs) {
    const fullProj = path.join(rootPath, projDir);
    let stat;
    try {
      stat = await fs.stat(fullProj);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    const files = await listDir(fullProj);
    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const fp = path.join(fullProj, file);
      try {
        const summary = await parseSessionFile(fp, projDir);
        if (summary) {
          sessions.push(summary);
          await archiveJson(archiveRoot, "claudecode", `${projDir}__${summary.sessionId}`, summary);
        }
      } catch (err: any) {
        logger.warn("claudecode-parser", `failed ${fp}: ${err?.message ?? err}`);
      }
    }
  }

  logger.info("claudecode-parser", `parsed ${sessions.length} sessions across ${projectDirs.length} project dirs`);
  await dataStore.setClaudeCodeSessions(sessions);
}

export async function parseSingleFile(filePath: string, rootPath: string, archiveRoot: string): Promise<void> {
  const rel = path.relative(rootPath, filePath);
  const projDir = rel.split(path.sep)[0];
  if (!projDir || !filePath.endsWith(".jsonl")) return;

  try {
    const summary = await parseSessionFile(filePath, projDir);
    if (!summary) return;

    const current = dataStore.getState().rawSources.claudeCode;
    const filtered = current.filter((s) => !(s.project === projDir && s.sessionId === summary.sessionId));
    filtered.push(summary);
    await dataStore.setClaudeCodeSessions(filtered);
    await archiveJson(archiveRoot, "claudecode", `${projDir}__${summary.sessionId}`, summary);
  } catch (err: any) {
    logger.warn("claudecode-parser", `failed ${filePath}: ${err?.message ?? err}`);
  }
}
