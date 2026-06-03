---
name: find-skills
display-name: Find Skills
description: Discover and recommend skills from the registry based on task requirements - search installed skills, suggest matching skills for current task, and browse skill categories
version: 1.0.0
category: system
user-invocable: true
tags: [skills, discovery, recommendation, search, registry, help]
capabilities: [skill-search, skill-recommendation, category-browse, skill-info]
handler: ./handler.js
os: [win32, darwin, linux]
tools: [skill-search, skill-recommend, skill-info, skill-categories]
instructions: |
  Use this skill when the user wants to find available skills, needs help
  choosing the right skill for a task, or wants to browse skill categories.
  Searches through the skill registry matching by name, tags, description,
  and capabilities. Can also recommend skills based on task description.
examples:
  - input: "find skills for code review"
    action: search
  - input: "what skill should I use for testing?"
    action: recommend
  - input: "list all automation skills"
    action: category
  - input: "show info about browser-automation"
    action: info
input-schema:
  type: object
  properties:
    mode:
      type: string
      enum: [search, recommend, category, info]
    query:
      type: string
output-schema:
  type: object
  properties:
    skills: { type: array }
    skillCount: { type: number }
    categories: { type: object }
author: ChainlessChain
license: MIT
---

# Find Skills

Discover and explore available skills in the registry.

## Usage

```
/find-skills <keyword>
/find-skills recommend <task description>
/find-skills category <category-name>
/find-skills info <skill-name>
```

## Modes

| Mode | Description | Example |
| --- | --- | --- |
| `search` (default) | Keyword search across names, tags, descriptions | `/find-skills browser` |
| `recommend` | Task-based skill recommendation | `/find-skills recommend "I need to test my API"` |
| `category` | Browse skills by category | `/find-skills category automation` |
| `info` | Show detailed info about a skill | `/find-skills info smart-search` |

## How Matching Works

- **Search**: Matches against skill name, tags, description, and capabilities
- **Recommend**: Analyzes task description and scores skills by relevance
- **Category**: Groups skills by their category field (knowledge, automation, development, etc.)

## Skill Categories

| Category | Examples |
| --- | --- |
| `knowledge` | smart-search, research-agent, codebase-qa |
| `automation` | workflow-automation, browser-automation, proactive-agent |
| `development` | code-review, test-generator, refactor |
| `system` | find-skills, skill-creator, rules-engine |
| `media` | video-toolkit, image-editor, audio-transcriber |
| `productivity` | planning-with-files, content-publisher, pptx-creator |
