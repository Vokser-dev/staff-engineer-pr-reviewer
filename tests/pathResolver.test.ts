import {
  stripRef,
  changeTypeLabel,
  statsFromPatch,
  resolveRepoPath,
  parseAzureDiff,
  AzureDiffChange,
} from "@/lib/azure/pathResolver";

describe("stripRef", () => {
  it("should strip refs/heads/ prefix if present", () => {
    expect(stripRef("refs/heads/main")).toBe("main");
    expect(stripRef("refs/heads/feature/auth")).toBe("feature/auth");
  });

  it("should return the original ref if refs/heads/ is not present", () => {
    expect(stripRef("main")).toBe("main");
    expect(stripRef("origin/main")).toBe("origin/main");
  });
});

describe("changeTypeLabel", () => {
  it("should map delete to removed", () => {
    expect(changeTypeLabel("delete")).toBe("removed");
    expect(changeTypeLabel("DELETE")).toBe("removed");
  });

  it("should map rename variants to renamed", () => {
    expect(changeTypeLabel("rename")).toBe("renamed");
    expect(changeTypeLabel("sourcerename")).toBe("renamed");
    expect(changeTypeLabel("targetrename")).toBe("renamed");
  });

  it("should map add to added", () => {
    expect(changeTypeLabel("add")).toBe("added");
  });

  it("should map other change types to modified", () => {
    expect(changeTypeLabel("edit")).toBe("modified");
    expect(changeTypeLabel("unknown")).toBe("modified");
  });
});

describe("statsFromPatch", () => {
  it("should count additions and deletions correctly", () => {
    const patch = `
--- a/src/main.ts
+++ b/src/main.ts
@@ -1,4 +1,4 @@
-const oldLine = 1;
+const newLine = 1;
+const addedLine = 2;
    unchanged line
-deletedLine
`;
    const stats = statsFromPatch(patch);
    expect(stats).toEqual({ additions: 2, deletions: 2 });
  });

  it("should ignore diff headers", () => {
    const patch = `
--- a/src/main.ts
+++ b/src/main.ts
@@ -1,1 +1,1 @@
`;
    const stats = statsFromPatch(patch);
    expect(stats).toEqual({ additions: 0, deletions: 0 });
  });
});

describe("resolveRepoPath", () => {
  it("should resolve exact match", () => {
    const changedFiles = new Set(["src/main.ts", "lib/core/prompt.ts"]);
    expect(resolveRepoPath("src/main.ts", changedFiles)).toBe("/src/main.ts");
    expect(resolveRepoPath("lib/core/prompt.ts", changedFiles)).toBe("/lib/core/prompt.ts");
  });

  it("should resolve suffix match against a deeper path", () => {
    const changedFiles = new Set(["src/lib/core/prompt.ts"]);
    expect(resolveRepoPath("prompt.ts", changedFiles)).toBe("/src/lib/core/prompt.ts");
    expect(resolveRepoPath("lib/core/prompt.ts", changedFiles)).toBe("/src/lib/core/prompt.ts");
  });

  it("should lock current behavior on ambiguous suffix matches based on insertion order", () => {
    const changedFiles = new Set(["src/main.ts", "tests/main.ts"]);
    expect(resolveRepoPath("main.ts", changedFiles)).toBe("/src/main.ts");

    const changedFilesReordered = new Set(["tests/main.ts", "src/main.ts"]);
    expect(resolveRepoPath("main.ts", changedFilesReordered)).toBe("/tests/main.ts");
  });

  it("should return undefined if no match", () => {
    const changedFiles = new Set(["src/main.ts"]);
    expect(resolveRepoPath("missing.ts", changedFiles)).toBeUndefined();
  });
});

