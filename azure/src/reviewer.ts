import Anthropic from "@anthropic-ai/sdk";
import {
  PullRequestContext,
  PullRequestFile,
  runReview,
} from "../../shared/prompt";

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
}

interface AzureIteration {
  id: number;
}

interface AzureIterationChange {
  item: { path: string };
  changeType: number;
}

interface AzureIterationChanges {
  changeEntries: AzureIterationChange[];
}

interface AzureFileDiff {
  blocks: Array<{
    changeType: number;
    mLines: string[];
    oLines: string[];
  }>;
}

function stripRef(ref: string): string {
  return ref.replace(/^refs\/heads\//, "");
}

function changeTypeLabel(ct: number): string {
  // Azure change type flags: 1=add, 2=edit, 4=delete, 8=rename
  if (ct & 4) return "removed";
  if (ct & 8) return "renamed";
  if (ct & 1) return "added";
  return "modified";
}

function diffBlocksToPatch(diff: AzureFileDiff): string {
  return diff.blocks
    .map((block) => {
      if (block.changeType === 0) return "";
      const removed = block.oLines.map((l) => `-${l}`).join("\n");
      const added = block.mLines.map((l) => `+${l}`).join("\n");
      return [removed, added].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n");
}

async function getPullRequestContext(
  config: AzureConfig
): Promise<PullRequestContext> {
  const base = `https://dev.azure.com/${config.organization}/${config.project}/_apis/git/repositories/${config.repositoryId}`;
  const apiVersion = "api-version=7.1";

  const pr = await azureGet<AzurePR>(
    `${base}/pullRequests/${config.pullRequestId}?${apiVersion}`,
    config.personalAccessToken
  );

  const iterations = await azureGet<{ value: AzureIteration[] }>(
    `${base}/pullRequests/${config.pullRequestId}/iterations?${apiVersion}`,
    config.personalAccessToken
  );

  const latestIteration = iterations.value[iterations.value.length - 1];

  const changes = await azureGet<AzureIterationChanges>(
    `${base}/pullRequests/${config.pullRequestId}/iterations/${latestIteration.id}/changes?${apiVersion}`,
    config.personalAccessToken
  );

  const files: PullRequestFile[] = await Promise.all(
    changes.changeEntries.map(async (entry) => {
      const filePath = entry.item.path.replace(/^\//, "");
      let patch: string | undefined;
      let additions = 0;
      let deletions = 0;

      try {
        const diff = await azureGet<AzureFileDiff>(
          `${base}/pullRequests/${config.pullRequestId}/iterations/${latestIteration.id}/changes?path=${encodeURIComponent(entry.item.path)}&${apiVersion}`,
          config.personalAccessToken
        );
        patch = diffBlocksToPatch(diff);
        additions = diff.blocks.reduce(
          (sum, b) => sum + (b.mLines?.length ?? 0),
          0
        );
        deletions = diff.blocks.reduce(
          (sum, b) => sum + (b.oLines?.length ?? 0),
          0
        );
      } catch {
        // diff unavailable for binary or newly added large files
      }

      return {
        filename: filePath,
        status: changeTypeLabel(entry.changeType),
        additions,
        deletions,
        patch,
      };
    })
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

async function postReviewComment(
  config: AzureConfig,
  body: string
): Promise<void> {
  const url = `https://dev.azure.com/${config.organization}/${config.project}/_apis/git/repositories/${config.repositoryId}/pullRequests/${config.pullRequestId}/threads?api-version=7.1`;

  await azurePost(url, config.personalAccessToken, {
    comments: [{ parentCommentId: 0, content: body, commentType: 1 }],
    status: 1,
  });
}

async function run(): Promise<void> {
  const config = loadConfig();

  console.log(
    `Reviewing Azure DevOps PR #${config.pullRequestId} in ${config.organization}/${config.project}`
  );

  const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

  const prContext = await getPullRequestContext(config);

  console.log(
    `PR has ${prContext.files.length} changed file(s). Sending to Claude...`
  );

  const review = await runReview(anthropic, prContext);

  await postReviewComment(config, review);

  console.log("Review posted successfully.");
}

run().catch((err: Error) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
