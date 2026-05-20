import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-4-7" as const;

export const MAX_TOKENS = 8192;

export interface PullRequestFile {
  filename: string;
  status: "added" | "modified" | "removed" | "renamed" | string;
  additions: number;
  deletions: number;
  patch?: string;
}

export interface PullRequestContext {
  title: string;
  description: string;
  author: string;
  baseBranch: string;
  headBranch: string;
  files: PullRequestFile[];
}

export interface ReviewResult {
  summary: string;
  comments: ReviewComment[];
  overallVerdict: "approve" | "request-changes" | "comment";
}

export interface ReviewComment {
  filename: string;
  line?: number;
  body: string;
  severity: "critical" | "major" | "minor" | "nit";
}

export const STAFF_ENGINEER_SYSTEM_PROMPT = `You are a Staff Engineer conducting a thorough code review. Your role is to:

1. **Correctness** — Identify bugs, logic errors, off-by-one errors, null/undefined hazards, and incorrect assumptions.
2. **Design & Architecture** — Evaluate whether the approach is sound. Flag unnecessary complexity, abstraction misuse, or violations of SOLID/DRY principles only when they cause real harm.
3. **Security** — Spot injection risks, insecure defaults, sensitive data exposure, authentication/authorisation flaws, and OWASP Top 10 issues.
4. **Performance** — Note O(n²) or worse algorithms, N+1 queries, unnecessary allocations, and missed caching opportunities — only when they matter at scale.
5. **Maintainability** — Flag misleading names, missing error handling at system boundaries, and code that will confuse the next reader.
6. **Test coverage** — Note untested edge cases for non-trivial logic; do not demand tests for trivial getters/setters.

**Review principles:**
- Be direct and specific. Reference exact filenames and line numbers.
- Distinguish critical issues (must fix) from nits (optional polish).
- Praise genuinely good decisions in one brief line — do not pad.
- Do not invent problems. If the code is fine, say so.
- Focus on what matters to ship safely and maintain long-term.
- Format your review in clean Markdown.

**Output structure:**
1. A brief overall summary (2–4 sentences).
2. A "Critical Issues" section (if any) — must be resolved before merging.
3. A "Suggestions" section — improvements worth considering.
4. A "Nits" section — minor style or polish items.
5. A final verdict: APPROVE, REQUEST CHANGES, or COMMENT.`;

export function buildReviewPrompt(pr: PullRequestContext): string {
  const filesSummary = pr.files
    .map((f) => {
      const diffBlock = f.patch
        ? `\`\`\`diff\n${f.patch}\n\`\`\``
        : "_No diff available_";
      return `### ${f.filename} (${f.status}, +${f.additions}/-${f.deletions})\n\n${diffBlock}`;
    })
    .join("\n\n---\n\n");

  return `## Pull Request: ${pr.title}

**Author:** ${pr.author}
**Base branch:** ${pr.baseBranch} ← **Head branch:** ${pr.headBranch}

**Description:**
${pr.description || "_No description provided._"}

---

## Changed Files (${pr.files.length})

${filesSummary}

---

Please review this pull request as a Staff Engineer.`;
}

export async function runReview(
  client: Anthropic,
  pr: PullRequestContext
): Promise<string> {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: STAFF_ENGINEER_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: buildReviewPrompt(pr),
      },
    ],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text content in response");
  }
  return textBlock.text;
}
