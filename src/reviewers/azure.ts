import { stripRef, resolveRepoPath, parseAzureDiff } from "@/lib/azure/pathResolver";
import {
  ReviewHost,
  ReviewFunction,
  runReviewSession,
  reviewPullRequest,
  ReviewerPlugin,
  createLLMClient,
} from "@/lib/index";
import { PullRequestContext, ReviewComment } from "@/lib/types";

const API_VERSION = "api-version=7.1";
const MAX_FILE_CHARS = 500_000;

interface AzureConfig {
  organization: string;
  project: string;
  repositoryId: string;
  pullRequestId: number;
  personalAccessToken: string;
}

function loadConfig(): AzureConfig {
  const required = (name: string): string => {
    const val = process.env[name];
    if (val == null || val === "")
      throw new Error(`Missing required environment variable: ${name}`);
    return val;
  };

  return {
    organization: required("AZURE_DEVOPS_ORG"),
    project: required("AZURE_DEVOPS_PROJECT"),
    repositoryId: required("AZURE_DEVOPS_REPO_ID"),
    pullRequestId: parseInt(required("AZURE_DEVOPS_PR_ID"), 10),
    personalAccessToken: required("AZURE_DEVOPS_PAT"),
  };
}

function authHeader(pat: string): string {
  return "Basic " + Buffer.from(`:${pat}`).toString("base64");
}

async function azureGet<T>(url: string, pat: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: authHeader(pat),
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Azure DevOps API error ${response.status}: ${url}`);
  }
  return response.json() as Promise<T>;
}

async function azurePost(url: string, pat: string, body: unknown): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader(pat),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Azure DevOps POST error ${response.status}: ${url}\n${text}`);
  }
}

async function azurePut(url: string, pat: string, body: unknown): Promise<void> {
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: authHeader(pat),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Azure DevOps PUT error ${response.status}: ${url}\n${text}`);
  }
}

interface AzureConnectionData {
  authenticatedUser: { id: string };
}

async function getCurrentUserId(organization: string, pat: string): Promise<string> {
  const url = `https://dev.azure.com/${organization}/_apis/connectionData`;
  const data = await azureGet<AzureConnectionData>(url, pat);
  return data.authenticatedUser.id;
}

const ADO_VOTE: Partial<Record<"approve" | "comment" | "request-changes", number>> = {
  approve: 10,
  "request-changes": -10,
};

async function postVote(
  config: AzureConfig,
  verdict: "approve" | "comment" | "request-changes",
): Promise<void> {
  const vote = ADO_VOTE[verdict];
  if (vote == null) return;

  const userId = await getCurrentUserId(config.organization, config.personalAccessToken);
  const url = `https://dev.azure.com/${config.organization}/${config.project}/_apis/git/repositories/${config.repositoryId}/pullRequests/${config.pullRequestId}/reviewers/${userId}?${API_VERSION}`;
  await azurePut(url, config.personalAccessToken, { vote });
}

interface AzurePR {
  title: string;
  description: string;
  createdBy: { displayName: string };
  targetRefName: string;
  sourceRefName: string;
  lastMergeSourceCommit: { commitId: string };
  lastMergeTargetCommit: { commitId: string };
}

interface AzureGitItem {
  content?: string;
  contentMetadata?: { isBinary?: boolean; encoding?: number };
  isFolder?: boolean;
}

interface AzureDiffChange {
  item: { path: string; isFolder?: boolean; gitObjectType?: string };
  changeType: string;
  originalPath?: string;
}

interface AzureCommitDiff {
  changes: AzureDiffChange[];
  allChangesIncluded?: boolean;
}

