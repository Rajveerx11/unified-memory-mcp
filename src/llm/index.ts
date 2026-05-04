import { logger } from "../logger.js";
import { Config } from "../config.js";
import { LLMProvider, NoopProvider } from "./provider.js";
import { OllamaProvider } from "./ollama-provider.js";
import { OllamaCloudProvider } from "./ollama-cloud-provider.js";
import { AnthropicProvider } from "./anthropic-provider.js";

export type ProviderKind = "ollama" | "ollama-cloud" | "anthropic";

const ALL_KINDS: ProviderKind[] = ["ollama", "ollama-cloud", "anthropic"];

function localTag(kind: string): string {
  return kind === "ollama" ? " — local" : kind === "ollama-cloud" ? " — cloud" : "";
}

class LLMRegistry {
  private active: LLMProvider = new NoopProvider();
  private config: Config | null = null;
  private lastSwitchAt: string | null = null;
  private lastSwitchReason: string | null = null;

  async init(config: Config): Promise<LLMProvider> {
    this.config = config;
    const preferred = config.llm.provider;
    const order: ProviderKind[] = [preferred, ...ALL_KINDS.filter((k) => k !== preferred)];

    let firstReason: string | null = null;
    let firstKind: ProviderKind | null = null;
    for (const kind of order) {
      const p = this.build(kind, undefined);
      const check = await p.isAvailable();
      if (check.ok) {
        this.active = p;
        this.lastSwitchAt = new Date().toISOString();
        this.lastSwitchReason = kind === preferred
          ? "config default"
          : `fallback from ${firstKind} (${firstReason})`;
        logger.info("llm", `LLM Provider: ${p.kind} (${p.model})${localTag(p.kind)}`);
        return p;
      }
      logger.warn("llm", `${p.kind} not available: ${check.reason}`);
      if (firstReason === null) {
        firstReason = check.reason;
        firstKind = kind;
      }
      const next = order[order.indexOf(kind) + 1];
      if (next) logger.warn("llm", `falling back to ${next}`);
    }

    logger.warn("llm", "no LLM provider available — synthesis disabled, raw data still served");
    this.active = new NoopProvider();
    this.lastSwitchAt = new Date().toISOString();
    this.lastSwitchReason = "no provider available";
    return this.active;
  }

  private build(kind: ProviderKind, modelOverride: string | undefined): LLMProvider {
    if (!this.config) throw new Error("registry not initialized");
    if (kind === "ollama") {
      const c = this.config.llm.ollama;
      return new OllamaProvider({
        baseUrl: c.baseUrl,
        model: modelOverride ?? c.model,
        contextWindow: c.contextWindow,
        temperature: c.temperature,
        timeout: c.timeout,
      });
    }
    if (kind === "ollama-cloud") {
      const c = this.config.llm.ollamaCloud;
      return new OllamaCloudProvider({
        baseUrl: c.baseUrl,
        apiKey: c.resolvedApiKey ?? "",
        model: modelOverride ?? c.model,
        temperature: c.temperature,
        timeout: c.timeout,
      });
    }
    const a = this.config.llm.anthropic;
    return new AnthropicProvider({
      apiKey: a.resolvedApiKey ?? "",
      model: modelOverride ?? a.model,
      maxTokens: a.maxTokens,
      temperature: a.temperature,
    });
  }

  getActive(): LLMProvider {
    return this.active;
  }

  getStatus(): { kind: string; model: string; lastSwitchAt: string | null; lastSwitchReason: string | null } {
    return {
      kind: this.active.kind,
      model: this.active.model,
      lastSwitchAt: this.lastSwitchAt,
      lastSwitchReason: this.lastSwitchReason,
    };
  }

  async switchTo(kind: ProviderKind, modelOverride?: string): Promise<{ ok: boolean; reason: string; provider: { kind: string; model: string } }> {
    if (!this.config) throw new Error("registry not initialized");
    const candidate = this.build(kind, modelOverride);
    const check = await candidate.isAvailable();
    if (!check.ok) {
      return { ok: false, reason: check.reason, provider: { kind: candidate.kind, model: candidate.model } };
    }
    this.active = candidate;
    this.lastSwitchAt = new Date().toISOString();
    this.lastSwitchReason = `manual switch via switch_provider tool`;
    logger.info("llm", `switched provider: ${candidate.kind} (${candidate.model})`);
    return { ok: true, reason: "switched", provider: { kind: candidate.kind, model: candidate.model } };
  }
}

export const llmRegistry = new LLMRegistry();
