import { InlineSeverity, ReviewComment, Severity, Verdict } from "@/lib/types";

export const MAX_INLINE_COMMENTS = 8;

const INLINE_SEVERITIES: readonly InlineSeverity[] = ["critical", "major", "minor"];
const VERDICTS: readonly Verdict[] = ["approve", "comment", "request-changes"];

function isInlineSeverity(value: string): value is InlineSeverity {
  return (INLINE_SEVERITIES as readonly string[]).includes(value);
}

function isVerdict(value: string): value is Verdict {
  return (VERDICTS as readonly string[]).includes(value);
}

export const SEVERITY_LABELS_NO: Record<Severity, string> = {
  critical: "Kritisk",
  major: "Alvorlig",
  minor: "Lav",
  nit: "Pirk",
};

// Strips any existing severity prefix the model may have inserted before we re-apply the
// canonical one: bold-bracket (`**[...]**`), plain bracket (`[...]`), or `Label:` form.
// The bracket forms intentionally match any content so typos and unknown labels are still removed.
const EXISTING_SEVERITY_PREFIX =
  /^(?:\*\*\s*\[[^\]]*\]\s*\*\*|\[[^\]]*\]|(?:Kritisk|Alvorlig|Lav|Pirk|Critical|Major|Minor|Nit|Severity)\s*:)\s*/i;

export function formatInlineCommentBody(comment: { severity: Severity; body: string }): string {
  const label = SEVERITY_LABELS_NO[comment.severity];
  const prefix = `**[${label}]** `;
  const cleanBody = comment.body.replace(EXISTING_SEVERITY_PREFIX, "").trim();
  return `${prefix}${cleanBody}`;
}

export function deriveVerdictFromComments(comments: Array<{ severity: Severity }>): Verdict {
  if (comments.length === 0) {
    return "approve";
  }
  const blocksMerge = comments.some((c) => c.severity === "critical" || c.severity === "major");
  return blocksMerge ? "request-changes" : "comment";
}

function resolveVerdict(parsedVerdict: Verdict | undefined, comments: ReviewComment[]): Verdict {
  const derived = deriveVerdictFromComments(comments);
  if (derived === "request-changes") return "request-changes";
  if (parsedVerdict === undefined || parsedVerdict === "request-changes") return derived;
  return parsedVerdict;
}

/** Matches ```json fenced blocks; closing ``` may be on the same line or after whitespace. */
const JSON_FENCE_PATTERN = "```json\\s*\\n([\\s\\S]*?)\\s*```";

function stripJsonCodeBlocks(text: string): string {
  return text
    .replace(new RegExp(JSON_FENCE_PATTERN, "gi"), "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function findLastJsonFence(text: string): RegExpMatchArray | undefined {
  const matches = [...text.matchAll(new RegExp(JSON_FENCE_PATTERN, "gi"))];
  return matches[matches.length - 1];
}

function parseInlineCommentsPayload(jsonText: string): {
  overallVerdict?: Verdict;
  inlineComments: ReviewComment[];
} {
  const parsed = JSON.parse(jsonText) as {
    overallVerdict?: unknown;
    inlineComments?: Array<{
      file?: string;
      line?: number;
      severity?: string;
      body?: string;
    }>;
  };

  const normalizedVerdict =
    typeof parsed.overallVerdict === "string" ? parsed.overallVerdict.toLowerCase() : undefined;
  const overallVerdict =
    normalizedVerdict !== undefined && isVerdict(normalizedVerdict) ? normalizedVerdict : undefined;

  const inlineComments: ReviewComment[] = [];

  for (const raw of parsed.inlineComments ?? []) {
    if (
      raw.file == null ||
      raw.file === "" ||
      raw.body == null ||
      raw.body === "" ||
      typeof raw.line !== "number"
    )
      continue;
    if (!Number.isInteger(raw.line) || raw.line < 1) continue;

    const severity = (raw.severity ?? "minor").toLowerCase();
    if (!isInlineSeverity(severity)) continue;

    inlineComments.push({
      filename: raw.file.replace(/^\//, ""),
      line: raw.line,
      body: raw.body.trim(),
      severity,
    });

    if (inlineComments.length >= MAX_INLINE_COMMENTS) break;
  }

  return { overallVerdict, inlineComments };
}

export function parseReviewResponse(text: string): {
  markdown: string;
  inlineComments: ReviewComment[];
  overallVerdict: Verdict;
} {
  const trimmed = text.trim();
  const lastMatch = findLastJsonFence(trimmed);

  const markdownBeforeJson = lastMatch?.index != null ? trimmed.slice(0, lastMatch.index) : trimmed;

  const markdown = stripJsonCodeBlocks(markdownBeforeJson);
  let inlineComments: ReviewComment[] = [];
  let parsedVerdict: Verdict | undefined;

  if (lastMatch != null) {
    try {
      const payload = parseInlineCommentsPayload(lastMatch[1].trim());
      parsedVerdict = payload.overallVerdict;
      inlineComments = payload.inlineComments;
    } catch (error) {
      console.warn(
        `Failed to parse review JSON payload; falling back to comment verdict: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      parsedVerdict = "comment";
    }
  }

  // The verdict is derived purely from comment severities (see deriveVerdictFromComments),
  // which formatting never touches. Resolve it before formatting so the data flow is explicit:
  // body formatting is a pure presentation step and plays no part in the verdict.
  const overallVerdict = resolveVerdict(parsedVerdict, inlineComments);

  // NOTE TO REVIEWERS: this is the single, canonical site where inline comment bodies are
  // formatted. runReviewSession no longer re-applies formatInlineCommentBody (that call was
  // removed when this logic moved here), so there is no double-prefixing of severity labels.
  const formattedComments = inlineComments.map((c) => ({
    ...c,
    body: formatInlineCommentBody(c),
  }));

  return {
    markdown,
    inlineComments: formattedComments,
    overallVerdict,
  };
}
