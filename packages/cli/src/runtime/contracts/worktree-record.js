export function createWorktreeRecord(worktree = {}, meta = {}) {
  return {
    branch: worktree.branch || null,
    path: worktree.path || worktree.worktreePath || null,
    baseBranch: worktree.baseBranch || null,
    hasChanges: typeof worktree.hasChanges === "boolean" ? worktree.hasChanges : null,
    summary: worktree.summary || null,
    conflicts: Array.isArray(worktree.conflicts) ? worktree.conflicts : [],
    previewEntrypoints: Array.isArray(worktree.previewEntrypoints)
      ? worktree.previewEntrypoints
      : [],
    meta,
  };
}
