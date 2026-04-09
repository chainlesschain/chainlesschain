---
name: complete
display-name: Complete (Canonical Workflow Terminal)
description: Stage 5 of the canonical coding workflow — write summary.md and transition to COMPLETE. Gated by verify.json (Gate V1/V3).
version: 1.0.0
category: workflow
user-invocable: true
tags: [workflow, complete, gate]
capabilities: [completion, gate-enforcement]
os: [win32, darwin, linux]
handler: ./handler.js
---

# Complete Skill

Fifth and final step of the canonical coding workflow. Writes
`summary.md` through `SessionStateManager.markComplete()`, which
enforces:

- **Gate V1** — `verify.json` must exist
- **Gate V3** — `verify.status` must be `"passed"`

A session cannot self-declare completion; only a passing verify
record can authorize the terminal COMPLETE stage.

## Usage

```
$complete
```

## Inputs (params)

- `sessionId` (string, optional) — workflow session id
- `summary` (string, optional) — free-form completion notes. If omitted,
  a default body is generated from the session id.

## Output

Writes `.chainlesschain/sessions/<id>/summary.md` and transitions the
session stage to `complete`.

## Gates

- Refuses if `verify.json` is missing.
- Refuses if `verify.status !== "passed"` (use `$verify` → fix-loop).
