import * as z from "zod/v4";
import { dataStore } from "../store/data-store.js";
import { tokenize } from "../utils/helpers.js";

interface SearchableDoc {
  id: string;
  source: "obsidian" | "claudecode" | "memory" | "synthesis";
  title: string;
  tags: string[];
  content: string;
  modified: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function buildIndex(): SearchableDoc[] {
  const state = dataStore.getState();
  const docs: SearchableDoc[] = [];

  for (const n of state.rawSources.obsidian) {
    docs.push({
      id: n.path,
      source: "obsidian",
      title: n.title,
      tags: n.tags,
      content: n.fullText,
      modified: Date.parse(n.modified),
    });
  }

  for (const s of state.rawSources.claudeCode) {
    const ts = s.lastTimestamp ?? s.fileMtime;
    const text = s.turns.map((t) => `${t.role}: ${t.text}`).join("\n");
    docs.push({
      id: `${s.project}/${s.sessionId}`,
      source: "claudecode",
      title: `${s.project} (${s.sessionId.slice(0, 8)})`,
      tags: [],
      content: text,
      modified: Date.parse(ts),
    });
  }

  for (const m of state.rawSources.memory) {
    for (const c of m.conversations) {
      docs.push({
        id: `${m.source}#${c.title}`,
        source: "memory",
        title: c.title,
        tags: [],
        content: c.snippet,
        modified: c.updated ? Date.parse(c.updated) : 0,
      });
    }
  }

  if (state.synthesis) {
    docs.push({
      id: "synthesis/weeklySummary",
      source: "synthesis",
      title: "Weekly Summary",
      tags: [],
      content: state.synthesis.weeklySummary,
      modified: Date.parse(state.synthesis.generatedAt),
    });
    for (const ins of state.synthesis.insights) {
      docs.push({
        id: `synthesis/insight/${ins.category}`,
        source: "synthesis",
        title: `Insight: ${ins.category}`,
        tags: [],
        content: ins.insight,
        modified: Date.parse(state.synthesis.generatedAt),
      });
    }
  }

  return docs;
}

function snippetFor(content: string, queryTokens: string[]): string {
  if (content.length === 0) return "";
  const lower = content.toLowerCase();
  let bestPos = 0;
  let bestHits = 0;
  const window = 200;
  const step = 50;
  for (let i = 0; i < lower.length; i += step) {
    const slice = lower.slice(i, i + window);
    let hits = 0;
    for (const t of queryTokens) if (slice.includes(t)) hits++;
    if (hits > bestHits) {
      bestHits = hits;
      bestPos = i;
    }
  }
  return content.slice(bestPos, bestPos + window).trim();
}

function score(doc: SearchableDoc, query: string, queryTokens: string[]): number {
  let s = 0;
  const titleLower = doc.title.toLowerCase();
  const contentLower = doc.content.toLowerCase();
  const queryLower = query.toLowerCase();

  if (titleLower.includes(queryLower)) s += 10;
  for (const t of queryTokens) {
    if (titleLower.includes(t)) s += 5;
    let occurrences = 0;
    let idx = 0;
    while ((idx = contentLower.indexOf(t, idx)) !== -1) {
      occurrences++;
      idx += t.length;
      if (occurrences >= 5) break;
    }
    s += occurrences;
    for (const tag of doc.tags) {
      if (tag.toLowerCase().includes(t)) s += 3;
    }
  }
  if (Date.now() - doc.modified < 7 * DAY_MS) s += 3;
  return s;
}

export const searchBrainTool = {
  name: "search_brain",
  description:
    "Weighted keyword search across all ingested data. Searches projects, notes, conversations, and insights.",
  inputSchema: {
    query: z.string().min(1),
    source: z.enum(["all", "obsidian", "claudecode", "memory"]).optional(),
  },
  handler: async (args: { query: string; source?: "all" | "obsidian" | "claudecode" | "memory" }) => {
    const docs = buildIndex();
    const tokens = tokenize(args.query);
    const sourceFilter = args.source ?? "all";
    const filtered = sourceFilter === "all" ? docs : docs.filter((d) => d.source === sourceFilter);

    const scored = filtered
      .map((d) => ({ doc: d, score: score(d, args.query, tokens) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map((r) => ({
        id: r.doc.id,
        source: r.doc.source,
        title: r.doc.title,
        score: r.score,
        snippet: snippetFor(r.doc.content, tokens),
      }));

    return {
      content: [{ type: "text" as const, text: JSON.stringify({ results: scored, query: args.query }, null, 2) }],
    };
  },
};
