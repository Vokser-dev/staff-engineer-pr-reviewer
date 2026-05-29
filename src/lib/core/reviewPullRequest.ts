import { LLMClient } from "@/lib/core/llm";
import { runReview } from "@/lib/core/prompt";
import { parseReviewResponse } from "@/lib/core/reviewResponse";
import { PullRequestContext, ReviewComment, Verdict } from "@/lib/types";

export async function reviewPullRequest(
  client: LLMClient,
  ctx: PullRequestContext,
  opts: { inline?: boolean } = {},
): Promise<{
  markdown: string;
  inlineComments: ReviewComment[];
  overallVerdict: Verdict;
}> {
  const inline = opts.inline ?? false;
  const reviewText = await runReview(client, ctx, { requestInlineComments: inline });
  return parseReviewResponse(reviewText);
}
