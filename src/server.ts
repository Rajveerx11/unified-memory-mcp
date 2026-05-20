import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { logger } from "./logger.js";
import { getProjectsTool } from "./tools/get-projects.js";
import { getThinkingPatternsTool } from "./tools/get-thinking-patterns.js";
import { getTodosTool } from "./tools/get-todos.js";
import { getInsightsTool } from "./tools/get-insights.js";
import { getWeeklySummaryTool } from "./tools/get-weekly-summary.js";
import { searchBrainTool } from "./tools/search-brain.js";
import { getDashboardDataTool } from "./tools/get-dashboard-data.js";
import { getBrainStatusTool } from "./tools/get-brain-status.js";
import { switchProviderTool } from "./tools/switch-provider.js";

export interface RunningServer {
  close: () => Promise<void>;
}

export async function startMcpServer(): Promise<RunningServer> {
  const server = new McpServer({ name: "unified-memory", version: "1.0.0" });

  const tools = [
    getProjectsTool,
    getThinkingPatternsTool,
    getTodosTool,
    getInsightsTool,
    getWeeklySummaryTool,
    searchBrainTool,
    getDashboardDataTool,
    getBrainStatusTool,
    switchProviderTool,
  ];

  for (const t of tools) {
    server.registerTool(
      t.name,
      { description: t.description, inputSchema: t.inputSchema as any },
      async (args: any) => {
        try {
          return await (t.handler as any)(args ?? {});
        } catch (err: any) {
          logger.error("server", `tool ${t.name} failed: ${err?.message ?? err}`);
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: err?.message ?? String(err) }) }],
            isError: true,
          };
        }
      },
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  return {
    close: async () => {
      try {
        await server.close();
      } catch (err: any) {
        logger.warn("server", `close error: ${err?.message ?? err}`);
      }
    },
  };
}
