---
name: chat-template
display-name: Chat Template
description: Generate conversation prompt templates for different use cases
version: 1.0.0
category: general
user-invocable: true
tags: [prompt, template, conversation]
os: [android, win32, darwin, linux]
input-schema:
  - name: input
    type: string
    description: Description of the desired prompt template
    required: true
execution-mode: local
---

# Chat Template Skill

Generates optimized prompt templates for different AI conversation scenarios.

## Usage

```
/chat-template [description of what you need]
```

## Template Types

- System prompts for specific roles
- Few-shot example templates
- Chain-of-thought prompts
- Structured output prompts

## Examples

```
/chat-template Create a prompt for an AI code reviewer that outputs structured JSON
```
