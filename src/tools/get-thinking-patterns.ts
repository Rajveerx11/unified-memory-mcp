import { dataStore } from "../store/data-store.js";

export const getThinkingPatternsTool = {
  name: "get_thinking_patterns",
  description:
    "Returns analysis of recurring thinking patterns, problem-solving approaches, and cognitive tendencies based on conversation history and notes.",
  inputSchema: {},
  handler: async () => {
    const state = dataStore.getState();
    const patterns = state.synthesis?.thinkingPatterns ?? [];
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              patterns,
              synthesisAvailable: state.synthesis !== null,
              note:
                state.synthesis === null ? "Thinking layer has not run yet (likely no API key or no data)." : undefined,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
};
