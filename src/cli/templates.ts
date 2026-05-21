/** Git-URL spec used by `npx`. Pointing at the open GitHub repo avoids npm
 *  publishing; npm clones the repo on every CI run, executes `prepack` to
 *  build `dist/`, and resolves the single `bin` automatically.
 *
 *  Consumers always track the repo's default branch — there is no version
 *  pinning. To roll out a change to everyone, push to the default branch.
 *  To stage a change, set the repo's default branch to your test branch
 *  in GitHub settings; consumers will pick it up on the next PR build. */
const PACKAGE_REF = "github:henriksvendsgard/staff-engineer-pr-reviewer";

export interface GithubTemplateOptions {
  branches: string[];
  nodeVersion: string;
}

export function renderGithubWorkflow(opts: GithubTemplateOptions): string {
  const branchesList = opts.branches.map((b) => `      - ${b}`).join("\n");
  const branchesBlock = opts.branches.length ? `\n    branches:\n${branchesList}` : "";

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
        run: npx --yes ${PACKAGE_REF} github
        env:
          INPUT_GITHUB-TOKEN: \${{ secrets.GITHUB_TOKEN }}
          INPUT_ANTHROPIC-API-KEY: \${{ secrets.ANTHROPIC_API_KEY }}
          # Optional overrides. Configure these as repository variables under
          # Settings → Secrets and variables → Actions → Variables. Leaving
          # them unset falls back to the reviewer's built-in defaults.
          ANTHROPIC_MODEL: \${{ vars.ANTHROPIC_MODEL }}
          ANTHROPIC_THINKING: \${{ vars.ANTHROPIC_THINKING }}
`;
}

export interface AzureTemplateOptions {
  org: string;
  project: string;
  repo: string;
  branches: string[];
  nodeVersion: string;
}

export function renderAzurePipeline(opts: AzureTemplateOptions): string {
  const branchesList = opts.branches.map((b) => `      - ${b}`).join("\n");

  return `trigger: none

pr:
  branches:
    include:
${branchesList}

# Empty defaults so unset overrides resolve to "" instead of the literal
# string "$(ANTHROPIC_MODEL)". Override per-pipeline or in Pipelines → Library.
variables:
  ANTHROPIC_MODEL: ""
  ANTHROPIC_THINKING: ""

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

      - script: npx --yes ${PACKAGE_REF} azure
        displayName: Run Staff Engineer review
        env:
          ANTHROPIC_API_KEY: $(ANTHROPIC_API_KEY)
          AZURE_DEVOPS_PAT: $(AZURE_DEVOPS_PAT)
          ANTHROPIC_MODEL: $(ANTHROPIC_MODEL)
          ANTHROPIC_THINKING: $(ANTHROPIC_THINKING)
          AZURE_DEVOPS_ORG: ${opts.org}
          AZURE_DEVOPS_PROJECT: ${opts.project}
          AZURE_DEVOPS_REPO_ID: ${opts.repo}
          AZURE_DEVOPS_PR_ID: $(System.PullRequest.PullRequestId)
`;
}
