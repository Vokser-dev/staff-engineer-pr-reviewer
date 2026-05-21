const PACKAGE_NAME = "@henriksvendsgard/staff-engineer-pr-reviewer";

export interface GithubTemplateOptions {
  branches: string[];
  nodeVersion: string;
  /** When true, pin the package to a specific version; otherwise always use latest. */
  versionPin?: string;
}

export function renderGithubWorkflow(opts: GithubTemplateOptions): string {
  const branchesList = opts.branches.map((b) => `      - ${b}`).join("\n");
  const branchesBlock = opts.branches.length ? `\n    branches:\n${branchesList}` : "";
  const pkgRef = opts.versionPin ? `${PACKAGE_NAME}@${opts.versionPin}` : PACKAGE_NAME;

  return `name: PR Review

on:
  pull_request:
    types: [opened, synchronize, reopened]${branchesBlock}

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    name: AI Code Review
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: "${opts.nodeVersion}"

      - name: Run Staff Engineer review
        run: npx --yes ${pkgRef} github
        env:
          INPUT_GITHUB-TOKEN: \${{ secrets.GITHUB_TOKEN }}
          INPUT_ANTHROPIC-API-KEY: \${{ secrets.ANTHROPIC_API_KEY }}
`;
}

export interface AzureTemplateOptions {
  org: string;
  project: string;
  repo: string;
  branches: string[];
  nodeVersion: string;
  versionPin?: string;
}

export function renderAzurePipeline(opts: AzureTemplateOptions): string {
  const branchesList = opts.branches.map((b) => `      - ${b}`).join("\n");
  const pkgRef = opts.versionPin ? `${PACKAGE_NAME}@${opts.versionPin}` : PACKAGE_NAME;

  return `trigger: none

pr:
  branches:
    include:
${branchesList}

jobs:
  - job: PRReview
    displayName: AI Code Review
    pool:
      vmImage: ubuntu-latest
    steps:
      - task: NodeTool@0
        inputs:
          versionSpec: "${opts.nodeVersion}.x"
        displayName: Set up Node.js

      - script: npx --yes ${pkgRef} azure
        displayName: Run Staff Engineer review
        env:
          ANTHROPIC_API_KEY: $(ANTHROPIC_API_KEY)
          AZURE_DEVOPS_PAT: $(AZURE_DEVOPS_PAT)
          AZURE_DEVOPS_ORG: ${opts.org}
          AZURE_DEVOPS_PROJECT: ${opts.project}
          AZURE_DEVOPS_REPO_ID: ${opts.repo}
          AZURE_DEVOPS_PR_ID: $(System.PullRequest.PullRequestId)
`;
}
