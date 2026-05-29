import Anthropic from "@anthropic-ai/sdk";

import { LLMClient } from "@/lib/core/llm";
import { getThinkingParameters, MAX_TOKENS, MODEL } from "@/lib/core/prompt";

export class AnthropicLLMClient implements LLMClient {
  readonly supportsThinking = true;
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(system: string, user: string): Promise<string> {
    const extraParams = getThinkingParameters(process.env.ANTHROPIC_THINKING);
    const model =
      process.env.ANTHROPIC_MODEL != null && process.env.ANTHROPIC_MODEL !== ""
        ? process.env.ANTHROPIC_MODEL
        : MODEL;

    const message = await this.client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
      ...extraParams,
    });

    const textBlock = message.content.find((b) => b.type === "text");
    if (textBlock == null || textBlock.type !== "text") {
      throw new Error("No text content in Anthropic response");
    }
    return textBlock.text;
  }
}
