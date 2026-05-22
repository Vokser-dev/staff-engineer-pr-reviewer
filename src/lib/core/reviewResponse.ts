import { ReviewComment, MAX_INLINE_COMMENTS } from "@/lib/core/prompt";

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
  overallVerdict?: "approve" | "comment" | "request-changes";
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

  const verdicts = new Set(["approve", "comment", "request-changes"]);
  const normalizedVerdict =
    typeof parsed.overallVerdict === "string" ? parsed.overallVerdict.toLowerCase() : undefined;
  const overallVerdict =
    normalizedVerdict !== undefined && verdicts.has(normalizedVerdict)
      ? (normalizedVerdict as "approve" | "comment" | "request-changes")
      : undefined;

  const inlineSeverities = new Set(["critical", "major", "minor"]);
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
    if (!inlineSeverities.has(severity)) continue;

    inlineComments.push({
      filename: raw.file.replace(/^\//, ""),
      line: raw.line,
      body: raw.body.trim(),
      severity: severity as ReviewComment["severity"],
    });

    if (inlineComments.length >= MAX_INLINE_COMMENTS) break;
  }

  return { overallVerdict, inlineComments };
}

export function parseReviewResponse(text: string): {
  markdown: string;
  inlineComments: ReviewComment[];
  overallVerdict?: "approve" | "comment" | "request-changes";
} {
  const trimmed = text.trim();
  const lastMatch = findLastJsonFence(trimmed);

  const markdownBeforeJson = lastMatch?.index != null ? trimmed.slice(0, lastMatch.index) : trimmed;

  const markdown = stripJsonCodeBlocks(markdownBeforeJson);
  let inlineComments: ReviewComment[] = [];
  let overallVerdict: "approve" | "comment" | "request-changes" | undefined;

  if (lastMatch != null) {
    try {
      const payload = parseInlineCommentsPayload(lastMatch[1].trim());
      overallVerdict = payload.overallVerdict;
      inlineComments = payload.inlineComments;
    } catch {
      overallVerdict = undefined;
      inlineComments = [];
    }
  }

  return { markdown, inlineComments, overallVerdict };
}
