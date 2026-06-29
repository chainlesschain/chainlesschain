/**
 * Git Worktree Manager Skill Handler
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const { logger } = require("../../../../../utils/logger.js");
const { execSync } = require("child_process");
const path = require("path");
/* eslint-enable @typescript-eslint/no-require-imports */

const _deps = { execSync };

module.exports = {
  _deps,
  isSafeRef, // exported for tests
  isSafePath, // exported for tests
  async init(_skill) {
    logger.info("[GitWorktree] Initialized");
  },

  async execute(task, context = {}, _skill) {
    const input = task.input || task.args || "";
    const parsed = parseInput(input);

    logger.info(`[GitWorktree] Action: ${parsed.action}`);

    try {
      switch (parsed.action) {
        case "create":
          return handleCreate(parsed, context);
        case "list":
          return handleList(context);
        case "remove":
          return handleRemove(parsed.target, context);
        case "status":
          return handleStatus(context);
        case "prune":
          return handlePrune(context);
        default:
          return { success: false, error: `Unknown action: ${parsed.action}` };
      }
    } catch (error) {
      logger.error("[GitWorktree] Error:", error);
      return { success: false, error: error.message };
    }
  },
};

function parseInput(input) {
  if (!input || typeof input !== "string") {
    return { action: "list" };
  }
  const parts = input.trim().split(/\s+/);
  const action = (parts[0] || "list").toLowerCase();
  const target = parts[1] || "";
  const pathMatch = input.match(/--path\s+(\S+)/);
  return { action, target, customPath: pathMatch ? pathMatch[1] : null };
}

// branch / worktree path / target below are interpolated into execSync (a shell)
// via git(`... ${x}`), and come from the skill's task input — so an unsanitized
// value is a command-injection vector (e.g. "main; rm -rf ~", or a path with
// $()/backticks which the shell expands even inside double quotes). Validate to
// git-ref chars and path chars respectively; no shell metacharacters.
function isSafeRef(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 200 &&
    /^[A-Za-z0-9._/-]+$/.test(value)
  );
}

function isSafePath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 4096 &&
    /^[A-Za-z0-9._/:\\-]+$/.test(value)
  );
}

function git(cmd, cwd) {
  return _deps
    .execSync(`git ${cmd}`, {
      cwd: cwd || process.cwd(),
      encoding: "utf8",
      timeout: 30000,
    })
    .trim();
}

function handleCreate(parsed, context) {
  const branch = parsed.target;
  if (!branch) {
    return { success: false, error: "No branch name provided." };
  }
  if (!isSafeRef(branch)) {
    return { success: false, error: `Invalid branch name: ${branch}` };
  }

  const cwd = context.cwd || process.cwd();
  const worktreePath =
    parsed.customPath ||
    path.join(cwd, "..", `worktree-${branch.replace(/\//g, "-")}`);
  if (!isSafePath(worktreePath)) {
    return { success: false, error: `Invalid worktree path: ${worktreePath}` };
  }

  // Check if branch exists
  try {
    git(`rev-parse --verify ${branch}`, cwd);
  } catch {
    // Branch doesn't exist, create it
    git(`branch ${branch}`, cwd);
  }

  git(`worktree add "${worktreePath}" ${branch}`, cwd);

  return {
    success: true,
    action: "create",
    branch,
    path: worktreePath,
    message: `Worktree created at ${worktreePath} for branch "${branch}".`,
  };
}

function handleList(context) {
  const cwd = context.cwd || process.cwd();
  const output = git("worktree list --porcelain", cwd);
  const worktrees = [];
  let current = {};

  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current.path) {
        worktrees.push(current);
      }
      current = { path: line.substring(9) };
    } else if (line.startsWith("HEAD ")) {
      current.head = line.substring(5);
    } else if (line.startsWith("branch ")) {
      current.branch = line.substring(7).replace("refs/heads/", "");
    } else if (line === "bare") {
      current.bare = true;
    } else if (line === "detached") {
      current.detached = true;
    }
  }
  if (current.path) {
    worktrees.push(current);
  }

  return {
    success: true,
    action: "list",
    worktrees,
    count: worktrees.length,
  };
}

function handleRemove(target, context) {
  if (!target) {
    return { success: false, error: "No worktree path provided." };
  }
  if (!isSafePath(target)) {
    return { success: false, error: `Invalid worktree path: ${target}` };
  }
  const cwd = context.cwd || process.cwd();
  git(`worktree remove "${target}"`, cwd);
  return {
    success: true,
    action: "remove",
    path: target,
    message: `Worktree "${target}" removed.`,
  };
}

function handleStatus(context) {
  const list = handleList(context);
  const statuses = (list.worktrees || []).map((wt) => {
    try {
      const status = git("status --short", wt.path);
      return {
        ...wt,
        changes: status ? status.split("\n").length : 0,
        clean: !status,
      };
    } catch {
      return { ...wt, changes: -1, clean: false, error: "Cannot read status" };
    }
  });
  return { success: true, action: "status", worktrees: statuses };
}

function handlePrune(context) {
  const cwd = context.cwd || process.cwd();
  const output = git("worktree prune -v", cwd);
  return {
    success: true,
    action: "prune",
    output,
    message: "Stale worktrees pruned.",
  };
}
