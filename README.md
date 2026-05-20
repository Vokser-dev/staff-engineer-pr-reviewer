# Staff Engineer PR Reviewer

Automated pull request reviews powered by Claude. Posts a structured code review as a PR comment on every opened or updated pull request. Supports both GitHub Actions and Azure DevOps pipelines.

## What it reviews

The reviewer acts as a Senior Staff Engineer with 15+ years of fullstack experience. It reads the entire diff before commenting, understands the intent before judging the implementation, and explains *why* something is a problem — not just that it is one.

**Coverage by layer:**

| Layer | What it catches |
|---|---|
| Database / storage | Missing indexes, N+1 queries, unbounded result sets, incorrect transactions |
| Backend / API | Auth gaps, unsafe deserialization, input validation, incorrect HTTP semantics, race conditions |
| Business logic | Off-by-one errors, silent failures, incorrect state machines, concurrency issues |
| Frontend | XSS vectors, unnecessary re-renders, missing loading/error states, accessibility issues |
| Cross-layer contracts | Type mismatches between client and server, broken cache invalidation, optimistic UI that ignores server rejection |
| Operability | Missing structured logging, swallowed errors without context |
| Security | OWASP Top 10 — flagged as Critical |

**Review output:**

1. Summary (2–4 sentences on quality and risk)
2. Critical Issues — will block merge
3. Major Issues — significant design or correctness problems
4. Minor Issues & Suggestions
5. Nits
6. Verdict: **APPROVE** · **APPROVE WITH NITS** · **REQUEST CHANGES** · **BLOCK**

## GitHub Actions

**1. Add the secret**

In your repo: Settings → Secrets and variables → Actions → New repository secret

| Secret | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key |

`GITHUB_TOKEN` is provided automatically.

**2. Add the workflow**

Copy `.github/workflows/pr-review.yml` into your target repository:

```yaml
name: Staff Engineer PR Review

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write
  issues: write

jobs:
  review:
    name: AI Code Review
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - name: Run Staff Engineer review
        run: node dist/github/src/reviewer.js
        env:
          INPUT_GITHUB-TOKEN: ${{ secrets.GITHUB_TOKEN }}
          INPUT_ANTHROPIC-API-KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

## Azure DevOps

**1. Create a Personal Access Token**

Azure DevOps → User Settings → Personal Access Tokens. Required scopes:
- Code → Read
- Pull Request Threads → Read & Write

**2. Add pipeline variables** (mark both as secret)

| Variable | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `AZURE_DEVOPS_PAT` | The PAT from step 1 |

**3. Add to `azure-pipelines.yml`**

```yaml
trigger: none
pr:
  branches:
    include:
      - main

jobs:
  - job: PRReview
    pool:
      vmImage: ubuntu-latest
    steps:
      - task: NodeTool@0
        inputs:
          versionSpec: '20.x'
      - script: npm install
      - script: npm run build
      - script: node dist/azure/src/reviewer.js
        displayName: Run Staff Engineer review
        env:
          ANTHROPIC_API_KEY: $(ANTHROPIC_API_KEY)
          AZURE_DEVOPS_PAT: $(AZURE_DEVOPS_PAT)
          AZURE_DEVOPS_ORG: my-org
          AZURE_DEVOPS_PROJECT: my-project
          AZURE_DEVOPS_REPO_ID: my-repo
          AZURE_DEVOPS_PR_ID: $(System.PullRequest.PullRequestId)
```

`$(System.PullRequest.PullRequestId)` is set automatically by Azure DevOps on PR builds.

**Run manually (one-off):**

```bash
npm run build

ANTHROPIC_API_KEY=sk-ant-... \
AZURE_DEVOPS_PAT=your-pat \
AZURE_DEVOPS_ORG=my-org \
AZURE_DEVOPS_PROJECT=my-project \
AZURE_DEVOPS_REPO_ID=my-repo \
AZURE_DEVOPS_PR_ID=42 \
node dist/azure/src/reviewer.js
```

## Development

```bash
npm install
npm run build        # compile once
npm run build:watch  # watch mode
npx tsc --noEmit     # type-check only
```

Compiled output goes to `dist/`, mirroring the source layout.

## Model

Uses `claude-opus-4-7` with an 8 192-token output budget. To switch models or adjust the prompt, edit `shared/prompt.ts`.
