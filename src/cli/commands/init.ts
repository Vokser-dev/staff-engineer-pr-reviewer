import * as fs from "fs";
import * as path from "path";

import * as p from "@clack/prompts";
import { defineCommand } from "citty";

import { detectPlatforms, Platform, PLATFORM_OUTPUT_PATHS } from "@/cli/detect";
import { renderAzurePipeline, renderGithubWorkflow } from "@/cli/templates";

const DEFAULT_BRANCHES = ["main"];
const DEFAULT_NODE_VERSION = "22";

async function choosePlatform(detected: Platform | null): Promise<Platform> {
  if (detected != null) {
    p.log.step(`Detected ${detected === "github" ? "GitHub" : "Azure DevOps"} project.`);
    return detected;
  }

  const platform = await p.select({
    message: "Where are you running your CI pipeline?",
    options: [
      { label: "GitHub", value: "github" as const },
      { label: "Azure DevOps", value: "azure" as const },
    ],
    initialValue: "github" as const,
  });

  if (p.isCancel(platform)) {
    p.cancel("Operation cancelled.");
    process.exit(130);
  }

  return platform;
}

async function chooseBranches(): Promise<string[]> {
  const branches = await p.text({
    message: "Which target branches should trigger reviews? (comma-separated)",
    defaultValue: DEFAULT_BRANCHES.join(","),
    placeholder: DEFAULT_BRANCHES.join(","),
  });

  if (p.isCancel(branches)) {
    p.cancel("Operation cancelled.");
    process.exit(130);
  }

  return String(branches ?? "")
    .split(",")
    .map((b) => b.trim())
    .filter(Boolean);
}

async function confirmOverwrite(
  filePath: string,
): Promise<{ overwrite: boolean; altPath?: string }> {
  if (!fs.existsSync(filePath)) return { overwrite: true };

  const action = await p.select({
    message: `${filePath} already exists. What do you want to do?`,
    options: [
      { label: "Overwrite", value: "overwrite" },
      { label: "Write to a different filename", value: "alt" },
      { label: "Cancel", value: "cancel" },
    ],
    initialValue: "alt",
  });

  if (p.isCancel(action) || action === "cancel") {
    p.cancel("Operation cancelled.");
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
  const nodeVersion = await p.text({
    message: "Node.js major version to use:",
    defaultValue: DEFAULT_NODE_VERSION,
    placeholder: DEFAULT_NODE_VERSION,
  });

  if (p.isCancel(nodeVersion)) {
    p.cancel("Operation cancelled.");
    process.exit(130);
  }

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
  p.log.success(`Wrote ${writePath}`);

  const nextSteps = [
    "1. Add ANTHROPIC_API_KEY as a repository secret",
    "   Settings → Secrets and variables → Actions → New repository secret",
    "2. Confirm workflow permissions are sufficient",
    "   Settings → Actions → General → 'Read and write permissions'",
    "   (or use the explicit permissions block in the workflow file)",
    "3. Commit and push the workflow file",
    "4. Open a PR to trigger the first review",
    "",
    "Run 'npx @henriksvendsgard/staff-engineer-pr-reviewer doctor' any time to verify the setup.",
  ].join("\n");

  p.note(nextSteps, "Next Steps");
}

async function initAzure(): Promise<void> {
  const baseAnswers = await p.group(
    {
      org: () =>
        p.text({
          message: "Azure DevOps organization:",
          validate: (v) => (v?.trim() !== "" ? undefined : "Required"),
        }),
      project: () =>
        p.text({
          message: "Project name:",
          validate: (v) => (v?.trim() !== "" ? undefined : "Required"),
        }),
      repo: () =>
        p.text({
          message: "Repository name or ID:",
          validate: (v) => (v?.trim() !== "" ? undefined : "Required"),
        }),
    },
    {
      onCancel: () => {
        p.cancel("Operation cancelled.");
        process.exit(130);
      },
    },
  );

  if (
    p.isCancel(baseAnswers) ||
    p.isCancel(baseAnswers.org) ||
    p.isCancel(baseAnswers.project) ||
    p.isCancel(baseAnswers.repo)
  ) {
    p.cancel("Operation cancelled.");
    process.exit(130);
  }

  const branches = await chooseBranches();
  const nodeVersion = await p.text({
    message: "Node.js major version to use:",
    defaultValue: DEFAULT_NODE_VERSION,
    placeholder: DEFAULT_NODE_VERSION,
  });

  if (p.isCancel(nodeVersion)) {
    p.cancel("Operation cancelled.");
    process.exit(130);
  }

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
  p.log.success(`Wrote ${writePath}`);

  const nextSteps = [
    "1. Create a Personal Access Token in Azure DevOps",
    "   User Settings → Personal access tokens → New token",
    "   Scopes required: Code: Read  +  Pull Request Threads: Read & Write",
    "2. Add pipeline variables (mark both as secret):",
    "   ANTHROPIC_API_KEY  = your Anthropic API key",
    "   AZURE_DEVOPS_PAT   = the PAT from step 1",
    "3. Wire the pipeline to your project (Pipelines → New pipeline → existing YAML)",
    "4. Open a PR to trigger the first review",
    "",
    "We can't set Azure pipeline variables programmatically — follow steps 2-3 in the Azure DevOps UI.",
    "",
    "Run 'npx @henriksvendsgard/staff-engineer-pr-reviewer doctor' to verify the setup.",
  ].join("\n");

  p.note(nextSteps, "Next Steps");
}

async function runInit(): Promise<void> {
  p.intro("Staff Engineer PR Reviewer — setup wizard");

  const detection = detectPlatforms();
  if (detection.platforms.length > 1) {
    p.log.warn("Multiple CI platforms detected in this project.");
  }

  const platform = await choosePlatform(detection.platforms.length === 1 ? detection.unique : null);

  if (platform === "github") {
    await initGithub();
  } else {
    await initAzure();
  }

  p.outro("Setup wizard completed!");
}

export default defineCommand({
  meta: {
    description:
      "Interactive wizard that detects your CI platform and generates the right workflow/pipeline file",
  },
  run: async () => {
    await runInit();
  },
});
