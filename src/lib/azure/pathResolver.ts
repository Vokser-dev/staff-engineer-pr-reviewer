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
