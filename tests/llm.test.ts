import { createLLMClient } from "@/lib/core/llm";

describe("createLLMClient", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should throw if LLM_PROVIDER is anthropic and ANTHROPIC_API_KEY is missing", () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.LLM_PROVIDER;
    expect(() => createLLMClient()).toThrow("ANTHROPIC_API_KEY");
  });

  it("should throw if LLM_PROVIDER is openai and OPENAI_API_KEY is missing", () => {
    process.env.LLM_PROVIDER = "openai";
    delete process.env.OPENAI_API_KEY;
    expect(() => createLLMClient()).toThrow("OPENAI_API_KEY");
  });

  it("should return a client with supportsThinking=true for the anthropic provider", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    delete process.env.LLM_PROVIDER;
    const client = createLLMClient();
    expect(client.supportsThinking).toBe(true);
  });

  it("should return a client with supportsThinking=false for the openai provider", () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test-key";
    const client = createLLMClient();
    expect(client.supportsThinking).toBe(false);
  });

  it("should warn when ANTHROPIC_THINKING is set with the openai provider", () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test-key";
    process.env.ANTHROPIC_THINKING = "2048";
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    createLLMClient();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("extended thinking"));
    warnSpy.mockRestore();
  });

  it("should not warn when ANTHROPIC_THINKING is set with the anthropic provider", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.ANTHROPIC_THINKING = "2048";
    delete process.env.LLM_PROVIDER;
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    createLLMClient();

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("should default to anthropic when LLM_PROVIDER is not set", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    delete process.env.LLM_PROVIDER;
    const client = createLLMClient();
    expect(client.supportsThinking).toBe(true);
  });
});
