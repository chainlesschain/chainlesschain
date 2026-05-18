---
name: team
display-name: Team (Coordinated Parallel Execution)
description: Split an approved plan into subtasks for coordinated parallel execution across multiple agent roles. Third step of the canonical coding workflow.
version: 1.0.0
category: workflow
user-invocable: true
tags: [workflow, parallel, team, cowork]
capabilities: [task-splitting, parallel-coordination]
os: [win32, darwin, linux]
handler: ./handler.js
---

# Team Skill

Coordinated parallel execution alternative to `$ralph`. Reads an
approved `plan.md`, splits the steps into subtasks, and returns a
routing spec describing the team composition and per-role assignments.
The coding agent / cowork runtime is responsible for actually spawning
and coordinating the sub-agents.

## Usage

```
$team 3:executor "execute the approved auth plan in parallel"
```

The `N:role` prefix is parsed from `task.action` or `task.params.spec`.

## Inputs (params)

- `size` (number, optional) — team size (default 3, max 6)
- `role` (string, optional) — default role for team members (`executor`, `reviewer`, `tester`, …)
- `spec` (string, optional) — raw `"N:role"` string, same as `task.action`
- `sessionId` (string, optional) — workflow session

## Output

- Appends a team-spawn marker to `progress.log`
- Returns a subtask assignment plan that the runtime can dispatch to
  cowork / coding-agent sub-sessions.

## Gates

- Refuses if `plan.md` is missing.
- Refuses if `plan.md` frontmatter `approved: false`.
