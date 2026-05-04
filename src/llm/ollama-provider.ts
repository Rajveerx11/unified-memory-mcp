import { logger } from "../logger.js";
import { LLMProvider } from "./provider.js";

export interface OllamaConfig {
  baseUrl: string;
  model: string;
  contextWindow: number;
  temperature: number;
  timeout: number;
}

interface OllamaTagsResponse {
  models?: Array<{ name?: string; model?: string }>;
}

interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

export class OllamaProvider implements LLMProvider {
  readonly kind = "ollama" as const;
  readonly model: string;
  private cfg: OllamaConfig;

  constructor(cfg: OllamaConfig) {
    this.cfg = cfg;
    this.model = cfg.model;
  }

  async isAvailable(): Promise<{ ok: true } | { ok: false; reason: string }> {
    const tagsUrl = `${this.cfg.baseUrl.replace(/\/$/, "")}/api/tags`;
    let res: Response;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3000);
      res = await fetch(tagsUrl, { signal: ctrl.signal });
      clearTimeout(t);
    } catch (err: any) {
      return { ok: false, reason: `Ollama not reachable at ${this.cfg.baseUrl} (${err?.message ?? err})` };
    }
    if (!res.ok) return { ok: false, reason: `Ollama returned HTTP ${res.status}` };
    let body: OllamaTagsResponse;
    try {
      body = (await res.json()) as OllamaTagsResponse;
    } catch {
      return { ok: false, reason: "Ollama tags response not JSON" };
    }
    const names = (body.models ?? []).map((m) => m.name ?? m.model ?? "").filter(Boolean);
    const found = names.some((n) => n === this.cfg.model || n.startsWith(`${this.cfg.model}:`));
    if (!found) {
      return {
        ok: false,
        reason: `Model '${this.cfg.model}' not found in Ollama. Run: ollama pull ${this.cfg.model}`,
      };
    }
    return { ok: true };
  }

  async generate(systemPrompt: string, userPrompt: string): Promise<string> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.cfg.timeout);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.cfg.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: this.cfg.temperature,
          stream: false,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Ollama HTTP ${res.status}: ${text.slice(0, 300)}`);
      }
      const body = (await res.json()) as OpenAIChatResponse;
      if (body.error) throw new Error(`Ollama error: ${body.error.message ?? "unknown"}`);
      const content = body.choices?.[0]?.message?.content ?? "";
      if (!content) throw new Error("Ollama returned empty content");
      return content;
    } catch (err: any) {
      if (err?.name === "AbortError") {
        logger.warn("ollama", `request timed out after ${this.cfg.timeout}ms`);
        throw new Error(`Ollama request timed out after ${this.cfg.timeout}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
