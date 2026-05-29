import { LLMClient } from "@/lib/core/llm";
import { PullRequestContext, ReviewComment, runReview } from "@/lib/core/prompt";
import { parseReviewResponse } from "@/lib/core/reviewResponse";

export async function reviewPullRequest(
  client: LLMClient,
  ctx: PullRequestContext,
  opts: { inline?: boolean } = {},
): Promise<{
  markdown: string;
  inlineComments: ReviewComment[];
  overallVerdict?: "approve" | "comment" | "request-changes";
}> {
  const inline = opts.inline ?? false;
  const reviewText = await runReview(client, ctx, { requestInlineComments: inline });
  return parseReviewResponse(reviewText);
}
