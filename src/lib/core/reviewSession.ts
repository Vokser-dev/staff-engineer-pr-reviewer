import { deriveVerdictFromComments } from "@/lib/core/reviewResponse";
import { PullRequestContext, PullRequestFile, ReviewComment, Verdict } from "@/lib/types";

export interface ReviewHost {
  fetchContext(): Promise<PullRequestContext>;
  publishReview(
    summaryMarkdown: string,
    inlineComments: ReviewComment[],
    verdict: Verdict,
  ): Promise<void>;
  warn?(message: string): void;
}

export type ReviewFunction = (
  pr: PullRequestContext,
  options?: { requestInlineComments?: boolean },
) => Promise<{
  markdown: string;
  inlineComments: ReviewComment[];
  overallVerdict?: Verdict;
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

/**
 * Warns when changed files arrive without diff content. A missing `patch` can be
 * legitimate (binary/oversized files) but it can also mean file content could not be
 * fetched (network/permission failure), in which case the model reviews blind. We surface
 * this rather than silently sending empty diffs; the all-files-missing case gets a stronger
 * warning since it most likely indicates a systemic fetch failure.
 */
export function warnOnMissingDiffs(files: PullRequestFile[], warn?: (msg: string) => void): void {
  const missing = files.filter((f) => f.patch == null || f.patch === "");
  if (missing.length === 0) return;

  const names = missing.map((f) => f.filename).join(", ");
  if (missing.length === files.length) {
    warn?.(
      `None of the ${files.length} changed file(s) have diff content (${names}); the review ` +
        `will run without diffs. This usually means the files are binary/oversized or their ` +
        `content could not be fetched.`,
    );
  } else {
    warn?.(
      `${missing.length} of ${files.length} changed file(s) have no diff content and will be ` +
        `reviewed without diffs: ${names}.`,
    );
  }
}

export async function runReviewSession(
  host: ReviewHost,
  reviewFn: ReviewFunction,
  opts: { inline: boolean },
): Promise<void> {
  const prContext = await host.fetchContext();

  warnOnMissingDiffs(prContext.files, host.warn?.bind(host));

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

  await host.publishReview(markdown, filteredComments, verdict);
}
