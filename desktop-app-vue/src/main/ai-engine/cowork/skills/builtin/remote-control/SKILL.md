---
name: remote-control
display-name: Remote Control
description: Control remote desktop and Android devices - execute commands, transfer files, manage processes, sync clipboard
version: 1.0.0
category: remote
user-invocable: true
tags: [remote, device, p2p, android, desktop, control]
capabilities: [remote-command, file-transfer, device-management, clipboard-sync]
handler: ./handler.js
os: [win32, darwin, linux]
tools:
  [
    list-devices,
    remote-exec,
    file-transfer,
    clipboard-sync,
    system-info,
    process-list,
  ]
instructions: |
  Use this skill when the user wants to interact with connected remote
  devices (desktop or Android). Supports listing peers, executing remote
  commands, file transfers, clipboard sync, and system monitoring.
  Requires an active P2P connection via WebRTC signaling server.
examples:
  - input: "list connected devices"
    action: list-devices
  - input: "execute ls -la on remote device"
    action: execute
  - input: "sync clipboard"
    action: clipboard-sync
---

# Remote Control Skill

Control connected remote desktop and Android devices via P2P.

## Usage

```
/remote-control <action> [args]
```

## Actions

| Action             | Description                   | Example                                            |
| ------------------ | ----------------------------- | -------------------------------------------------- |
| `list-devices`     | Show connected devices        | `/remote-control list-devices`                     |
| `execute` / `exec` | Run command on remote device  | `/remote-control exec ls -la`                      |
| `file-transfer`    | Transfer file to/from device  | `/remote-control file-transfer send /path/to/file` |
| `clipboard-sync`   | Sync clipboard content        | `/remote-control clipboard-sync`                   |
| `system-info`      | Get remote system information | `/remote-control system-info`                      |
| `process-list`     | List running processes        | `/remote-control process-list`                     |

## Requirements

- Active P2P connection via WebRTC signaling server (port 9001)
- At least one paired device
