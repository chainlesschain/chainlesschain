---
name: doc-coauthoring
display-name: Doc Co-authoring
description: Collaborative documentation writing with drafting, expanding, and restructuring
version: 1.0.0
category: documentation
user-invocable: true
tags: [documentation, writing, collaboration, technical-writing]
capabilities:
  [drafting, expanding, reviewing, restructuring, glossary-generation]
os: [win32, darwin, linux]
handler: ./handler.js
---

# Doc Co-authoring Skill

Write and improve documentation iteratively with structured drafting and review workflows.

## Usage

```
/doc-coauthoring [mode] [topic or file path]
```

## Modes

- **draft** (default) - Create an initial documentation draft
- **expand** - Expand a section with more detail
- **review** - Review and suggest improvements
- **structure** - Restructure document organization
- **glossary** - Generate a glossary from document content

## Examples

```
/doc-coauthoring draft API authentication guide
/doc-coauthoring expand src/docs/setup.md#installation
/doc-coauthoring review docs/architecture.md
/doc-coauthoring structure docs/user-guide.md
/doc-coauthoring glossary docs/technical-spec.md
```

## Output

Polished documentation with structure, cross-references, and consistent formatting.
