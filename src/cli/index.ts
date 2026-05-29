#!/usr/bin/env node

import { defineCommand, runMain } from "citty";

// Resolved at build time via require — keeps it accurate even if the
// package is renamed/forked.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require("../../package.json") as { version: string };

const main = defineCommand({
  meta: {
    name: "staff-engineer-pr-reviewer",
    version: pkg.version,
    description: "Staff Engineer PR Reviewer — GitHub and Azure DevOps",
  },
  subCommands: {
    init: () => import("./commands/init").then((m) => m.default),
    doctor: () => import("./commands/doctor").then((m) => m.default),
    github: defineCommand({
      meta: {
        description:
          "Run the GitHub Actions reviewer (used inside a workflow or triggered from CLI)",
      },
      args: {
        ref: {
          type: "positional",
          description: "Optional git revision or SHA/ref to review (if triggering from CLI)",
          required: false,
        },
        repo: {
          type: "string",
          description:
            "Optional repository 'owner/repo' (if triggering from CLI, defaults to auto-detecting from git remote)",
          required: false,
        },
        pr: {
          type: "string",
          description:
            "Optional PR number (if triggering from CLI, defaults to finding PR associated with the commit)",
          required: false,
        },
      },
      run: async (ctx) => {
        const { run } = await import("@/reviewers/github");
        await run({
          ref: ctx.args.ref,
          repo: ctx.args.repo,
          pr: ctx.args.pr,
        });
      },
    }),
    azure: defineCommand({
      meta: {
        description: "Run the Azure DevOps reviewer (used inside a pipeline)",
      },
      run: async () => {
        const { run } = await import("@/reviewers/azure");
        await run();
      },
    }),
    local: defineCommand({
      meta: {
        description: "Review uncommitted changes or a specific commit locally",
      },
      args: {
        ref: {
          type: "positional",
          description:
            "Optional git revision or SHA to review (defaults to uncommitted changes relative to HEAD)",
          required: false,
        },
      },
      run: async (ctx) => {
        const { run } = await import("@/reviewers/local");
        await run(ctx.args.ref !== undefined ? [ctx.args.ref] : []);
      },
    }),
  },
});

void runMain(main);
