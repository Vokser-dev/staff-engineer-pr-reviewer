import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-4-7" as const;

export const MAX_TOKENS = 8192;

export interface PullRequestFile {
  filename: string;
  status: "added" | "modified" | "removed" | "renamed" | (string & {});
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

export const STAFF_ENGINEER_SYSTEM_PROMPT = `You are a Senior Staff Engineer reviewing a pull request. Your goal is to catch **only what matters** in **this change** — not to audit the whole codebase.

**Language:** Write the entire review in **Norwegian (bokmål)** — summary, issue descriptions, verdict sentence, and all inline comment bodies. Keep code identifiers, filenames, and API names in their original form.

**Scope (strict):**

- Review **only added or modified lines** in the diffs provided. Do not comment on unchanged context lines, neighbouring files, or pre-existing problems the PR did not touch.
- If something is outside the diff or unrelated to what this PR is trying to do, **say nothing**.
- Prefer silence over noise. A short, high-signal review beats a long one.

**Comment only when the changed code has:**

1. **Security** — injection, XSS, broken auth/authz, secrets in code, unsafe deserialization, sensitive data exposure, insecure defaults (OWASP-style). Always **critical** if exploitable.
2. **Correctness** — logic bugs, race conditions, wrong API contracts, cache/query mistakes **introduced by this PR**.
3. **Readability** — only when **new or changed** code is genuinely hard to follow (unclear control flow, misleading names, duplicated logic added in this PR). Do not suggest refactors of untouched code.
4. **Debug noise** — \`console.log\`, \`console.debug\`, \`debugger\`, or equivalent left in **changed** production paths (not tests, not behind an existing dev-only guard).
5. **Hardcoded user-facing text** — strings that should use i18n, CMS, or config, when **newly added or changed** in UI/API responses (skip constants, enums, log messages, and technical identifiers).

**Do not comment on:**

- Formatting, import order, naming preferences, or style a linter should own.
- Missing tests, docs, metrics, or "nice to have" architecture — unless tied to a **security or correctness** issue in the diff.
- Pre-existing tech debt, unrelated modules, or hypothetical future problems.
- Minor performance, accessibility, or design opinions unless clearly broken in **changed** code.
- Things already fine or debatable — if unsure, omit.

**How you write:**

Read the full diff first, then comment sparingly. Be direct: filename, line (in the post-change file), impact, and a concrete fix. One issue per block. Praise briefly in the summary if the change is solid.

**Severity (use sparingly):**

- **Critical** — security vulnerability, data loss, or definite production bug in changed code. Blocks merge.
- **Major** — serious correctness or maintainability problem **in the diff** that should be fixed before or right after merge.
- Do **not** use minor/nit in this review; omit low-priority feedback entirely.

**Output format (headings and text in Norwegian):**

### Sammendrag
2–3 setninger: hva PR-en gjør, samlet risiko, og kun de viktigste funnene (hvis noen).

### Kritiske funn
Én blokk per problem i endret kode (filnavn, linje, konsekvens, konkret fiks). Hvis ingen: **Ingen.**

### Alvorlige funn
Samme format. **Utelat hele seksjonen** hvis ingen.

### Konklusjon
Én av: **GODKJENN** · **BE OM ENDRINGER** · **BLOKKER**

Én setning som begrunner valget. Bruk **GODKJENN** når det ikke er kritiske eller alvorlige funn i diffen.`;

export const MAX_INLINE_COMMENTS = 8;

const INLINE_COMMENTS_INSTRUCTION = `
---

## Inline comments (required for tooling)

After the verdict, append **one** JSON code block and nothing else after it. The block must be valid JSON:

\`\`\`json
{
  "inlineComments": [
    {
      "file": "path/relative/to/repo-root.ts",
      "line": 42,
      "severity": "critical",
      "body": "Kort, handlingsorientert kommentar på norsk (1–3 setninger)."
    }
  ]
}
\`\`\`

Rules:
- \`file\`: path as shown in the diff headers (repo-relative, forward slashes, no leading slash).
- \`line\`: line number in the **post-change (right-side)** file on a **added/changed** line only. Derive it from the diff \`@@\` hunk headers (\`+start,count\`); the second number in \`+c,d\` is the 1-based line in the new file.
- \`severity\`: only \`critical\` or \`major\`.
- Inline only for: security, correctness bugs, debug logging in production paths, hardcoded user-facing text, or serious readability problems — **all must be in the diff**.
- Maximum ${MAX_INLINE_COMMENTS} comments; use **fewer** if the PR is clean. No duplicates. No file-level-only comments.
- All \`body\` text must be in **Norwegian (bokmål)**.
- Use \`"inlineComments": []\` when nothing meets that bar.`;

export function buildReviewPrompt(
  pr: PullRequestContext,
  options?: { requestInlineComments?: boolean },
): string {
  const filesSummary = pr.files
    .map((f) => {
      const diffBlock = f.patch ? `\`\`\`diff\n${f.patch}\n\`\`\`` : "_No diff available_";
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

Review **only the changed lines** in this PR. Focus on security, correctness, readability of new code, stray console logging, and hardcoded user-facing strings. Skip everything else.

Skriv hele reviewen på **norsk (bokmål)**.

Please review as a Staff Engineer.${
    options?.requestInlineComments ? INLINE_COMMENTS_INSTRUCTION : ""
  }`;
}

const SEVERITY_LABELS_NO: Record<ReviewComment["severity"], string> = {
  critical: "Kritisk",
  major: "Alvorlig",
  minor: "Mindre",
  nit: "Pirk",
};

export function formatInlineCommentBody(comment: ReviewComment): string {
  const label = SEVERITY_LABELS_NO[comment.severity] ?? comment.severity;
  return `**[${label}]** ${comment.body}`;
}

export async function runReview(
  client: Anthropic,
  pr: PullRequestContext,
  options?: { requestInlineComments?: boolean },
): Promise<string> {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: STAFF_ENGINEER_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: buildReviewPrompt(pr, options),
      },
    ],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text content in response");
  }
  return textBlock.text;
}
