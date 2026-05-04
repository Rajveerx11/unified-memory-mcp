import { logger } from "../logger.js";
import { Config } from "../config.js";
import { LLMProvider, NoopProvider } from "./provider.js";
import { OllamaProvider } from "./ollama-provider.js";
import { AnthropicProvider } from "./anthropic-provider.js";

export type ProviderKind = "ollama" | "anthropic";

class LLMRegistry {
  private active: LLMProvider = new NoopProvider();
  private config: Config | null = null;
  private lastSwitchAt: string | null = null;
  private lastSwitchReason: string | null = null;

  async init(config: Config): Promise<LLMProvider> {
    this.config = config;
    const preferred = config.llm.provider;
    const fallback: ProviderKind = preferred === "ollama" ? "anthropic" : "ollama";

    const primary = this.build(preferred, undefined);
    const primaryCheck = await primary.isAvailable();
    if (primaryCheck.ok) {
      this.active = primary;
      this.lastSwitchAt = new Date().toISOString();
      this.lastSwitchReason = "config default";
      logger.info("llm", `LLM Provider: ${primary.kind} (${primary.model})${primary.kind === "ollama" ? " — local" : ""}`);
      return primary;
    }

    logger.warn("llm", `${primary.kind} not available: ${primaryCheck.reason}`);
    logger.warn("llm", `falling back to ${fallback}`);

    const second = this.build(fallback, undefined);
    const secondCheck = await second.isAvailable();
    if (secondCheck.ok) {
      this.active = second;
      this.lastSwitchAt = new Date().toISOString();
      this.lastSwitchReason = `fallback from ${primary.kind} (${primaryCheck.reason})`;
      logger.info("llm", `LLM Provider: ${second.kind} (${second.model})${second.kind === "ollama" ? " — local" : ""}`);
      return second;
    }

    logger.warn("llm", `${second.kind} also unavailable: ${secondCheck.reason}`);
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
