import { PullRequestContext, ReviewComment } from "@/lib/core/prompt";

export interface ReviewHost {
  fetchContext(): Promise<PullRequestContext>;
  publishSummary(markdown: string): Promise<void>;
  publishInline(comments: ReviewComment[], ctx: PullRequestContext): Promise<number>;
}

export type ReviewFunction = (
  pr: PullRequestContext,
  options?: { requestInlineComments?: boolean },
) => Promise<{ markdown: string; inlineComments: ReviewComment[] }>;

export async function runReviewSession(
  host: ReviewHost,
  reviewFn: ReviewFunction,
  opts: { inline: boolean },
): Promise<void> {
  const prContext = await host.fetchContext();

  const { markdown, inlineComments } = await reviewFn(prContext, {
    requestInlineComments: opts.inline,
  });

  await host.publishSummary(markdown);

  if (opts.inline && inlineComments && inlineComments.length > 0) {
    try {
      await host.publishInline(inlineComments, prContext);
    } catch (err) {
      console.warn("Failed to publish inline comments:", err);
    }
  }
}
