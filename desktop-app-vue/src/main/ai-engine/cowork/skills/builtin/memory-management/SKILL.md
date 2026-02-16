---
name: memory-management
display-name: Memory Management
description: Manage persistent memory - save notes, search knowledge, review daily logs, extract insights across sessions
version: 1.0.0
category: knowledge
user-invocable: true
tags: [memory, knowledge, notes, search, daily-notes, recall]
capabilities: [memory-write, memory-search, daily-notes, knowledge-extraction]
handler: ./handler.js
os: [win32, darwin, linux]
tools:
  [memory-write, memory-search, memory-read-daily, memory-extract, memory-stats]
instructions: |
  Use this skill when the user wants to save information for later recall,
  search their knowledge base, review daily activity logs, or extract
  insights from conversations. Supports writing daily notes, appending
  to long-term MEMORY.md, hybrid search (vector + BM25), and statistics.
examples:
  - input: "Remember that the API key format changed to v2"
    action: save
  - input: "What do I know about WebRTC configuration?"
    action: search
  - input: "Show me yesterday's notes"
    action: review
---

# Memory Management Skill

Manage persistent cross-session memory using the Permanent Memory system.

## Usage

```
/memory-management <action> [content]
```

## Actions

| Action              | Description                                  | Example                                        |
| ------------------- | -------------------------------------------- | ---------------------------------------------- |
| `save` / `remember` | Save information to daily notes or MEMORY.md | `/memory-management save API key format is v2` |
| `search` / `recall` | Search knowledge base (hybrid vector+BM25)   | `/memory-management search WebRTC config`      |
| `review`            | Review daily notes for a date                | `/memory-management review 2024-01-15`         |
| `extract`           | Extract insights from current conversation   | `/memory-management extract`                   |
| `stats`             | Show memory usage statistics                 | `/memory-management stats`                     |

## How It Works

- **Save**: Appends to daily notes (`daily/YYYY-MM-DD.md`) or long-term memory (`MEMORY.md`)
- **Search**: Uses hybrid search combining vector similarity (60%) and BM25 keyword matching (40%)
- **Review**: Reads daily notes for specified date (defaults to today)
- **Extract**: Analyzes conversation context and extracts key insights to memory
- **Stats**: Reports memory file counts, index size, and search performance
