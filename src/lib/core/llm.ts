import { AnthropicLLMClient } from "@/lib/core/providers/anthropic";
import { OpenAILLMClient } from "@/lib/core/providers/openai";

export interface LLMClient {
  readonly supportsThinking: boolean;
  complete(system: string, user: string): Promise<string>;
}

function isThinkingEnabled(thinkingEnv: string | undefined): boolean {
  return (
    thinkingEnv != null &&
    thinkingEnv !== "" &&
    thinkingEnv !== "false" &&
    thinkingEnv !== "off" &&
    thinkingEnv !== "0"
  );
}

export function createLLMClient(): LLMClient {
  const provider = (process.env.LLM_PROVIDER ?? "anthropic").toLowerCase();

  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey == null || apiKey === "")
      throw new Error("Missing required environment variable: OPENAI_API_KEY");

    if (isThinkingEnabled(process.env.ANTHROPIC_THINKING)) {
      console.warn(
        "Warning: ANTHROPIC_THINKING is set but the openai provider does not support extended thinking. The setting will be ignored.",
      );
    }

    return new OpenAILLMClient(apiKey);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey == null || apiKey === "")
    throw new Error("Missing required environment variable: ANTHROPIC_API_KEY");

  return new AnthropicLLMClient(apiKey);
}
