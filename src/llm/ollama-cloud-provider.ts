import { logger } from "../logger.js";
import { LLMProvider } from "./provider.js";

export interface OllamaCloudConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  timeout: number;
}

interface OpenAIModelsResponse {
  data?: Array<{ id?: string }>;
  error?: { message?: string };
}

interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

function trimSlash(u: string): string {
  return u.replace(/\/$/, "");
}

export class OllamaCloudProvider implements LLMProvider {
  readonly kind = "ollama-cloud" as const;
  readonly model: string;
  private cfg: OllamaCloudConfig;

  constructor(cfg: OllamaCloudConfig) {
    this.cfg = cfg;
    this.model = cfg.model;
  }

  async isAvailable(): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (!this.cfg.apiKey) {
      return { ok: false, reason: "OLLAMA_API_KEY not set" };
    }
    const url = `${trimSlash(this.cfg.baseUrl)}/v1/models`;
    let res: Response;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      res = await fetch(url, {
        signal: ctrl.signal,
        headers: { Authorization: `Bearer ${this.cfg.apiKey}` },
      });
      clearTimeout(t);
    } catch (err: any) {
      return { ok: false, reason: `Ollama Cloud unreachable at ${this.cfg.baseUrl} (${err?.message ?? err})` };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: `Ollama Cloud auth failed (HTTP ${res.status}) — check OLLAMA_API_KEY` };
    }
    if (!res.ok) {
      return { ok: false, reason: `Ollama Cloud returned HTTP ${res.status}` };
    }
    let body: OpenAIModelsResponse;
    try {
      body = (await res.json()) as OpenAIModelsResponse;
    } catch {
      return { ok: false, reason: "Ollama Cloud /v1/models response not JSON" };
    }
    if (body.error) {
      return { ok: false, reason: `Ollama Cloud error: ${body.error.message ?? "unknown"}` };
    }
    const ids = (body.data ?? []).map((m) => m.id ?? "").filter(Boolean);
    if (ids.length === 0) {
      return { ok: true };
    }
    const found = ids.some(
      (id) => id === this.cfg.model || id.startsWith(`${this.cfg.model}:`) || id.startsWith(`${this.cfg.model}-`),
    );
    if (!found) {
      return {
        ok: false,
        reason: `Model '${this.cfg.model}' not listed by Ollama Cloud (saw ${ids.length} models). Pick one from https://ollama.com/search?c=cloud`,
      };
    }
    return { ok: true };
  }

  async generate(systemPrompt: string, userPrompt: string): Promise<string> {
    const url = `${trimSlash(this.cfg.baseUrl)}/v1/chat/completions`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.cfg.timeout);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.cfg.apiKey}`,
        },
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
        throw new Error(`Ollama Cloud HTTP ${res.status}: ${text.slice(0, 300)}`);
      }
      const body = (await res.json()) as OpenAIChatResponse;
      if (body.error) throw new Error(`Ollama Cloud error: ${body.error.message ?? "unknown"}`);
      const content = body.choices?.[0]?.message?.content ?? "";
      if (!content) throw new Error("Ollama Cloud returned empty content");
      return content;
    } catch (err: any) {
      if (err?.name === "AbortError") {
        logger.warn("ollama-cloud", `request timed out after ${this.cfg.timeout}ms`);
        throw new Error(`Ollama Cloud request timed out after ${this.cfg.timeout}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
