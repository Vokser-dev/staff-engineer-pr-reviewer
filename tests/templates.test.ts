import { renderAzurePipeline, renderGithubWorkflow } from "@/cli/templates";

describe("renderGithubWorkflow", () => {
  it("renders a workflow with branches, node version and unpinned package", () => {
    const out = renderGithubWorkflow({
      branches: ["main", "develop"],
      nodeVersion: "22",
    });

    expect(out).toContain("on:\n  pull_request:");
    expect(out).toContain("- main");
    expect(out).toContain("- develop");
    expect(out).toContain('node-version: "22"');
    expect(out).toContain("npx --yes @henriksvendsgard/staff-engineer-pr-reviewer github");
    expect(out).not.toContain("@henriksvendsgard/staff-engineer-pr-reviewer@");
    expect(out).toContain("pull-requests: write");
    expect(out).toContain("${{ secrets.GITHUB_TOKEN }}");
    expect(out).toContain("${{ secrets.ANTHROPIC_API_KEY }}");
  });

  it("pins the package version when versionPin is set", () => {
    const out = renderGithubWorkflow({
      branches: ["main"],
      nodeVersion: "22",
      versionPin: "1.2.3",
    });
    expect(out).toContain("npx --yes @henriksvendsgard/staff-engineer-pr-reviewer@1.2.3 github");
  });

  it("omits the branches block when none are given", () => {
    const out = renderGithubWorkflow({
      branches: [],
      nodeVersion: "22",
    });
    expect(out).not.toContain("branches:");
    expect(out).toContain("pull_request:");
  });
});

describe("renderAzurePipeline", () => {
  it("renders an azure pipeline with PR triggers and required env vars", () => {
    const out = renderAzurePipeline({
      org: "my-org",
      project: "my-project",
      repo: "my-repo",
      branches: ["main", "release/*"],
      nodeVersion: "22",
    });

    expect(out).toContain("trigger: none");
    expect(out).toContain("pr:");
    expect(out).toContain("- main");
    expect(out).toContain("- release/*");
    expect(out).toContain('versionSpec: "22.x"');
    expect(out).toContain("npx --yes @henriksvendsgard/staff-engineer-pr-reviewer azure");
    expect(out).toContain("ANTHROPIC_API_KEY: $(ANTHROPIC_API_KEY)");
    expect(out).toContain("AZURE_DEVOPS_PAT: $(AZURE_DEVOPS_PAT)");
    expect(out).toContain("AZURE_DEVOPS_ORG: my-org");
    expect(out).toContain("AZURE_DEVOPS_PROJECT: my-project");
    expect(out).toContain("AZURE_DEVOPS_REPO_ID: my-repo");
    expect(out).toContain("AZURE_DEVOPS_PR_ID: $(System.PullRequest.PullRequestId)");
  });
});
