---
name: pc-cowork-workflow
display-name: PC Cowork Workflow
description: Execute a saved Cowork DAG workflow on the desktop via P2P
version: 1.0.0
category: remote
user-invocable: true
tags: [remote, cowork, workflow, dag, desktop, pc]
os: [android]
execution-mode: remote
remote-skill-name: cowork-workflow
input-schema:
  - name: id
    type: string
    description: Saved workflow id on the desktop (see `cc cowork workflow list`)
    required: true
  - name: continueOnError
    type: string
    description: "true to keep running after a failed step (default false)"
    required: false
---

# PC Cowork Workflow Skill

Execute a multi-step Cowork workflow (DAG) saved on the desktop. Dependencies, parallel batches, and `${step.<id>.summary}` placeholders all run on the desktop side.

## Usage

```
/pc-cowork-workflow id=research-pipeline
/pc-cowork-workflow id=weekly-digest continueOnError=true
```

## How It Works

Delegates to the desktop `cowork-workflow` skill via P2P. The desktop resolves the saved workflow, runs `executeWorkflow` from `cowork-workflow.js`, and returns per-step status + final summary.

## Requirements

- Active P2P connection to a desktop running ChainlessChain
- The workflow must already be saved on the desktop via `cc cowork workflow add <file>`
