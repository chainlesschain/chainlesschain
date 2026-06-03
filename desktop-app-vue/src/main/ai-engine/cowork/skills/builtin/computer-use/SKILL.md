---
name: computer-use
display-name: Computer Use
description: Control desktop - take screenshots, click at coordinates, type text, move mouse, press keys, visual AI
version: 1.0.0
category: automation
user-invocable: true
tags: [desktop, screenshot, mouse, keyboard, computer-use, screen, vision]
capabilities:
  [desktop-control, screenshot, mouse-keyboard, vision-ai, coordinate-click]
handler: ./handler.js
os: [win32, darwin, linux]
tools:
  [
    desktop-screenshot,
    desktop-click,
    desktop-type,
    visual-click,
    visual-analyze,
    mouse-move,
    key-press,
  ]
instructions: |
  Use this skill for desktop-level automation beyond the browser - taking
  screenshots of the entire screen, clicking at pixel coordinates, typing
  text via keyboard simulation, and using Vision AI to find and interact
  with visual elements on screen. Ideal for automating native applications.
examples:
  - input: "take a screenshot"
    action: screenshot
  - input: "click at 500 300"
    action: click
  - input: "visual-click the Settings icon"
    action: visual-click
---

# Computer Use Skill

Desktop-level automation with screenshot, mouse, keyboard, and Vision AI.

## Usage

```
/computer-use <action> [args]
```

## Actions

| Action         | Description                       | Example                                        |
| -------------- | --------------------------------- | ---------------------------------------------- |
| `screenshot`   | Capture full screen               | `/computer-use screenshot`                     |
| `click`        | Click at pixel coordinates        | `/computer-use click 500 300`                  |
| `type`         | Type text via keyboard            | `/computer-use type "Hello World"`             |
| `visual-click` | Click element found by Vision AI  | `/computer-use visual-click "Settings button"` |
| `analyze`      | Analyze screenshot with Vision AI | `/computer-use analyze "What's on screen?"`    |
| `key`          | Press keyboard shortcut           | `/computer-use key ctrl+c`                     |
| `move`         | Move mouse to coordinates         | `/computer-use move 400 200`                   |

## Vision AI Integration

The skill can use Vision AI (Claude/GPT-4V/LLaVA) to:

- Find UI elements by visual description
- Analyze screen content
- Identify clickable targets without knowing coordinates
