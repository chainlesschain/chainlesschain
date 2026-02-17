---
name: git-commit
display-name: Git Commit Message
description: Generate meaningful git commit messages from changes
version: 1.0.0
category: development
user-invocable: true
tags: [git, commit, development]
os: [android, win32, darwin, linux]
input-schema:
  - name: changes
    type: string
    description: Description of the changes made
    required: true
execution-mode: local
---

# Git Commit Message Generator

Generates conventional commit messages from change descriptions.

## Usage

```
/git-commit Added user authentication with JWT tokens
```

## Format

Follows conventional commits: `type(scope): description`

Types: feat, fix, docs, style, refactor, test, chore, perf

## Examples

```
/git-commit Fixed login crash when password is empty
```
