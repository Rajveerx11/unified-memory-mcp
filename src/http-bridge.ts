import * as http from "node:http";
import { logger } from "./logger.js";
import { Config } from "./config.js";
import { runtime } from "./runtime.js";
import { dataStore } from "./store/data-store.js";
import { llmRegistry, ProviderKind } from "./llm/index.js";
import { getProjectsTool } from "./tools/get-projects.js";
import { getThinkingPatternsTool } from "./tools/get-thinking-patterns.js";
import { getTodosTool } from "./tools/get-todos.js";
import { getInsightsTool } from "./tools/get-insights.js";
import { getWeeklySummaryTool } from "./tools/get-weekly-summary.js";
import { searchBrainTool } from "./tools/search-brain.js";
import { getDashboardDataTool } from "./tools/get-dashboard-data.js";
import { getBrainStatusTool } from "./tools/get-brain-status.js";

export interface RunningHttpBridge {
  close: () => Promise<void>;
  port: number;
}

const CORS_HEADERS: http.OutgoingHttpHeaders = {
  "Access-Control-Allow-Origin": "http://localhost:3000",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const VALID_PROVIDERS: ProviderKind[] = ["ollama", "ollama-cloud", "anthropic"];
const PROVIDER_LABELS: Record<ProviderKind, string> = {
  "ollama": "Local (Ollama)",
  "ollama-cloud": "Cloud (Ollama)",
  "anthropic": "Anthropic API",
};
const MAX_BODY_BYTES = 4096;

type ToolHandler = (args: any) => Promise<{ content: Array<{ type: "text"; text: string }> }>;
type DataHandler = (params: URLSearchParams) => Promise<unknown>;

async function callTool(handler: ToolHandler, args: Record<string, unknown>): Promise<unknown> {
  const result = await handler(args);
  const text = result?.content?.[0]?.text ?? "{}";
  return JSON.parse(text);
}

function isStoreEmpty(): boolean {
  const s = dataStore.getState();
  return (
    s.rawSources.claudeCode.length === 0 &&
    s.rawSources.obsidian.length === 0 &&
    s.rawSources.memory.length === 0 &&
    s.synthesis === null
  );
}

function buildDataRoutes(): Map<string, DataHandler> {
  const m = new Map<string, DataHandler>();
  m.set("/api/dashboard", async () => callTool(getDashboardDataTool.handler, {}));
  m.set("/api/projects", async (q) => callTool(getProjectsTool.handler as ToolHandler, { filter: q.get("filter") ?? undefined }));
  m.set("/api/todos", async (q) => callTool(getTodosTool.handler as ToolHandler, {
    status: q.get("status") ?? undefined,
    source: q.get("source") ?? undefined,
  }));
  m.set("/api/insights", async () => callTool(getInsightsTool.handler, {}));
  m.set("/api/patterns", async () => callTool(getThinkingPatternsTool.handler, {}));
  m.set("/api/summary", async (q) => {
    const wb = q.get("weeks_back");
    const args: Record<string, unknown> = {};
    if (wb !== null) {
      const n = Number(wb);
      if (Number.isFinite(n)) args.weeks_back = n;
    }
    return callTool(getWeeklySummaryTool.handler as ToolHandler, args);
  });
  m.set("/api/search", async (q) => callTool(searchBrainTool.handler as ToolHandler, {
    query: q.get("q") ?? "",
    source: q.get("source") ?? undefined,
  }));
  m.set("/api/status", async () => callTool(getBrainStatusTool.handler, {}));
  return m;
}

function listProviders(): unknown {
  const cfg = runtime.requireConfig();
  const status = llmRegistry.getStatus();
  return {
    active: {
      kind: status.kind,
      model: status.model,
      lastSwitchAt: status.lastSwitchAt,
      lastSwitchReason: status.lastSwitchReason,
    },
    configured: {
      provider: cfg.llm.provider,
    },
    available: VALID_PROVIDERS.map((kind) => {
      const model =
        kind === "ollama" ? cfg.llm.ollama.model
        : kind === "ollama-cloud" ? cfg.llm.ollamaCloud.model
        : cfg.llm.anthropic.model;
      const requiresKey = kind === "ollama-cloud" || kind === "anthropic";
      const keyPresent =
        kind === "ollama-cloud" ? !!cfg.llm.ollamaCloud.resolvedApiKey
        : kind === "anthropic" ? !!cfg.llm.anthropic.resolvedApiKey
        : true;
      return {
        kind,
        label: PROVIDER_LABELS[kind],
        model,
        requiresKey,
        keyPresent,
      };
    }),
  };
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      total += c.length;
      if (total > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error("request body too large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (!text) { resolve({}); return; }
      try { resolve(JSON.parse(text)); } catch { reject(new Error("invalid JSON body")); }
    });
    req.on("error", reject);
  });
}

