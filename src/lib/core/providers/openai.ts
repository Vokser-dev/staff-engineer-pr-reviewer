import OpenAI from "openai";

import { LLMClient } from "@/lib/core/llm";

const OPENAI_DEFAULT_MODEL = "gpt-4o";
const OPENAI_MAX_TOKENS = 8192;

export class OpenAILLMClient implements LLMClient {
  readonly supportsThinking = false;
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async complete(system: string, user: string): Promise<string> {
    const model =
      process.env.OPENAI_MODEL != null && process.env.OPENAI_MODEL !== ""
        ? process.env.OPENAI_MODEL
        : OPENAI_DEFAULT_MODEL;

    const response = await this.client.chat.completions.create({
      model,
      max_tokens: OPENAI_MAX_TOKENS,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (content == null) {
      throw new Error("No text content in OpenAI response");
    }
    return content;
  }
}
