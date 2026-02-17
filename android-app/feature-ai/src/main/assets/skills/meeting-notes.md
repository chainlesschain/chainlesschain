---
name: meeting-notes
display-name: Meeting Notes
description: Structure raw meeting notes into organized agenda, decisions, and action items
version: 1.0.0
category: productivity
user-invocable: true
tags: [meeting, notes, organize, productivity]
os: [android]
handler: MeetingNotesHandler
execution-mode: local
input-schema:
  - name: text
    type: string
    description: Raw meeting notes or transcript
    required: true
---

# Meeting Notes Skill

Transform raw meeting notes or transcripts into well-structured documents with attendees, agenda items, key decisions, action items, and next steps.

## Usage

```
/meeting-notes [raw meeting notes or transcript]
```

## Examples

```
/meeting-notes Bob and Alice discussed the Q3 roadmap. Decided to prioritize mobile app. Bob will create wireframes by Friday. Next sync on Monday.
```
