import { promises as fs, createWriteStream, WriteStream } from "node:fs";
import * as path from "node:path";

type Level = "info" | "warn" | "error";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 5;

class Logger {
  private logDir: string | null = null;
  private logFile: string | null = null;
  private stream: WriteStream | null = null;
  private currentBytes = 0;
  private rotating = false;

  async init(logDir: string): Promise<void> {
    this.logDir = logDir;
    await fs.mkdir(logDir, { recursive: true });
    this.logFile = path.join(logDir, "server.log");

    try {
      const stat = await fs.stat(this.logFile);
      this.currentBytes = stat.size;
    } catch {
      this.currentBytes = 0;
    }

    this.stream = createWriteStream(this.logFile, { flags: "a" });
  }

  private async rotate(): Promise<void> {
    if (!this.logDir || !this.logFile) return;
    if (this.rotating) return;
    this.rotating = true;
    try {
      if (this.stream) {
        await new Promise<void>((resolve) => this.stream!.end(resolve));
        this.stream = null;
      }
      for (let i = MAX_FILES - 1; i >= 1; i--) {
        const src = path.join(this.logDir, `server.log.${i}`);
        const dst = path.join(this.logDir, `server.log.${i + 1}`);
        try {
          await fs.rename(src, dst);
        } catch {
          // file may not exist
        }
      }
      try {
        await fs.rename(this.logFile, path.join(this.logDir, "server.log.1"));
      } catch {
        // ignore
      }
      this.stream = createWriteStream(this.logFile, { flags: "a" });
      this.currentBytes = 0;
    } finally {
      this.rotating = false;
    }
  }

  private write(level: Level, module: string, msg: string): void {
    const ts = new Date().toISOString();
    const line = `[${ts}] [${level.toUpperCase()}] [${module}] ${msg}\n`;
    process.stderr.write(line);
    if (this.stream && !this.rotating) {
      this.stream.write(line);
      this.currentBytes += Buffer.byteLength(line);
      if (this.currentBytes >= MAX_BYTES && !this.rotating) {
        void this.rotate();
      }
    }
  }

  info(module: string, msg: string): void { this.write("info", module, msg); }
  warn(module: string, msg: string): void { this.write("warn", module, msg); }
  error(module: string, msg: string): void { this.write("error", module, msg); }

  async close(): Promise<void> {
    if (this.stream) {
      await new Promise<void>((resolve) => this.stream!.end(resolve));
      this.stream = null;
    }
  }
}

export const logger = new Logger();
