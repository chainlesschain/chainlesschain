---
name: github-manager
display-name: GitHub Manager
description: GitHub operations - manage issues, pull requests, repositories, and workflows via GitHub API
version: 1.2.0
category: development
user-invocable: true
tags: [github, issues, pull-requests, repositories, workflows, ci-cd, git]
capabilities: [issue-management, pr-management, repo-info, workflow-management]
handler: ./handler.js
os: [win32, darwin, linux]
tools: [github-issues, github-prs, github-repo, github-workflows]
instructions: |
  Use this skill when the user wants to interact with GitHub repositories.
  Supports listing and creating issues, listing and creating pull requests,
  viewing repository info, and listing workflow runs. Requires GITHUB_TOKEN
  environment variable for authentication.
examples:
  - input: "list-issues owner/repo --state open"
    action: list-issues
  - input: "create-issue owner/repo title:'Bug report' body:'Steps to reproduce...'"
    action: create-issue
  - input: "list-prs owner/repo --state open"
    action: list-prs
  - input: "repo-info owner/repo"
    action: repo-info
  - input: "list-workflows owner/repo"
    action: list-workflows
input-schema:
  type: string
  description: "Action followed by owner/repo and parameters"
output-schema:
  type: object
  properties:
    success: { type: boolean }
    action: { type: string }
    results: { type: array }
    message: { type: string }
model-hints:
  context-window: small
  capability: text
cost: api-key-required
author: ChainlessChain
license: MIT
---

# GitHub Manager

Manage GitHub issues, pull requests, repositories, and workflows.

## Usage

```
/github-manager list-issues <owner/repo> [--state open|closed|all] [--max N]
/github-manager create-issue <owner/repo> title:'<title>' body:'<body>' [--labels bug,enhancement]
/github-manager list-prs <owner/repo> [--state open|closed|all] [--max N]
/github-manager create-pr <owner/repo> title:'<title>' head:<branch> base:<branch> body:'<body>'
/github-manager repo-info <owner/repo>
/github-manager list-workflows <owner/repo>
```

## Actions

| Action | Description |
| --- | --- |
| `list-issues` | List repository issues with optional state filter |
| `create-issue` | Create a new issue with title, body, and labels |
| `list-prs` | List pull requests with optional state filter |
| `create-pr` | Create a new pull request |
| `repo-info` | Get repository metadata and statistics |
| `list-workflows` | List recent GitHub Actions workflow runs |

## Setup

Set the `GITHUB_TOKEN` environment variable:

```bash
export GITHUB_TOKEN=ghp_your-personal-access-token
```

## Examples

- List open issues: `/github-manager list-issues myorg/myrepo --state open`
- Create an issue: `/github-manager create-issue myorg/myrepo title:'Fix login bug' body:'Login fails on mobile'`
- View repo info: `/github-manager repo-info myorg/myrepo`
