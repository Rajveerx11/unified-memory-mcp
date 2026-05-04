import { promises as fs } from "node:fs";
import * as path from "node:path";

export async function archiveJson(archiveRoot: string, kind: string, id: string, data: unknown): Promise<string> {
  const dir = path.join(archiveRoot, kind);
  await fs.mkdir(dir, { recursive: true });
  const safeId = id.replace(/[^A-Za-z0-9_.-]/g, "_");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `${safeId}.${stamp}.json`);
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf-8");
  return file;
}
