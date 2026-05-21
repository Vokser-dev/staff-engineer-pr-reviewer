import {
  buildReviewPrompt,
  formatInlineCommentBody,
  PullRequestContext,
  ReviewComment,
} from "@/lib/core/prompt";
import { parseReviewResponse } from "@/lib/core/reviewResponse";

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
    expect(formatInlineCommentBody(comment)).toBe("**[Mindre]** Noe annet.");
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
    expect(prompt).toContain("## Inline-kommentarer (påkrevd for verktøy)");
    expect(prompt).toContain("inlineComments");
    expect(prompt).toContain("overallVerdict");
  });

  it("should handle empty description", () => {
    const contextWithoutDesc = { ...mockContext, description: "" };
    const prompt = buildReviewPrompt(contextWithoutDesc, { requestInlineComments: false });
    expect(prompt).toContain("_Ingen beskrivelse gitt._");
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
      body: "Bruk en sikrere algoritme her.",
    });
  });

  it("should parse markdown-only response (no JSON)", () => {
    const response = "Bare markdown her uten noe json.";
    const { markdown, inlineComments } = parseReviewResponse(response);
    expect(markdown).toBe("Bare markdown her uten noe json.");
    expect(inlineComments).toEqual([]);
  });

  it("should handle malformed JSON inside a fence gracefully", () => {
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
    const { markdown, inlineComments } = parseReviewResponse(response);
    expect(markdown).toBe("Markdown.");
    expect(inlineComments).toEqual([]);
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
});
