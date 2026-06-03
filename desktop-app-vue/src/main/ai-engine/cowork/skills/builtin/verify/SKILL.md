---
name: verify
display-name: Verify (Canonical Workflow Gate)
description: Stage 4 of the canonical coding workflow — execute verification checks, write verify.json, and gate completion on real evidence. Failure auto-routes to fix-loop.
version: 1.0.0
category: workflow
user-invocable: true
tags: [workflow, verify, gate, fix-loop]
capabilities: [verification, gate-enforcement, fix-loop-routing]
os: [win32, darwin, linux]
handler: ./handler.js
---

# Verify Skill

Fourth step of the canonical coding workflow
(`$deep-interview → $ralplan → $ralph/$team → $verify → complete`).

`$verify` runs structured verification checks, aggregates the result,
and writes `verify.json`. The result is the **only** authorization to
transition a session to `complete`. A failing or partial result routes
the session to `fix-loop` (bounded retries) or `failed`.

## Usage

```
$verify
```

## Inputs (params)

- `sessionId` (string, optional) — workflow session id
- `checks` (Array<{id, command, timeout?}>, optional) — explicit checks
- `maxRetries` (number, optional, default 3) — fix-loop cap (Gate V4)
- `autoFixLoop` (boolean, optional, default true) — on failure, auto
  call `enterFixLoop` instead of just reporting
- `cwd` (string, optional) — working directory for commands; defaults
  to `projectRoot`

## Check sources (priority order)

1. `params.checks`
2. `tasks.json` — union of every task's `verifyCommands`
3. Default heuristics (package.json → `npm test`, Maven → `mvn test -q`,
   pytest → `python -m pytest -q`). Skipped cleanly if nothing detected.

## Output

Writes `.chainlesschain/sessions/<id>/verify.json` via
`SessionStateManager.writeVerify()` and transitions stage to `verify`.
If the aggregate status is `passed`, the caller may invoke `$complete`
(which enforces Gate V1/V3). If not, the handler enters fix-loop or
records failed.

## Gates

- Refuses if `plan.md` is missing.
- Refuses if `plan.md` is not approved.
- `verify.json` is the only authorization for `complete` (Gate V1/V3).
- Fix-loop respects `maxRetries` (Gate V4).
