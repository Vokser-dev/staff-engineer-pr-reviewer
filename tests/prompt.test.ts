import {
  buildReviewPrompt,
  getThinkingParameters,
  runReview,
  STAFF_ENGINEER_SYSTEM_PROMPT,
} from "@/lib/core/prompt";
import { formatInlineCommentBody, parseReviewResponse } from "@/lib/core/reviewResponse";
import { PullRequestContext, ReviewComment } from "@/lib/types";

describe("formatInlineCommentBody", () => {
  it("should format critical severity correctly in Norwegian", () => {
    const comment: ReviewComment = {
      filename: "src/main.ts",
      line: 10,
      body: "En kritisk feil.",
      severity: "critical",
    };
    expect(formatInlineCommentBody(comment)).toBe("**[Kritisk]** En kritisk feil.");
  });

  it("should format major severity correctly in Norwegian", () => {
    const comment: ReviewComment = {
      filename: "src/main.ts",
      line: 10,
      body: "En alvorlig feil.",
      severity: "major",
    };
    expect(formatInlineCommentBody(comment)).toBe("**[Alvorlig]** En alvorlig feil.");
  });

  it("should handle fallbacks for unknown severities gracefully", () => {
    const comment = {
      filename: "src/main.ts",
      line: 10,
      body: "Noe annet.",
      severity: "minor",
    } as unknown as ReviewComment;
    expect(formatInlineCommentBody(comment)).toBe("**[Lav]** Noe annet.");
  });

  it("should strip existing prefixes and avoid double-prefixing", () => {
    const comment1: ReviewComment = {
      filename: "src/main.ts",
      line: 10,
      body: "**[Lav]** Noe annet.",
      severity: "minor",
    };
    expect(formatInlineCommentBody(comment1)).toBe("**[Lav]** Noe annet.");

    const comment2: ReviewComment = {
      filename: "src/main.ts",
      line: 10,
      body: "**[Alvorlig]** Noe annet.",
      severity: "minor",
    };
    expect(formatInlineCommentBody(comment2)).toBe("**[Lav]** Noe annet.");

    const comment3: ReviewComment = {
      filename: "src/main.ts",
      line: 10,
      body: "[Critical] Noe annet.",
      severity: "critical",
    };
    expect(formatInlineCommentBody(comment3)).toBe("**[Kritisk]** Noe annet.");

    const comment4: ReviewComment = {
      filename: "src/main.ts",
      line: 10,
      body: "Kritisk: Noe annet.",
      severity: "critical",
    };
    expect(formatInlineCommentBody(comment4)).toBe("**[Kritisk]** Noe annet.");
  });

  it("should preserve bracketed content that is not a severity prefix", () => {
    const comment: ReviewComment = {
      filename: "src/main.ts",
      line: 10,
      body: "[array indexing] is fast.",
      severity: "critical",
    };

    expect(formatInlineCommentBody(comment)).toBe("**[Kritisk]** [array indexing] is fast.");
  });
});

describe("buildReviewPrompt", () => {
  const mockContext: PullRequestContext = {
    title: "Fix auth bug",
    description: "Resolves a race condition in auth token generation",
    author: "mortena",
    baseBranch: "main",
    headBranch: "auth-fix",
    files: [
      {
        filename: "src/auth.ts",
        status: "modified",
        additions: 2,
        deletions: 1,
        patch:
          "@@ -1,3 +1,4 @@\n-const token = generate();\n+const token = await generate();\n+return token;",
      },
    ],
  };

  it("should construct prompt with files and description", () => {
    const prompt = buildReviewPrompt(mockContext, { requestInlineComments: false });
    expect(prompt).toContain("Fix auth bug");
    expect(prompt).toContain("mortena");
    expect(prompt).toContain("main");
    expect(prompt).toContain("auth-fix");
    expect(prompt).toContain("src/auth.ts");
    expect(prompt).toContain("const token = await generate()");
    expect(prompt).not.toContain("## Inline comments (required for tooling)");
  });

  it("should append inline comments instruction when requested", () => {
    const prompt = buildReviewPrompt(mockContext, { requestInlineComments: true });
    expect(prompt).toContain("## Inline comments (required for tooling)");
    expect(prompt).toContain("inlineComments");
    expect(prompt).toContain("overallVerdict");
  });

  it("should handle empty description", () => {
    const contextWithoutDesc = { ...mockContext, description: "" };
    const prompt = buildReviewPrompt(contextWithoutDesc, { requestInlineComments: false });
    expect(prompt).toContain("_No description provided._");
  });

  it("should handle null description", () => {
    const contextWithoutDesc = { ...mockContext, description: null };
    const prompt = buildReviewPrompt(contextWithoutDesc, { requestInlineComments: false });
    expect(prompt).toContain("_No description provided._");
  });
});

