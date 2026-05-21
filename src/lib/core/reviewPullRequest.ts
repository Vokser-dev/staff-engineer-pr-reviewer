import Anthropic from "@anthropic-ai/sdk";

import { PullRequestContext, ReviewComment, runReview } from "@/lib/core/prompt";
import { parseReviewResponse } from "@/lib/core/reviewResponse";

export async function reviewPullRequest(
  client: Anthropic,
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
