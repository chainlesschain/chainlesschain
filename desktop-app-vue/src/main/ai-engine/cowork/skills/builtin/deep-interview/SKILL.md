---
name: deep-interview
display-name: Deep Interview
description: Clarify intent, boundaries, and non-goals before planning. First step of the canonical coding workflow.
version: 1.0.0
category: workflow
user-invocable: true
tags: [workflow, clarify, intent, planning]
capabilities: [requirement-elicitation, scope-definition]
os: [win32, darwin, linux]
handler: ./handler.js
---

# Deep Interview Skill

First step of the ChainlessChain canonical coding workflow:

```
$deep-interview  →  $ralplan  →  $ralph / $team
```

Use this skill when the user's request is vague, the scope is unclear,
or the boundaries and non-goals have not been agreed upon.

It writes a structured `intent.md` to
`<project>/.chainlesschain/sessions/<session-id>/intent.md` which the
next step (`$ralplan`) will read.

## Usage

```
$deep-interview "add authentication to the API"
```

## Inputs (params)

- `goal` (string, required) — the raw user request
- `clarifications` (string[], optional) — follow-up answers already gathered
- `nonGoals` (string[], optional) — explicit out-of-scope items
- `sessionId` (string, optional) — reuse an existing workflow session

## Output

`intent.md` file path + the rendered markdown, plus LLM guidance asking
the agent to ask the user any remaining clarification questions before
advancing to `$ralplan`.
