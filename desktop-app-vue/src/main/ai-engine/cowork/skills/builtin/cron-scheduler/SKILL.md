---
name: cron-scheduler
display-name: Cron Scheduler
description: Schedule and manage automated tasks with cron expressions - create recurring jobs, one-time tasks, natural language scheduling, and cross-platform timer management
version: 1.0.0
category: automation
user-invocable: true
tags: [cron, schedule, automation, timer, recurring, job, task, periodic]
capabilities:
  [
    cron-scheduling,
    natural-language-time,
    one-time-task,
    recurring-task,
    job-management,
  ]
handler: ./handler.js
os: [win32, darwin, linux]
tools: [cron-add, cron-list, cron-remove, cron-status, cron-pause, cron-resume]
instructions: |
  Use this skill when the user wants to schedule tasks for later execution,
  set up recurring jobs, or manage automated schedules. Supports cron expressions,
  natural language time ("every weekday at 9am", "tomorrow at 3pm"), one-time
  and recurring tasks. Use this skill instead of executing immediately whenever
  the user's request contains a time expression.
examples:
  - input: "every weekday at 9am review yesterday's code"
    action: add
  - input: "list all scheduled tasks"
    action: list
  - input: "run tests every 4 hours"
    action: add
  - input: "cancel task abc123"
    action: remove
input-schema:
  type: object
  properties:
    action:
      type: string
      enum: [add, list, remove, pause, resume, status]
    schedule:
      type: string
    command:
      type: string
output-schema:
  type: object
  properties:
    jobId: { type: string }
    jobs: { type: array }
    cron: { type: string }
author: ChainlessChain
license: MIT
---

# Cron Scheduler Skill

Schedule and manage automated tasks.

## Usage

```
/cron-scheduler add "<schedule>" "<command>"
/cron-scheduler list
/cron-scheduler remove <job-id>
/cron-scheduler pause <job-id>
/cron-scheduler resume <job-id>
/cron-scheduler status <job-id>
```

## Schedule Formats

### Cron Expressions

```
* * * * *
| | | | |
| | | | +-- Day of week (0-6, Sun=0)
| | | +---- Month (1-12)
| | +------ Day of month (1-31)
| +-------- Hour (0-23)
+---------- Minute (0-59)
```

### Natural Language

| Expression | Cron | Type |
| --- | --- | --- |
| `every day at 9am` | `0 9 * * *` | Recurring |
| `every weekday at 9am` | `0 9 * * 1-5` | Recurring |
| `every Monday at 10am` | `0 10 * * 1` | Recurring |
| `every 4 hours` | `0 */4 * * *` | Recurring |
| `every 30 minutes` | `*/30 * * * *` | Recurring |
| `tomorrow at 3pm` | - | One-time |
| `today at 5pm` | - | One-time |

## Common Patterns

| Pattern | Cron | Description |
| --- | --- | --- |
| `0 9 * * *` | Daily at 9:00 AM |
| `0 9 * * 1-5` | Weekdays at 9:00 AM |
| `*/15 * * * *` | Every 15 minutes |
| `0 */2 * * *` | Every 2 hours |
| `0 9 1 * *` | First of month at 9:00 AM |

## Task Types

- **One-time**: Runs once at a specific time, auto-cleans up after execution
- **Recurring**: Repeats on a schedule until stopped

Detection rule: Unless "every", "daily", "weekly" or similar keywords are present, the task is treated as one-time.

## Examples

```
/cron-scheduler add "every weekday at 9am" "review yesterday's code commits"
/cron-scheduler add "every 4 hours" "check API health"
/cron-scheduler add "tomorrow at 3pm" "deploy staging release"
```
