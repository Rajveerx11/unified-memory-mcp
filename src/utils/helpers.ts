import { promises as fs } from "node:fs";
import { logger } from "../logger.js";

export function debounce<T extends (...args: any[]) => void>(fn: T, wait: number): T {
  let t: NodeJS.Timeout | null = null;
  return ((...args: any[]) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  }) as T;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const RETRY_CODES = new Set(["EBUSY", "EPERM", "EACCES"]);

export async function safeReadFile(filePath: string, maxRetries = 3): Promise<string | null> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fs.readFile(filePath, "utf-8");
    } catch (err: any) {
      if (RETRY_CODES.has(err?.code) && attempt < maxRetries - 1) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      logger.warn("safeReadFile", `failed ${filePath} after ${attempt + 1} attempts: ${err?.message ?? err}`);
      return null;
    }
  }
  return null;
}

export async function safeReadStream(filePath: string, onLine: (line: string) => void): Promise<boolean> {
  const text = await safeReadFile(filePath);
  if (text === null) return false;
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (line.length === 0) continue;
    onLine(line);
  }
  return true;
}

export function pathExists(p: string): Promise<boolean> {
  return fs
    .stat(p)
    .then(() => true)
    .catch(() => false);
}

export async function listDir(p: string): Promise<string[]> {
  try {
    return await fs.readdir(p);
  } catch {
    return [];
  }
}

export function tokenize(text: string): string[] {
  const stop = new Set([
    "the",
    "a",
    "an",
    "is",
    "are",
    "was",
    "were",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "and",
    "or",
    "but",
    "not",
    "with",
    "this",
    "that",
    "it",
    "be",
    "as",
    "by",
    "from",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "can",
    "i",
    "my",
    "me",
    "we",
    "our",
    "you",
    "your",
  ]);
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w));
}
