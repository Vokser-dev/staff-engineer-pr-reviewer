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

**IMPORTANT**: Any refactoring or new code should be followed by linting and testing. Any error or warning should be fixed.

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

**`src/reviewers/local.ts`** — local CLI entrypoint. Uses `simple-git` to build a `PullRequestContext` from uncommitted changes or a specific commit, then prints the review to stdout. No platform API calls.

**`src/cli/index.ts`** — CLI dispatcher (the package's `bin`). Parses the first argv token and dispatches to `init`, `doctor`, `github`, `azure`, or `local`. Each platform reviewer is lazy-imported so that running `init` or `doctor` doesn't pull in `@actions/core` and friends. Always exits non-zero on errors.

**`src/cli/detect.ts`** — best-effort detection of the consumer's CI platform by looking for marker paths (`.github/workflows`, `azure-pipelines.yml`, etc.). Returns both the list of detected platforms and the unique platform if exactly one was found.

**`src/cli/templates.ts`** — pure render functions for the GitHub workflow and Azure pipeline YAML. Both reference the package via the bare `github:owner/repo` URL (no ref pin — see "Distribution" below) and use `npx --yes` so the consuming repo never needs to clone this repo. Both templates forward `ANTHROPIC_MODEL` and `ANTHROPIC_THINKING` as optional overrides (GitHub: `vars.X`; Azure: `$(X)` paired with empty top-level `variables:` defaults — see the Azure macro caveat below).

**`src/cli/commands/init.ts`** — interactive wizard. Detects the platform, asks for branches, Node version, and (for Azure) org/project/repo, then writes the template to the right path. Handles overwrite confirmation and prints next-steps including which secret(s) to add.

**`src/cli/commands/doctor.ts`** — non-destructive health check. Detects the platform, looks for the workflow file, verifies it references this package and (for GitHub) declares `pull-requests: write`. Cannot inspect secrets — it just tells the user where to look in the GitHub/Azure UI.

**`tsconfig.json`** — compiles the `src/` directory into `dist/` using the `"rootDir": "./src"` option in `tsconfig.build.json`. Resolves `@/*` path aliases via `tsc-alias` at build time so the published `dist/` ships with plain relative requires.

## Model & Thinking Configuration

- **Default Model**: `claude-haiku-4-5-20251001` with `MAX_TOKENS = 8192`.
- **Model Override**: Can be configured using the `ANTHROPIC_MODEL` environment variable.
- **Thinking Budget**: Controlled via the `ANTHROPIC_THINKING` environment variable:
  - If set to `false`, `off`, `0`, or left unset, thinking is disabled.
  - If set to a number (e.g. `2048`), thinking is enabled with that number as the `budget_tokens` (must be >= 1024, defaults to 2048 if invalid or non-numeric).
  - When thinking is enabled, `temperature` is set to `1.0`.

## Distribution

The package is **not published to npm** and **does not use version pinning**. Consumers install it directly from the public GitHub repo via `npx github:henriksvendsgard/staff-engineer-pr-reviewer <command>`. Every consumer always tracks the default branch — there is no `#tag` / `#sha` suffix on the URL. The whole point is that consuming projects do **not** need to clone this repo, build it, or maintain a forked action; the reviewer is the same for everyone, and rollout is "push to default branch".

- `bin.staff-engineer-pr-reviewer` points to `dist/cli/index.js`, so all five subcommands share one entrypoint. npm resolves the bin automatically because the package only declares one bin entry.
- `scripts.prepack: "npm run build"` is what makes git-URL installs work. When `npm`/`npx` clones the repo to create a tarball, `prepack` runs `tsc` so `dist/` exists at install time (it's intentionally `.gitignore`d).
- `package.json` ships `files: ["dist"]` only — no source — when packing a tarball.
- The generated CI workflows always run `npx --yes github:henriksvendsgard/staff-engineer-pr-reviewer <github|azure>`. There is intentionally no GitHub Action wrapper (`action.yml`) — keeping the surface as one npx-able package avoids dist-bundle drift.
- **Releasing is just `git push` to the default branch.** No tags, no `npm publish`, no version bumps. Every consumer's next PR build picks up the change.
- **Staging a change**: temporarily set the repo's default branch (e.g. to `develop`) in GitHub Settings; consumers automatically follow. Switch back to `main` when ready.
- To later introduce versioning, see `PACKAGE_REF` in `src/cli/templates.ts`; reintroducing a `versionPin` field on the template options and a `#${ref}` suffix is a contained change.

## Key constraints

- Both reviewers post inline comments. GitHub uses `pulls.createReview` (formal review with `event` + `comments[]` anchored via `path` + `line` + `side: "RIGHT"`); Azure uses `/threads` with `threadContext` (anchors on the latest right-side view).
- GitHub strictly enforces inline anchors against diff hunks; the GitHub reviewer therefore filters comments through `extractAddedLines()` before calling `createReview` and falls back to a flat `issues.createComment` if the review API still rejects the request.
- The Azure reviewer currently posts the summary as a separate thread without consuming `overallVerdict` (Azure has no equivalent of GitHub review events). The GitHub reviewer maps `overallVerdict` to the review `event`.
- The Azure reviewer reviews the cumulative PR diff (source vs target merge commits), same scope as the GitHub `pulls.listFiles` path.
- File diffs are fetched in parallel (`Promise.all`); binary or oversized files are skipped with a console warning so they don't abort the whole review.
- `@actions/core.getInput` reads `process.env['INPUT_GITHUB-TOKEN']` (with a literal hyphen) — this is why the generated workflow sets `INPUT_GITHUB-TOKEN` and `INPUT_ANTHROPIC-API-KEY` rather than using standard env var naming.
- The CLI lazy-imports platform reviewers (`await import("@/reviewers/github")` etc.) so a consumer running `init` or `doctor` in a non-CI shell never loads `@actions/core` or `@anthropic-ai/sdk`.
- Azure macro caveat: if you reference `$(FOO)` in a pipeline `env:` block but `FOO` is never declared anywhere, Azure DevOps passes the literal string `"$(FOO)"` to the env var instead of an empty string. The generated Azure template therefore declares `variables: { ANTHROPIC_MODEL: "", ANTHROPIC_THINKING: "" }` at top level so unset overrides resolve to `""` (which the reviewer's `process.env.X || DEFAULT` fallback treats correctly).
