---
name: notion
display-name: Notion Integration
description: Notion API integration - create pages, query databases, manage blocks, and sync content with Notion workspace
version: 1.2.0
category: productivity
user-invocable: true
tags: [notion, productivity, wiki, database, pages, blocks, workspace]
capabilities: [page-creation, database-query, content-search, block-management, page-updates]
handler: ./handler.js
os: [win32, darwin, linux]
tools: [notion-search, notion-create, notion-query, notion-update]
instructions: |
  Use this skill when the user wants to interact with their Notion workspace.
  Supports searching pages, creating new pages, querying databases,
  retrieving page content, and updating existing pages.
  Requires NOTION_API_KEY environment variable to be set.
examples:
  - input: "search for meeting notes in Notion"
    action: search
  - input: "create-page 'Weekly Standup' with content 'Action items from today'"
    action: create-page
  - input: "query-db abc123 --filter status=Done"
    action: query-db
  - input: "get-page page-id-here"
    action: get-page
  - input: "update-page page-id title='New Title'"
    action: update-page
input-schema:
  type: string
  description: "Action (search|create-page|query-db|get-page|update-page) followed by arguments"
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

# Notion Integration

Connect to your Notion workspace to create, search, and manage content.

## Usage

```
/notion search <query>
/notion create-page <title> [--parent <page-id>] [--content <text>]
/notion query-db <database-id> [--filter key=value] [--sort field]
/notion get-page <page-id>
/notion update-page <page-id> [title=<new-title>] [--content <text>]
```

## Actions

- **search** - Search across all pages and databases in the workspace
- **create-page** - Create a new page with title and optional content
- **query-db** - Query a Notion database with optional filters and sorting
- **get-page** - Retrieve full content of a page by ID
- **update-page** - Update page title or content

## Examples

```
/notion search "project roadmap"
/notion create-page "Sprint Planning" --content "Goals for this sprint"
/notion query-db 8a3b1c2d --filter status=In Progress --sort updated
/notion get-page abc123def
/notion update-page abc123def title="Updated Title"
```
