#!/usr/bin/env node
"use strict";

const { resolve } = require("path");

const platform = process.argv[2];
const distRoot = resolve(__dirname, "..", "dist");

function usage() {
  console.error("Usage: staff-engineer-pr-review <azure|github>");
  process.exit(1);
}

if (!platform || platform === "-h" || platform === "--help") {
  usage();
}

const runners = {
  azure: resolve(distRoot, "azure/src/reviewer.js"),
  github: resolve(distRoot, "github/src/reviewer.js"),
};

const entry = runners[platform];
if (!entry) {
  console.error(`Unknown platform: ${platform}`);
  usage();
}

try {
  require(entry);
} catch (err) {
  if (err.code === "MODULE_NOT_FOUND") {
    console.error(
      "Compiled output missing. Run: npm run build\n" +
        "Or use a git tag where prepare has produced dist/."
    );
  } else {
    console.error(err.message);
  }
  process.exit(1);
}
