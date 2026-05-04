import * as z from "zod/v4";
import { llmRegistry } from "../llm/index.js";

export const switchProviderTool = {
  name: "switch_provider",
  description:
    "Switch the active LLM provider at runtime. Changes take effect immediately for the next thinking layer run. Does not persist to config.json — restart reverts to config default.",
  inputSchema: {
    provider: z.enum(["ollama", "ollama-cloud", "anthropic"]),
    model: z.string().optional().describe("Optional model override (otherwise uses config model for that provider)"),
  },
  handler: async (args: { provider: "ollama" | "ollama-cloud" | "anthropic"; model?: string }) => {
    const result = await llmRegistry.switchTo(args.provider, args.model);
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(
          {
            switched: result.ok,
            reason: result.reason,
            activeProvider: llmRegistry.getStatus(),
            requested: result.provider,
          },
          null,
          2,
        ),
      }],
      isError: !result.ok,
    };
  },
};
