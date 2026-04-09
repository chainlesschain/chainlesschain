---
name: ralph
display-name: Ralph (Persistent Completion Loop)
description: Drive an approved plan to completion as a single persistent owner. Third step of the canonical coding workflow.
version: 1.0.0
category: workflow
user-invocable: true
tags: [workflow, execute, completion-loop]
capabilities: [execution, verification, iteration]
os: [win32, darwin, linux]
handler: ./handler.js
---

# Ralph Skill

Persistent completion loop — one owner keeps pushing on an approved
plan until every step is done and verified. Use this when the work
does not need coordinated parallelism and you want a single focused
execution context.

## Usage

```
$ralph "carry the approved auth plan to completion"
```

## Inputs (params)

- `note` (string, optional) — progress note to append to progress.log
- `sessionId` (string, optional) — workflow session

## Output

Appends to `progress.log` and returns LLM guidance: read the plan,
pick the next unfinished step, execute it with the coding agent's
normal tools (file_write, run_shell, tests, etc.), append progress,
repeat until the plan is complete.

## Gates

- Refuses if `plan.md` is missing.
- Refuses if `plan.md` frontmatter `approved: false`.
