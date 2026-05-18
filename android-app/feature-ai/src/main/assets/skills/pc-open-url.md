---
name: pc-open-url
display-name: PC Open URL
description: Open a URL in the PC browser
version: 1.0.0
category: remote
user-invocable: true
tags: [remote, browser, url, pc]
os: [android]
execution-mode: remote
remote-skill-name: browser-automation
input-schema:
  - name: url
    type: string
    description: The URL to open
    required: true
---

# PC Open URL Skill

Open a URL in the browser on your connected desktop PC.

## Usage

```
/pc-open-url [url]
```

## Examples

```
/pc-open-url https://github.com/my-org/my-repo/pull/42
```

## Requirements

- Active P2P connection to a desktop running ChainlessChain
