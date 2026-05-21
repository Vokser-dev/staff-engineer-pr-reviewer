#!/usr/bin/env node

import { runDoctor } from "@/cli/commands/doctor";
import { runInit } from "@/cli/commands/init";

/** Git-URL form used in help text. Consumers install via `npx <this>` — the
 *  open GitHub repo is the source of truth, no npm registry involved. */
const PACKAGE_REF = "github:henriksvendsgard/staff-engineer-pr-reviewer";

function printHelp(): void {
  console.log(`
Staff Engineer PR Reviewer

Usage:
  npx ${PACKAGE_REF} <command> [args]

Commands:
  init                Interactive wizard that detects your CI platform and
                      generates the right workflow/pipeline file.
  doctor              Check that the reviewer is correctly set up in this
                      project and report what's missing.
  github              Run the GitHub Actions reviewer (used inside a workflow).
  azure               Run the Azure DevOps reviewer (used inside a pipeline).
  local [SHA]         Review uncommitted changes or a specific commit locally.
  help, --help, -h    Show this help.
  --version, -v       Print the package version.

Examples:
  npx ${PACKAGE_REF} init
  npx ${PACKAGE_REF} doctor
  npx ${PACKAGE_REF} local
  npx ${PACKAGE_REF} local HEAD~1

Most consumers only need 'init' once, then the generated workflow takes over.
All consumers track the default branch of the reviewer repo — there is no
version pinning. Roll out changes by pushing to the default branch.
`);
}

function printVersion(): void {
  // Resolved at build time via require — keeps it accurate even if the
  // package is renamed/forked.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pkg = require("../../package.json") as { version: string };
  console.log(pkg.version);
}

async function dispatch(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  switch (command) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return 0;

    case "--version":
    case "-v":
      printVersion();
      return 0;

    case "init":
      await runInit(rest);
      return 0;

    case "doctor":
      runDoctor(rest);
      return 0;

    case "github": {
      const { run } = await import("@/reviewers/github");
      await run();
      return 0;
    }

    case "azure": {
      const { run } = await import("@/reviewers/azure");
      await run();
      return 0;
    }

    case "local": {
      const { run } = await import("@/reviewers/local");
      await run(rest);
      return 0;
    }

    default:
      console.error(`Unknown command: ${command}\n`);
      printHelp();
      return 1;
  }
}

dispatch(process.argv.slice(2))
  .then((code) => {
    if (code !== 0) process.exit(code);
  })
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\nFatal error: ${message}`);
    process.exit(1);
  });
