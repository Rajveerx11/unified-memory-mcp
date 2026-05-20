import { dataStore } from "../store/data-store.js";

export const getDashboardDataTool = {
  name: "get_dashboard_data",
  description:
    "Returns all dashboard data in a single call — projects, todos, recent insights, and weekly summary. Optimized for rendering a dashboard view.",
  inputSchema: {},
  handler: async () => {
    const state = dataStore.getState();
    const synthesis = state.synthesis;

    const obsidianTodos = state.rawSources.obsidian
      .flatMap((n) =>
        n.todos.map((t) => ({
          text: t.text,
          source: "obsidian" as const,
          status: (t.done ? "completed" : "pending") as "pending" | "completed",
          project: n.title,
        })),
      )
      .filter((t) => t.status === "pending");

    const synthesisTodos = (synthesis?.todos ?? []).filter((t) => t.status === "pending" && t.source !== "obsidian");

    const dashboard = {
      projects: synthesis?.activeProjects ?? [],
      todos: [...obsidianTodos, ...synthesisTodos],
      insights: synthesis?.insights ?? [],
      weeklySummary: synthesis?.weeklySummary ?? "",
      generatedAt: synthesis?.generatedAt ?? null,
      lastUpdated: state.lastUpdated,
      synthesisAvailable: synthesis !== null,
      sourceCounts: {
        claudeCode: state.rawSources.claudeCode.length,
        obsidian: state.rawSources.obsidian.length,
        memory: state.rawSources.memory.length,
      },
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(dashboard, null, 2) }],
    };
  },
};
