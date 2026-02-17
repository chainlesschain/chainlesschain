---
name: quick-note
display-name: Quick Note
description: Capture ideas and thoughts with AI auto-categorization and tagging
version: 1.0.0
category: productivity
user-invocable: true
tags: [note, capture, organize, productivity]
os: [android]
handler: QuickNoteHandler
execution-mode: local
input-schema:
  - name: text
    type: string
    description: The note content to capture
    required: true
  - name: category
    type: string
    description: Optional category hint (idea, task, reminder, reference)
    required: false
---

# Quick Note Skill

Capture thoughts, ideas, and notes on the go. The AI automatically categorizes, tags, and summarizes your note for easy retrieval later.

## Usage

```
/quick-note [your note content]
```

## Options

- `--category <category>` - Hint category: idea, task, reminder, reference (auto-detected if omitted)

## Examples

```
/quick-note Meeting with Bob at 3pm about Q3 budget review
```

```
/quick-note --category idea Build a habit tracker with weekly progress charts
```
