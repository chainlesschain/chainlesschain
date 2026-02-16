---
name: browser-automation
display-name: Browser Automation
description: Automate browser tasks - navigate, click, type, fill forms, extract data, take screenshots
version: 1.0.0
category: automation
user-invocable: true
tags: [browser, automation, web, form, screenshot, scraping]
capabilities: [browser-control, form-fill, data-extraction, screenshot]
handler: ./handler.js
os: [win32, darwin, linux]
tools:
  [
    browser-navigate,
    browser-click,
    browser-type,
    browser-screenshot,
    browser-fill-form,
    browser-extract,
  ]
instructions: |
  Use this skill when the user needs to automate browser interactions such as
  navigating to URLs, clicking elements, typing text, filling forms, extracting
  page data, or taking screenshots. Works with the built-in browser engine.
examples:
  - input: "navigate to https://example.com"
    action: navigate
  - input: "screenshot the current page"
    action: screenshot
  - input: "click the login button"
    action: click
---

# Browser Automation Skill

Automate browser tasks using the built-in browser engine and Computer Use agent.

## Usage

```
/browser-automation <action> [target] [options]
```

## Actions

| Action       | Description                    | Example                                                          |
| ------------ | ------------------------------ | ---------------------------------------------------------------- |
| `navigate`   | Navigate to a URL              | `/browser-automation navigate https://example.com`               |
| `click`      | Click an element               | `/browser-automation click "Login button"`                       |
| `type`       | Type text into focused element | `/browser-automation type "Hello world"`                         |
| `screenshot` | Capture page screenshot        | `/browser-automation screenshot`                                 |
| `fill-form`  | Auto-fill a form               | `/browser-automation fill-form name=John email=john@example.com` |
| `extract`    | Extract page data              | `/browser-automation extract tables`                             |

## Features

- **Smart Element Location**: XPath, CSS selectors, text content, visual matching
- **Form Automation**: Auto-detect and fill form fields
- **Data Extraction**: Tables, lists, structured content
- **Screenshots**: Full page and element-level capture
- **Template Actions**: Pre-built automation templates
