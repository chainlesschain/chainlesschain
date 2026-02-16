---
name: git-commit
display-name: Git Commit
description: Generate semantic commit messages based on staged changes
version: 1.0.0
category: development
user-invocable: true
tags: [git, commit, version-control]
capabilities: [git-analysis, message-generation]
requires:
  bins: [git]
os: [win32, darwin, linux]
handler: ./handler.js
---

# Git Commit Skill

Analyzes staged changes and generates appropriate semantic commit messages.

## Usage

```
/git-commit [options]
```

## Options

- `--scope <scope>` - Specify the scope (e.g., ui, api, db)
- `--type <type>` - Override commit type (feat, fix, docs, etc.)
- `--dry-run` - Preview without committing

## Commit Types

| Type     | Description                |
| -------- | -------------------------- |
| feat     | New feature                |
| fix      | Bug fix                    |
| docs     | Documentation only         |
| style    | Formatting, no code change |
| refactor | Code restructuring         |
| test     | Adding tests               |
| chore    | Maintenance tasks          |
| perf     | Performance improvements   |

## Process

1. Reads staged changes via `git diff --cached`
2. Analyzes the nature of changes
3. Identifies affected files and scope
4. Generates semantic commit message
5. Presents for user approval
6. Commits with message

## Examples

Basic usage:

```
/git-commit
```

With scope:

```
/git-commit --scope api
```

Preview only:

```
/git-commit --dry-run
```

## Output

```
Analyzing staged changes...

Detected changes:
- 3 files modified
- 1 file added
- Primary scope: api

Suggested commit:
feat(api): add user authentication endpoint

- Add /auth/login and /auth/logout endpoints
- Implement JWT token generation
- Add rate limiting middleware

Proceed with commit? [Y/n]
```
