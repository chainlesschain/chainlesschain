---
name: webapp-testing
display-name: WebApp Testing
description: Test local web applications using browser automation - verify frontend functionality, debug UI behavior, capture screenshots, view console logs, run E2E scenarios, and check accessibility
version: 1.0.0
category: development
user-invocable: true
tags: [testing, webapp, e2e, browser, ui, screenshot, automation, accessibility]
capabilities:
  [
    ui-testing,
    screenshot-capture,
    console-logging,
    form-testing,
    e2e-scenarios,
    accessibility-check,
  ]
handler: ./handler.js
os: [win32, darwin, linux]
tools:
  [
    webapp-test-run,
    webapp-screenshot,
    webapp-console,
    webapp-accessibility,
    webapp-scenario,
  ]
dependencies: [browser-automation]
requires:
  bins: [node]
instructions: |
  Use this skill when the user needs to test a web application. Supports
  testing local dev servers, capturing screenshots, checking console logs,
  running E2E scenarios, and accessibility checks. Uses the reconnaissance-
  then-action pattern: navigate → wait for networkidle → inspect DOM →
  identify selectors → execute actions.
examples:
  - input: "test the login page at localhost:5173"
    action: test
  - input: "screenshot the dashboard page"
    action: screenshot
  - input: "check console errors on the settings page"
    action: console
  - input: "run accessibility check on the form"
    action: accessibility
author: ChainlessChain
license: MIT
---

# WebApp Testing Skill

Test web applications with browser automation.

## Usage

```
/webapp-testing test <url> [--check selectors|forms|links]
/webapp-testing screenshot <url> [--full]
/webapp-testing console <url>
/webapp-testing accessibility <url>
/webapp-testing scenario <url> --steps "click .btn, fill #email test@example.com, click #submit"
/webapp-testing inspect <url>
```

## Decision Tree

```
Task → Is it static HTML?
  ├─ Yes → Read HTML directly, identify selectors, write tests
  └─ No (dynamic webapp) → Is server running?
    ├─ No → Start server first, then test
    └─ Yes → Reconnaissance-then-action:
        1. Navigate and wait for networkidle
        2. Take screenshot or inspect DOM
        3. Identify selectors from rendered state
        4. Execute actions with discovered selectors
```

## Actions

| Action | Description |
| --- | --- |
| `test` | Navigate to URL, wait for load, check for errors |
| `screenshot` | Capture full page or element screenshot |
| `console` | Monitor and report console logs/errors |
| `accessibility` | Run basic accessibility checks |
| `scenario` | Execute multi-step test scenario |
| `inspect` | Get DOM structure and interactive elements |

## Reconnaissance-Then-Action Pattern

1. **Navigate**: Go to URL and wait for `networkidle`
2. **Inspect**: Take screenshot or read DOM
3. **Identify**: Find selectors from rendered state
4. **Execute**: Run actions with discovered selectors

## Accessibility Checks

- Alt text on images
- Form labels on inputs
- Heading hierarchy (h1 → h2 → h3)
- Color contrast indicators
- ARIA roles on interactive elements
- Keyboard navigation support

## Common Pitfall

- **Don't** inspect DOM before waiting for `networkidle` on dynamic apps
- **Do** wait for `page.wait_for_load_state('networkidle')` before inspection
