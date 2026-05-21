import Anthropic from "@anthropic-ai/sdk";
import { createTwoFilesPatch } from "diff";
import {
  formatInlineCommentBody,
  PullRequestContext,
  PullRequestFile,
  ReviewComment,
  ReviewHost,
  ReviewFunction,
  runReviewSession,
  reviewPullRequest,
  ReviewerPlugin,
} from "@/lib/index";
import {
  stripRef,
  changeTypeLabel,
  statsFromPatch,
  resolveRepoPath,
} from "@/lib/azure/pathResolver";

const API_VERSION = "api-version=7.1";
const MAX_FILE_CHARS = 500_000;

interface AzureConfig {
  organization: string;
  project: string;
  repositoryId: string;
  pullRequestId: number;
  personalAccessToken: string;
  anthropicApiKey: string;
}

function loadConfig(): AzureConfig {
  const required = (name: string): string => {
    const val = process.env[name];
    if (!val) throw new Error(`Missing required environment variable: ${name}`);
    return val;
  };

  return {
    organization: required("AZURE_DEVOPS_ORG"),
    project: required("AZURE_DEVOPS_PROJECT"),
    repositoryId: required("AZURE_DEVOPS_REPO_ID"),
    pullRequestId: parseInt(required("AZURE_DEVOPS_PR_ID"), 10),
    personalAccessToken: required("AZURE_DEVOPS_PAT"),
    anthropicApiKey: required("ANTHROPIC_API_KEY"),
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
    if (item.isFolder || item.contentMetadata?.isBinary) return undefined;
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

function buildFilePatch(
  oldPath: string,
  newPath: string,
  oldContent: string,
  newContent: string,
): string | undefined {
  const patch = createTwoFilesPatch(oldPath, newPath, oldContent, newContent, "", "", {
    context: 3,
  });
  const hasChanges = patch.split("\n").some((l) => l.startsWith("+") || l.startsWith("-"));
  return hasChanges ? patch : undefined;
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

  const blobChanges = diff.changes.filter(
    (c) => !c.item.isFolder && c.item.gitObjectType !== "tree",
  );

  const files: PullRequestFile[] = await Promise.all(
    blobChanges.map(async (change) => {
      const status = changeTypeLabel(change.changeType);
      const filename = change.item.path;

      if (status === "added") {
        const content = await getFileContent(
          repoBase,
          config.personalAccessToken,
          filename,
          sourceCommitId,
        );
        const patch = content ? buildFilePatch("/dev/null", filename, "", content) : undefined;
        return {
          filename,
          status,
          additions: content ? content.split("\n").length : 0,
          deletions: 0,
          patch,
        };
      }

      if (status === "removed") {
        const content = await getFileContent(
          repoBase,
          config.personalAccessToken,
          filename,
          targetCommitId,
        );
        const patch = content ? buildFilePatch(filename, "/dev/null", content, "") : undefined;
        return {
          filename,
          status,
          additions: 0,
          deletions: content ? content.split("\n").length : 0,
          patch,
        };
      }

      const [oldContent, newContent] = await Promise.all([
        getFileContent(
          repoBase,
          config.personalAccessToken,
          change.originalPath || filename,
          targetCommitId,
        ),
        getFileContent(repoBase, config.personalAccessToken, filename, sourceCommitId),
      ]);

      let additions = 0;
      let deletions = 0;
      let patch: string | undefined;

      if (oldContent !== undefined && newContent !== undefined) {
        patch = buildFilePatch(change.originalPath || filename, filename, oldContent, newContent);
        if (patch) {
          ({ additions, deletions } = statsFromPatch(patch));
        }
      }

      return {
        filename,
        status,
        additions,
        deletions,
        patch,
      };
    }),
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
  pr: PullRequestContext,
  comments: ReviewComment[],
): Promise<number> {
  const changedFiles = new Set(pr.files.map((f) => f.filename));
  let posted = 0;

  for (const comment of comments) {
    const filePath = resolveRepoPath(comment.filename, changedFiles);
    if (!filePath || comment.line == null) {
      console.warn(`Skipping inline comment: could not resolve file "${comment.filename}"`);
      continue;
    }

    const body = formatInlineCommentBody(comment);

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

  const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

  const host: ReviewHost = {
    async fetchContext() {
      return getPullRequestContext(config);
    },
    async publishSummary(markdown) {
      await postReviewSummary(config, markdown);
    },
    async publishInline(comments, ctx) {
      return postInlineComments(config, ctx, comments);
    },
  };

  const reviewFn: ReviewFunction = (pr, options) => {
    return reviewPullRequest(anthropic, pr, { inline: options?.requestInlineComments });
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
