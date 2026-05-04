import * as http from "node:http";
import { logger } from "./logger.js";
import { Config } from "./config.js";
import { dataStore } from "./store/data-store.js";
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
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

type ToolHandler = (args: any) => Promise<{ content: Array<{ type: "text"; text: string }> }>;

interface Route {
  path: string;
  handler: (params: URLSearchParams) => Promise<unknown>;
}

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

function buildRoutes(): Map<string, Route["handler"]> {
  const m = new Map<string, Route["handler"]>();
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

export function startHttpBridge(config: Config): RunningHttpBridge | null {
  if (!config.httpBridgeEnabled) {
    logger.info("http-bridge", "disabled in config — skipping");
    return null;
  }

  const routes = buildRoutes();

  const server = http.createServer(async (req, res) => {
    const start = Date.now();
    const method = req.method ?? "GET";
    const urlStr = req.url ?? "/";
    const url = new URL(urlStr, `http://localhost:${config.httpBridgePort}`);

    if (method === "OPTIONS") {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    if (method !== "GET") {
      res.writeHead(405, { ...CORS_HEADERS, "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "method not allowed" }));
      logger.info("http-bridge", `${method} ${url.pathname} 405 (${Date.now() - start}ms)`);
      return;
    }

    const handler = routes.get(url.pathname);
    if (!handler) {
      res.writeHead(404, { ...CORS_HEADERS, "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found", path: url.pathname }));
      logger.info("http-bridge", `GET ${url.pathname} 404 (${Date.now() - start}ms)`);
      return;
    }

    if (isStoreEmpty()) {
      const body = JSON.stringify({
        status: "initializing",
        message: "Brain is still processing data. Try again in a minute.",
      });
      res.writeHead(202, { ...CORS_HEADERS, "Content-Type": "application/json" });
      res.end(body);
      logger.info("http-bridge", `GET ${url.pathname} 202 (${Date.now() - start}ms)`);
      return;
    }

    try {
      const data = await handler(url.searchParams);
      const body = JSON.stringify(data);
      res.writeHead(200, { ...CORS_HEADERS, "Content-Type": "application/json" });
      res.end(body);
      logger.info("http-bridge", `GET ${url.pathname} 200 (${Date.now() - start}ms)`);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      logger.error("http-bridge", `GET ${url.pathname} failed: ${msg}`);
      res.writeHead(500, { ...CORS_HEADERS, "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: msg }));
      logger.info("http-bridge", `GET ${url.pathname} 500 (${Date.now() - start}ms)`);
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
