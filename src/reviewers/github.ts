import * as fs from "fs";

import * as core from "@actions/core";
import * as github from "@actions/github";
import * as dotenv from "dotenv";
import { simpleGit } from "simple-git";

import {
  PullRequestContext,
  PullRequestFile,
  ReviewComment,
  Verdict,
  reviewPullRequest,
  ReviewHost,
  ReviewFunction,
  runReviewSession,
  createLLMClient,
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

function verdictToEvent(verdict: Verdict): ReviewEvent {
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

function printReviewToConsole(
  summaryMarkdown: string,
  inlineComments: ReviewComment[],
  verdict: Verdict,
): void {
  console.log("\n========================================================");
  console.log("                  SAMMENDRAG AV REVIEW                  ");
  console.log("========================================================\n");
  console.log(summaryMarkdown);

  console.log("\n========================================================");
  console.log("                   INLINE-KOMMENTARER                   ");
  console.log("========================================================\n");

  const validComments = inlineComments.filter(
    (c): c is ReviewComment & { line: number } => c.line != null,
  );
  if (validComments.length > 0) {
    for (const comment of validComments) {
      console.log(`📌 Fil:              ${comment.filename}:${comment.line}`);
      console.log(`   Alvorlighetsgrad: ${comment.severity.toUpperCase()}`);
      console.log(`   Kommentar:        ${comment.body}`);
      console.log("--------------------------------------------------------");
    }
  } else {
    console.log("Ingen inline-kommentarer funnet.");
  }

  console.log(`\nSamlet vurdering: ${verdict.toUpperCase()}`);
  console.log("========================================================\n");
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

export const run = async (options?: {
  ref?: string;
  repo?: string;
  pr?: number;
}): Promise<void> => {
  const isActions = process.env.GITHUB_ACTIONS === "true";

  // Load local environment variables if we're not running in GitHub Actions
  if (!isActions) {
    const envPath = fs.existsSync(".env.local") ? ".env.local" : ".env";
    dotenv.config({ path: envPath });
  }

  const logInfo = (msg: string) => (isActions ? core.info(msg) : console.log(msg));
  const logWarn = (msg: string) => (isActions ? core.warning(msg) : console.warn(msg));
  const logError = (msg: string) => (isActions ? core.setFailed(msg) : console.error(msg));

  // Get token with fallback to env vars
  let token = process.env.GITHUB_TOKEN ?? process.env.INPUT_GITHUB_TOKEN;
  if (token === undefined || token === "") {
    token = isActions ? core.getInput("github-token", { required: false }) : "";
  }

  // Normalize API keys from Action inputs to env vars so the LLM factory can read them.
  // Locally the keys come from the loaded .env file (or the surrounding shell environment).
  if (isActions) {
    const anthropicKey = core.getInput("anthropic-api-key");
    if (anthropicKey !== "") process.env.ANTHROPIC_API_KEY = anthropicKey;
    const openaiKey = core.getInput("openai-api-key");
    if (openaiKey !== "") process.env.OPENAI_API_KEY = openaiKey;
  }

  if (token === "") {
    logError("GitHub token is required (set GITHUB_TOKEN environment variable).");
    if (!isActions) process.exit(1);
    return;
  }

  // Require at least one provider API key; createLLMClient() picks the provider via LLM_PROVIDER.
  const hasAnthropicKey = (process.env.ANTHROPIC_API_KEY ?? "") !== "";
  const hasOpenaiKey = (process.env.OPENAI_API_KEY ?? "") !== "";
  if (!hasAnthropicKey && !hasOpenaiKey) {
    logError("Missing required API key: provide either ANTHROPIC_API_KEY or OPENAI_API_KEY.");
    if (!isActions) process.exit(1);
    return;
  }

  const octokit = github.getOctokit(token);

  let owner = "";
  let repo = "";
  let pullNumber: number | undefined = undefined;
  let targetCommitSha: string | undefined = undefined;

  if (
    isActions &&
    options?.ref === undefined &&
    options?.pr === undefined &&
    options?.repo === undefined
  ) {
    // Standard GitHub Actions workflow path
    const context = github.context;
    if (context.eventName !== "pull_request") {
      core.setFailed("This action only runs on pull_request events.");
      return;
    }

    pullNumber = context.payload.pull_request?.number;
    if (pullNumber === undefined) {
      core.setFailed("Could not determine pull request number.");
      return;
    }

    owner = context.repo.owner;
    repo = context.repo.repo;
  } else {
    // Local CLI path (or overridden actions run)
    const git = simpleGit();

    // 1. Determine repository owner and repo
    if (options?.repo !== undefined) {
      const parts = options.repo.split("/");
      if (parts.length !== 2) {
        logError(`Invalid repository format: "${options.repo}". Expected "owner/repo".`);
        process.exit(1);
      }
      owner = parts[0];
      repo = parts[1];
    } else if (
      process.env.GITHUB_REPOSITORY !== undefined &&
      process.env.GITHUB_REPOSITORY !== ""
    ) {
      const parts = process.env.GITHUB_REPOSITORY.split("/");
      owner = parts[0];
      repo = parts[1];
    } else {
      try {
        const remotes = await git.getRemotes(true);
        const origin = remotes.find((r) => r.name === "origin")?.refs.push;
        if (origin === undefined || origin === "") {
          logError(
            "Could not find 'origin' remote URL. Please specify repository using --repo <owner/repo>.",
          );
          process.exit(1);
        }
        const cleanUrl = origin.replace(/\.git$/, "");
        const match = cleanUrl.match(/([^/:]+)\/([^/:]+)$/);
        if (match === null) {
          logError(
            `Could not parse owner/repo from remote URL: "${origin}". Please specify repository using --repo <owner/repo>.`,
          );
          process.exit(1);
        }
        owner = match[1];
        repo = match[2];
      } catch (err) {
        logError(
          `Error detecting git remote: ${err instanceof Error ? err.message : String(err)}. Please specify repository using --repo <owner/repo>.`,
        );
        process.exit(1);
      }
    }

    // 2. Resolve commit SHA if ref is provided (or default to HEAD if pr is not specified)
    if (options?.ref !== undefined || options?.pr === undefined) {
      const ref = options?.ref ?? "HEAD";
      try {
        targetCommitSha = (await git.raw(["rev-parse", ref])).trim();
      } catch (err) {
        logError(
          `Could not resolve git ref "${ref}": ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
    }

    // 3. Determine pull request number
    if (options?.pr !== undefined) {
      pullNumber = options.pr;
    } else if (targetCommitSha !== undefined && targetCommitSha !== "") {
      logInfo(`Finding Pull Request associated with commit: ${targetCommitSha}`);
      try {
        const prs = await octokit.rest.repos.listPullRequestsAssociatedWithCommit({
          owner,
          repo,
          commit_sha: targetCommitSha,
        });

        const openPrs = prs.data.filter((p) => p.state === "open");
        if (openPrs.length > 1) {
          logError(
            `Commit ${targetCommitSha} is associated with multiple open PRs (${openPrs
              .map((p) => `#${p.number}`)
              .join(", ")}). Please specify which one to review with --pr <number>.`,
          );
          process.exit(1);
        }
        const matchedPr = openPrs[0] ?? prs.data[0];

        if (matchedPr === undefined) {
          logError(
            `No Pull Request found on GitHub associated with commit ${targetCommitSha}. Please ensure the commit has been pushed and a PR is open, or specify the PR number using --pr.`,
          );
          process.exit(1);
        }

        pullNumber = matchedPr.number;
        logInfo(`Found PR #${pullNumber} ("${matchedPr.title}")`);
      } catch (err) {
        logError(
          `Failed to fetch associated Pull Request from GitHub: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        process.exit(1);
      }
    }
  }

  if (pullNumber === undefined || owner === "" || repo === "") {
    logError("Could not resolve owner, repo, or pull request number.");
    if (!isActions) process.exit(1);
    return;
  }

  logInfo(`Reviewing PR #${pullNumber} in ${owner}/${repo}`);

  if (!isActions) {
    logInfo("Running locally: review will be printed to the console and NOT posted to GitHub.");
  }

  const llmClient = createLLMClient();

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
      // Anchor review comments on the target commit if specified, otherwise on the PR head SHA
      headSha = targetCommitSha ?? sha;
      return prContext;
    },
    async publishReview(summaryMarkdown, inlineComments, verdict) {
      reviewSummary = summaryMarkdown;

      if (!isActions) {
        printReviewToConsole(summaryMarkdown, inlineComments, verdict);
        return;
      }

      if (headSha == null || headSha === "") {
        throw new Error("Cannot publish review: headSha was not resolved during fetchContext");
      }
      const event = verdictToEvent(verdict);
      logInfo(
        `Posting review (event=${event}) with ${inlineComments.length} inline comment(s) on commit ${headSha}.`,
      );
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
        logInfo("Review posted successfully.");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logWarn(`Failed to create formal review (${message}). Falling back to flat comment.`);
        await postFallbackComment(octokit, owner, repo, pullNumber, summaryMarkdown);
        logInfo("Fallback comment posted.");
      }
    },
    warn(msg) {
      logWarn(msg);
    },
  };

  const reviewFn: ReviewFunction = (pr, options) => {
    core.info(`PR has ${pr.files.length} changed file(s). Sending to LLM...`);
    return reviewPullRequest(llmClient, pr, { inline: options?.requestInlineComments });
  };

  try {
    await runReviewSession(host, reviewFn, { inline: true });
  } catch (err) {
    logError(`Review session failed: ${err instanceof Error ? err.message : String(err)}`);
    if (!isActions) process.exit(1);
    return;
  }

  if (isActions) {
    core.setOutput("review", reviewSummary);
  }
};

if (require.main === module) {
  run().catch((err: Error) => {
    core.setFailed(err.message);
  });
}
