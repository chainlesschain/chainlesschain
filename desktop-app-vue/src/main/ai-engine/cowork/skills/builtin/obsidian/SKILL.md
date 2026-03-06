---
name: obsidian
display-name: Obsidian Vault Manager
description: Obsidian vault operations - create notes, search vault, manage tags, link notes, and sync with Obsidian markdown files
version: 1.2.0
category: knowledge
user-invocable: true
tags: [obsidian, notes, markdown, vault, knowledge, tags, links, zettelkasten]
capabilities: [note-creation, content-search, tag-management, note-linking, recent-notes]
handler: ./handler.js
os: [win32, darwin, linux]
tools: [obsidian-create, obsidian-search, obsidian-tags, obsidian-link, obsidian-recent]
instructions: |
  Use this skill when the user wants to work with their Obsidian vault.
  Supports creating notes, searching by content or title, listing tags,
  finding or creating links between notes, and listing recent notes.
  Detects vault path from OBSIDIAN_VAULT_PATH env var or common locations.
examples:
  - input: "create-note 'Daily Log' --content 'Today I worked on...'"
    action: create-note
  - input: "search machine learning"
    action: search
  - input: "list-tags"
    action: list-tags
  - input: "link-notes 'Note A' 'Note B'"
    action: link-notes
  - input: "list-recent --limit 10"
    action: list-recent
input-schema:
  type: string
  description: "Action (create-note|search|list-tags|link-notes|list-recent) followed by arguments"
output-schema:
  type: object
  properties:
    success: { type: boolean }
    action: { type: string }
    result: { type: object }
    message: { type: string }
model-hints:
  context-window: small
  capability: text
cost: low
author: ChainlessChain
license: MIT
---

# Obsidian Vault Manager

Manage your Obsidian vault directly - create notes, search, tag, and link.

## Usage

```
/obsidian create-note <title> [--content <text>] [--folder <subfolder>] [--tags tag1,tag2]
/obsidian search <query> [--limit <n>]
/obsidian list-tags [--sort count|alpha]
/obsidian link-notes <source-title> <target-title>
/obsidian list-recent [--limit <n>]
```

## Actions

- **create-note** - Create a new markdown file in the vault
- **search** - Search notes by title or content
- **list-tags** - Extract and list all tags across the vault
- **link-notes** - Find or create wiki-links between notes
- **list-recent** - List recently modified notes

## Examples

```
/obsidian create-note "Meeting Notes 2024" --tags meeting,work --content "Attendees: ..."
/obsidian search "project roadmap"
/obsidian list-tags --sort count
/obsidian link-notes "React Patterns" "Frontend Architecture"
/obsidian list-recent --limit 5
```
