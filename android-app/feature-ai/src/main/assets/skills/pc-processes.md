---
name: pc-processes
display-name: PC Processes
description: List and manage running processes on the connected PC
version: 1.0.0
category: remote
user-invocable: true
tags: [remote, processes, monitor, pc]
os: [android]
execution-mode: remote
remote-skill-name: remote-control
input-schema:
  - name: action
    type: string
    description: Action to perform (default: process-list)
    required: false
  - name: filter
    type: string
    description: Filter processes by name (optional)
    required: false
---

# PC Processes Skill

List and manage running processes on your connected desktop PC.

## Usage

```
/pc-processes
/pc-processes --filter node
```

## Examples

```
/pc-processes
```

```
/pc-processes --filter chrome
```

## Requirements

- Active P2P connection to a desktop running ChainlessChain