async function handleSwitchProvider(req: http.IncomingMessage): Promise<{ status: number; body: unknown }> {
  let body: any;
  try {
    body = await readJsonBody(req);
  } catch (err: any) {
    return { status: 400, body: { error: err?.message ?? "bad request" } };
  }
  const provider = typeof body?.provider === "string" ? body.provider : null;
  const model = typeof body?.model === "string" && body.model.length > 0 ? body.model : undefined;
  if (!provider || !VALID_PROVIDERS.includes(provider as ProviderKind)) {
    return {
      status: 400,
      body: { error: `provider must be one of: ${VALID_PROVIDERS.join(", ")}`, received: provider },
    };
  }
  const result = await llmRegistry.switchTo(provider as ProviderKind, model);
  return {
    status: result.ok ? 200 : 409,
    body: {
      switched: result.ok,
      reason: result.reason,
      requested: result.provider,
      active: llmRegistry.getStatus(),
    },
  };
}

function writeJson(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { ...CORS_HEADERS, "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

export function startHttpBridge(config: Config): RunningHttpBridge | null {
  if (!config.httpBridgeEnabled) {
    logger.info("http-bridge", "disabled in config — skipping");
    return null;
  }

  const dataRoutes = buildDataRoutes();

  const server = http.createServer(async (req, res) => {
    const start = Date.now();
    const method = req.method ?? "GET";
    const urlStr = req.url ?? "/";
    const url = new URL(urlStr, `http://localhost:${config.httpBridgePort}`);
    const pathname = url.pathname;
    const log = (status: number) =>
      logger.info("http-bridge", `${method} ${pathname} ${status} (${Date.now() - start}ms)`);

    if (method === "OPTIONS") {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    try {
      // Control endpoints — never gated by store state
      if (method === "GET" && pathname === "/api/providers") {
        writeJson(res, 200, listProviders());
        log(200);
        return;
      }
      if (method === "POST" && pathname === "/api/provider/switch") {
        const { status, body } = await handleSwitchProvider(req);
        writeJson(res, status, body);
        log(status);
        return;
      }

      // Data endpoints
      if (method !== "GET") {
        writeJson(res, 405, { error: "method not allowed" });
        log(405);
        return;
      }
      const handler = dataRoutes.get(pathname);
      if (!handler) {
        writeJson(res, 404, { error: "not found", path: pathname });
        log(404);
        return;
      }
      if (isStoreEmpty()) {
        writeJson(res, 202, { status: "initializing", message: "Brain is still processing data. Try again in a minute." });
        log(202);
        return;
      }
      const data = await handler(url.searchParams);
      writeJson(res, 200, data);
      log(200);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      logger.error("http-bridge", `${method} ${pathname} failed: ${msg}`);
      writeJson(res, 500, { error: msg });
      log(500);
    }
  });

  server.listen(config.httpBridgePort, "127.0.0.1");

  return {
    port: config.httpBridgePort,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
