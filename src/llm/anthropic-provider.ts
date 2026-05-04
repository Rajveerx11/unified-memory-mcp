import Anthropic from "@anthropic-ai/sdk";
import { LLMProvider } from "./provider.js";

export interface AnthropicConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
}

export class AnthropicProvider implements LLMProvider {
  readonly kind = "anthropic" as const;
  readonly model: string;
  private cfg: AnthropicConfig;
  private client: Anthropic;

  constructor(cfg: AnthropicConfig) {
    this.cfg = cfg;
    this.model = cfg.model;
    this.client = new Anthropic({ apiKey: cfg.apiKey });
  }

  async isAvailable(): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (!this.cfg.apiKey || this.cfg.apiKey.length === 0) {
      return { ok: false, reason: "ANTHROPIC_API_KEY not set" };
    }
    return { ok: true };
  }

  async generate(systemPrompt: string, userPrompt: string): Promise<string> {
    const resp = await this.client.messages.create({
      model: this.cfg.model,
      max_tokens: this.cfg.maxTokens,
      temperature: this.cfg.temperature,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    const textBlock = resp.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("Anthropic response had no text block");
    }
    return textBlock.text;
  }
}
