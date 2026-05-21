import * as fs from "fs";
import * as path from "path";

import { detectPlatforms, Platform, PLATFORM_OUTPUT_PATHS } from "@/cli/detect";

type CheckStatus = "ok" | "warn" | "fail" | "info";

interface CheckResult {
  status: CheckStatus;
  message: string;
  hint?: string;
}

/** Git-URL form used in CLI hints and to verify the generated workflow content. */
const PACKAGE_REF = "github:henriksvendsgard/staff-engineer-pr-reviewer";
/** npm-style name used to detect if the consumer added the package as a project
 *  dependency (uncommon for CI tools, but possible). */
const PACKAGE_NPM_NAME = "@henriksvendsgard/staff-engineer-pr-reviewer";

const STATUS_GLYPH: Record<CheckStatus, string> = {
  ok: "\u001b[32m✓\u001b[0m",
  warn: "\u001b[33m⚠\u001b[0m",
  fail: "\u001b[31m✗\u001b[0m",
  info: "\u001b[36mi\u001b[0m",
};

function readIfExists(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function checkWorkflowFile(filePath: string, packageName: string): CheckResult {
  const content = readIfExists(filePath);
  if (!content) {
    return {
      status: "fail",
      message: `Workflow file missing: ${filePath}`,
      hint: `Run: npx ${PACKAGE_REF} init`,
    };
  }
  if (!content.includes(packageName)) {
    return {
      status: "warn",
      message: `Workflow exists but does not reference ${packageName}`,
      hint: `Make sure the run step uses 'npx --yes ${packageName} github' (or 'azure').`,
    };
  }
  return { status: "ok", message: `Workflow file present and references ${packageName}` };
}

function checkGithubPermissions(filePath: string): CheckResult {
  const content = readIfExists(filePath);
  if (!content) {
    return {
      status: "info",
      message: "Skipped permission check (no workflow file).",
    };
  }
  const hasPermissions = /\bpermissions:\s*\n[\s\S]*?pull-requests:\s*write/m.test(content);
  if (hasPermissions) {
    return { status: "ok", message: "Workflow grants pull-requests: write" };
  }
  return {
    status: "warn",
    message: "Workflow does not explicitly grant pull-requests: write",
    hint: "Add this block at the workflow or job level:\n        permissions:\n          contents: read\n          pull-requests: write",
  };
}

function checkAzureVars(filePath: string): CheckResult {
  const content = readIfExists(filePath);
  if (!content) {
    return { status: "info", message: "Skipped variable check (no pipeline file)." };
  }
  const missing: string[] = [];
  for (const v of ["AZURE_DEVOPS_ORG", "AZURE_DEVOPS_PROJECT", "AZURE_DEVOPS_REPO_ID"]) {
    const re = new RegExp(`${v}:\\s*(<.+>|REPLACE|REPLACE_ME|REPLACE-ME|)$`, "m");
    if (re.test(content)) missing.push(v);
  }
  if (missing.length) {
    return {
      status: "warn",
      message: `These pipeline env vars look like placeholders: ${missing.join(", ")}`,
      hint: "Replace placeholder values with your actual org/project/repo.",
    };
  }
  return { status: "ok", message: "Azure pipeline env vars look filled in" };
}

function checkNoNodeModulesPolicy(): CheckResult {
  // npx will fetch dependencies automatically; we only flag if the consumer
  // appears to have copied the source instead of using the published package.
  const pkgPath = path.join(process.cwd(), "package.json");
  const pkg = readIfExists(pkgPath);
  if (!pkg)
    return { status: "info", message: "No package.json in this project — OK for CI-only usage." };

  try {
    const parsed = JSON.parse(pkg) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const allDeps = { ...(parsed.dependencies ?? {}), ...(parsed.devDependencies ?? {}) };
    if (PACKAGE_NPM_NAME in allDeps) {
      return {
        status: "info",
        message: `Project depends on ${PACKAGE_NPM_NAME} directly (${allDeps[PACKAGE_NPM_NAME]})`,
        hint: "You can use the local binary directly instead of npx, e.g. 'npx staff-engineer-pr-reviewer github'.",
      };
    }
  } catch {
    /* ignore JSON parse errors */
  }
  return {
    status: "ok",
    message: "Project does not pin the reviewer as a dependency (will use npx)",
  };
}

function printSection(title: string): void {
  console.log(`\n${title}`);
  console.log("─".repeat(title.length));
}

function printCheck(result: CheckResult): void {
  console.log(`  ${STATUS_GLYPH[result.status]} ${result.message}`);
  if (result.hint) {
    const lines = result.hint.split("\n");
    for (const line of lines) {
      console.log(`      ${"\u001b[2m"}${line}${"\u001b[0m"}`);
    }
  }
}

export async function runDoctor(_args: string[]): Promise<void> {
  console.log("Staff Engineer PR Reviewer — setup check");
  const cwd = process.cwd();
  console.log(`\nChecking ${cwd}`);

  const detection = detectPlatforms(cwd);
  const results: { section: string; checks: CheckResult[] }[] = [];

  if (detection.platforms.length === 0) {
    results.push({
      section: "Platform detection",
      checks: [
        {
          status: "warn",
          message: "No CI configuration found",
          hint: `If this is a CI-targeted setup, run: npx ${PACKAGE_REF} init`,
        },
      ],
    });
  }

  for (const platform of detection.platforms as Platform[]) {
    const filePath = PLATFORM_OUTPUT_PATHS[platform];
    const checks: CheckResult[] = [];
    checks.push(checkWorkflowFile(filePath, PACKAGE_REF));

    if (platform === "github") {
      checks.push(checkGithubPermissions(filePath));
      checks.push({
        status: "info",
        message: "Secrets (ANTHROPIC_API_KEY) cannot be checked from here.",
        hint: "Verify in: Settings → Secrets and variables → Actions",
      });
    } else {
      checks.push(checkAzureVars(filePath));
      checks.push({
        status: "info",
        message:
          "Pipeline variables (ANTHROPIC_API_KEY, AZURE_DEVOPS_PAT) cannot be checked from here.",
        hint: "Verify in: Pipelines → Library (or pipeline-level variables)",
      });
    }
    results.push({
      section: `${platform === "github" ? "GitHub Actions" : "Azure DevOps"} setup`,
      checks,
    });
  }

  results.push({
    section: "Package",
    checks: [checkNoNodeModulesPolicy()],
  });

  for (const { section, checks } of results) {
    printSection(section);
    for (const c of checks) printCheck(c);
  }

  const allChecks = results.flatMap((r) => r.checks);
  const fails = allChecks.filter((c) => c.status === "fail").length;
  const warns = allChecks.filter((c) => c.status === "warn").length;

  console.log("");
  if (fails === 0 && warns === 0) {
    console.log(`${STATUS_GLYPH.ok} Setup looks healthy.`);
  } else if (fails === 0) {
    console.log(`${STATUS_GLYPH.warn} Setup mostly OK, but ${warns} warning(s) to review.`);
  } else {
    console.log(
      `${STATUS_GLYPH.fail} Setup has ${fails} blocking issue(s) and ${warns} warning(s).`,
    );
    process.exitCode = 1;
  }
}
