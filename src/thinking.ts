import { logger } from "./logger.js";
import { Config } from "./config.js";
import { dataStore, BrainState, Synthesis } from "./store/data-store.js";
import { archiveJson } from "./utils/archive.js";
import { llmRegistry } from "./llm/index.js";

const MAX_THINKING_INPUT_CHARS = 300_000;
const DAY_MS = 24 * 60 * 60 * 1000;

interface AggregatedInput {
  truncated: boolean;
  payload: string;
}

function tierAndTrim(state: BrainState): AggregatedInput {
  const now = Date.now();
  const sevenDays = now - 7 * DAY_MS;
  const fourteenDays = now - 14 * DAY_MS;
  const thirtyDays = now - 30 * DAY_MS;

  const ccRecent: any[] = [];
  const ccMid: any[] = [];
  for (const s of state.rawSources.claudeCode) {
    const t = s.lastTimestamp ? Date.parse(s.lastTimestamp) : Date.parse(s.fileMtime);
    const turns = s.turns.map((t2) => `${t2.role}: ${t2.text}`).join("\n");
    const full = { project: s.project, sessionId: s.sessionId, lastTimestamp: s.lastTimestamp, turns };
    if (t >= sevenDays) ccRecent.push(full);
    else if (t >= thirtyDays) ccMid.push({ project: s.project, sessionId: s.sessionId, lastTimestamp: s.lastTimestamp, snippet: turns.slice(0, 200) });
  }

  const obFull: any[] = [];
  const obShort: any[] = [];
  for (const n of state.rawSources.obsidian) {
    const t = Date.parse(n.modified);
    if (t >= fourteenDays) {
      obFull.push({ path: n.path, title: n.title, tags: n.tags, todos: n.todos, content: n.fullText });
    } else {
      obShort.push({ path: n.path, title: n.title, tags: n.tags, snippet: n.fullText.slice(0, 100) });
    }
  }

  const memory = state.rawSources.memory.map((m) => ({
    source: m.source,
    conversations: m.conversations,
    raw: m.raw,
  }));

  const tiers = [
    { name: "memory", data: memory },
    { name: "claudeCodeRecent", data: ccRecent },
    { name: "obsidianRecent", data: obFull },
    { name: "claudeCodeMid", data: ccMid },
    { name: "obsidianOld", data: obShort },
  ];

  let truncated = false;
  let payload: Record<string, unknown> = {};
  for (let i = tiers.length; i > 0; i--) {
    payload = {};
    for (let j = 0; j < i; j++) {
      payload[tiers[j].name] = tiers[j].data;
    }
    const text = JSON.stringify(payload);
    if (text.length <= MAX_THINKING_INPUT_CHARS || i === 1) {
      truncated = i < tiers.length;
      if (truncated) {
        logger.warn("thinking", `input truncated, kept ${i}/${tiers.length} tiers (${text.length} chars)`);
      }
      return { truncated, payload: text };
    }
  }
  return { truncated: true, payload: JSON.stringify(payload).slice(0, MAX_THINKING_INPUT_CHARS) };
}

const EXAMPLE_OUTPUT = `{
  "activeProjects": [
    { "name": "Axon Landing Page", "status": "in progress, working on hero copy", "nextSteps": ["finalize hero text", "ship to staging"], "sources": ["claudecode"] }
  ],
  "thinkingPatterns": [
    { "category": "problem decomposition", "description": "Tends to break problems into 3-step plans before coding", "examples": ["explored repo before editing in Axon project"] }
  ],
  "todos": [
    { "text": "Finalize hero text", "source": "claudecode", "status": "pending", "project": "Axon Landing Page" }
  ],
  "insights": [
    { "category": "cross-project", "insight": "MCP server work and Obsidian todo extraction share a parser pattern", "sources": ["claudecode", "obsidian"] }
  ],
  "weeklySummary": "Spent the week building a local MCP server...\\n\\nAlso revisited the Axon landing page hero copy..."
}`;

