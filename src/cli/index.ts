#!/usr/bin/env node

import { runInit } from "@/cli/commands/init";
import { runDoctor } from "@/cli/commands/doctor";

const PACKAGE_NAME = "@henriksvendsgard/staff-engineer-pr-reviewer";

function printHelp(): void {
  console.log(`
Staff Engineer PR Reviewer

Usage:
  npx ${PACKAGE_NAME} <command> [args]

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
  npx ${PACKAGE_NAME} init
  npx ${PACKAGE_NAME} doctor
  npx ${PACKAGE_NAME} local
  npx ${PACKAGE_NAME} local HEAD~1

Most consumers only need 'init' once, then the generated workflow takes over.
`);
}

function printVersion(): void {
  // Resolved at build time via require — keeps it accurate even if the
  // package is renamed/forked.
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
      await runDoctor(rest);
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
      await run();
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
