---
name: agent-browser
display-name: Agent Browser
description: Advanced browser automation for AI agents with snapshot-ref interaction pattern - navigate, snapshot interactive elements with refs, click/fill/select by refs, manage sessions, and extract structured data
version: 1.0.0
category: automation
user-invocable: true
tags: [browser, agent, automation, snapshot, form, screenshot, session, ref]
capabilities:
  [
    snapshot-navigation,
    ref-interaction,
    session-management,
    form-automation,
    data-extraction,
    screenshot-capture,
    state-persistence,
  ]
handler: ./handler.js
os: [win32, darwin, linux]
tools:
  [
    agent-browse,
    agent-snapshot,
    agent-click,
    agent-fill,
    agent-screenshot,
    agent-extract,
    agent-wait,
    agent-session,
  ]
dependencies: [browser-automation, computer-use]
instructions: |
  Use this skill for advanced browser automation with the snapshot-ref pattern:
  1. Navigate to URL  2. Snapshot to get element refs (@e1, @e2...)
  3. Interact using refs  4. Re-snapshot after DOM changes.
  Supports session persistence, form filling, data extraction, and screenshots.
  Integrates with the built-in browser engine and Computer Use agent.
examples:
  - input: "open https://example.com and snapshot"
    action: open
  - input: "fill @e1 with user@example.com"
    action: fill
  - input: "click @e3 and wait for navigation"
    action: click
  - input: "screenshot the current page"
    action: screenshot
author: ChainlessChain
license: MIT
---

# Agent Browser Skill

Advanced browser automation using the snapshot-ref interaction pattern.

## Core Workflow

Every browser automation follows this pattern:

1. **Navigate**: `open <url>`
2. **Snapshot**: Get interactive elements with refs (`@e1`, `@e2`, ...)
3. **Interact**: Use refs to click, fill, select
4. **Re-snapshot**: After DOM changes, get fresh refs

```
/agent-browser open https://example.com
/agent-browser snapshot
# Output: @e1 [input email], @e2 [input password], @e3 [button] "Login"
/agent-browser fill @e1 "user@example.com"
/agent-browser fill @e2 "secret"
/agent-browser click @e3
/agent-browser snapshot   # Check result
```

## Commands

| Command | Description | Example |
| --- | --- | --- |
| `open` | Navigate to URL | `open https://example.com` |
| `snapshot` | Get interactive elements with refs | `snapshot` |
| `click` | Click element by ref | `click @e1` |
| `fill` | Clear and type into element | `fill @e2 "text"` |
| `type` | Type without clearing | `type @e2 "text"` |
| `select` | Select dropdown option | `select @e3 "option"` |
| `screenshot` | Capture page screenshot | `screenshot` |
| `extract` | Extract text/data from element | `extract @e5` |
| `wait` | Wait for element or condition | `wait @e1` or `wait 2000` |

## Session Management

```
/agent-browser session-save auth.json     # Save cookies/state
/agent-browser session-load auth.json     # Restore state
```

## Common Patterns

### Form Submission

```
open https://example.com/signup → snapshot → fill fields → click submit → snapshot
```

### Data Extraction

```
open <url> → snapshot → extract @e5 → extract body
```

### Multi-Page Navigation

```
open <url> → snapshot → click @link → wait → snapshot → repeat
```

## Element Refs

- Refs like `@e1`, `@e2` are assigned by snapshot to interactive elements
- Refs are reset on each new snapshot
- Use descriptive selectors as fallback: `click "Login button"`
