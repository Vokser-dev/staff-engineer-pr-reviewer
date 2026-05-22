import { deriveVerdictFromComments } from "@/lib/core/reviewResponse";
import {
  extractAddedLines,
  buildAddedLinesIndex,
  filterInlineComments,
  runReviewSession,
  ReviewHost,
  ReviewFunction,
} from "@/lib/core/reviewSession";
import { PullRequestContext, ReviewComment } from "@/lib/types";

describe("Review Session Orchestrator", () => {
  let mockContext: PullRequestContext;

  beforeEach(() => {
    mockContext = {
      title: "Fix bug",
      description: "Fixes a minor issue",
      author: "mortena",
      baseBranch: "main",
      headBranch: "feature",
      files: [
        {
          filename: "src/main.ts",
          status: "modified",
          additions: 3,
          deletions: 1,
          patch: `@@ -1,4 +1,6 @@
 unchanged 1
 unchanged 2
+added line 3
+added line 4
-removed line 5
+added line 5`,
        },
      ],
    };
  });

  describe("extractAddedLines", () => {
    it("should extract right-side added lines from a patch", () => {
      const patch = `@@ -1,4 +1,6 @@
 unchanged 1
 unchanged 2
+added line 3
+added line 4
-removed line 5
+added line 5`;
      const lines = extractAddedLines(patch);
      expect(lines).toEqual(new Set([3, 4, 5]));
    });

    it("should return empty set for undefined or empty patch", () => {
      expect(extractAddedLines(undefined)).toEqual(new Set());
      expect(extractAddedLines("")).toEqual(new Set());
    });
  });

  describe("buildAddedLinesIndex", () => {
    it("should build index for multiple files", () => {
      const files = [
        {
          filename: "file1.ts",
          status: "modified" as const,
          additions: 1,
          deletions: 0,
          patch: "@@ -1,1 +1,2 @@\n unchanged\n+added",
        },
        {
          filename: "file2.ts",
          status: "added" as const,
          additions: 1,
          deletions: 0,
          patch: "@@ -0,0 +1,1 @@\n+added file2",
        },
      ];
      const index = buildAddedLinesIndex(files);
      expect(index.get("file1.ts")).toEqual(new Set([2]));
      expect(index.get("file2.ts")).toEqual(new Set([1]));
    });
  });

  describe("filterInlineComments", () => {
    it("should filter out comments not on added lines", () => {
      const index = new Map<string, Set<number>>();
      index.set("src/main.ts", new Set([3, 4, 5]));

      const comments: ReviewComment[] = [
        { filename: "src/main.ts", line: 2, severity: "minor", body: "Off diff line" },
        { filename: "src/main.ts", line: 3, severity: "major", body: "On diff line" },
        { filename: "src/other.ts", line: 1, severity: "critical", body: "Wrong file" },
        { filename: "src/main.ts", line: undefined, severity: "minor", body: "No line number" },
      ];

      const warnMock = jest.fn();

      const filtered = filterInlineComments(comments, index, warnMock);

      expect(filtered).toHaveLength(1);
      expect(filtered[0]).toEqual({
        filename: "src/main.ts",
        line: 3,
        severity: "major",
        body: "On diff line",
      });

      expect(warnMock).toHaveBeenCalledTimes(3);
    });
  });

  describe("deriveVerdictFromComments", () => {
    it("should approve if empty", () => {
      expect(deriveVerdictFromComments([])).toBe("approve");
    });

    it("should return comment if only minor comments", () => {
      expect(deriveVerdictFromComments([{ severity: "minor" }])).toBe("comment");
    });

    it("should return request-changes if critical or major comments exist", () => {
      expect(deriveVerdictFromComments([{ severity: "minor" }, { severity: "major" }])).toBe(
        "request-changes",
      );

      expect(deriveVerdictFromComments([{ severity: "critical" }])).toBe("request-changes");
    });
  });

  describe("runReviewSession", () => {
    it("should fetch context and publish review summary without inline comments if inline is disabled", async () => {
      const published: { markdown: string; comments: ReviewComment[]; verdict: string }[] = [];
      const host: ReviewHost = {
        fetchContext() {
          return Promise.resolve(mockContext);
        },
        publishReview(markdown, comments, verdict) {
          published.push({ markdown, comments, verdict });
          return Promise.resolve();
        },
      };

      const reviewFn: ReviewFunction = (pr, options) => {
        expect(options?.requestInlineComments).toBe(false);
        return Promise.resolve({
          markdown: "Flott PR",
          inlineComments: [
            {
              filename: "src/main.ts",
              line: 3,
              severity: "major",
              body: "should not be published",
            },
          ],
          overallVerdict: "approve",
        });
      };

      await runReviewSession(host, reviewFn, { inline: false });

      expect(published).toHaveLength(1);
      expect(published[0]).toEqual({
        markdown: "Flott PR",
        comments: [],
        verdict: "approve",
      });
    });

    it("should parse, filter, format and publish review with comments if inline is enabled", async () => {
      const published: { markdown: string; comments: ReviewComment[]; verdict: string }[] = [];
      const host: ReviewHost = {
        fetchContext() {
          return Promise.resolve(mockContext);
        },
        publishReview(markdown, comments, verdict) {
          published.push({ markdown, comments, verdict });
          return Promise.resolve();
        },
      };

      const reviewFn: ReviewFunction = () => {
        return Promise.resolve({
          markdown: "Sammendrag",
          inlineComments: [
            { filename: "src/main.ts", line: 2, severity: "minor", body: "off-line" },
            { filename: "src/main.ts", line: 3, severity: "minor", body: "on-line" },
          ],
        });
      };

      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

      await runReviewSession(host, reviewFn, { inline: true });

      expect(published).toHaveLength(1);
      expect(published[0].markdown).toBe("Sammendrag");
      expect(published[0].comments).toHaveLength(1);
      expect(published[0].comments[0]).toEqual({
        filename: "src/main.ts",
        line: 3,
        severity: "minor",
        body: "on-line",
      });
      // Verdict is derived since it was not provided in LLM response
      expect(published[0].verdict).toBe("comment");

      warnSpy.mockRestore();
    });

    it("should use overallVerdict from review result if provided", async () => {
      const published: { markdown: string; comments: ReviewComment[]; verdict: string }[] = [];
      const host: ReviewHost = {
        fetchContext() {
          return Promise.resolve(mockContext);
        },
        publishReview(markdown, comments, verdict) {
          published.push({ markdown, comments, verdict });
          return Promise.resolve();
        },
      };

      const reviewFn: ReviewFunction = () => {
        return Promise.resolve({
          markdown: "Sammendrag",
          inlineComments: [],
          overallVerdict: "request-changes",
        });
      };

      await runReviewSession(host, reviewFn, { inline: true });

      expect(published[0].verdict).toBe("request-changes");
    });

    it("should derive verdict from filtered comments so off-diff comments do not block merge", async () => {
      const published: { markdown: string; comments: ReviewComment[]; verdict: string }[] = [];
      const host: ReviewHost = {
        fetchContext() {
          return Promise.resolve(mockContext);
        },
        publishReview(markdown, comments, verdict) {
          published.push({ markdown, comments, verdict });
          return Promise.resolve();
        },
      };

      const reviewFn: ReviewFunction = () => {
        return Promise.resolve({
          markdown: "Sammendrag",
          inlineComments: [
            {
              filename: "src/main.ts",
              line: 999, // Off diff line (not in mockContext which only has line 3 as added line)
              severity: "critical",
              body: "critical issue offline",
            },
          ],
        });
      };

      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

      await runReviewSession(host, reviewFn, { inline: true });

      expect(published).toHaveLength(1);
      // Inline comments should be filtered out (empty)
      expect(published[0].comments).toHaveLength(0);
      // Verdict should be approve: no published comments means nothing to act on,
      // so the original off-diff critical should not block merge.
      expect(published[0].verdict).toBe("approve");

      warnSpy.mockRestore();
    });
  });
});
