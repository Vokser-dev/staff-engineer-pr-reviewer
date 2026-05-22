export type Severity = "critical" | "major" | "minor" | "nit";

export type InlineSeverity = Exclude<Severity, "nit">;

export type Verdict = "approve" | "comment" | "request-changes";

export interface PullRequestFile {
  filename: string;
  status: "added" | "modified" | "removed" | "renamed" | (string & {});
  additions: number;
  deletions: number;
  patch?: string;
}

export interface PullRequestContext {
  title: string;
  description: string | null;
  author: string;
  baseBranch: string;
  headBranch: string;
  files: PullRequestFile[];
}

export interface ReviewComment {
  filename: string;
  line?: number;
  body: string;
  severity: Severity;
}

export interface ReviewResult {
  summary: string;
  comments: ReviewComment[];
  overallVerdict: Verdict;
}
