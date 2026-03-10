---
name: create-pr
display-name: Create PR
description: Generate pull request descriptions, changelogs, and PR templates from git changes
version: 1.0.0
category: development
user-invocable: true
tags: [pr, pull-request, git, changelog, development]
capabilities: [pr-creation, draft-pr, template-generation, changelog-generation]
os: [win32, darwin, linux]
handler: ./handler.js
---

# Create PR Skill

Generate pull request content from git changes, including titles, descriptions, and changelogs.

## Usage

```
/create-pr [mode] [branch name or description]
```

## Modes

- **create** (default) - Generate PR title and description from current changes
- **draft** - Create a draft PR outline
- **template** - Generate a reusable PR template
- **changelog** - Generate changelog entries from commits

## Examples

```
/create-pr create
/create-pr create feature/user-auth
/create-pr draft Add caching to API endpoints
/create-pr template
/create-pr changelog v1.1.0..v1.2.0
```

## Output

PR title, structured description with summary, changes, testing notes, and optional changelog.
