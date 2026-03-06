---
name: google-workspace
display-name: Google Workspace
description: Google Workspace integration - Gmail, Calendar, Drive operations via Google APIs
version: 1.2.0
category: productivity
user-invocable: true
tags: [google, gmail, calendar, drive, workspace, email, productivity]
capabilities: [gmail-search, gmail-send, calendar-management, drive-operations]
handler: ./handler.js
os: [win32, darwin, linux]
tools: [gmail-search, gmail-send, calendar-list, calendar-create, drive-list, drive-upload]
instructions: |
  Use this skill when the user wants to interact with Google Workspace services
  including Gmail, Google Calendar, or Google Drive. Requires GOOGLE_API_KEY
  or OAuth credentials configured in environment. Supports searching emails,
  sending messages, managing calendar events, and listing/uploading Drive files.
examples:
  - input: "gmail-search subject:invoice from:billing@example.com"
    action: gmail-search
  - input: "gmail-send to:user@example.com subject:Hello body:Hi there"
    action: gmail-send
  - input: "calendar-list --days 7"
    action: calendar-list
  - input: "calendar-create 'Team standup' 2026-03-10T09:00:00 --duration 30"
    action: calendar-create
  - input: "drive-list --folder root"
    action: drive-list
input-schema:
  type: string
  description: "Action followed by parameters (email addresses, search queries, event details)"
output-schema:
  type: object
  properties:
    success: { type: boolean }
    action: { type: string }
    results: { type: array }
    message: { type: string }
model-hints:
  context-window: small
  capability: text
cost: api-key-required
author: ChainlessChain
license: MIT
---

# Google Workspace

Interact with Gmail, Google Calendar, and Google Drive via Google APIs.

## Usage

```
/google-workspace gmail-search <query> [--max N]
/google-workspace gmail-send to:<email> subject:<subject> body:<body>
/google-workspace calendar-list [--days N]
/google-workspace calendar-create <title> <datetime> [--duration minutes]
/google-workspace drive-list [--folder <folderId>] [--max N]
/google-workspace drive-upload <filepath> [--folder <folderId>]
```

## Actions

| Action | Description |
| --- | --- |
| `gmail-search` | Search Gmail messages by query |
| `gmail-send` | Send an email via Gmail |
| `calendar-list` | List upcoming calendar events |
| `calendar-create` | Create a new calendar event |
| `drive-list` | List files in Google Drive |
| `drive-upload` | Upload a file to Google Drive |

## Setup

Set one of the following environment variables:

```bash
export GOOGLE_API_KEY=your-api-key
# or
export GOOGLE_CLIENT_ID=your-client-id
export GOOGLE_CLIENT_SECRET=your-client-secret
export GOOGLE_REFRESH_TOKEN=your-refresh-token
```

## Examples

- Search emails: `/google-workspace gmail-search from:boss@company.com has:attachment`
- List events: `/google-workspace calendar-list --days 14`
- List Drive files: `/google-workspace drive-list --max 20`
