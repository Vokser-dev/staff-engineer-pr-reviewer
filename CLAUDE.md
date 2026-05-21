# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # install dependencies
npm run build        # compile TypeScript → dist/
npm run build:watch  # watch mode
npx tsc --noEmit     # type-check without emitting
```

There are no tests and no linter configured.

## Architecture

The codebase has a shared core and two platform-specific entrypoints:

**`shared/prompt.ts`** — the only place that touches Claude. Owns:
- `PullRequestContext` / `PullRequestFile` / `ReviewComment` types
- `STAFF_ENGINEER_SYSTEM_PROMPT` — the review persona and output structure
- `buildReviewPrompt()` — formats a `PullRequestContext` into a user message
- `runReview()` — calls the Anthropic API and returns the raw review string

Both platform implementations import `runReview` and `PullRequestContext` from here. All prompt or model changes belong in this file.

**`github/src/reviewer.ts`** — GitHub Actions entrypoint. Reads inputs via `@actions/core.getInput()` (which maps to `INPUT_*` env vars). Uses Octokit (`@actions/github`) to fetch PR metadata and file diffs, then posts a formal review via `pulls.createReview` with the markdown summary as `body`, inline comments anchored on `RIGHT`-side line numbers, and `event` mapped from `splitReviewResponse().overallVerdict` (`approve`→`APPROVE`, `comment`→`COMMENT`, `request-changes`→`REQUEST_CHANGES`; if verdict is missing/invalid, the event is derived from inline severities via `deriveEventFromComments()`). Inline comments are filtered against added lines parsed from each file's `patch` (`extractAddedLines()`) since GitHub returns 422 for anchors outside the diff. If `createReview` still fails, it falls back to `issues.createComment` so the review isn't lost. Exits via `core.setFailed()` on error.

**`azure/src/reviewer.ts`** — Azure DevOps entrypoint. Reads config from env vars (`AZURE_DEVOPS_ORG`, `AZURE_DEVOPS_PROJECT`, `AZURE_DEVOPS_REPO_ID`, `AZURE_DEVOPS_PR_ID`, `AZURE_DEVOPS_PAT`, `ANTHROPIC_API_KEY`). Uses native `fetch` against the ADO REST API v7.1. Loads the cumulative PR diff via `diffs/commits` (target vs source merge commits), fetches file content at each commit via `items?includeContent=true`, and builds unified patches with the `diff` package. Posts a summary PR thread plus inline line comments via `/threads` (`threadContext` with file path and right-side line only — no `pullRequestThreadContext`, so comments anchor on the latest PR view). Claude returns a trailing JSON block with `inlineComments`; see `splitReviewResponse()` in `shared/prompt.ts`. Exits via `process.exit(1)` on error.

**`tsconfig.json`** — compiles all three source trees (`shared/`, `github/src/`, `azure/src/`) into `dist/` preserving the directory structure. Target: ES2020, module: commonjs.

## Key constraints

- Both reviewers post inline comments. GitHub uses `pulls.createReview` (formal review with `event` + `comments[]` anchored via `path` + `line` + `side: "RIGHT"`); Azure uses `/threads` with `threadContext` (anchors on the latest right-side view, no `pullRequestThreadContext`).
- GitHub strictly enforces inline anchors against diff hunks; the GitHub reviewer therefore filters comments through `extractAddedLines()` before calling `createReview` and falls back to a flat `issues.createComment` if the review API still rejects the request.
- The Azure reviewer currently posts the summary as a separate thread without consuming `overallVerdict` (Azure has no equivalent of GitHub review events). The GitHub reviewer maps `overallVerdict` to the review `event`.
- The Azure reviewer reviews the cumulative PR diff (source vs target merge commits), same scope as the GitHub `pulls.listFiles` path.
- File diffs are fetched in parallel (`Promise.all`); binary or oversized files are skipped with a console warning so they don't abort the whole review.
- `@actions/core.getInput` reads `process.env['INPUT_GITHUB-TOKEN']` (with a literal hyphen) — this is why the workflow sets `INPUT_GITHUB-TOKEN` and `INPUT_ANTHROPIC-API-KEY` rather than using standard env var naming.
