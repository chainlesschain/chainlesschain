---
name: cursor-rules-generator
display-name: Cursor Rules Generator
description: Generate IDE rules and configuration files - .cursorrules, .clinerules, CLAUDE.md, .windsurfrules, and other AI coding assistant configuration for consistent project conventions
version: 1.0.0
category: development
user-invocable: true
tags: [cursor, ide, rules, configuration, conventions, codestyle, assistant-config]
capabilities: [rules-generation, project-analysis, convention-detection, config-export]
handler: ./handler.js
os: [win32, darwin, linux]
tools: [rules-generate, rules-detect, rules-export]
instructions: |
  Use this skill when the user wants to generate AI assistant
  configuration files for their project. Analyzes project structure
  and conventions to produce rules files for Cursor, Cline, Claude
  Code, Windsurf, and other AI coding tools.
examples:
  - input: "generate cursorrules for this project"
    action: generate
  - input: "detect conventions in src/"
    action: detect
  - input: "export rules as .clinerules"
    action: export
input-schema:
  type: string
  description: "Action (generate|detect|export) followed by target format or path"
output-schema:
  type: object
  properties:
    success: { type: boolean }
    action: { type: string }
    rules: { type: string }
    conventions: { type: array }
    message: { type: string }
model-hints:
  context-window: medium
  capability: text
cost: low
author: ChainlessChain
license: MIT
---

# Cursor Rules Generator

Generate AI coding assistant configuration from project analysis.

## Usage

```
/cursor-rules-generator generate [cursor|cline|claude|windsurf]
/cursor-rules-generator detect [path]
/cursor-rules-generator export <format> [--output <file>]
```

## Supported Formats

- `.cursorrules` - Cursor AI
- `.clinerules` - Cline
- `CLAUDE.md` - Claude Code
- `.windsurfrules` - Windsurf
- `.github/copilot-instructions.md` - GitHub Copilot

## Detected Conventions

Package manager, framework, language, testing framework, code style, commit format, directory structure, naming patterns
