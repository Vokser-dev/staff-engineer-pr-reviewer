import { parseGitHubPullRequestNumber } from "@/reviewers/github";

describe("GitHub reviewer", () => {
  describe("parseGitHubPullRequestNumber", () => {
    it("should parse positive integer strings", () => {
      expect(parseGitHubPullRequestNumber("14")).toBe(14);
      expect(parseGitHubPullRequestNumber(" 14 ")).toBe(14);
    });

    it("should reject invalid PR numbers", () => {
      expect(parseGitHubPullRequestNumber("")).toBeUndefined();
      expect(parseGitHubPullRequestNumber("0")).toBeUndefined();
      expect(parseGitHubPullRequestNumber("-1")).toBeUndefined();
      expect(parseGitHubPullRequestNumber("123.456")).toBeUndefined();
      expect(parseGitHubPullRequestNumber("1e2")).toBeUndefined();
      expect(parseGitHubPullRequestNumber("14abc")).toBeUndefined();
    });
  });
});
