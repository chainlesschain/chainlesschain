---
name: daily-planner
display-name: Daily Planner
description: Generate a prioritized daily task plan from goals and context
version: 1.0.0
category: productivity
user-invocable: true
tags: [planning, schedule, productivity, tasks]
os: [android]
handler: DailyPlannerHandler
execution-mode: local
input-schema:
  - name: text
    type: string
    description: Goals, tasks, and context for the day
    required: true
---

# Daily Planner Skill

Generate an organized daily plan with prioritized tasks and suggested time blocks from your goals and context.

## Usage

```
/daily-planner [your goals, tasks, and context for the day]
```

## Examples

```
/daily-planner Finish the API integration, review PR from Alice, prepare slides for tomorrow's demo, gym at 6pm
```
