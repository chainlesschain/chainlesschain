export {
  createWorktree,
  removeWorktree,
  listWorktrees,
  pruneWorktrees,
  isolateTask,
  cleanupAgentWorktrees,
  assessAgentWorktreeCleanup,
  diffWorktree,
  previewWorktreeMerge,
  applyWorktreeAutomationCandidate,
  mergeWorktree,
  worktreeLog,
} from "../harness/worktree-isolator.js";

export {
  normalizeSparsePaths,
  planSymlinkDirectories,
  isContainedPath,
  isSafeRelPath,
} from "./worktree-sparse.js";
