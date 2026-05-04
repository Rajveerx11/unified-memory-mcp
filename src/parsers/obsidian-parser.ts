import { promises as fs } from "node:fs";
import * as path from "node:path";
import { glob } from "glob";
import matter from "gray-matter";
import { logger } from "../logger.js";
import { safeReadFile, pathExists } from "../utils/helpers.js";
import { dataStore, ObsidianNote } from "../store/data-store.js";

const MAX_FILE_BYTES = 1 * 1024 * 1024;

const TAG_REGEX = /(?:^|\s)#([A-Za-z0-9_\-/]+)/g;
const WIKILINK_REGEX = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
const TODO_REGEX = /^\s*[-*]\s+\[( |x|X)\]\s+(.+)$/;
const CODE_FENCE = /```[\s\S]*?```/g;

function stripCodeBlocks(text: string): string {
  return text.replace(CODE_FENCE, "");
}

function extractTags(content: string, frontmatter: Record<string, unknown>): string[] {
  const out = new Set<string>();
  const fmTags = frontmatter.tags;
  if (Array.isArray(fmTags)) {
    for (const t of fmTags) if (typeof t === "string") out.add(t);
  } else if (typeof fmTags === "string") {
    for (const t of fmTags.split(/[,\s]+/)) if (t.length > 0) out.add(t);
  }
  const stripped = stripCodeBlocks(content);
  for (const m of stripped.matchAll(TAG_REGEX)) {
    out.add(m[1]);
  }
  return [...out];
}

function extractWikilinks(content: string): string[] {
  const out = new Set<string>();
  const stripped = stripCodeBlocks(content);
  for (const m of stripped.matchAll(WIKILINK_REGEX)) {
    out.add(m[1].trim());
  }
  return [...out];
}

function extractTodos(content: string): Array<{ done: boolean; text: string }> {
  const todos: Array<{ done: boolean; text: string }> = [];
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(TODO_REGEX);
    if (m) {
      todos.push({ done: m[1].toLowerCase() === "x", text: m[2].trim() });
    }
  }
  return todos;
}

function extractTitle(filePath: string, content: string): string {
  const h1 = content.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim();
  return path.basename(filePath, ".md");
}

async function parseNote(filePath: string): Promise<ObsidianNote | null> {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return null;
  }
  if (stat.size > MAX_FILE_BYTES) {
    logger.warn("obsidian-parser", `skipping large file (${stat.size} bytes): ${filePath}`);
    return null;
  }
  const raw = await safeReadFile(filePath);
  if (raw === null) return null;

  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(raw);
  } catch (err: any) {
    logger.warn("obsidian-parser", `frontmatter parse failed ${filePath}: ${err?.message ?? err}`);
    parsed = { content: raw, data: {}, isEmpty: false, excerpt: "", orig: raw } as any;
  }

  const content = parsed.content;
  const frontmatter = parsed.data ?? {};

  return {
    path: filePath,
    title: extractTitle(filePath, content),
    tags: extractTags(content, frontmatter),
    wikilinks: extractWikilinks(content),
    todos: extractTodos(content),
    summary: content.slice(0, 500).trim(),
    fullText: content,
    modified: stat.mtime.toISOString(),
    frontmatter: frontmatter as Record<string, unknown>,
  };
}

export async function scanObsidianVault(vaultPath: string): Promise<void> {
  if (!(await pathExists(vaultPath))) {
    logger.warn("obsidian-parser", `vault path not found, skipping: ${vaultPath}`);
    await dataStore.setObsidianNotes([]);
    return;
  }

  const files = await glob("**/*.md", { cwd: vaultPath, absolute: true, nodir: true });
  const notes: ObsidianNote[] = [];
  for (const file of files) {
    try {
      const n = await parseNote(file);
      if (n) notes.push(n);
    } catch (err: any) {
      logger.warn("obsidian-parser", `failed ${file}: ${err?.message ?? err}`);
    }
  }
  logger.info("obsidian-parser", `parsed ${notes.length} notes from vault`);
  await dataStore.setObsidianNotes(notes);
}

export async function parseSingleNote(filePath: string, vaultPath: string): Promise<void> {
  if (!filePath.endsWith(".md")) return;
  try {
    const n = await parseNote(filePath);
    const current = dataStore.getState().rawSources.obsidian;
    const filtered = current.filter((c) => c.path !== filePath);
    if (n) filtered.push(n);
    await dataStore.setObsidianNotes(filtered);
  } catch (err: any) {
    logger.warn("obsidian-parser", `failed ${filePath}: ${err?.message ?? err}`);
  }
}

export async function removeNote(filePath: string): Promise<void> {
  const current = dataStore.getState().rawSources.obsidian;
  const filtered = current.filter((c) => c.path !== filePath);
  if (filtered.length !== current.length) {
    await dataStore.setObsidianNotes(filtered);
  }
}
