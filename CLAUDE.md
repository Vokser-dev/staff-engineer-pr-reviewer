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

**`src/reviewers/github.ts`** — GitHub Actions entrypoint. Reads inputs via `@actions/core.getInput()`. Uses Octokit to fetch PR metadata and diffs.

**`src/reviewers/azure.ts`** — Azure DevOps entrypoint. Reads config from env vars. Uses `fetch` against the ADO REST API.

**`tsconfig.json`** — compiles the `src/` directory into `dist/` using the `"rootDir": "./src"` option in `tsconfig.build.json`. Resolves `@/*` path aliases.

## Key constraints

- The GitHub reviewer uses `issues.createComment` (not `pulls.createReview`), so it posts a flat comment, not a formal GitHub review with inline annotations.
- The Azure reviewer reviews the cumulative PR diff (source vs target merge commits), same scope as the GitHub `pulls.listFiles` path.
- File diffs are fetched in parallel (`Promise.all`); binary or oversized files are skipped with a console warning so they don't abort the whole review.
- `@actions/core.getInput` reads `process.env['INPUT_GITHUB-TOKEN']` (with a literal hyphen) — this is why the workflow sets `INPUT_GITHUB-TOKEN` and `INPUT_ANTHROPIC-API-KEY` rather than using standard env var naming.