describe("parseReviewResponse", () => {
  it("should parse happy path with well-formed JSON block", () => {
    const response = `Her er mitt review.
Dette ser bra ut.

\`\`\`json
{
  "inlineComments": [
    {
      "file": "src/auth.ts",
      "line": 42,
      "severity": "critical",
      "body": "Bruk en sikrere algoritme her."
    }
  ]
}
\`\`\``;

    const { markdown, inlineComments } = parseReviewResponse(response);
    expect(markdown).toBe("Her er mitt review.\nDette ser bra ut.");
    expect(inlineComments).toHaveLength(1);
    expect(inlineComments[0]).toEqual({
      filename: "src/auth.ts",
      line: 42,
      severity: "critical",
      body: "**[Kritisk]** Bruk en sikrere algoritme her.",
    });
  });

  it("should parse markdown-only response (no JSON)", () => {
    const response = "Bare markdown her uten noe json.";
    const { markdown, inlineComments } = parseReviewResponse(response);
    expect(markdown).toBe("Bare markdown her uten noe json.");
    expect(inlineComments).toEqual([]);
  });

  it("should handle malformed JSON inside a fence gracefully", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const response = `Markdown.
\`\`\`json
{
  "inlineComments": [
    {
      "file": "src/auth.ts",
      "line": 42,
      "severity": "critical",
      "body": "Mangler en lukke-brakett"
  ]
}
\`\`\``;
    const { markdown, inlineComments, overallVerdict } = parseReviewResponse(response);
    expect(markdown).toBe("Markdown.");
    expect(inlineComments).toEqual([]);
    expect(overallVerdict).toBe("comment");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to parse review JSON payload"),
    );
    warnSpy.mockRestore();
  });

  it("should accept critical, major, and minor severities but filter nit", () => {
    const response = `Review.
\`\`\`json
{
  "inlineComments": [
    {
      "file": "src/auth.ts",
      "line": 42,
      "severity": "minor",
      "body": "Dette bør beholdes som minor"
    },
    {
      "file": "src/auth.ts",
      "line": 43,
      "severity": "major",
      "body": "Dette bør beholdes som major"
    },
    {
      "file": "src/auth.ts",
      "line": 44,
      "severity": "nit",
      "body": "Dette bør filtreres ut"
    }
  ]
}
\`\`\``;
    const { inlineComments } = parseReviewResponse(response);
    expect(inlineComments).toHaveLength(2);
    expect(inlineComments[0].severity).toBe("minor");
    expect(inlineComments[1].severity).toBe("major");
  });

  it("should filter out non-integer or negative line numbers", () => {
    const response = `Review.
\`\`\`json
{
  "inlineComments": [
    {
      "file": "src/auth.ts",
      "line": -5,
      "severity": "critical",
      "body": "Negativ linje"
    },
    {
      "file": "src/auth.ts",
      "line": 42.5,
      "severity": "critical",
      "body": "Desimal-linje"
    },
    {
      "file": "src/auth.ts",
      "line": 43,
      "severity": "critical",
      "body": "Ok linje"
    }
  ]
}
\`\`\``;
    const { inlineComments } = parseReviewResponse(response);
    expect(inlineComments).toHaveLength(1);
    expect(inlineComments[0].line).toBe(43);
  });

  it("should filter out comments with missing fields", () => {
    const response = `Review.
\`\`\`json
{
  "inlineComments": [
    {
      "line": 42,
      "severity": "critical",
      "body": "Mangler filnavn"
    },
    {
      "file": "src/auth.ts",
      "severity": "critical",
      "body": "Mangler linje"
    },
    {
      "file": "src/auth.ts",
      "line": 43,
      "severity": "critical"
    }
  ]
}
\`\`\``;
    const { inlineComments } = parseReviewResponse(response);
    expect(inlineComments).toEqual([]);
  });

  it("should truncate inline comments exceeding MAX_INLINE_COMMENTS (8)", () => {
    const commentsList = Array.from({ length: 10 }, (_, i) => ({
      file: `src/file_${i}.ts`,
      line: i + 1,
      severity: "critical",
      body: `Kommentar ${i}`,
    }));
    const response = `Review.
\`\`\`json
{
  "inlineComments": ${JSON.stringify(commentsList)}
}
\`\`\``;
    const { inlineComments } = parseReviewResponse(response);
    expect(inlineComments).toHaveLength(8);
    expect(inlineComments[7].filename).toBe("src/file_7.ts");
  });

  it("should strip multiple JSON fences, parsing only the last one", () => {
    const response = `Første markdown.
\`\`\`json
{
  "inlineComments": [
    {
      "file": "src/first.ts",
      "line": 1,
      "severity": "critical",
      "body": "Første json"
    }
  ]
}
\`\`\`
Andre markdown.
\`\`\`json
{
  "inlineComments": [
    {
      "file": "src/second.ts",
      "line": 2,
      "severity": "critical",
      "body": "Andre json"
    }
  ]
}
\`\`\``;
    const { markdown, inlineComments } = parseReviewResponse(response);
    expect(markdown).toContain("Første markdown.");
    expect(markdown).toContain("Andre markdown.");
    expect(markdown).not.toContain("src/first.ts");
    expect(markdown).not.toContain("src/second.ts");
    expect(inlineComments).toHaveLength(1);
    expect(inlineComments[0].filename).toBe("src/second.ts");
  });

  it("should normalize leading slashes in filenames", () => {
    const response = `Review.
\`\`\`json
{
  "inlineComments": [
    {
      "file": "/src/auth.ts",
      "line": 42,
      "severity": "critical",
      "body": "Ledende skråstrek"
    }
  ]
}
\`\`\``;
    const { inlineComments } = parseReviewResponse(response);
    expect(inlineComments).toHaveLength(1);
    expect(inlineComments[0].filename).toBe("src/auth.ts");
  });

  it("should handle empty text response gracefully", () => {
    const { markdown, inlineComments } = parseReviewResponse("");
    expect(markdown).toBe("");
    expect(inlineComments).toEqual([]);
  });

  describe("overallVerdict consistency and derivation", () => {
    it("should force verdict to request-changes if critical or major comments exist", () => {
      const response = `Review.
\`\`\`json
{
  "overallVerdict": "approve",
  "inlineComments": [
    {
      "file": "src/auth.ts",
      "line": 42,
      "severity": "critical",
      "body": "Feil"
    }
  ]
}
\`\`\``;
      const { overallVerdict } = parseReviewResponse(response);
      expect(overallVerdict).toBe("request-changes");
    });

    it("should override request-changes to comment if only minor comments exist", () => {
      const response = `Review.
\`\`\`json
{
  "overallVerdict": "request-changes",
  "inlineComments": [
    {
      "file": "src/auth.ts",
      "line": 42,
      "severity": "minor",
      "body": "Pirk"
    }
  ]
}
\`\`\``;
      const { overallVerdict } = parseReviewResponse(response);
      expect(overallVerdict).toBe("comment");
    });

    it("should override request-changes to approve if no comments exist", () => {
      const response = `Review.
\`\`\`json
{
  "overallVerdict": "request-changes",
  "inlineComments": []
}
\`\`\``;
      const { overallVerdict } = parseReviewResponse(response);
      expect(overallVerdict).toBe("approve");
    });

    it("should derive verdict if not provided or invalid", () => {
      // 1. Empty comments -> approve
      const resp1 = `Review.
\`\`\`json
{
  "inlineComments": []
}
\`\`\``;
      expect(parseReviewResponse(resp1).overallVerdict).toBe("approve");

      // 2. Only minor comments -> comment
      const resp2 = `Review.
\`\`\`json
{
  "inlineComments": [
    { "file": "src/auth.ts", "line": 42, "severity": "minor", "body": "Pirk" }
  ]
}
\`\`\``;
      expect(parseReviewResponse(resp2).overallVerdict).toBe("comment");

      // 3. Critical/Major comments -> request-changes
      const resp3 = `Review.
\`\`\`json
{
  "inlineComments": [
    { "file": "src/auth.ts", "line": 42, "severity": "major", "body": "Alvorlig" }
  ]
}
\`\`\``;
      expect(parseReviewResponse(resp3).overallVerdict).toBe("request-changes");
    });

    it("should preserve valid and consistent overallVerdict", () => {
      const response = `Review.
\`\`\`json
{
  "overallVerdict": "approve",
  "inlineComments": []
}
\`\`\``;
      expect(parseReviewResponse(response).overallVerdict).toBe("approve");

      const response2 = `Review.
\`\`\`json
{
  "overallVerdict": "comment",
  "inlineComments": [
    { "file": "src/auth.ts", "line": 42, "severity": "minor", "body": "Pirk" }
  ]
}
\`\`\``;
      expect(parseReviewResponse(response2).overallVerdict).toBe("comment");
    });
  });
});

