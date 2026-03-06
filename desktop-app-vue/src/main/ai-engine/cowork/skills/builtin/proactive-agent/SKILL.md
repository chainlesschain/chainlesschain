---
name: proactive-agent
display-name: Proactive Agent
description: Autonomous proactive agent that monitors conditions and triggers actions - watches for file changes, error patterns, performance thresholds, and schedules periodic checks without user intervention
version: 1.0.0
category: automation
user-invocable: true
tags: [proactive, autonomous, monitor, watch, trigger, condition, alert, agent]
capabilities:
  [
    condition-monitoring,
    auto-trigger,
    file-watching,
    threshold-alert,
    periodic-check,
  ]
handler: ./handler.js
os: [win32, darwin, linux]
tools:
  [proactive-watch, proactive-trigger, proactive-list, proactive-stop, proactive-status]
dependencies: [workflow-automation]
instructions: |
  Use this skill when the user wants to set up autonomous monitoring and
  proactive actions. Supports 4 trigger types: file-watch (on file changes),
  threshold (when metrics exceed limits), periodic (at intervals), and
  pattern (when log patterns are detected). Each trigger can execute skills,
  run commands, or send notifications.
examples:
  - input: "watch src/ for changes and run tests"
    action: watch
  - input: "alert me when CPU exceeds 80%"
    action: threshold
  - input: "every 30 minutes check API health"
    action: periodic
  - input: "list all active watchers"
    action: list
input-schema:
  type: object
  properties:
    action:
      type: string
      enum: [watch, threshold, periodic, pattern, list, stop, status]
    config:
      type: object
output-schema:
  type: object
  properties:
    watcherId: { type: string }
    status: { type: string }
    triggers: { type: array }
author: ChainlessChain
license: MIT
---

# Proactive Agent Skill

Autonomous monitoring and proactive action execution.

## Usage

```
/proactive-agent watch <path> --on-change "<command>"
/proactive-agent threshold <metric> --above <value> --action "<command>"
/proactive-agent periodic <interval> "<command>"
/proactive-agent pattern <file> --match "<regex>" --action "<command>"
/proactive-agent list
/proactive-agent stop <watcher-id>
```

## Trigger Types

| Type | Description | Example |
| --- | --- | --- |
| `watch` | File/directory change detection | Watch `src/` and run tests |
| `threshold` | Metric threshold alerts | Alert when memory > 80% |
| `periodic` | Interval-based execution | Check API health every 30min |
| `pattern` | Log/file pattern matching | Detect ERROR in log files |

## Watch Mode

Monitors filesystem for changes using native OS watchers:

```
/proactive-agent watch src/ --on-change "npm test"
/proactive-agent watch config/ --on-change "/lint-and-fix"
```

## Threshold Mode

Monitors system metrics against thresholds:

```
/proactive-agent threshold cpu --above 80 --action "alert"
/proactive-agent threshold memory --above 90 --action "/system-monitor"
```

## Periodic Mode

Runs actions at regular intervals:

```
/proactive-agent periodic 30m "curl -s http://localhost:3000/health"
/proactive-agent periodic 1h "/security-audit --quick"
```

## Pattern Mode

Watches files for regex pattern matches:

```
/proactive-agent pattern logs/app.log --match "ERROR|FATAL" --action "alert"
/proactive-agent pattern access.log --match "status=5\\d{2}" --action "/log-analyzer"
```

## Management

```
/proactive-agent list          # List all active watchers
/proactive-agent status <id>   # Show watcher details
/proactive-agent stop <id>     # Stop a specific watcher
/proactive-agent stop all      # Stop all watchers
```
