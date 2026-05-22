import {
  formatInlineCommentBody,
  PullRequestContext,
  PullRequestFile,
  ReviewComment,
} from "@/lib/core/prompt";

export interface ReviewHost {
  fetchContext(): Promise<PullRequestContext>;
  publishReview(
    summaryMarkdown: string,
    inlineComments: ReviewComment[],
    verdict: "approve" | "comment" | "request-changes",
  ): Promise<void>;
  warn?(message: string): void;
}

export type ReviewFunction = (
  pr: PullRequestContext,
  options?: { requestInlineComments?: boolean },
) => Promise<{
  markdown: string;
  inlineComments: ReviewComment[];
  overallVerdict?: "approve" | "comment" | "request-changes";
}>;

export function extractAddedLines(patch: string | undefined): Set<number> {
  const lines = new Set<number>();
  if (patch == null || patch === "") return lines;

  let newLineNum = 0;
  for (const raw of patch.split("\n")) {
    const hunk = raw.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
    if (hunk != null) {
      newLineNum = parseInt(hunk[1], 10);
      continue;
    }
    if (raw.startsWith("+++") || raw.startsWith("---")) continue;
    if (raw.startsWith("\\")) continue;

    if (raw.startsWith("+")) {
      lines.add(newLineNum);
      newLineNum++;
    } else if (raw.startsWith(" ")) {
      newLineNum++;
    }
  }
  return lines;
}

export function buildAddedLinesIndex(files: PullRequestFile[]): Map<string, Set<number>> {
  const index = new Map<string, Set<number>>();
  for (const file of files) {
    index.set(file.filename, extractAddedLines(file.patch));
  }
  return index;
}

export function filterInlineComments(
  comments: ReviewComment[],
  index: Map<string, Set<number>>,
  warn?: (msg: string) => void,
): (ReviewComment & { line: number })[] {
  const kept: (ReviewComment & { line: number })[] = [];
  for (const c of comments) {
    if (c.line == null) {
      warn?.(`Skipping inline comment on ${c.filename}: missing line number`);
      continue;
    }
    const validLines = index.get(c.filename);
    if (validLines == null) {
      warn?.(`Skipping inline comment: file "${c.filename}" not in PR diff`);
      continue;
    }
    if (!validLines.has(c.line)) {
      warn?.(`Skipping inline comment on ${c.filename}:${c.line} (line not in diff)`);
      continue;
    }
    kept.push({ ...c, line: c.line });
  }
  return kept;
}

export function deriveVerdictFromComments(
  comments: ReviewComment[],
): "approve" | "comment" | "request-changes" {
  if (comments.length === 0) {
    return "approve";
  }
  const blocksMerge = comments.some((c) => c.severity === "critical" || c.severity === "major");
  return blocksMerge ? "request-changes" : "comment";
}

export async function runReviewSession(
  host: ReviewHost,
  reviewFn: ReviewFunction,
  opts: { inline: boolean },
): Promise<void> {
  const prContext = await host.fetchContext();

  const { markdown, inlineComments, overallVerdict } = await reviewFn(prContext, {
    requestInlineComments: opts.inline,
  });

  let filteredComments: (ReviewComment & { line: number })[] = [];
  if (opts.inline && inlineComments != null && inlineComments.length > 0) {
    const index = buildAddedLinesIndex(prContext.files);
    filteredComments = filterInlineComments(inlineComments, index, host.warn?.bind(host));
  }

  let verdict = overallVerdict;
  if (verdict == null) {
    verdict = deriveVerdictFromComments(filteredComments);
    console.warn(
      `overallVerdict was not provided in the response. Derived verdict from inline severities: ${verdict}.`,
    );
  }

  const formattedComments = filteredComments.map((c) => ({
    ...c,
    body: formatInlineCommentBody(c),
  }));

  await host.publishReview(markdown, formattedComments, verdict);
}
