---
name: text-improver
display-name: Text Improver
description: Polish text for grammar, clarity, and tone
version: 1.0.0
category: productivity
user-invocable: true
tags: [writing, grammar, polish, productivity]
os: [android]
handler: TextImproverHandler
execution-mode: local
input-schema:
  - name: text
    type: string
    description: The text to improve
    required: true
  - name: style
    type: string
    description: Target style (formal, casual, concise, academic)
    required: false
---

# Text Improver Skill

Improve text for grammar, clarity, and tone. Supports different target styles and explains the changes made.

## Usage

```
/text-improver [text to improve]
```

## Options

- `--style <style>` - Target style: formal, casual, concise, academic (default: formal)

## Examples

```
/text-improver --style=concise The thing is that we need to basically figure out what we want to do about the problem with the server that keeps crashing
```

```
/text-improver --style=formal hey bob can u send me the report asap thx
```
