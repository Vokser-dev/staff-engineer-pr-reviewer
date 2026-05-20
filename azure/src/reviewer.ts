import Anthropic from "@anthropic-ai/sdk";
import { createTwoFilesPatch } from "diff";
import {
  formatInlineCommentBody,
  PullRequestContext,
  PullRequestFile,
  ReviewComment,
  runReview,
  splitReviewResponse,
} from "../../shared/prompt";

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

async function azurePost(
  url: string,
  pat: string,
  body: unknown
): Promise<void> {
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
    throw new Error(
      `Azure DevOps POST error ${response.status}: ${url}\n${text}`
    );
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

interface AzureIteration {
  id: number;
}

interface AzureIterationChange {
  changeTrackingId: number;
  item: { path: string };
}

interface AzureIterationChanges {
  changeEntries: AzureIterationChange[];
}

interface AzureReviewBundle {
  pr: PullRequestContext;
  latestIterationId: number;
  changeTrackingByPath: Map<string, number>;
}

function stripRef(ref: string): string {
  return ref.replace(/^refs\/heads\//, "");
}

function changeTypeLabel(changeType: string): string {
  const ct = changeType.toLowerCase();
  if (ct === "delete") return "removed";
  if (ct === "rename" || ct === "sourcerename" || ct === "targetrename") {
    return "renamed";
  }
  if (ct === "add") return "added";
  return "modified";
}

function statsFromPatch(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) {
      continue;
    }
    if (line.startsWith("+")) additions++;
    else if (line.startsWith("-")) deletions++;
  }
  return { additions, deletions };
}

