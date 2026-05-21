# Staff Engineer PR Reviewer

Automated pull request reviews powered by Claude. Posts a structured code review as a PR comment on every opened or updated pull request. Supports both GitHub Actions and Azure DevOps pipelines.

## What it reviews

Focused review of **changed lines only** — high signal, low noise. Reviews are written in **Norwegian (bokmål)**. It skips pre-existing issues, style nits, and unrelated files.

| Priority       | What it flags                                               |
| -------------- | ----------------------------------------------------------- |
| Security       | Injection, XSS, auth gaps, secrets, unsafe handling of data |
| Correctness    | Bugs and contract mistakes introduced in the diff           |
| Readability    | New/changed code that is genuinely hard to follow           |
| Debug noise    | `console.log` / `debugger` left in changed production code  |
| Hardcoded text | User-facing strings that should be i18n or config           |

**Review output:**

1. Sammendrag (2–3 setninger)
2. Funn (med alvorlighetsgrad: critical, major, minor)
3. Konklusjon: **GODKJENN** · **GODKJENN MED SMÅTING** · **BE OM ENDRINGER** · **BLOKKER**

Both platforms post up to 8 **inline** comments on critical/major/minor items in the diff. GitHub uses a formal review (`pulls.createReview`) with an event mapped from the verdict; Azure posts inline thread comments.

## GitHub Actions

**1. Add the secret**

In your repo: Settings → Secrets and variables → Actions → New repository secret

| Secret              | Value                   |
| ------------------- | ----------------------- |
| `ANTHROPIC_API_KEY` | Your Anthropic API key. |

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
          node-version: "20"
          cache: "npm"
      - run: npm ci
      - run: npm run build
      - run: npm test
      - name: Run Staff Engineer review
        run: node -r tsconfig-paths/register dist/reviewers/github.js
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

| Variable            | Value                  |
| ------------------- | ---------------------- |
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `AZURE_DEVOPS_PAT`  | The PAT from step 1    |

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
          versionSpec: "20.x"
      - script: npm install
      - script: npm run build
      - script: node -r tsconfig-paths/register dist/reviewers/azure.js
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

The Azure reviewer posts a **summary** PR comment plus **inline** comments on specific lines (critical/major issues). The PAT needs **Pull Request Threads → Read & Write** (same as above).

### Running Azure DevOps reviewer manually (one-off)

```bash
npm run build

ANTHROPIC_API_KEY=sk-ant-... \
AZURE_DEVOPS_PAT=your-pat \
AZURE_DEVOPS_ORG=my-org \
AZURE_DEVOPS_PROJECT=my-project \
AZURE_DEVOPS_REPO_ID=my-repo \
AZURE_DEVOPS_PR_ID=42 \
node -r tsconfig-paths/register dist/reviewers/azure.js
```

## Running Locally (CLI)

You can run the reviewer locally against a specific commit or your uncommitted working tree changes using the local reviewer CLI.

**1. Configure environment variables:**
Create a `.env` or `.env.local` file in the project root:

```env
ANTHROPIC_API_KEY=your-api-key-here
ANTHROPIC_THINKING=2048 # Optional: enable thinking
```

**2. Run the CLI:**

- Review current **uncommitted changes** relative to `HEAD`:
  ```bash
  npm run review:commit
  # or
  npx tsx src/reviewers/local.ts
  ```
- Review a **specific commit** or revision (e.g., `main` or a commit SHA):
  ```bash
  npx tsx src/reviewers/local.ts <SHA_OR_REF>
  ```

## Development

```bash
npm install
npm run build        # compile once
npm run build:watch  # watch mode
npm test             # run tests
npx tsc --noEmit     # type-check only
```

Compiled output goes to `dist/`, mirroring the source layout.

## Configuration & Model

### Environment Variables

You can configure the reviewer using the following environment variables:

| Variable             | Description                                                                                                                                                                                                                                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`  | **Required.** Your Anthropic API key.                                                                                                                                                                                                                                                                       |
| `ANTHROPIC_MODEL`    | The model to use. Defaults to `claude-haiku-4-5-20251001`.                                                                                                                                                                                                                                                  |
| `ANTHROPIC_THINKING` | Control the thinking budget. Set to `false`, `off`, `0` to disable (default), or a number (e.g. `2048`, `4096`) to enable with a specific token budget (minimum `1024`, defaults to `2048` if non-numeric/invalid). When thinking is enabled, the API request temperature is automatically locked to `1.0`. |

By default, the reviewer uses the `claude-haiku-4-5-20251001` model with a max output token limit of 8,192 (`MAX_TOKENS = 8192`). To adjust the core prompt rules, check [src/lib/core/prompt.ts](file:///Users/mortena/src/staff-engineer-pr-reviewer/src/lib/core/prompt.ts).
