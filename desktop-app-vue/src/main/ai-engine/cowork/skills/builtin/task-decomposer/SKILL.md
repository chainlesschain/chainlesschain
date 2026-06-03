---
name: task-decomposer
display-name: Task Decomposer
description: 智能任务分解器 - 将复杂需求自动拆分为有序子任务，分配到最合适的技能执行
version: 1.0.0
category: automation
user-invocable: true
tags: [orchestrator, decompose, planning, workflow, multi-task, routing]
capabilities:
  [task-decomposition, skill-routing, dependency-management, result-aggregation]
tools: [file_reader, code_analyzer, project_navigator]
handler: ./handler.js
instructions: |
  Use when a user request is complex and involves multiple steps or skills.
  Decompose into ordered sub-tasks, identify dependencies, assign each to the
  best skill, and track execution. Supports --analyze (decompose only),
  --execute (run all), and --status (check progress).
examples:
  - input: "/task-decomposer 'add a new user profile page with tests and docs'"
    output: "Decomposed into 5 sub-tasks: 1) project-scaffold (Vue page) 2) db-migration (add profile table) 3) test-generator (unit tests) 4) doc-generator (API docs) 5) code-review (final check)"
  - input: "/task-decomposer --analyze 'refactor auth module, add security audit, update docs'"
    output: "Analysis: 3 sub-tasks identified with dependency chain: refactor → security-audit → doc-generator"
  - input: "/task-decomposer --status task-abc123"
    output: "Task task-abc123: 3/5 sub-tasks completed, 1 in-progress, 1 pending"
input-schema:
  type: object
  properties:
    input:
      type: string
      description: Task description with optional flags (--analyze, --execute, --status)
  required: [input]
output-schema:
  type: object
  properties:
    id:
      type: string
      description: Unique decomposition ID
    originalTask:
      type: string
      description: The original task description
    subTasks:
      type: array
      items:
        type: object
        properties:
          id:
            type: string
          skill:
            type: string
          description:
            type: string
          dependencies:
            type: array
            items:
              type: string
          status:
            type: string
            enum: [pending, in-progress, completed, failed, skipped]
          estimatedEffort:
            type: string
model-hints:
  min-context: 4096
  preferred-models: [gpt-4, claude-3, qwen2]
cost: low
os: [win32, darwin, linux]
author: ChainlessChain Team
license: MIT
---

# Task Decomposer Skill

Intelligently decomposes complex, multi-step user requests into ordered
sub-tasks, assigns each to the most suitable built-in skill, resolves
dependencies, and optionally orchestrates execution.

## Usage

```
/task-decomposer <task description>
/task-decomposer --analyze <task description>
/task-decomposer --execute <task description>
/task-decomposer --status <decomposition-id>
```

## Modes

### Default / --analyze

Decomposes the task and returns a structured plan without executing anything.
Useful for review before committing to execution.

### --execute

Decomposes the task **and** executes each sub-task in dependency order.
Sub-tasks with unmet dependencies are queued until predecessors complete.

### --status

Returns the current progress of a previously decomposed task by its ID.

## Skill Routing

The decomposer maps keywords in the task description to built-in skills:

| Keyword Pattern                      | Assigned Skill        |
| ------------------------------------ | --------------------- |
| test, spec, unit test                | test-generator        |
| page, component, scaffold, create    | project-scaffold      |
| database, schema, migration, table   | db-migration          |
| docs, document, readme, guide        | doc-generator         |
| review, inspect, quality             | code-review           |
| deploy, ci, cd, pipeline, docker     | devops-automation     |
| security, audit, vulnerability       | security-audit        |
| lint, format, eslint, prettier       | lint-and-fix          |
| performance, optimize, speed, memory | performance-optimizer |
| refactor, restructure, clean up      | refactor              |
| api, endpoint, rest, graphql         | api-tester            |
| explain, understand, walkthrough     | explain-code          |
| dependency, package, outdated        | dependency-analyzer   |

## Dependency Resolution

Sub-tasks are automatically ordered based on logical dependencies:

1. Scaffolding / creation tasks run first
2. Database migrations before application code
3. Implementation before testing
4. Testing before code review
5. Documentation can run in parallel with review
6. Security audit and linting run last

## Output Format

```json
{
  "id": "td-abc123",
  "originalTask": "add user profile page with tests and docs",
  "subTasks": [
    {
      "id": "st-1",
      "skill": "project-scaffold",
      "description": "Create Vue user profile page component",
      "dependencies": [],
      "status": "pending",
      "estimatedEffort": "medium"
    }
  ],
  "totalEstimatedEffort": "high",
  "executionOrder": ["st-1", "st-2", "st-3"]
}
```

## Examples

Decompose a feature request:

```
/task-decomposer "build a settings page with form validation, unit tests, and API docs"
```

Analyze without executing:

```
/task-decomposer --analyze "refactor the auth module and run security audit"
```

Execute a full plan:

```
/task-decomposer --execute "create REST API endpoint, add tests, lint, and deploy"
```

Check progress:

```
/task-decomposer --status td-abc123
```