describe("getThinkingParameters", () => {
  it("should return empty object if thinkingEnv is undefined or disabled", () => {
    expect(getThinkingParameters()).toEqual({});
    expect(getThinkingParameters("false")).toEqual({});
    expect(getThinkingParameters("off")).toEqual({});
    expect(getThinkingParameters("0")).toEqual({});
  });

  it("should return budget 2048 and temperature 1.0 for truthy non-numeric values", () => {
    expect(getThinkingParameters("true")).toEqual({
      thinking: { type: "enabled", budget_tokens: 2048 },
      temperature: 1.0,
    });
    expect(getThinkingParameters("on")).toEqual({
      thinking: { type: "enabled", budget_tokens: 2048 },
      temperature: 1.0,
    });
  });

  it("should parse numeric budget if >= 1024", () => {
    expect(getThinkingParameters("4096")).toEqual({
      thinking: { type: "enabled", budget_tokens: 4096 },
      temperature: 1.0,
    });
  });

  it("should fallback to 2048 if numeric budget < 1024", () => {
    expect(getThinkingParameters("500")).toEqual({
      thinking: { type: "enabled", budget_tokens: 2048 },
      temperature: 1.0,
    });
  });
});

describe("runReview", () => {
  const mockContext: PullRequestContext = {
    title: "Fix bug",
    description: "Fixes a minor issue",
    author: "mortena",
    baseBranch: "main",
    headBranch: "feature",
    files: [],
  };

  it("should call client.complete with the system prompt and a user prompt derived from the PR context", async () => {
    const completeMock = jest.fn().mockResolvedValue("En kjempefin PR!");
    const client = { complete: completeMock, supportsThinking: false };

    await runReview(client, mockContext);

    expect(completeMock).toHaveBeenCalledTimes(1);
    const [system, user] = completeMock.mock.calls[0] as [string, string];
    expect(system).toBe(STAFF_ENGINEER_SYSTEM_PROMPT);
    expect(user).toContain("Fix bug");
    expect(user).toContain("mortena");
  });

  it("should include inline comments instruction in user prompt when requestInlineComments is true", async () => {
    const completeMock = jest.fn().mockResolvedValue("Review");
    const client = { complete: completeMock, supportsThinking: false };

    await runReview(client, mockContext, { requestInlineComments: true });

    const [, user] = completeMock.mock.calls[0] as [string, string];
    expect(user).toContain("overallVerdict");
    expect(user).toContain("inlineComments");
  });

  it("should not include inline comments instruction when requestInlineComments is false", async () => {
    const completeMock = jest.fn().mockResolvedValue("Review");
    const client = { complete: completeMock, supportsThinking: false };

    await runReview(client, mockContext, { requestInlineComments: false });

    const [, user] = completeMock.mock.calls[0] as [string, string];
    expect(user).not.toContain("overallVerdict");
  });

  it("should return the text returned by client.complete", async () => {
    const client = {
      complete: jest.fn().mockResolvedValue("Gjennomgang ferdig."),
      supportsThinking: false,
    };

    const result = await runReview(client, mockContext);
    expect(result).toBe("Gjennomgang ferdig.");
  });
});
