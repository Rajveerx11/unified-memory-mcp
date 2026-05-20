import { dataStore } from "../store/data-store.js";

export const getInsightsTool = {
  name: "get_insights",
  description:
    "Returns AI-generated insights: connections between ideas, abandoned threads worth revisiting, emerging interests, and cross-source patterns.",
  inputSchema: {},
  handler: async () => {
    const state = dataStore.getState();
    const insights = state.synthesis?.insights ?? [];
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              insights,
              synthesisAvailable: state.synthesis !== null,
              generatedAt: state.synthesis?.generatedAt ?? null,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
};
