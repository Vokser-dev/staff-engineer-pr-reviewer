import {
  stripRef,
  changeTypeLabel,
  statsFromPatch,
  resolveRepoPath,
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