describe("parseAzureDiff", () => {
  const sourceCommitId = "src123";
  const targetCommitId = "tgt456";

  it("should process added, removed, modified files, and filter folders/trees", async () => {
    const changes: AzureDiffChange[] = [
      {
        item: { path: "src/new-file.ts", isFolder: false, gitObjectType: "blob" },
        changeType: "add",
      },
      {
        item: { path: "src/old-file.ts", isFolder: false, gitObjectType: "blob" },
        changeType: "delete",
      },
      {
        item: { path: "src/modified.ts", isFolder: false, gitObjectType: "blob" },
        changeType: "edit",
      },
      {
        item: { path: "src/subfolder", isFolder: true, gitObjectType: "tree" },
        changeType: "add",
      },
    ];

    const fileContents: Record<string, string> = {
      "src/new-file.ts_src123": "console.log('hello');\nconsole.log('world');",
      "src/old-file.ts_tgt456": "console.log('old');",
      "src/modified.ts_tgt456": "const x = 1;\nconst y = 2;",
      "src/modified.ts_src123": "const x = 1;\nconst y = 3;\nconst z = 4;",
    };

    const retrieveFileContent = jest.fn((path: string, commitId: string) => {
      return Promise.resolve(fileContents[`${path}_${commitId}`]);
    });

    const result = await parseAzureDiff(
      changes,
      sourceCommitId,
      targetCommitId,
      retrieveFileContent,
    );

    // Should only have 3 entries (folder is filtered out)
    expect(result).toHaveLength(3);

    // Added file check
    const added = result.find((f) => f.filename === "src/new-file.ts");
    expect(added).toBeDefined();
    expect(added?.status).toBe("added");
    expect(added?.additions).toBe(2);
    expect(added?.deletions).toBe(0);
    expect(added?.patch).toContain("+++ src/new-file.ts");

    // Removed file check
    const removed = result.find((f) => f.filename === "src/old-file.ts");
    expect(removed).toBeDefined();
    expect(removed?.status).toBe("removed");
    expect(removed?.additions).toBe(0);
    expect(removed?.deletions).toBe(1);
    expect(removed?.patch).toContain("--- src/old-file.ts");

    // Modified file check
    const modified = result.find((f) => f.filename === "src/modified.ts");
    expect(modified).toBeDefined();
    expect(modified?.status).toBe("modified");
    expect(modified?.additions).toBe(2);
    expect(modified?.deletions).toBe(1);
    expect(modified?.patch).toContain("-const y = 2;");
    expect(modified?.patch).toContain("+const y = 3;");

    // Verify retrieveFileContent calls
    expect(retrieveFileContent).toHaveBeenCalledWith("src/new-file.ts", sourceCommitId);
    expect(retrieveFileContent).toHaveBeenCalledWith("src/old-file.ts", targetCommitId);
    expect(retrieveFileContent).toHaveBeenCalledWith("src/modified.ts", targetCommitId);
    expect(retrieveFileContent).toHaveBeenCalledWith("src/modified.ts", sourceCommitId);
  });

  it("should warn when Azure content retrieval returns undefined", async () => {
    const changes: AzureDiffChange[] = [
      {
        item: { path: "src/new-file.ts", isFolder: false, gitObjectType: "blob" },
        changeType: "add",
      },
      {
        item: { path: "src/old-file.ts", isFolder: false, gitObjectType: "blob" },
        changeType: "delete",
      },
      {
        item: { path: "src/modified.ts", isFolder: false, gitObjectType: "blob" },
        changeType: "edit",
      },
    ];

    const retrieveFileContent = jest.fn(() => Promise.resolve(undefined));
    const warn = jest.fn();

    const result = await parseAzureDiff(
      changes,
      sourceCommitId,
      targetCommitId,
      retrieveFileContent,
      warn,
    );

    expect(result).toEqual([
      {
        filename: "src/new-file.ts",
        status: "added",
        additions: 0,
        deletions: 0,
        patch: undefined,
      },
      {
        filename: "src/old-file.ts",
        status: "removed",
        additions: 0,
        deletions: 0,
        patch: undefined,
      },
      {
        filename: "src/modified.ts",
        status: "modified",
        additions: 0,
        deletions: 0,
        patch: undefined,
      },
    ]);
    expect(warn).toHaveBeenCalledTimes(4);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "Azure diff content missing for src/new-file.ts at source commit src123",
      ),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "Azure diff content missing for src/old-file.ts at target commit tgt456",
      ),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "Azure diff content missing for src/modified.ts at target commit tgt456",
      ),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "Azure diff content missing for src/modified.ts at source commit src123",
      ),
    );
  });
});
