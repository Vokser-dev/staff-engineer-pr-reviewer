import * as core from "@actions/core";
import * as github from "@actions/github";
import Anthropic from "@anthropic-ai/sdk";
import {
  PullRequestContext,
  PullRequestFile,
  runReview,
} from "../../shared/prompt";

async function getPullRequestContext(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<PullRequestContext> {
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
    title: pr.title,
    description: pr.body ?? "",
    author: pr.user?.login ?? "unknown",
    baseBranch: pr.base.ref,
    headBranch: pr.head.ref,
    files,
  };
}

async function postReviewComment(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  pullNumber: number,
  body: string
): Promise<void> {
  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: pullNumber,
    body,
  });
}

async function run(): Promise<void> {
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
  if (!pullNumber) {
    core.setFailed("Could not determine pull request number.");
    return;
  }

  const { owner, repo } = context.repo;

  core.info(`Reviewing PR #${pullNumber} in ${owner}/${repo}`);

  const anthropic = new Anthropic({ apiKey: anthropicApiKey });

  const prContext = await getPullRequestContext(
    octokit,
    owner,
    repo,
    pullNumber
  );

  core.info(
    `PR has ${prContext.files.length} changed file(s). Sending to Claude...`
  );

  const review = await runReview(anthropic, prContext);

  await postReviewComment(octokit, owner, repo, pullNumber, review);

  core.info("Review posted successfully.");
  core.setOutput("review", review);
}

run().catch((err: Error) => {
  core.setFailed(err.message);
});
