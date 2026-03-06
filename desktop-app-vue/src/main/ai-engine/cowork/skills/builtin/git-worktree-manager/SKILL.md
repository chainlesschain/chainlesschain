---
name: git-worktree-manager
display-name: Git Worktree Manager
description: Manage git worktrees for isolated branch development - create, list, switch, and clean up worktrees for parallel feature development, safe experimentation, and CI/CD isolation
version: 1.0.0
category: development
user-invocable: true
tags: [git, worktree, branch, isolation, parallel, development]
capabilities: [worktree-create, worktree-list, worktree-remove, branch-isolation]
handler: ./handler.js
os: [win32, darwin, linux]
tools: [worktree-create, worktree-list, worktree-remove, worktree-status]
requires:
  bins: [git]
instructions: |
  Use this skill when the user needs to work on multiple branches simultaneously,
  create isolated environments for experimentation, or manage parallel feature
  development. Git worktrees allow checking out multiple branches at once in
  separate directories.
examples:
  - input: "create worktree for feature/auth branch"
    action: create
  - input: "list all worktrees"
    action: list
  - input: "remove worktree for old-feature"
    action: remove
author: ChainlessChain
license: MIT
---

# Git Worktree Manager

Manage git worktrees for parallel branch development.

## Usage

```
/git-worktree-manager create <branch> [--path <dir>]
/git-worktree-manager list
/git-worktree-manager remove <path>
/git-worktree-manager status
/git-worktree-manager prune
```

## When to Use Worktrees

- Work on a hotfix while keeping your feature branch state
- Run tests on one branch while coding on another
- Compare behavior across branches side-by-side
- Isolated CI/CD task execution

## Actions

| Action | Description |
| --- | --- |
| `create` | Create a new worktree for a branch |
| `list` | List all active worktrees |
| `remove` | Remove a worktree and clean up |
| `status` | Show git status across all worktrees |
| `prune` | Clean up stale worktree references |
