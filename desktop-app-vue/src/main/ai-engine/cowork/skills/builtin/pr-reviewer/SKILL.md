---
name: pr-reviewer
display-name: PR Reviewer
description: AI-powered pull request review and summarization - analyze diffs, detect bugs, security issues, suggest improvements, generate PR summaries, and auto-comment on GitHub PRs
version: 1.0.0
category: development
user-invocable: true
tags: [pr, review, github, diff, code-review, summary, pull-request]
capabilities: [diff-analysis, bug-detection, security-scan, pr-summary, auto-comment]
handler: ./handler.js
os: [win32, darwin, linux]
tools: [pr-review, pr-summary, pr-comment]
requires:
  bins: [git, gh]
instructions: |
  Use this skill when the user wants to review a pull request, summarize PR
  changes, or get automated code review feedback. Analyzes git diffs for bugs,
  security issues, style violations, and suggests improvements. Can generate
  PR summaries and post review comments via GitHub CLI.
examples:
  - input: "review PR #42"
    action: review
  - input: "summarize the current branch changes"
    action: summary
  - input: "review the diff against main"
    action: diff-review
author: ChainlessChain
license: MIT
---

# PR Reviewer Skill

AI-powered pull request review and summarization.

## Usage

```
/pr-reviewer review <PR-number>
/pr-reviewer summary [branch]
/pr-reviewer diff [base-branch]
```

## Review Checklist

- Bug detection and logic errors
- Security vulnerabilities (injection, XSS, secrets)
- Performance concerns
- Error handling gaps
- Code style and consistency
- Test coverage gaps
- Breaking changes

## Output Format

Each finding includes: severity (critical/warning/info), file:line, description, and suggestion.
