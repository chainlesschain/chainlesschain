---
name: orchestrate
display-name: Orchestrate Workflow
description: Multi-agent workflow orchestration with predefined templates and agent handoff protocol
version: 1.0.0
category: workflow
user-invocable: true
tags:
  [
    orchestrate,
    workflow,
    multi-agent,
    feature,
    bugfix,
    refactor,
    security,
    pipeline,
  ]
capabilities:
  [
    workflow-templates,
    agent-handoff,
    multi-agent-coordination,
    sequential-execution,
    result-aggregation,
  ]
tools:
  - agent_coordinator
  - command_executor
  - file_reader
  - file_writer
instructions: |
  Use this skill when the user wants to execute a predefined multi-agent workflow.
  Supports 4 workflow templates: feature (new feature development), bugfix (bug diagnosis
  and fix), refactor (code restructuring), and security-audit (security review and fix).
  Each workflow runs a sequence of specialized agents with structured handoff documents.
  The final stage always runs verification-loop for quality assurance.
  Usage: /orchestrate <template> "description"
examples:
  - input: '/orchestrate feature "add user profile page"'
    output: "Feature workflow: planner → architect → coder → reviewer → verification. SHIP"
  - input: '/orchestrate bugfix "login fails with special characters"'
    output: "Bugfix workflow: debugger → coder → tester → verification. SHIP"
  - input: '/orchestrate refactor "extract auth module"'
    output: "Refactor workflow: architect → coder → reviewer → verification. SHIP"
os: [win32, darwin, linux]
author: ChainlessChain
handler: ./handler.js
---

# Orchestrate Workflow

## Description

Multi-agent workflow orchestration with predefined templates, agent handoff protocol, and structured inter-agent documents. Inspired by the everything-claude-code orchestrate pattern.

## Usage

```
/orchestrate <template> "description"
```

## Templates

| Template       | Agent Chain                                           | Use Case                |
| -------------- | ----------------------------------------------------- | ----------------------- |
| feature        | planner → architect → coder → reviewer → verification | New feature development |
| bugfix         | debugger → coder → tester → verification              | Bug diagnosis and fix   |
| refactor       | architect → coder → reviewer → verification           | Code restructuring      |
| security-audit | security → coder → security → verification            | Security review & fix   |

## Handoff Protocol

Each agent produces a structured handoff document:

```json
{
  "agent": "planner",
  "status": "complete",
  "deliverables": ["requirements.md", "acceptance-criteria.md"],
  "decisions": ["Use Vue 3 composables", "Add Pinia store"],
  "concerns": ["Performance impact on large datasets"],
  "nextAgentInstructions": "Implement based on requirements..."
}
```

## Output Format

```
Orchestrate Workflow Report
===========================
Template: feature
Description: "add user profile page"

| Step | Agent     | Status   | Duration | Summary                    |
| ---- | --------- | -------- | -------- | -------------------------- |
| 1    | planner   | Complete | 5.2s     | Requirements defined       |
| 2    | architect | Complete | 3.8s     | Architecture designed      |
| 3    | coder     | Complete | 12.1s   | Implementation complete    |
| 4    | reviewer  | Complete | 4.5s     | Code review passed         |
| 5    | verify    | Complete | 28.3s   | 6/6 verification passed    |

Verdict: SHIP
Total Duration: 53.9s
```

## Verdict Scale

- **SHIP** - All agents succeeded and verification passed
- **NEEDS WORK** - Some agents flagged concerns but no blockers
- **BLOCKED** - Critical failure in one or more agents
