import { promises as fs } from "node:fs";
import * as path from "node:path";
import AdmZip from "adm-zip";
import { logger } from "../logger.js";
import { safeReadFile, listDir, pathExists } from "../utils/helpers.js";
import { archiveJson } from "../utils/archive.js";
import { dataStore, MemoryExport } from "../store/data-store.js";

interface ConversationLike {
  name?: string;
  title?: string;
  uuid?: string;
  updated_at?: string;
  created_at?: string;
  chat_messages?: Array<{ text?: string; sender?: string }>;
  messages?: Array<{ content?: unknown; role?: string }>;
}

function snippetFromConversation(c: ConversationLike): string {
  const msgs = c.chat_messages ?? [];
  for (const m of msgs) {
    if (typeof m.text === "string" && m.text.trim().length > 0) {
      return m.text.slice(0, 300);
    }
  }
  if (Array.isArray(c.messages)) {
    for (const m of c.messages) {
      if (typeof m.content === "string" && m.content.trim().length > 0) {
        return m.content.slice(0, 300);
      }
    }
  }
  return "";
}

function parseConversationsArray(arr: unknown): MemoryExport["conversations"] {
  if (!Array.isArray(arr)) return [];
  const out: MemoryExport["conversations"] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const c = item as ConversationLike;
    out.push({
      title: c.name ?? c.title ?? c.uuid ?? "untitled",
      updated: c.updated_at ?? c.created_at ?? null,
      snippet: snippetFromConversation(c),
    });
  }
  return out;
}

function pickMemoryishFields(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const kl = k.toLowerCase();
    if (kl.includes("memory") || kl.includes("preference") || kl.includes("synthesis") || kl.includes("profile")) {
      out[k] = v;
    }
  }
  return out;
}

async function parseExportSource(source: string, fileMap: Record<string, string>): Promise<MemoryExport> {
  const conversations: MemoryExport["conversations"] = [];
  const raw: Record<string, unknown> = {};

  for (const [name, content] of Object.entries(fileMap)) {
    if (!name.toLowerCase().endsWith(".json")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (err: any) {
      logger.warn("memory-parser", `bad JSON ${name}: ${err?.message ?? err}`);
      continue;
    }
    const baseName = path.basename(name).toLowerCase();

    if (baseName === "conversations.json" || baseName === "conversations") {
      conversations.push(...parseConversationsArray(parsed));
    } else if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "object") {
      const maybeConvs = parseConversationsArray(parsed);
      if (maybeConvs.length > 0) conversations.push(...maybeConvs);
      raw[baseName] = parsed;
    } else if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      const memoryish = pickMemoryishFields(obj);
      if (Object.keys(memoryish).length > 0) {
        raw[baseName] = memoryish;
      } else {
        raw[baseName] = parsed;
      }
    } else {
      raw[baseName] = parsed;
    }
  }

  return {
    source,
    importedAt: new Date().toISOString(),
    conversations,
    raw,
  };
}

async function readZipEntries(zipPath: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const zip = new AdmZip(zipPath);
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    if (!entry.entryName.toLowerCase().endsWith(".json")) continue;
    try {
      out[entry.entryName] = entry.getData().toString("utf-8");
    } catch (err: any) {
      logger.warn("memory-parser", `failed entry ${entry.entryName}: ${err?.message ?? err}`);
    }
  }
  return out;
}

async function parseFile(filePath: string): Promise<MemoryExport | null> {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".zip")) {
    try {
      const entries = await readZipEntries(filePath);
      return parseExportSource(filePath, entries);
    } catch (err: any) {
      logger.warn("memory-parser", `zip read failed ${filePath}: ${err?.message ?? err}`);
      return null;
    }
  }
  if (lower.endsWith(".json")) {
    const text = await safeReadFile(filePath);
    if (text === null) return null;
    return parseExportSource(filePath, { [path.basename(filePath)]: text });
  }
  return null;
}

export async function scanMemoryExports(rootPath: string, archiveRoot: string): Promise<void> {
  if (!(await pathExists(rootPath))) {
    logger.info("memory-parser", `path not found, creating: ${rootPath}`);
    await fs.mkdir(rootPath, { recursive: true });
  }
  const files = await listDir(rootPath);
  const exports: MemoryExport[] = [];
  for (const file of files) {
    const fp = path.join(rootPath, file);
    try {
      const stat = await fs.stat(fp);
      if (!stat.isFile()) continue;
      const exp = await parseFile(fp);
      if (exp) {
        exports.push(exp);
        await archiveJson(archiveRoot, "memory", path.basename(file), exp);
      }
    } catch (err: any) {
      logger.warn("memory-parser", `failed ${fp}: ${err?.message ?? err}`);
    }
  }
  logger.info("memory-parser", `parsed ${exports.length} memory export files`);
  await dataStore.setMemoryExports(exports);
}

export async function parseSingleExport(filePath: string, archiveRoot: string): Promise<void> {
  try {
    const exp = await parseFile(filePath);
    if (!exp) return;
    const current = dataStore.getState().rawSources.memory;
    const filtered = current.filter((m) => m.source !== filePath);
    filtered.push(exp);
    await dataStore.setMemoryExports(filtered);
    await archiveJson(archiveRoot, "memory", path.basename(filePath), exp);
  } catch (err: any) {
    logger.warn("memory-parser", `failed ${filePath}: ${err?.message ?? err}`);
  }
}
