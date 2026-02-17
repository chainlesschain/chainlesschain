---
name: email-draft
display-name: Email Draft
description: Draft professional emails with customizable tone and format
version: 1.0.0
category: productivity
user-invocable: true
tags: [email, draft, writing, productivity]
os: [android]
handler: EmailDraftHandler
execution-mode: local
input-schema:
  - name: text
    type: string
    description: Brief description of the email to draft
    required: true
  - name: to
    type: string
    description: Recipient name or role
    required: false
  - name: tone
    type: string
    description: Email tone (formal, casual, friendly)
    required: false
---

# Email Draft Skill

Draft polished, professional emails from a brief description. Supports different tones and automatically generates subject lines.

## Usage

```
/email-draft [brief description of the email]
```

## Options

- `--to <recipient>` - Recipient name or role
- `--tone <tone>` - Email tone: formal, casual, friendly (default: formal)

## Examples

```
/email-draft --to=Bob --tone=formal Invite to quarterly review meeting next Tuesday
```

```
/email-draft --tone=casual Thanks for helping with the deployment last night
```
