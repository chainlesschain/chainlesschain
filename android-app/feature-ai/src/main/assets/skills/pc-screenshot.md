---
name: pc-screenshot
display-name: PC Screenshot
description: Take a screenshot of the PC screen
version: 1.0.0
category: remote
user-invocable: true
tags: [remote, screenshot, desktop, pc]
os: [android]
execution-mode: remote
remote-skill-name: computer-use
input-schema:
  - name: action
    type: string
    description: Action to perform (default: screenshot)
    required: false
---

# PC Screenshot Skill

Take a screenshot of your connected desktop PC screen. Requires an active P2P connection to the desktop.

## Usage

```
/pc-screenshot
```

## How It Works

This skill delegates to the desktop `computer-use` skill via P2P, which captures the screen and returns the screenshot data.

## Requirements

- Active P2P connection to a desktop running ChainlessChain
