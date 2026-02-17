---
name: pc-clipboard
display-name: PC Clipboard
description: Sync clipboard content between Android and PC
version: 1.0.0
category: remote
user-invocable: true
tags: [remote, clipboard, sync, pc]
os: [android]
execution-mode: remote
remote-skill-name: remote-control
input-schema:
  - name: content
    type: string
    description: Text to send to PC clipboard (omit to read PC clipboard)
    required: false
---

# PC Clipboard Skill

Sync clipboard content between your Android device and connected desktop PC. Send text to PC clipboard or read the current PC clipboard content.

## Usage

```
/pc-clipboard                     # Read PC clipboard
/pc-clipboard [text to send]      # Send text to PC clipboard
```

## Examples

```
/pc-clipboard
```

```
/pc-clipboard https://important-link.example.com/doc
```

## Requirements

- Active P2P connection to a desktop running ChainlessChain
