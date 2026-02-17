---
name: doc-converter
display-name: Document Converter
description: Universal document format converter - DOCX, PDF, Markdown, HTML, TXT
version: 1.0.0
category: document
user-invocable: true
tags: [document, converter, docx, pdf, markdown, html]
capabilities: [format-detection, document-conversion, batch-convert]
supported-file-types: [docx, pdf, md, html, txt]
os: [win32, darwin, linux]
handler: ./handler.js
tools:
  - file_read
  - file_write
instructions: |
  Use this skill for document format conversion between DOCX, PDF, Markdown, HTML, and TXT.
  Supports single file and batch directory conversion.
examples:
  - input: "/doc-converter --convert report.docx --to md"
    output: "Converted DOCX to Markdown format"
  - input: "/doc-converter --detect myfile.docx"
    output: "Detected format: DOCX (Microsoft Word)"
author: ChainlessChain
---

# Document Converter

Universal document format conversion between DOCX, PDF, Markdown, HTML, and TXT.

## Usage

```
/doc-converter --convert <file> --to <format>   Convert file to target format
/doc-converter --detect <file>                   Detect file format
/doc-converter --batch <dir> --to <format>       Batch convert directory
```

## Supported Conversions

| From → To | MD  | HTML | TXT | PDF |
| --------- | --- | ---- | --- | --- |
| DOCX      | ✅  | ✅   | ✅  | —   |
| Markdown  | —   | ✅   | ✅  | ✅  |
| HTML      | ✅  | —    | ✅  | ✅  |
| PDF       | —   | —    | ✅  | —   |
| TXT       | —   | —    | —   | ✅  |

## Dependencies

- `mammoth` — DOCX parsing
- `marked` — Markdown to HTML
- `pdf-parse` — PDF text extraction
