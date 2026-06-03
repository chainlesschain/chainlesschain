---
name: pc-file-search
display-name: PC File Search
description: Search files and knowledge on the connected PC
version: 1.0.0
category: remote
user-invocable: true
tags: [remote, search, files, pc]
os: [android]
execution-mode: remote
remote-skill-name: smart-search
input-schema:
  - name: query
    type: string
    description: Search query terms
    required: true
---

# PC File Search Skill

Search files and knowledge base content on your connected desktop PC using hybrid search (vector + keyword).

## Usage

```
/pc-file-search [search terms]
```

## Examples

```
/pc-file-search API authentication implementation
```

## Requirements

- Active P2P connection to a desktop running ChainlessChain
