import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as z from "zod/v4";

const OllamaSchema = z.object({
  baseUrl: z.string().default("http://localhost:11434"),
  model: z.string().default("gemma4:e4b"),
  contextWindow: z.number().int().positive().default(131072),
  temperature: z.number().min(0).max(2).default(0.3),
  timeout: z.number().int().positive().default(120000),
});

const OllamaCloudSchema = z.object({
  baseUrl: z.string().default("https://ollama.com"),
  apiKey: z.string().default("env:OLLAMA_API_KEY"),
  model: z.string().default("gpt-oss:120b"),
  temperature: z.number().min(0).max(2).default(0.3),
  timeout: z.number().int().positive().default(120000),
});

const AnthropicSchema = z.object({
  apiKey: z.string().default("env:ANTHROPIC_API_KEY"),
  model: z.string().default("claude-sonnet-4-6"),
  maxTokens: z.number().int().positive().default(8000),
  temperature: z.number().min(0).max(1).default(0.3),
});

const LLMSchema = z.object({
  provider: z.enum(["ollama", "ollama-cloud", "anthropic"]).default("ollama"),
  ollama: OllamaSchema.optional(),
  ollamaCloud: OllamaCloudSchema.optional(),
  anthropic: AnthropicSchema.optional(),
});

const ConfigSchema = z.object({
  memoryExportPath: z.string(),
  claudeCodeLogsPath: z.string(),
  obsidianVaultPath: z.string(),
  archivePath: z.string(),
  llm: LLMSchema,
  watchEnabled: z.boolean().default(true),
  processOnStartup: z.boolean().default(true),
  httpBridgeEnabled: z.boolean().default(true),
  httpBridgePort: z.number().int().min(1).max(65535).default(3001),
});

type ConfigInput = z.infer<typeof ConfigSchema>;

export interface Config extends Omit<ConfigInput, "llm"> {
  logsPath: string;
  llm: {
    provider: "ollama" | "ollama-cloud" | "anthropic";
    ollama: z.infer<typeof OllamaSchema>;
    ollamaCloud: z.infer<typeof OllamaCloudSchema> & { resolvedApiKey: string | null };
    anthropic: z.infer<typeof AnthropicSchema> & { resolvedApiKey: string | null };
  };
}

function expandHome(p: string): string {
  if (p.startsWith("~")) return path.join(os.homedir(), p.slice(1));
  return p;
}

function normalizePath(p: string): string {
  return path.resolve(expandHome(p));
}

async function ensureDir(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: true });
}

function resolveApiKey(value: string): string | null {
  if (value.startsWith("env:")) {
    return process.env[value.slice(4)] ?? null;
  }
  return value.length > 0 ? value : null;
}

const DEFAULT_OLLAMA = {
  baseUrl: "http://localhost:11434",
  model: "gemma4:e4b",
  contextWindow: 131072,
  temperature: 0.3,
  timeout: 120000,
};

const DEFAULT_OLLAMA_CLOUD = {
  baseUrl: "https://ollama.com",
  apiKey: "env:OLLAMA_API_KEY",
  model: "gpt-oss:120b",
  temperature: 0.3,
  timeout: 120000,
};

const DEFAULT_ANTHROPIC = {
  apiKey: "env:ANTHROPIC_API_KEY",
  model: "claude-sonnet-4-6",
  maxTokens: 8000,
  temperature: 0.3,
};

export async function loadConfig(configPath: string): Promise<Config> {
  const raw = await fs.readFile(configPath, "utf-8");
  const parsed = ConfigSchema.parse(JSON.parse(raw));

  const archivePath = normalizePath(parsed.archivePath);
  const dataRoot = path.dirname(archivePath);

  const ollama = parsed.llm.ollama ?? DEFAULT_OLLAMA;
  const ollamaCloud = parsed.llm.ollamaCloud ?? DEFAULT_OLLAMA_CLOUD;
  const anthropic = parsed.llm.anthropic ?? DEFAULT_ANTHROPIC;

  const config: Config = {
    memoryExportPath: normalizePath(parsed.memoryExportPath),
    claudeCodeLogsPath: normalizePath(parsed.claudeCodeLogsPath),
    obsidianVaultPath: normalizePath(parsed.obsidianVaultPath),
    archivePath,
    watchEnabled: parsed.watchEnabled,
    processOnStartup: parsed.processOnStartup,
    httpBridgeEnabled: parsed.httpBridgeEnabled,
    httpBridgePort: parsed.httpBridgePort,
    logsPath: path.join(dataRoot, "logs"),
    llm: {
      provider: parsed.llm.provider,
      ollama,
      ollamaCloud: {
        ...ollamaCloud,
        resolvedApiKey: resolveApiKey(ollamaCloud.apiKey),
      },
      anthropic: {
        ...anthropic,
        resolvedApiKey: resolveApiKey(anthropic.apiKey),
      },
    },
  };

  await ensureDir(config.memoryExportPath);
  await ensureDir(config.archivePath);
  await ensureDir(config.logsPath);

  return config;
}
