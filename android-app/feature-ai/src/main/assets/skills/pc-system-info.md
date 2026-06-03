---
name: pc-system-info
display-name: PC System Info
description: Get PC system metrics (CPU, memory, disk)
version: 1.0.0
category: remote
user-invocable: true
tags: [remote, system, monitor, pc]
os: [android]
execution-mode: remote
remote-skill-name: remote-control
input-schema:
  - name: action
    type: string
    description: Action to perform (default: system-info)
    required: false
---

# PC System Info Skill

Get system metrics from your connected desktop PC including CPU usage, memory, and disk space.

## Usage

```
/pc-system-info
```

## Requirements

- Active P2P connection to a desktop running ChainlessChain
