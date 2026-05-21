import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { detectPlatforms } from "@/cli/detect";

function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "spr-detect-"));
}

describe("detectPlatforms", () => {
  it("returns an empty result for an empty project", () => {
    const dir = mkTmpDir();
    const result = detectPlatforms(dir);
    expect(result.platforms).toEqual([]);
    expect(result.unique).toBeNull();
  });

  it("detects GitHub via .github/workflows", () => {
    const dir = mkTmpDir();
    fs.mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true });
    const result = detectPlatforms(dir);
    expect(result.platforms).toEqual(["github"]);
    expect(result.unique).toBe("github");
  });

  it("detects Azure DevOps via azure-pipelines.yml", () => {
    const dir = mkTmpDir();
    fs.writeFileSync(path.join(dir, "azure-pipelines.yml"), "");
    const result = detectPlatforms(dir);
    expect(result.platforms).toEqual(["azure"]);
    expect(result.unique).toBe("azure");
  });

  it("returns both platforms when both markers are present", () => {
    const dir = mkTmpDir();
    fs.mkdirSync(path.join(dir, ".github"), { recursive: true });
    fs.writeFileSync(path.join(dir, "azure-pipelines.yml"), "");
    const result = detectPlatforms(dir);
    expect(result.platforms.sort()).toEqual(["azure", "github"]);
    expect(result.unique).toBeNull();
  });
});
