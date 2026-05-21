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

function parseInlineCommentsPayload(jsonText: string): ReviewComment[] {
  const parsed = JSON.parse(jsonText) as {
    inlineComments?: Array<{
      file?: string;
      line?: number;
      severity?: string;
      body?: string;
    }>;
  };

  const inlineSeverities = new Set(["critical", "major"]);
  const inlineComments: ReviewComment[] = [];

  for (const raw of parsed.inlineComments ?? []) {
    if (!raw.file || !raw.body || typeof raw.line !== "number") continue;
    if (!Number.isInteger(raw.line) || raw.line < 1) continue;
    const severity = (raw.severity ?? "major").toLowerCase();
    if (!inlineSeverities.has(severity)) continue;

    inlineComments.push({
      filename: raw.file.replace(/^\//, ""),
      line: raw.line,
      body: raw.body.trim(),
      severity: severity as ReviewComment["severity"],
    });

    if (inlineComments.length >= MAX_INLINE_COMMENTS) break;
  }

  return inlineComments;
}

export function parseReviewResponse(text: string): {
  markdown: string;
  inlineComments: ReviewComment[];
} {
  const trimmed = text.trim();
  const lastMatch = findLastJsonFence(trimmed);

  const markdownBeforeJson = lastMatch?.index != null ? trimmed.slice(0, lastMatch.index) : trimmed;

  const markdown = stripJsonCodeBlocks(markdownBeforeJson);
  let inlineComments: ReviewComment[] = [];

  if (lastMatch) {
    try {
      inlineComments = parseInlineCommentsPayload(lastMatch[1].trim());
    } catch {
      inlineComments = [];
    }
  }

  return { markdown, inlineComments };
}
