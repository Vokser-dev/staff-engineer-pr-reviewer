import * as fs from "fs";

import Anthropic from "@anthropic-ai/sdk";
import * as dotenv from "dotenv";
import { simpleGit } from "simple-git";

import { PullRequestContext, PullRequestFile, reviewPullRequest } from "@/lib/index";

// Load environment variables
const envPath = fs.existsSync(".env.local") ? ".env.local" : ".env";
dotenv.config({ path: envPath });

/**
 * Run the local reviewer.
 *
 * @param args - Positional arguments. `args[0]` is an optional git SHA/ref
 *   to review. When undefined, reviews uncommitted changes against HEAD.
 *   Defaults to `process.argv.slice(2)` so that direct execution
 *   (`node dist/reviewers/local.js <sha>`) keeps working, but the CLI
 *   dispatcher passes the trailing args explicitly so the subcommand name
 *   ("local") isn't mistaken for a SHA.
 */
export async function run(args: string[] = process.argv.slice(2)): Promise<void> {
  const git = simpleGit();
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicApiKey == null || anthropicApiKey === "") {
    console.error("Error: ANTHROPIC_API_KEY environment variable is not set.");
    console.error("Please set it in your environment or in a .env file.");
    process.exit(1);
  }

  const isUncommitted = args[0] == null || args[0] === "";
  let commitSha = "";
  let base = "HEAD";
  let author = "Local User";
  let title = "Local Uncommitted Changes";
  let description = "Review of current uncommitted changes.";
  let headBranch = "Working Tree";
  let baseBranch = "HEAD";

  if (isUncommitted) {
    console.log(
      "No commit SHA specified. Running code review on current uncommitted changes relative to HEAD.",
    );
    try {
      const name = (await git.raw(["config", "user.name"])).trim();
      const email = (await git.raw(["config", "user.email"])).trim();
      if (name !== "") {
        author = `${name} ${email !== "" ? `<${email}>` : ""}`.trim();
      }
    } catch {
      // Use fallback
    }
    try {
      baseBranch = (await git.raw(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    } catch {
      // Use fallback "HEAD"
    }
  } else {
    const rawSha = args[0];
    try {
      commitSha = (await git.raw(["rev-parse", "--verify", rawSha])).trim();
    } catch {
      console.error(`Error: Invalid git revision or SHA: "${rawSha}"`);
      process.exit(1);
    }

    console.log(`Running code review for commit: ${commitSha}`);

    // Fetch parent revision to compute the diff against
    try {
      const parents = (await git.raw(["rev-list", "--parents", "-n", "1", commitSha]))
        .trim()
        .split(/\s+/);

      const isRoot = parents.length === 1;
      base = isRoot ? "4b825dc642cb6eb9a0accbf1240487182c04b2c4" : `${commitSha}~1`;
    } catch (err) {
      console.error(`Error retrieving git parents for commit ${commitSha}:`, err);
      process.exit(1);
    }

    // Fetch commit metadata (author, message subject, message body)
    try {
      author = (await git.raw(["show", "-s", "--format=%an <%ae>", commitSha])).trim();
      title = (await git.raw(["show", "-s", "--format=%s", commitSha])).trim();
      description = (await git.raw(["show", "-s", "--format=%b", commitSha])).trim();
    } catch {
      console.warn("Warning: Failed to retrieve commit metadata from git. Using fallback values.");
    }

    baseBranch = base.substring(0, 7);
    headBranch = commitSha.substring(0, 7);
  }

  // Fetch changed files and their status
  const files: PullRequestFile[] = [];
  try {
    const statusArgs = isUncommitted
      ? ["diff", "--name-status", "HEAD"]
      : ["diff", "--name-status", base, commitSha];

    const statusOutput = (await git.raw(statusArgs)).trim();

    if (statusOutput === "") {
      console.log(
        isUncommitted ? "No uncommitted changes found." : "No changed files in this commit.",
      );
      return;
    }

    const lines = statusOutput.split("\n");
    for (const line of lines) {
      const parts = line.split("\t");
      if (parts.length < 2) continue;

      const gitStatus = parts[0];
      let filename = parts[1];

      // Map git status letters to PullRequestFile status
      let status: PullRequestFile["status"] = "modified";
      if (gitStatus.startsWith("A")) {
        status = "added";
      } else if (gitStatus.startsWith("D")) {
        status = "removed";
      } else if (gitStatus.startsWith("R")) {
        status = "renamed";
        if (parts.length >= 3) {
          filename = parts[2];
        }
      }

      // Fetch file numstat (additions / deletions)
      let additions = 0;
      let deletions = 0;
      try {
        const numstatArgs = isUncommitted
          ? ["diff", "--numstat", "HEAD", "--", filename]
          : ["diff", "--numstat", base, commitSha, "--", filename];
        const numstatOutput = (await git.raw(numstatArgs)).trim();
        if (numstatOutput !== "") {
          const numParts = numstatOutput.split(/\s+/);
          const parsedAdditions = parseInt(numParts[0], 10);
          const parsedDeletions = parseInt(numParts[1], 10);
          additions = Number.isNaN(parsedAdditions) ? 0 : parsedAdditions;
          deletions = Number.isNaN(parsedDeletions) ? 0 : parsedDeletions;
        }
      } catch {
        // Fallback or binary file (which shows '-' in numstat)
      }

      // Fetch patch
      let patch: string | undefined;
      try {
        const patchArgs = isUncommitted
          ? ["diff", "HEAD", "--", filename]
          : ["diff", base, commitSha, "--", filename];
        patch = await git.raw(patchArgs);
      } catch {
        console.warn(`Warning: Could not fetch patch for ${filename}`);
      }

      files.push({
        filename,
        status,
        additions,
        deletions,
        patch,
      });
    }
  } catch (err) {
    console.error("Error retrieving changed files from git:", err);
    process.exit(1);
  }

  const prContext: PullRequestContext = {
    title,
    description,
    author,
    baseBranch,
    headBranch,
    files,
  };

  console.log(
    isUncommitted
      ? `Endringssettet har ${files.length} endret(e) fil(er). Sender til Claude...`
      : `Commit-en har ${files.length} endret(e) fil(er). Sender til Claude...`,
  );

  const anthropic = new Anthropic({ apiKey: anthropicApiKey });

  try {
    const { markdown, inlineComments, overallVerdict } = await reviewPullRequest(
      anthropic,
      prContext,
      { inline: true },
    );

    console.log("\n========================================================");
    console.log("                  SAMMENDRAG AV REVIEW                  ");
    console.log("========================================================\n");
    console.log(markdown);

    console.log("\n========================================================");
    console.log("                   INLINE-KOMMENTARER                   ");
    console.log("========================================================\n");

    if (inlineComments != null && inlineComments.length > 0) {
      for (const comment of inlineComments) {
        const severityStr = comment.severity.toUpperCase();
        console.log(`📌 Fil:              ${comment.filename}:${comment.line ?? "N/A"}`);
        console.log(`   Alvorlighetsgrad: ${severityStr}`);
        console.log(`   Kommentar:        ${comment.body}`);
        console.log("--------------------------------------------------------");
      }
    } else {
      console.log("Ingen inline-kommentarer funnet.");
    }

    console.log(`\nSamlet vurdering: ${overallVerdict?.toUpperCase() ?? "UKJENT"}`);
    console.log("========================================================\n");
  } catch (err) {
    console.error("Feil ved kall til Anthropic API eller parsing av svar:", err);
    process.exit(1);
  }
}

if (require.main === module) {
  run().catch((err: Error) => {
    console.error("Fatal error:", err.message);
    process.exit(1);
  });
}