async function getFileContent(
  repoBase: string,
  pat: string,
  path: string,
  commitId: string,
): Promise<string | undefined> {
  const params = new URLSearchParams({
    path,
    "versionDescriptor.version": commitId,
    "versionDescriptor.versionType": "commit",
    includeContent: "true",
    "api-version": "7.1",
  });

  const response = await fetch(`${repoBase}/items?${params.toString()}`, {
    headers: {
      Authorization: authHeader(pat),
      Accept: "application/json",
    },
  });

  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`Azure DevOps API error ${response.status}: items ${path}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  let content: string;

  if (contentType.includes("application/json")) {
    const item = (await response.json()) as AzureGitItem;
    if (item.isFolder === true || item.contentMetadata?.isBinary === true) return undefined;
    if (item.content == null) return undefined;
    content = item.content;
  } else {
    content = await response.text();
  }

  if (content.length > MAX_FILE_CHARS) {
    console.warn(`Skipping ${path}: content exceeds ${MAX_FILE_CHARS} chars`);
    return undefined;
  }

  return content;
}

async function getPullRequestContext(config: AzureConfig): Promise<PullRequestContext> {
  const repoBase = `https://dev.azure.com/${config.organization}/${config.project}/_apis/git/repositories/${config.repositoryId}`;

  const pr = await azureGet<AzurePR>(
    `${repoBase}/pullRequests/${config.pullRequestId}?${API_VERSION}`,
    config.personalAccessToken,
  );

  const sourceCommitId = pr.lastMergeSourceCommit.commitId;
  const targetCommitId = pr.lastMergeTargetCommit.commitId;

  const diff = await azureGet<AzureCommitDiff>(
    `${repoBase}/diffs/commits?baseVersion=${targetCommitId}&baseVersionType=commit&targetVersion=${sourceCommitId}&targetVersionType=commit&$top=2000&${API_VERSION}`,
    config.personalAccessToken,
  );

  if (diff.allChangesIncluded === false) {
    console.warn("PR has more than 2000 changed paths; only the first page was reviewed.");
  }

  const files = await parseAzureDiff(
    diff.changes,
    sourceCommitId,
    targetCommitId,
    (path, commitId) => getFileContent(repoBase, config.personalAccessToken, path, commitId),
  );

  return {
    title: pr.title,
    description: pr.description ?? "",
    author: pr.createdBy.displayName,
    baseBranch: stripRef(pr.targetRefName),
    headBranch: stripRef(pr.sourceRefName),
    files,
  };
}

async function postReviewSummary(config: AzureConfig, markdown: string): Promise<void> {
  const url = `https://dev.azure.com/${config.organization}/${config.project}/_apis/git/repositories/${config.repositoryId}/pullRequests/${config.pullRequestId}/threads?${API_VERSION}`;
  await azurePost(url, config.personalAccessToken, {
    comments: [
      {
        parentCommentId: 0,
        content: markdown,
        commentType: 1,
      },
    ],
    status: 1,
  });
}

async function postInlineComment(
  config: AzureConfig,
  filePath: string,
  line: number,
  body: string,
): Promise<void> {
  const url = `https://dev.azure.com/${config.organization}/${config.project}/_apis/git/repositories/${config.repositoryId}/pullRequests/${config.pullRequestId}/threads?${API_VERSION}`;
  await azurePost(url, config.personalAccessToken, {
    comments: [
      {
        parentCommentId: 0,
        content: body,
        commentType: 1,
      },
    ],
    status: 1,
    threadContext: {
      filePath,
      leftFileStart: null,
      leftFileEnd: null,
      rightFileStart: { line, offset: 1 },
      rightFileEnd: { line, offset: 1 },
    },
  });
}

async function postInlineComments(
  config: AzureConfig,
  changedFiles: Set<string>,
  comments: ReviewComment[],
): Promise<number> {
  let posted = 0;

  for (const comment of comments) {
    const filePath = resolveRepoPath(comment.filename, changedFiles);
    if (filePath == null || filePath === "" || comment.line == null) {
      console.warn(`Skipping inline comment: could not resolve file "${comment.filename}"`);
      continue;
    }

    const body = comment.body;

    try {
      await postInlineComment(config, filePath, comment.line, body);
      posted++;
    } catch (err) {
      console.warn(`Failed to post inline comment on ${filePath}:${comment.line}:`, err);
    }
  }

  return posted;
}

export const run: ReviewerPlugin["run"] = async (): Promise<void> => {
  const config = loadConfig();

  console.log(
    `Reviewing Azure DevOps PR #${config.pullRequestId} in ${config.organization}/${config.project}`,
  );

  const llmClient = createLLMClient();

  const changedFiles = new Set<string>();

  const host: ReviewHost = {
    async fetchContext() {
      const ctx = await getPullRequestContext(config);
      for (const file of ctx.files) {
        changedFiles.add(file.filename);
      }
      return ctx;
    },
    async publishReview(summaryMarkdown, inlineComments, verdict) {
      await postReviewSummary(config, summaryMarkdown);
      await postInlineComments(config, changedFiles, inlineComments);
      try {
        await postVote(config, verdict);
        if (verdict !== "comment") {
          console.log(`Vote posted: ${verdict}`);
        }
      } catch (err) {
        console.warn("Failed to post vote:", err);
      }
    },
  };

  const reviewFn: ReviewFunction = (pr, options) => {
    return reviewPullRequest(llmClient, pr, { inline: options?.requestInlineComments });
  };

  await runReviewSession(host, reviewFn, { inline: true });

  console.log("Review posted successfully.");
};

if (require.main === module) {
  run().catch((err: Error) => {
    console.error("Fatal error:", err.message);
    process.exit(1);
  });
}
