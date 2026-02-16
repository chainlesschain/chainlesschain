---
name: workflow-automation
display-name: Workflow Automation
description: Create and run multi-step automation workflows with conditional logic, loops, and parallel execution
version: 1.0.0
category: automation
user-invocable: true
tags: [workflow, automation, multi-step, pipeline, batch, condition, loop]
capabilities:
  [workflow-creation, workflow-execution, conditional-logic, parallel-execution]
handler: ./handler.js
os: [win32, darwin, linux]
tools:
  [
    workflow-create,
    workflow-run,
    workflow-list,
    workflow-pause,
    workflow-resume,
    workflow-cancel,
  ]
dependencies: [browser-automation, computer-use]
instructions: |
  Use this skill to chain multiple automated actions into workflows.
  Supports sequential steps, conditional branching, loops, parallel
  execution, and sub-workflows. Workflows can combine browser automation,
  desktop control, data extraction, and memory management actions.
examples:
  - input: "list all workflows"
    action: list
  - input: "run workflow daily-backup"
    action: run
  - input: "create a workflow that screenshots 5 URLs"
    action: create
---

# Workflow Automation Skill

Create and manage multi-step automation workflows.

## Usage

```
/workflow-automation <action> [name/id] [options]
```

## Actions

| Action   | Description            | Example                                      |
| -------- | ---------------------- | -------------------------------------------- |
| `create` | Create a new workflow  | `/workflow-automation create "Daily Report"` |
| `run`    | Execute a workflow     | `/workflow-automation run daily-backup`      |
| `list`   | List all workflows     | `/workflow-automation list`                  |
| `status` | Check workflow status  | `/workflow-automation status workflow-id`    |
| `pause`  | Pause running workflow | `/workflow-automation pause workflow-id`     |
| `resume` | Resume paused workflow | `/workflow-automation resume workflow-id`    |
| `cancel` | Cancel workflow        | `/workflow-automation cancel workflow-id`    |

## Workflow Features

- **Sequential Steps**: Run actions one after another
- **Conditional Branching**: If/else based on previous results
- **Loops**: Repeat actions for a list of items
- **Parallel Execution**: Run independent actions simultaneously
- **Sub-workflows**: Nest workflows for complex pipelines
- **Error Handling**: Retry, skip, or abort on failure
