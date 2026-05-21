# Staff Engineer PR Reviewer

Automated pull request reviews powered by Claude. Posts a structured review in **Norwegian (bokmål)** — summary plus inline comments on Azure DevOps. Supports GitHub Actions and Azure DevOps pipelines.

Run via **`npx github:YourOrg/staff-engineer-pr-reviewer#v1.0.0`** so consumer pipelines do not need to check out this repository.

## What it reviews

Focused review of **changed lines only** — high signal, low noise.

| Priority | What it flags |
|---|---|
| Security | Injection, XSS, auth gaps, secrets, unsafe handling of data |
| Correctness | Bugs and contract mistakes introduced in the diff |
| Readability | New/changed code that is genuinely hard to follow |
| Debug noise | `console.log` / `debugger` in changed production code |
| Hardcoded text | User-facing strings that should be i18n or config |

**Review output:** Sammendrag → Kritiske funn → Alvorlige funn (optional) → Konklusjon (**GODKJENN** / **BE OM ENDRINGER** / **BLOKKER**). Azure also posts up to 8 inline comments on critical/major lines.

## CLI

```bash
# After clone (build runs via prepare on npm install)
npm install
npx staff-engineer-pr-review azure   # Azure DevOps PR
npx staff-engineer-pr-review github  # GitHub PR (Actions / local)

# From GitHub without cloning (pin a tag)
npx --yes github:YourOrg/staff-engineer-pr-reviewer@v1.0.0 azure
npx --yes github:YourOrg/staff-engineer-pr-reviewer@v1.0.0 github
```

| Command | Environment variables |
|---|---|
| `azure` | `ANTHROPIC_API_KEY`, `AZURE_DEVOPS_PAT`, `AZURE_DEVOPS_ORG`, `AZURE_DEVOPS_PROJECT`, `AZURE_DEVOPS_REPO_ID`, `AZURE_DEVOPS_PR_ID` |
| `github` | `INPUT_ANTHROPIC-API-KEY`, `INPUT_GITHUB-TOKEN` (GitHub Actions provides the token automatically) |

## Azure DevOps (app repo in ADO, tool on GitHub)

The application under review lives in **Azure DevOps**. The reviewer tool lives on **GitHub**. The pipeline only runs `npx` — it does not check out application code for review (the tool uses the REST API).

```
ADO PR pipeline (app repo)  →  npx github:Org/staff-engineer-pr-reviewer#v1.0.0 azure
                                    →  Azure DevOps API (diff + comments on that PR)
```

**1. Personal Access Token** (Azure DevOps → User Settings → PAT)

- Code → Read
- Pull Request Threads → Read & Write

**2. Variable group** (e.g. `staff-engineer-pr-review`) in your ADO project

| Variable | Secret |
|---|---|
| `ANTHROPIC_API_KEY` | Yes |
| `AZURE_DEVOPS_PAT` | Yes |

**3. Pipeline in the application repo**

Copy [`examples/azure-pipelines.npx-pr.yml`](examples/azure-pipelines.npx-pr.yml) and set:

- `MyGitHubOrg` → your GitHub org/user
- `reviewerVersion` → git tag on this repo (e.g. `v1.0.0`)
- `AZURE_DEVOPS_ORG` → your organization name (e.g. `AutoSync`)

`$(Build.Repository.ID)` and `$(System.PullRequest.PullRequestId)` refer to the **application** PR.

**Private GitHub tool repo:** before `npx`, authenticate git/npm to GitHub (e.g. `GITHUB_TOKEN` from a secret) — see [npm docs on private git deps](https://docs.npmjs.com/cli/v10/commands/npx#description).

**Manual review** of any PR (optional): pipeline in ADO connected to this GitHub repo — [`azure-pipelines.manual.yml`](azure-pipelines.manual.yml).

## GitHub Actions (app repo on GitHub)

**1. Secret:** `ANTHROPIC_API_KEY`

**2. Workflow** — copy [`examples/github-actions.npx-pr.yml`](examples/github-actions.npx-pr.yml):

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: "20"

- run: npx --yes github:YourOrg/staff-engineer-pr-reviewer@v1.0.0 github
  env:
    INPUT_GITHUB-TOKEN: ${{ secrets.GITHUB_TOKEN }}
    INPUT_ANTHROPIC-API-KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

No checkout of this tool repo is required.

## Local run (Azure)

```bash
npm install

# PowerShell
$env:ANTHROPIC_API_KEY = "..."
$env:AZURE_DEVOPS_PAT = "..."
$env:AZURE_DEVOPS_ORG = "AutoSync"
$env:AZURE_DEVOPS_PROJECT = "My Project"
$env:AZURE_DEVOPS_REPO_ID = "guid"
$env:AZURE_DEVOPS_PR_ID = "42"
npx staff-engineer-pr-review azure
```

Or with dotenv: `node -r dotenv/config bin/cli.js azure dotenv_config_path=.env.local`

## Versioning

Create a **git tag** on this repo for each release (`v1.0.0`). Consumer pipelines reference that tag in `npx`:

`github:YourOrg/staff-engineer-pr-reviewer#v1.0.0`

Avoid `#main` in production pipelines.

## Development

```bash
npm install          # runs prepare → build
npm run build
npm run review:azure
npm run review:github
npx tsc --noEmit
```

Edit prompts in `shared/prompt.ts`. Model: `claude-opus-4-7` (8192 output tokens).

Update `repository.url` in `package.json` when you know the final GitHub path.

## This repository's own PRs

[`.github/workflows/pr-review.yml`](.github/workflows/pr-review.yml) reviews PRs **to this repo** using a local build + `npx staff-engineer-pr-review github`.
