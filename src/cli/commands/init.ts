import * as fs from "fs";
import * as path from "path";
import prompts from "prompts";

import { detectPlatforms, Platform, PLATFORM_OUTPUT_PATHS } from "@/cli/detect";
import { renderAzurePipeline, renderGithubWorkflow } from "@/cli/templates";

const DEFAULT_BRANCHES = ["main"];
const DEFAULT_NODE_VERSION = "22";

function onCancel(): void {
  console.log("\nAborted.");
  process.exit(130);
}

function pinkArrow(s: string): string {
  return `\u001b[36m›\u001b[0m ${s}`;
}

function check(s: string): string {
  return `\u001b[32m✓\u001b[0m ${s}`;
}

function warn(s: string): string {
  return `\u001b[33m⚠\u001b[0m ${s}`;
}

function info(s: string): string {
  return `\u001b[2m${s}\u001b[0m`;
}

async function choosePlatform(detected: Platform | null): Promise<Platform> {
  if (detected) {
    console.log(check(`Detected ${detected === "github" ? "GitHub" : "Azure DevOps"} project.`));
    return detected;
  }

  const { platform } = (await prompts(
    {
      type: "select",
      name: "platform",
      message: "Where are you running your CI pipeline?",
      choices: [
        { title: "GitHub", value: "github" as const },
        { title: "Azure DevOps", value: "azure" as const },
      ],
      initial: 0,
    },
    { onCancel },
  )) as { platform: Platform };
  return platform;
}

async function chooseBranches(): Promise<string[]> {
  const { branches } = (await prompts(
    {
      type: "text",
      name: "branches",
      message: "Which target branches should trigger reviews? (comma-separated)",
      initial: DEFAULT_BRANCHES.join(","),
    },
    { onCancel },
  )) as { branches: string };
  return String(branches ?? "")
    .split(",")
    .map((b) => b.trim())
    .filter(Boolean);
}

async function confirmOverwrite(
  filePath: string,
): Promise<{ overwrite: boolean; altPath?: string }> {
  if (!fs.existsSync(filePath)) return { overwrite: true };

  const { action } = (await prompts(
    {
      type: "select",
      name: "action",
      message: `${filePath} already exists. What do you want to do?`,
      choices: [
        { title: "Overwrite", value: "overwrite" },
        { title: "Write to a different filename", value: "alt" },
        { title: "Cancel", value: "cancel" },
      ],
      initial: 1,
    },
    { onCancel },
  )) as { action: "overwrite" | "alt" | "cancel" };

  if (action === "cancel") {
    console.log("\nAborted.");
    process.exit(0);
  }

  if (action === "alt") {
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const base = path.basename(filePath, ext);
    const altPath = path.join(dir, `${base}.review${ext}`);
    return { overwrite: true, altPath };
  }

  return { overwrite: true };
}

async function initGithub(): Promise<void> {
  const branches = await chooseBranches();
  const { nodeVersion } = (await prompts(
    {
      type: "text",
      name: "nodeVersion",
      message: "Node.js major version to use:",
      initial: DEFAULT_NODE_VERSION,
    },
    { onCancel },
  )) as { nodeVersion: string };
  const content = renderGithubWorkflow({
    branches,
    nodeVersion: String(nodeVersion ?? DEFAULT_NODE_VERSION),
  });

  const targetPath = PLATFORM_OUTPUT_PATHS.github;
  const { overwrite, altPath } = await confirmOverwrite(targetPath);
  if (!overwrite) return;

  const writePath = altPath ?? targetPath;
  fs.mkdirSync(path.dirname(writePath), { recursive: true });
  fs.writeFileSync(writePath, content);
  console.log(check(`Wrote ${writePath}`));

  console.log("\n" + pinkArrow("Next steps:"));
  console.log(
    "  1. Add ANTHROPIC_API_KEY as a repository secret",
    "\n     " + info("Settings → Secrets and variables → Actions → New repository secret"),
  );
  console.log(
    "  2. Confirm workflow permissions are sufficient",
    "\n     " +
      info(
        "Settings → Actions → General → 'Read and write permissions' (or use the explicit permissions block in the workflow file)",
      ),
  );
  console.log("  3. Commit and push the workflow file");
  console.log("  4. Open a PR to trigger the first review");
  console.log(
    "\nRun " +
      pinkArrow("npx github:henriksvendsgard/staff-engineer-pr-reviewer doctor") +
      " any time to verify the setup.",
  );
}

async function initAzure(): Promise<void> {
  const baseAnswers = (await prompts(
    [
      {
        type: "text",
        name: "org",
        message: "Azure DevOps organization:",
        validate: (v: string) => (v?.trim() ? true : "Required"),
      },
      {
        type: "text",
        name: "project",
        message: "Project name:",
        validate: (v: string) => (v?.trim() ? true : "Required"),
      },
      {
        type: "text",
        name: "repo",
        message: "Repository name or ID:",
        validate: (v: string) => (v?.trim() ? true : "Required"),
      },
    ],
    { onCancel },
  )) as { org: string; project: string; repo: string };

  const branches = await chooseBranches();
  const { nodeVersion } = (await prompts(
    {
      type: "text",
      name: "nodeVersion",
      message: "Node.js major version to use:",
      initial: DEFAULT_NODE_VERSION,
    },
    { onCancel },
  )) as { nodeVersion: string };

  const content = renderAzurePipeline({
    org: String(baseAnswers.org).trim(),
    project: String(baseAnswers.project).trim(),
    repo: String(baseAnswers.repo).trim(),
    branches,
    nodeVersion: String(nodeVersion ?? DEFAULT_NODE_VERSION),
  });

  const targetPath = PLATFORM_OUTPUT_PATHS.azure;
  const { overwrite, altPath } = await confirmOverwrite(targetPath);
  if (!overwrite) return;

  const writePath = altPath ?? targetPath;
  fs.writeFileSync(writePath, content);
  console.log(check(`Wrote ${writePath}`));

  console.log("\n" + pinkArrow("Next steps:"));
  console.log("  1. Create a Personal Access Token in Azure DevOps");
  console.log("     " + info("User Settings → Personal access tokens → New token"));
  console.log("     " + info("Scopes required: Code: Read  +  Pull Request Threads: Read & Write"));
  console.log("  2. Add pipeline variables (mark both as secret):");
  console.log("     " + info("ANTHROPIC_API_KEY  = your Anthropic API key"));
  console.log("     " + info("AZURE_DEVOPS_PAT   = the PAT from step 1"));
  console.log("  3. Wire the pipeline to your project (Pipelines → New pipeline → existing YAML)");
  console.log("  4. Open a PR to trigger the first review");
  console.log(
    "\n" +
      warn(
        "We can't set Azure pipeline variables programmatically — follow steps 2-3 in the Azure DevOps UI.",
      ),
  );
  console.log(
    "\nRun " +
      pinkArrow("npx github:henriksvendsgard/staff-engineer-pr-reviewer doctor") +
      " to verify the setup.",
  );
}

export async function runInit(_args: string[]): Promise<void> {
  console.log("Staff Engineer PR Reviewer — setup wizard\n");

  const detection = detectPlatforms();
  if (detection.platforms.length > 1) {
    console.log(warn("Multiple CI platforms detected in this project."));
  }

  const platform = await choosePlatform(detection.platforms.length === 1 ? detection.unique : null);

  if (platform === "github") {
    await initGithub();
  } else {
    await initAzure();
  }
}
