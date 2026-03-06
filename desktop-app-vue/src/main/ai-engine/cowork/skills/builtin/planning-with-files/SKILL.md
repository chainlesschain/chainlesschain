---
name: planning-with-files
display-name: Planning with Files
description: Manus-style persistent markdown planning - use filesystem as working memory with task_plan.md, findings.md, and progress.md for complex multi-step tasks that survive context resets
version: 1.0.0
category: productivity
user-invocable: true
tags: [planning, manus, persistent, markdown, workflow, memory, context, tracking]
capabilities:
  [
    task-planning,
    progress-tracking,
    findings-storage,
    session-recovery,
    context-persistence,
  ]
handler: ./handler.js
os: [win32, darwin, linux]
tools: [plan-create, plan-update, plan-status, plan-findings, plan-progress]
instructions: |
  Use this skill for complex multi-step tasks. Creates 3 persistent files:
  task_plan.md (phases and progress), findings.md (research and discoveries),
  progress.md (session log and test results). The 2-Action Rule: save findings
  after every 2 view/browse operations. Never start without task_plan.md.
  Context Window = RAM (volatile), Filesystem = Disk (persistent).
examples:
  - input: "plan a new feature for user authentication"
    action: create
  - input: "update plan phase 2 as completed"
    action: update
  - input: "show current plan status"
    action: status
  - input: "add finding: API rate limit is 100 req/min"
    action: finding
author: ChainlessChain
license: MIT
---

# Planning with Files Skill

Manus-style persistent markdown planning for complex tasks.

## Usage

```
/planning-with-files create "<task description>"
/planning-with-files update <phase> <status>
/planning-with-files status
/planning-with-files finding "<finding text>"
/planning-with-files progress "<progress note>"
/planning-with-files recover
```

## The 3-File Pattern

For every complex task, THREE files are created:

| File | Purpose | Updated When |
| --- | --- | --- |
| `task_plan.md` | Track phases and progress | Phase changes |
| `findings.md` | Store research and discoveries | After research |
| `progress.md` | Session log and test results | After actions |

## Core Principles

### Context Window = RAM, Filesystem = Disk

```
Context Window → Volatile, limited capacity
Filesystem     → Persistent, unlimited storage
```

### The 2-Action Rule

After every 2 view/browse/research operations, save findings to `findings.md`.

### Never Start Without a Plan

Always create `task_plan.md` before beginning work. The plan is your persistent roadmap.

## Plan Template

```markdown
# Task Plan: [Title]

## Objective
[What we're trying to achieve]

## Phases
- [ ] Phase 1: Research & Discovery
- [ ] Phase 2: Design & Architecture
- [ ] Phase 3: Implementation
- [ ] Phase 4: Testing & Validation
- [ ] Phase 5: Review & Cleanup

## Current Phase: 1
## Status: IN_PROGRESS
```

## Session Recovery

When context is reset, use `/planning-with-files recover` to reload the plan state from the persistent files. This restores context without losing progress.

## Actions

| Action | Description |
| --- | --- |
| `create` | Initialize plan with 3 files |
| `update` | Update phase status |
| `status` | Show current plan state |
| `finding` | Add research finding |
| `progress` | Add progress note |
| `recover` | Recover from context reset |