const BASE_SYSTEM_PROMPT = `You are a "second brain" synthesis engine. You receive aggregated parsed data from three sources about a single user:
- memory: conversation history exported from claude.ai
- claudeCode: recent and older coding session turns from Claude Code
- obsidian: notes from the user's Obsidian vault

Some older content may be omitted for context budget. Do NOT infer inactivity from absence — only what is present.

Analyze the combined data and emit STRICT JSON with exactly these top-level keys:
- "activeProjects": array of { name, status, nextSteps[], sources[] }
- "thinkingPatterns": array of { category, description, examples[] }
- "todos": array of { text, source ("obsidian"|"claudecode"|"memory"), status ("pending"|"completed"), project }
- "insights": array of { category, insight, sources[] }
- "weeklySummary": string (3-6 paragraphs of plain markdown)

Example of valid output:
${EXAMPLE_OUTPUT}

Rules:
- Respond ONLY with valid JSON. No markdown fences, no preamble, no explanation outside the JSON.
- "todos" should pull explicit todos from Obsidian (- [ ] / - [x]) AND implied tasks from conversations.
- "insights" should highlight cross-source connections, abandoned threads, emerging interests.`;

const STRICT_RETRY_PROMPT = `${BASE_SYSTEM_PROMPT}

CRITICAL: Your previous response was not valid JSON. Output ONLY the JSON object, starting with { and ending with }. Do NOT wrap in code fences. Do NOT add any text before or after the JSON.`;

function tryParseJson(text: string): Synthesis | null {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, "").replace(/```\s*$/, "").trim();
  }
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1) return null;
  cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  try {
    const obj = JSON.parse(cleaned);
    return {
      generatedAt: new Date().toISOString(),
      activeProjects: Array.isArray(obj.activeProjects) ? obj.activeProjects : [],
      thinkingPatterns: Array.isArray(obj.thinkingPatterns) ? obj.thinkingPatterns : [],
      todos: Array.isArray(obj.todos) ? obj.todos : [],
      insights: Array.isArray(obj.insights) ? obj.insights : [],
      weeklySummary: typeof obj.weeklySummary === "string" ? obj.weeklySummary : "",
      truncated: false,
    };
  } catch {
    return null;
  }
}

export async function runThinkingLayer(_config: Config): Promise<Synthesis | null> {
  const provider = llmRegistry.getActive();
  if (provider.kind === "noop") {
    logger.warn("thinking", "no LLM provider active — synthesis disabled");
    return null;
  }

  const state = dataStore.getState();
  const totalItems =
    state.rawSources.claudeCode.length +
    state.rawSources.obsidian.length +
    state.rawSources.memory.length;
  if (totalItems === 0) {
    logger.info("thinking", "no source data yet — skipping synthesis");
    return null;
  }

  const { payload, truncated } = tierAndTrim(state);
  logger.info("thinking", `calling ${provider.kind}/${provider.model}, payload ${payload.length} chars`);

  const prompts = [BASE_SYSTEM_PROMPT, STRICT_RETRY_PROMPT, STRICT_RETRY_PROMPT];
  let lastErr: unknown = null;

  for (let attempt = 0; attempt < prompts.length; attempt++) {
    try {
      const text = await provider.generate(prompts[attempt], payload);
      const synth = tryParseJson(text);
      if (synth) {
        synth.truncated = truncated;
        await archiveJson(_config.archivePath, "synthesis", "synthesis", synth);
        logger.info(
          "thinking",
          `synthesis ok via ${provider.kind}/${provider.model} (${synth.activeProjects.length} projects, ${synth.todos.length} todos)`,
        );
        return synth;
      }
      lastErr = new Error(`attempt ${attempt + 1}: response was not valid JSON`);
      logger.warn("thinking", `${provider.kind} returned non-JSON on attempt ${attempt + 1}, retrying with stricter prompt`);
    } catch (err: any) {
      lastErr = err;
      logger.warn("thinking", `attempt ${attempt + 1} failed: ${err?.message ?? err}`);
    }
  }

  logger.error("thinking", `synthesis failed after ${prompts.length} attempts: ${(lastErr as any)?.message ?? lastErr}`);
  return null;
}
