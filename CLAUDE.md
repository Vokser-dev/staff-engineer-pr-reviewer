# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # install dependencies
npm run build        # compile TypeScript → dist/
npm run build:watch  # watch mode
npm test             # run Jest tests
npx tsc --noEmit     # type-check without emitting
```

We use Jest for unit tests, with tests located in the top-level `tests/` directory.

The codebase is structured as follows:

**`src/lib/`** — shared business logic and platform-specific helpers.

- **`core/`** — platform-independent review orchestration, prompt construction, and response parsing.
  - `prompt.ts` — system prompts and prompt formatting.
  - `reviewPullRequest.ts` — LLM client interface and Anthropic integrations.
  - `reviewResponse.ts` — JSON extraction, schema validation, and severity filtering.
  - `reviewSession.ts` — reusable review orchestrator orchestration logic.
- **`azure/`** — platform-specific helper modules (e.g. `pathResolver.ts`).
- **`index.ts`** — public entrypoint exposing public types and APIs from `core/`.

**`src/reviewers/github.ts`** — GitHub Actions entrypoint. Reads inputs via `@actions/core.getInput()`. Uses Octokit to fetch PR metadata and diffs, then posts a formal review via `pulls.createReview` with the markdown summary as `body`, inline comments anchored on `RIGHT`-side line numbers, and `event` mapped from `overallVerdict` (`approve`→`APPROVE`, `comment`→`COMMENT`, `request-changes`→`REQUEST_CHANGES`; if verdict is missing/invalid, the event is derived from inline severities via `deriveEventFromComments()`). Inline comments are filtered against added lines parsed from each file’s `patch` (`extractAddedLines()`) since GitHub returns 422 for anchors outside the diff. If `createReview` fails, it falls back to `issues.createComment` so the review isn’t lost. Exits via `core.setFailed()` on error.

**`src/reviewers/azure.ts`** — Azure DevOps entrypoint. Reads config from env vars. Uses `fetch` against the ADO REST API. Posts a summary PR thread plus inline line comments via `/threads`.

**`tsconfig.json`** — compiles the `src/` directory into `dist/` using the `"rootDir": "./src"` option in `tsconfig.build.json`. Resolves `@/*` path aliases.

## Key constraints

- Both reviewers post inline comments. GitHub uses `pulls.createReview` (formal review with `event` + `comments[]` anchored via `path` + `line` + `side: "RIGHT"`); Azure uses `/threads` with `threadContext` (anchors on the latest right-side view).
- GitHub strictly enforces inline anchors against diff hunks; the GitHub reviewer therefore filters comments through `extractAddedLines()` before calling `createReview` and falls back to a flat `issues.createComment` if the review API still rejects the request.
- The Azure reviewer currently posts the summary as a separate thread without consuming `overallVerdict` (Azure has no equivalent of GitHub review events). The GitHub reviewer maps `overallVerdict` to the review `event`.
- The Azure reviewer reviews the cumulative PR diff (source vs target merge commits), same scope as the GitHub `pulls.listFiles` path.
- File diffs are fetched in parallel (`Promise.all`); binary or oversized files are skipped with a console warning so they don't abort the whole review.
- `@actions/core.getInput` reads `process.env['INPUT_GITHUB-TOKEN']` (with a literal hyphen) — this is why the workflow sets `INPUT_GITHUB-TOKEN` and `INPUT_ANTHROPIC-API-KEY` rather than using standard env var naming.
