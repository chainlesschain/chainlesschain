---
name: ralplan
display-name: Ralplan (Approved Plan)
description: Turn a clarified intent into an approved implementation plan with tradeoffs. Second step of the canonical coding workflow.
version: 1.0.0
category: workflow
user-invocable: true
tags: [workflow, plan, architecture, tradeoffs]
capabilities: [planning, tradeoff-analysis]
os: [win32, darwin, linux]
handler: ./handler.js
---

# Ralplan Skill

Second step of the canonical coding workflow. Reads `intent.md` written
by `$deep-interview` and produces a structured `plan.md` with steps and
tradeoffs. The plan starts as **unapproved** — the user (or agent with
user confirmation) must run `$ralplan --approve` before execution
skills (`$ralph` / `$team`) will accept it.

## Usage

```
$ralplan "approve the safest path for the auth change"
$ralplan --approve
```

## Inputs (params)

- `title` (string, optional) — plan title
- `steps` (string[], optional) — ordered implementation steps
- `tradeoffs` (string[], optional) — notable tradeoffs and their rationale
- `approve` (boolean, optional) — flip the approved flag on an existing plan
- `sessionId` (string, optional) — workflow session

## Output

Writes `plan.md` with YAML frontmatter (`approved: true|false`) and
returns LLM guidance asking the agent to walk the user through the plan
and request approval.

## Gates

- Refuses to run if `intent.md` is missing (user must run `$deep-interview` first).
