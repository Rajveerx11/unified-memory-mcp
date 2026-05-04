import * as z from "zod/v4";
import { dataStore } from "../store/data-store.js";

export const getProjectsTool = {
  name: "get_projects",
  description:
    "Returns active projects with status, recent activity, and suggested next steps. Derived from Claude Code sessions, Obsidian notes, and Claude memory.",
  inputSchema: { filter: z.string().optional().describe("Optional substring filter on project name or status") },
  handler: async (args: { filter?: string }) => {
    const state = dataStore.getState();
    let projects = state.synthesis?.activeProjects ?? [];

    if (projects.length === 0 && state.rawSources.claudeCode.length > 0) {
      const seen = new Map<string, { name: string; status: string; nextSteps: string[]; sources: string[] }>();
      for (const s of state.rawSources.claudeCode) {
        const key = s.project;
        if (!seen.has(key)) {
          seen.set(key, {
            name: s.cwd ?? key,
            status: `last activity ${s.lastTimestamp ?? s.fileMtime}`,
            nextSteps: [],
            sources: ["claudecode"],
          });
        }
      }
      projects = [...seen.values()];
    }

    if (args.filter) {
      const f = args.filter.toLowerCase();
      projects = projects.filter(
        (p) => p.name.toLowerCase().includes(f) || p.status.toLowerCase().includes(f),
      );
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify({ projects, synthesisAvailable: state.synthesis !== null }, null, 2) }],
    };
  },
};
