import * as core from "@actions/core";
import * as github from "@actions/github";
import Anthropic from "@anthropic-ai/sdk";

import {
  PullRequestContext,
  PullRequestFile,
  ReviewComment,
  reviewPullRequest,
  ReviewerPlugin,
  ReviewHost,
  ReviewFunction,
  runReviewSession,
} from "@/lib/index";

type ReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

interface PullRequestData {
  context: PullRequestContext;
  headSha: string;
}

async function getPullRequestData(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<PullRequestData> {
  const { data: pr } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: pullNumber,
  });

  const { data: rawFiles } = await octokit.rest.pulls.listFiles({
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100,
  });

  const files: PullRequestFile[] = rawFiles.map((f) => ({
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    patch: f.patch,
  }));

  return {
    context: {
      title: pr.title,
      description: pr.body ?? "",
      author: pr.user?.login ?? "unknown",
      baseBranch: pr.base.ref,
      headBranch: pr.head.ref,
      files,
    },
    headSha: pr.head.sha,
  };
}

function verdictToEvent(verdict: "approve" | "comment" | "request-changes"): ReviewEvent {
  switch (verdict) {
    case "approve":
      return "APPROVE";
    case "request-changes":
      return "REQUEST_CHANGES";
    case "comment":
      return "COMMENT";
  }
}

async function postReview(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  pullNumber: number,
  commitId: string,
  body: string,
  event: ReviewEvent,
  inlineComments: ReviewComment[],
): Promise<void> {
  const reviewComments = inlineComments
    .filter((c): c is ReviewComment & { line: number } => c.line != null)
    .map((c) => ({
      path: c.filename,
      line: c.line,
      side: "RIGHT" as const,
      body: c.body,
    }));

  await octokit.rest.pulls.createReview({
    owner,
    repo,
    pull_number: pullNumber,
    commit_id: commitId,
    body,
    event,
    comments: reviewComments,
  });
}

async function postFallbackComment(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  pullNumber: number,
  body: string,
): Promise<void> {
  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: pullNumber,
    body,
  });
}

export const run: ReviewerPlugin["run"] = async (): Promise<void> => {
  const token = core.getInput("github-token", { required: true });
  const anthropicApiKey = core.getInput("anthropic-api-key", {
    required: true,
  });

  const octokit = github.getOctokit(token);
  const context = github.context;

  if (context.eventName !== "pull_request") {
    core.setFailed("This action only runs on pull_request events.");
    return;
  }

  const pullNumber = context.payload.pull_request?.number;
  if (pullNumber == null) {
    core.setFailed("Could not determine pull request number.");
    return;
  }

  const { owner, repo } = context.repo;

  core.info(`Reviewing PR #${pullNumber} in ${owner}/${repo}`);

  const anthropic = new Anthropic({ apiKey: anthropicApiKey });

  let headSha: string | undefined = undefined;
  let reviewSummary = "";

  const host: ReviewHost = {
    async fetchContext() {
      const { context: prContext, headSha: sha } = await getPullRequestData(
        octokit,
        owner,
        repo,
        pullNumber,
      );
      headSha = sha;
      return prContext;
    },
    async publishReview(summaryMarkdown, inlineComments, verdict) {
      reviewSummary = summaryMarkdown;
      if (headSha == null || headSha === "") {
        throw new Error("Cannot publish review: headSha was not resolved during fetchContext");
      }
      const event = verdictToEvent(verdict);
      core.info(`Posting review (event=${event}) with ${inlineComments.length} inline comment(s).`);
      try {
        await postReview(
          octokit,
          owner,
          repo,
          pullNumber,
          headSha,
          summaryMarkdown,
          event,
          inlineComments,
        );
        core.info("Review posted successfully.");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        core.warning(`Failed to create formal review (${message}). Falling back to flat comment.`);
        await postFallbackComment(octokit, owner, repo, pullNumber, summaryMarkdown);
        core.info("Fallback comment posted.");
      }
    },
    warn(msg) {
      core.warning(msg);
    },
  };

  const reviewFn: ReviewFunction = (pr, options) => {
    core.info(`PR has ${pr.files.length} changed file(s). Sending to Claude...`);
    return reviewPullRequest(anthropic, pr, { inline: options?.requestInlineComments });
  };

  await runReviewSession(host, reviewFn, { inline: true });

  core.setOutput("review", reviewSummary);
};

if (require.main === module) {
  run().catch((err: Error) => {
    core.setFailed(err.message);
  });
}
