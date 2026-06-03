---
name: pc-cowork-daily
display-name: PC Cowork Daily Task
description: Run a daily Cowork task on your desktop via P2P (uses templates, workflows, or free mode)
version: 1.0.0
category: remote
user-invocable: true
tags: [remote, cowork, desktop, pc, multi-agent]
os: [android]
execution-mode: remote
remote-skill-name: cowork-daily
input-schema:
  - name: template
    type: string
    description: Cowork template id (e.g. weekly-report, doc-convert). Omit for free mode.
    required: false
  - name: message
    type: string
    description: The task description / user message
    required: true
  - name: files
    type: string
    description: Comma-separated absolute file paths on the desktop
    required: false
---

# PC Cowork Daily Task Skill

Run a daily Cowork task on your connected desktop via P2P. Supports any of the built-in Cowork templates (writing, weekly-report, doc-convert, trip-planner, …) or free mode.

## Usage

```
/pc-cowork-daily template=weekly-report message="Summarize this week's commits"
/pc-cowork-daily message="Draft a reply to the attached email" files=/path/to/email.txt
```

## How It Works

This skill delegates to the desktop `cowork-daily` skill via the existing P2P `RemoteSkillProvider`. The desktop runs the task with `runCoworkTask`, streams progress back, and returns the final summary and artifacts.

## Requirements

- Active P2P connection to a desktop running ChainlessChain
- The referenced template must be installed on the desktop (built-in or marketplace)
