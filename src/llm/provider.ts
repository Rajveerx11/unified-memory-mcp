export interface LLMProvider {
  readonly kind: "ollama" | "anthropic" | "noop";
  readonly model: string;
  generate(systemPrompt: string, userPrompt: string): Promise<string>;
  isAvailable(): Promise<{ ok: true } | { ok: false; reason: string }>;
}

export class NoopProvider implements LLMProvider {
  readonly kind = "noop" as const;
  readonly model = "none";
  async generate(): Promise<string> {
    throw new Error("no LLM provider available — synthesis disabled");
  }
  async isAvailable() {
    return { ok: false as const, reason: "noop provider" };
  }
}
