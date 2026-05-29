import { createTwoFilesPatch } from "diff";

import { PullRequestFile } from "@/lib/types";

export interface AzureDiffChange {
  item: { path: string; isFolder?: boolean; gitObjectType?: string };
  changeType: string;
  originalPath?: string;
}

export function stripRef(ref: string): string {
  return ref.replace(/^refs\/heads\//, "");
}

export function changeTypeLabel(changeType: string): string {
  const ct = changeType.toLowerCase();
  if (ct === "delete") return "removed";
  if (ct === "rename" || ct === "sourcerename" || ct === "targetrename") {
    return "renamed";
  }
  if (ct === "add") return "added";
  return "modified";
}

export function statsFromPatch(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) {
      continue;
    }
    if (line.startsWith("+")) additions++;
    else if (line.startsWith("-")) deletions++;
  }
  return { additions, deletions };
}

export function resolveRepoPath(filename: string, changedFiles: Set<string>): string | undefined {
  const normalized = filename.replace(/^\//, "");
  if (changedFiles.has(normalized)) return `/${normalized}`;

  for (const f of changedFiles) {
    if (f === normalized || f.endsWith(`/${normalized}`)) {
      return `/${f}`;
    }
  }
  return undefined;
}

export function buildFilePatch(
  oldPath: string,
  newPath: string,
  oldContent: string,
  newContent: string,
): string | undefined {
  const patch = createTwoFilesPatch(oldPath, newPath, oldContent, newContent, "", "", {
    context: 3,
  });
  const hasChanges = patch.split("\n").some((l) => l.startsWith("+") || l.startsWith("-"));
  return hasChanges ? patch : undefined;
}

function warnOnMissingAzureContent(
  warn: (msg: string) => void,
  filename: string,
  commitId: string,
  side: "source" | "target",
): void {
  // `undefined` is an intentional retrieval signal for binary/oversized/missing
  // content; warn here so unexpected fetch failures do not look like empty diffs.
  warn(
    `Azure diff content missing for ${filename} at ${side} commit ${commitId}; ` +
      `patch and line counts may be unavailable. This can be expected for ` +
      `binary/oversized files, or indicate that content retrieval failed.`,
  );
}

export async function parseAzureDiff(
  changes: AzureDiffChange[],
  sourceCommitId: string,
  targetCommitId: string,
  retrieveFileContent: (path: string, commitId: string) => Promise<string | undefined>,
  warn: (msg: string) => void = console.warn,
): Promise<PullRequestFile[]> {
  const blobChanges = changes.filter(
    (c) => c.item.isFolder !== true && c.item.gitObjectType !== "tree",
  );

  const files: PullRequestFile[] = await Promise.all(
    blobChanges.map(async (change) => {
      const status = changeTypeLabel(change.changeType);
      const filename = change.item.path;

      if (status === "added") {
        const content = await retrieveFileContent(filename, sourceCommitId);
        if (content === undefined) {
          warnOnMissingAzureContent(warn, filename, sourceCommitId, "source");
        }
        const patch =
          content != null ? buildFilePatch("/dev/null", filename, "", content) : undefined;
        return {
          filename,
          status,
          additions: content != null ? content.split("\n").length : 0,
          deletions: 0,
          patch,
        };
      }

      if (status === "removed") {
        const content = await retrieveFileContent(filename, targetCommitId);
        if (content === undefined) {
          warnOnMissingAzureContent(warn, filename, targetCommitId, "target");
        }
        const patch =
          content != null ? buildFilePatch(filename, "/dev/null", content, "") : undefined;
        return {
          filename,
          status,
          additions: 0,
          deletions: content != null ? content.split("\n").length : 0,
          patch,
        };
      }

      const [oldContent, newContent] = await Promise.all([
        retrieveFileContent(change.originalPath ?? filename, targetCommitId),
        retrieveFileContent(filename, sourceCommitId),
      ]);

      if (oldContent === undefined) {
        warnOnMissingAzureContent(warn, change.originalPath ?? filename, targetCommitId, "target");
      }
      if (newContent === undefined) {
        warnOnMissingAzureContent(warn, filename, sourceCommitId, "source");
      }

      let additions = 0;
      let deletions = 0;
      let patch: string | undefined;

      if (oldContent !== undefined && newContent !== undefined) {
        patch = buildFilePatch(change.originalPath ?? filename, filename, oldContent, newContent);
        if (patch != null) {
          ({ additions, deletions } = statsFromPatch(patch));
        }
      }

      return {
        filename,
        status,
        additions,
        deletions,
        patch,
      };
    }),
  );

  return files;
}
