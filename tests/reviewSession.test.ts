import { PullRequestContext, ReviewComment } from "@/lib/core/prompt";
import { ReviewHost, ReviewFunction, runReviewSession } from "@/lib/core/reviewSession";

describe("runReviewSession", () => {
  let mockContext: PullRequestContext;
  let mockComments: ReviewComment[];

  beforeEach(() => {
    mockContext = {
      title: "Fix bug",
      description: "Fixes a minor issue",
      author: "mortena",
      baseBranch: "main",
      headBranch: "feature",
      files: [],
    };

    mockComments = [
      {
        filename: "src/main.ts",
        line: 10,
        severity: "critical",
        body: "Feil her.",
      },
    ];
  });

  it("should post summary on a clean review (inline disabled)", async () => {
    const calls: string[] = [];
    const host: ReviewHost = {
      fetchContext() {
        calls.push("fetchContext");
        return Promise.resolve(mockContext);
      },
      publishSummary(markdown) {
        calls.push(`publishSummary:${markdown}`);
        return Promise.resolve();
      },
      publishInline() {
        calls.push("publishInline");
        return Promise.resolve(0);
      },
    };

    const reviewFn: ReviewFunction = (pr, options) => {
      calls.push(`reviewFn:requestInlineComments=${!!options?.requestInlineComments}`);
      expect(options?.requestInlineComments).toBe(false);
      return Promise.resolve({ markdown: "Flott PR", inlineComments: [] });
    };

    await runReviewSession(host, reviewFn, { inline: false });

    expect(calls).toEqual([
      "fetchContext",
      "reviewFn:requestInlineComments=false",
      "publishSummary:Flott PR",
    ]);
  });

  it("should not call publishInline if inline requested but no comments returned", async () => {
    const calls: string[] = [];
    const host: ReviewHost = {
      fetchContext() {
        return Promise.resolve(mockContext);
      },
      publishSummary(markdown) {
        calls.push(`publishSummary:${markdown}`);
        return Promise.resolve();
      },
      publishInline() {
        calls.push("publishInline");
        return Promise.resolve(0);
      },
    };

    const reviewFn: ReviewFunction = () => {
      return Promise.resolve({ markdown: "Okey", inlineComments: [] });
    };

    await runReviewSession(host, reviewFn, { inline: true });

    expect(calls).toEqual(["publishSummary:Okey"]);
  });

  it("should publish summary first, then inline comments in order", async () => {
    const calls: string[] = [];
    const host: ReviewHost = {
      fetchContext() {
        return Promise.resolve(mockContext);
      },
      publishSummary(markdown) {
        calls.push(`publishSummary:${markdown}`);
        return Promise.resolve();
      },
      publishInline(comments) {
        calls.push(`publishInline:${comments.length}`);
        return Promise.resolve(comments.length);
      },
    };

    const reviewFn: ReviewFunction = () => {
      return Promise.resolve({ markdown: "Endringer kreves", inlineComments: mockComments });
    };

    await runReviewSession(host, reviewFn, { inline: true });

    expect(calls).toEqual(["publishSummary:Endringer kreves", "publishInline:1"]);
  });

  it("should catch exceptions from publishInline and not bubble them up", async () => {
    const host: ReviewHost = {
      fetchContext() {
        return Promise.resolve(mockContext);
      },
      publishSummary() {
        return Promise.resolve();
      },
      publishInline() {
        return Promise.reject(new Error("Azure DevOps API error"));
      },
    };

    const reviewFn: ReviewFunction = () => {
      return Promise.resolve({ markdown: "Kritisk", inlineComments: mockComments });
    };

    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    await expect(runReviewSession(host, reviewFn, { inline: true })).resolves.not.toThrow();
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
