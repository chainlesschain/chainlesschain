---
name: doc-comparator
display-name: Document Comparator
description: Compare documents - text diff, structural comparison, change summary
version: 1.0.0
category: document
user-invocable: true
tags: [document, compare, diff, changes]
capabilities: [text-diff, structural-comparison, change-summary]
supported-file-types: [txt, md, docx, pdf, html]
os: [win32, darwin, linux]
handler: ./handler.js
tools:
  - file_read
instructions: |
  Use this skill to compare two documents and identify differences.
  Supports text files, Markdown, DOCX, PDF, and HTML.
examples:
  - input: "/doc-comparator --compare old.md new.md"
    output: "Diff summary: 5 additions, 3 deletions, 89% similarity"
  - input: "/doc-comparator --compare doc1.docx doc2.docx --format json"
    output: "Structured JSON diff with line-level changes"
author: ChainlessChain
---

# Document Comparator

Compare two documents to identify text differences, structural changes, and similarity.

## Usage

```
/doc-comparator --compare <file1> <file2> [--format text|json|html]
/doc-comparator --summary <file1> <file2>
```

## Supported Formats

- **Text/Markdown**: Line-by-line comparison
- **DOCX**: Extracts text via mammoth, then compares
- **PDF**: Extracts text via pdf-parse, then compares
- **HTML**: Strips tags, then compares text content

## Output Formats

- **text** (default): Unified diff format
- **json**: Structured change objects
- **html**: HTML with highlighted changes

## Dependencies

- `mammoth` — DOCX text extraction
- `pdf-parse` — PDF text extraction