async function getFileContent(
  repoBase: string,
  pat: string,
  path: string,
  commitId: string
): Promise<string | undefined> {
  const params = new URLSearchParams({
    path,
    "versionDescriptor.version": commitId,
    "versionDescriptor.versionType": "commit",
    includeContent: "true",
    "api-version": "7.1",
  });

  const response = await fetch(`${repoBase}/items?${params}`, {
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
  newContent: string
): string | undefined {
  const patch = createTwoFilesPatch(
    oldPath,
    newPath,
    oldContent,
    newContent,
    "",
    "",
    { context: 3 }
  );
  const hasChanges = patch.split("\n").some((l) => l.startsWith("+") || l.startsWith("-"));
  return hasChanges ? patch : undefined;
}

async function getIterationContext(
  repoBase: string,
  pullRequestId: number,
  pat: string
): Promise<{
  latestIterationId: number;
  changeTrackingByPath: Map<string, number>;
}> {
  const iterations = await azureGet<{ value: AzureIteration[] }>(
    `${repoBase}/pullRequests/${pullRequestId}/iterations?${API_VERSION}`,
    pat
  );
  const latestIterationId = iterations.value[iterations.value.length - 1].id;

  const changes = await azureGet<AzureIterationChanges>(
    `${repoBase}/pullRequests/${pullRequestId}/iterations/${latestIterationId}/changes?${API_VERSION}`,
    pat
  );

  const changeTrackingByPath = new Map<string, number>();
  for (const entry of changes.changeEntries) {
    changeTrackingByPath.set(entry.item.path, entry.changeTrackingId);
  }

  return { latestIterationId, changeTrackingByPath };
}

function resolveRepoPath(
  filename: string,
  changedFiles: Set<string>
): string | undefined {
  const normalized = filename.replace(/^\//, "");
  if (changedFiles.has(normalized)) return `/${normalized}`;

  for (const f of changedFiles) {
    if (f === normalized || f.endsWith(`/${normalized}`)) {
      return `/${f}`;
    }
  }
  return undefined;
}

async function getReviewBundle(config: AzureConfig): Promise<AzureReviewBundle> {
  const repoBase = `https://dev.azure.com/${config.organization}/${config.project}/_apis/git/repositories/${config.repositoryId}`;

  const [pr, iteration] = await Promise.all([
    azureGet<AzurePR>(
      `${repoBase}/pullRequests/${config.pullRequestId}?${API_VERSION}`,
      config.personalAccessToken
    ),
    getIterationContext(
      repoBase,
      config.pullRequestId,
      config.personalAccessToken
    ),
  ]);

  const sourceCommitId = pr.lastMergeSourceCommit.commitId;
  const targetCommitId = pr.lastMergeTargetCommit.commitId;

  const diff = await azureGet<AzureCommitDiff>(
    `${repoBase}/diffs/commits?baseVersion=${targetCommitId}&baseVersionType=commit&targetVersion=${sourceCommitId}&targetVersionType=commit&$top=2000&${API_VERSION}`,
    config.personalAccessToken
  );

  if (diff.allChangesIncluded === false) {
    console.warn(
      "PR has more than 2000 changed paths; only the first page was reviewed."
    );
  }

  const blobChanges = diff.changes.filter(
    (c) => !c.item.isFolder && c.item.gitObjectType !== "tree"
  );

  const files: PullRequestFile[] = await Promise.all(
    blobChanges.map(async (change) => {
      const newPath = change.item.path;
      const oldPath = change.originalPath ?? newPath;
      const displayPath = newPath.replace(/^\//, "");
      const status = changeTypeLabel(change.changeType);

      let patch: string | undefined;
      let additions = 0;
      let deletions = 0;

      try {
        const ct = change.changeType.toLowerCase();
        const oldRaw =
          ct === "add"
            ? ""
            : await getFileContent(
                repoBase,
                config.personalAccessToken,
                oldPath,
                targetCommitId
              );
        const newRaw =
          ct === "delete"
            ? ""
            : await getFileContent(
                repoBase,
                config.personalAccessToken,
                newPath,
                sourceCommitId
              );

        if (oldRaw === undefined && newRaw === undefined) {
          console.warn(`Diff skipped for ${newPath}: binary or unreadable`);
        } else {
          patch = buildFilePatch(
            oldPath,
            newPath,
            oldRaw ?? "",
            newRaw ?? ""
          );
          if (patch) {
            ({ additions, deletions } = statsFromPatch(patch));
          }
        }
      } catch (err) {
        console.warn(`Diff failed for ${newPath}:`, err);
      }

      return { filename: displayPath, status, additions, deletions, patch };
    })
  );

  const prContext: PullRequestContext = {
    title: pr.title,
    description: pr.description ?? "",
    author: pr.createdBy.displayName,
    baseBranch: stripRef(pr.targetRefName),
    headBranch: stripRef(pr.sourceRefName),
    files,
  };

  return {
    pr: prContext,
    latestIterationId: iteration.latestIterationId,
    changeTrackingByPath: iteration.changeTrackingByPath,
  };
}

function threadsUrl(config: AzureConfig): string {
  return `https://dev.azure.com/${config.organization}/${config.project}/_apis/git/repositories/${config.repositoryId}/pullRequests/${config.pullRequestId}/threads?api-version=7.1`;
}

async function postReviewSummary(
  config: AzureConfig,
  body: string
): Promise<void> {
  await azurePost(threadsUrl(config), config.personalAccessToken, {
    comments: [{ parentCommentId: 0, content: body, commentType: 1 }],
    status: 1,
  });
}

async function postInlineComment(
  config: AzureConfig,
  filePath: string,
  line: number,
  body: string,
  latestIterationId: number,
  changeTrackingId?: number
): Promise<void> {
  const payload: Record<string, unknown> = {
    comments: [{ parentCommentId: 0, content: body, commentType: 1 }],
    status: 1,
    threadContext: {
      filePath,
      leftFileStart: null,
      leftFileEnd: null,
      rightFileStart: { line, offset: 1 },
      rightFileEnd: { line, offset: 1 },
    },
  };

  if (changeTrackingId != null) {
    payload.pullRequestThreadContext = {
      changeTrackingId,
      iterationContext: {
        firstComparingIteration: 1,
        secondComparingIteration: latestIterationId,
      },
    };
  }

  await azurePost(threadsUrl(config), config.personalAccessToken, payload);
}

async function postInlineComments(
  config: AzureConfig,
  bundle: AzureReviewBundle,
  comments: ReviewComment[]
): Promise<number> {
  const changedFiles = new Set(bundle.pr.files.map((f) => f.filename));
  let posted = 0;

  for (const comment of comments) {
    const filePath = resolveRepoPath(comment.filename, changedFiles);
    if (!filePath || comment.line == null) {
      console.warn(
        `Skipping inline comment: could not resolve file "${comment.filename}"`
      );
      continue;
    }

    const changeTrackingId = bundle.changeTrackingByPath.get(filePath);
    const body = formatInlineCommentBody(comment);

    try {
      await postInlineComment(
        config,
        filePath,
        comment.line,
        body,
        bundle.latestIterationId,
        changeTrackingId
      );
      posted++;
    } catch (err) {
      console.warn(`Failed to post inline comment on ${filePath}:${comment.line}:`, err);
    }
  }

  return posted;
}

async function run(): Promise<void> {
  const config = loadConfig();

  console.log(
    `Reviewing Azure DevOps PR #${config.pullRequestId} in ${config.organization}/${config.project}`
  );

  const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

  const bundle = await getReviewBundle(config);

  const withPatch = bundle.pr.files.filter((f) => f.patch).length;
  console.log(
    `PR has ${bundle.pr.files.length} changed file(s), ${withPatch} with diff content. Sending to Claude...`
  );

  const reviewText = await runReview(anthropic, bundle.pr, {
    requestInlineComments: true,
  });

  const { markdown, inlineComments } = splitReviewResponse(reviewText);

  const inlinePosted = await postInlineComments(config, bundle, inlineComments);
  console.log(
    `Posted ${inlinePosted} inline comment(s) (${inlineComments.length} requested).`
  );

  await postReviewSummary(config, markdown);

  console.log("Review posted successfully.");
}

run().catch((err: Error) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
