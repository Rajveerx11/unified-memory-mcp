import * as z from "zod/v4";
import { dataStore } from "../store/data-store.js";

export const getTodosTool = {
  name: "get_todos",
  description:
    "Returns consolidated to-do items from Obsidian vault, Claude Code sessions, and Claude memory. Includes source attribution.",
  inputSchema: {
    status: z.enum(["pending", "completed", "all"]).optional(),
    source: z.enum(["obsidian", "claudecode", "memory", "all"]).optional(),
  },
  handler: async (args: { status?: "pending" | "completed" | "all"; source?: "obsidian" | "claudecode" | "memory" | "all" }) => {
    const state = dataStore.getState();
    const status = args.status ?? "all";
    const source = args.source ?? "all";

    type Todo = { text: string; source: string; status: "pending" | "completed"; project?: string };
    const todos: Todo[] = [];

    if (source === "all" || source === "obsidian") {
      for (const note of state.rawSources.obsidian) {
        for (const t of note.todos) {
          todos.push({
            text: t.text,
            source: "obsidian",
            status: t.done ? "completed" : "pending",
            project: note.title,
          });
        }
      }
    }

    if (state.synthesis?.todos) {
      for (const t of state.synthesis.todos) {
        if (source !== "all" && source !== t.source) continue;
        if (source === "obsidian") continue;
        todos.push(t as Todo);
      }
    }

    const filtered = status === "all" ? todos : todos.filter((t) => t.status === status);

    return {
      content: [{ type: "text" as const, text: JSON.stringify({ todos: filtered, count: filtered.length }, null, 2) }],
    };
  },
};
