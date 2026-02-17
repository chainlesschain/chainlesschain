---
name: pc-run-command
display-name: PC Run Command
description: Execute a terminal command on the connected PC
version: 1.0.0
category: remote
user-invocable: true
tags: [remote, terminal, command, pc]
os: [android]
execution-mode: remote
remote-skill-name: remote-control
input-schema:
  - name: command
    type: string
    description: The terminal command to execute
    required: true
---

# PC Run Command Skill

Execute a terminal command on your connected desktop PC and get the output.

## Usage

```
/pc-run-command [command]
```

## Examples

```
/pc-run-command git pull origin main
```

```
/pc-run-command npm run build
```

## Requirements

- Active P2P connection to a desktop running ChainlessChain
