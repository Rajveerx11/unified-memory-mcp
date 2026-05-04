import * as z from "zod/v4";
import { dataStore } from "../store/data-store.js";

export const getWeeklySummaryTool = {
  name: "get_weekly_summary",
  description:
    "Returns a synthesized weekly summary of recent activity, projects, and thinking across all sources.",
  inputSchema: { weeks_back: z.number().int().min(1).max(4).optional() },
  handler: async (_args: { weeks_back?: number }) => {
    const state = dataStore.getState();
    const summary = state.synthesis?.weeklySummary ?? "";
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          summary,
          generatedAt: state.synthesis?.generatedAt ?? null,
          synthesisAvailable: state.synthesis !== null,
          note: state.synthesis === null
            ? "Synthesis unavailable. Returning empty summary."
            : "weeks_back > 1 currently returns the most recent synthesis run.",
        }, null, 2),
      }],
    };
  },
};
