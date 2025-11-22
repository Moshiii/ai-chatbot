import type { ModelMessage } from "ai";

export const TEST_PROMPTS: Record<string, ModelMessage> = {
  USER_ANP_INTRO: {
    role: "user",
    content: [{ type: "text", text: "What is the Agent Network Protocol (ANP)?" }],
  },
  USER_ANP_BENEFITS: {
    role: "user",
    content: [{ type: "text", text: "How does ANP benefit intelligent agent networks?" }],
  },
  USER_ANP_USE_CASES: {
    role: "user",
    content: [{ type: "text", text: "What are some practical use cases of ANP?" }],
  },
  USER_ANP_SECURITY: {
    role: "user",
    content: [{ type: "text", text: "How does ANP ensure secure communication between agents?" }],
  },
};
