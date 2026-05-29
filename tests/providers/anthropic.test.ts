import Anthropic from "@anthropic-ai/sdk";

import { AnthropicLLMClient } from "@/lib/core/providers/anthropic";

describe("AnthropicLLMClient", () => {
  let mockMessages: {
    create: jest.Mock<Promise<unknown>, [Anthropic.MessageCreateParamsNonStreaming]>;
  };
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    mockMessages = {
      create: jest
        .fn<Promise<unknown>, [Anthropic.MessageCreateParamsNonStreaming]>()
        .mockResolvedValue({
          content: [{ type: "text", text: "En kjempefin PR!" }],
        }),
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function makeClient(): AnthropicLLMClient {
    const client = new AnthropicLLMClient("test-key");
    (client as unknown as { client: { messages: typeof mockMessages } }).client = {
      messages: mockMessages,
    };
    return client;
  }

  it("should declare supportsThinking = true", () => {
    const client = makeClient();
    expect(client.supportsThinking).toBe(true);
  });

  it("should call messages.create with cache_control on the system block", async () => {
    const client = makeClient();
    await client.complete("System prompt", "User prompt");

    expect(mockMessages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        system: [
          expect.objectContaining({
            type: "text",
            text: "System prompt",
            cache_control: { type: "ephemeral" },
          }),
        ],
      }),
    );
  });

  it("should not include thinking or temperature by default", async () => {
    const client = makeClient();
    await client.complete("System", "User");

    const args = mockMessages.create.mock.calls[0][0];
    expect(args.thinking).toBeUndefined();
    expect(args.temperature).toBeUndefined();
  });

  it("should enable thinking with budget 2048 and temperature 1.0 when ANTHROPIC_THINKING is truthy", async () => {
    process.env.ANTHROPIC_THINKING = "true";
    const client = makeClient();
    await client.complete("System", "User");

    const args = mockMessages.create.mock.calls[0][0];
    expect(args.thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
    expect(args.temperature).toBe(1.0);
  });

  it("should use a custom numeric budget when ANTHROPIC_THINKING is a valid number >= 1024", async () => {
    process.env.ANTHROPIC_THINKING = "4096";
    const client = makeClient();
    await client.complete("System", "User");

    const args = mockMessages.create.mock.calls[0][0];
    expect(args.thinking).toEqual({ type: "enabled", budget_tokens: 4096 });
  });

  it("should fall back to budget 2048 when ANTHROPIC_THINKING is a number < 1024", async () => {
    process.env.ANTHROPIC_THINKING = "500";
    const client = makeClient();
    await client.complete("System", "User");

    const args = mockMessages.create.mock.calls[0][0];
    expect(args.thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
  });

  it("should disable thinking when ANTHROPIC_THINKING is false, off, or 0", async () => {
    for (const val of ["false", "off", "0"]) {
      process.env.ANTHROPIC_THINKING = val;
      mockMessages.create.mockClear();
      const client = makeClient();
      await client.complete("System", "User");

      const args = mockMessages.create.mock.calls[0][0];
      expect(args.thinking).toBeUndefined();
      expect(args.temperature).toBeUndefined();
    }
  });

  it("should use ANTHROPIC_MODEL env var when set", async () => {
    process.env.ANTHROPIC_MODEL = "claude-opus-4-7-20251001";
    const client = makeClient();
    await client.complete("System", "User");

    const args = mockMessages.create.mock.calls[0][0];
    expect(args.model).toBe("claude-opus-4-7-20251001");
  });

  it("should return the text from the response content block", async () => {
    const client = makeClient();
    const result = await client.complete("System", "User");
    expect(result).toBe("En kjempefin PR!");
  });

  it("should throw if the response contains no text block", async () => {
    mockMessages.create.mockResolvedValue({ content: [] });
    const client = makeClient();
    await expect(client.complete("System", "User")).rejects.toThrow(
      "No text content in Anthropic response",
    );
  });
});
