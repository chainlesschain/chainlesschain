---
name: humanizer
display-name: Text Humanizer
description: Remove AI writing traces - rewrite text to sound more natural and human, adjust tone, add personality, and reduce repetitive AI patterns
version: 1.2.0
category: productivity
user-invocable: true
tags: [writing, humanize, tone, rewrite, ai-detection, natural-language, editing]
capabilities: [text-humanization, ai-pattern-detection, tone-adjustment, style-analysis]
handler: ./handler.js
os: [win32, darwin, linux]
tools: [humanize-text, analyze-text, adjust-tone]
instructions: |
  Use this skill when the user wants to make AI-generated text sound more
  natural and human-like. Can detect common AI writing patterns, rewrite
  text with more personality, and adjust tone between casual, formal,
  friendly, and professional styles.
examples:
  - input: "humanize It's important to note that leveraging AI can significantly enhance productivity"
    action: humanize
  - input: "analyze In conclusion, it is evident that this multifaceted approach delves into the tapestry of modern solutions"
    action: analyze
  - input: "adjust-tone casual The implementation of this solution necessitates careful consideration"
    action: adjust-tone
input-schema:
  type: string
  description: "Action (humanize|analyze|adjust-tone) followed by text"
output-schema:
  type: object
  properties:
    success: { type: boolean }
    action: { type: string }
    result: { type: object }
    message: { type: string }
model-hints:
  context-window: medium
  capability: text
cost: low
author: ChainlessChain
license: MIT
---

# Text Humanizer

Make AI-generated text sound more natural, human, and authentic.

## Usage

```
/humanizer humanize <text>
/humanizer analyze <text>
/humanizer adjust-tone <tone> <text>
```

## Actions

- **humanize** - Rewrite text to remove AI patterns and sound more natural
- **analyze** - Detect AI writing patterns and score text for naturalness
- **adjust-tone** - Rewrite text in a specific tone (casual, formal, friendly, professional)

## Examples

```
/humanizer humanize "It's important to note that leveraging AI can enhance productivity"
/humanizer analyze "In conclusion, this multifaceted approach delves into the tapestry of innovation"
/humanizer adjust-tone casual "The implementation necessitates careful consideration of all factors"
```
