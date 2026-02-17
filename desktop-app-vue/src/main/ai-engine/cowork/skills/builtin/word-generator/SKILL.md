---
name: word-generator
display-name: Word Generator
description: Word文档生成（从Markdown/模板创建DOCX、段落/标题/列表/表格）
version: 1.0.0
category: document
user-invocable: true
tags: [word, docx, document, generate, template, markdown-to-word]
capabilities: [word_create, word_from_markdown, word_from_template, word_read]
tools:
  - word_create
  - word_from_markdown
  - word_read
instructions: |
  Use this skill to generate Word (DOCX) documents. Can create documents from
  Markdown content, structured data, or templates. Supports headings, paragraphs,
  bullet lists, numbered lists, tables, and basic formatting (bold, italic).
  Uses the docx library for generation and mammoth for reading.
examples:
  - input: "/word-generator --from-md README.md --output report.docx"
    output: "Generated Word document from Markdown (12 pages)"
  - input: "/word-generator --create --title \"Report\" --content \"# Introduction\\nThis is...\" --output report.docx"
    output: "Created report.docx with 3 sections"
  - input: "/word-generator --read document.docx"
    output: "Read document: 5 pages, 2340 words"
dependencies: []
os: [win32, darwin, linux]
author: ChainlessChain
handler: ./handler.js
supported-file-types: [.docx, .doc, .md, .txt]
---

# Word Generator

Word 文档生成技能，基于 docx + mammoth 库。

## 功能

| 操作     | 命令                                                     | 说明             |
| -------- | -------------------------------------------------------- | ---------------- |
| 从MD生成 | `--from-md <file.md> --output <file.docx>`               | Markdown 转 Word |
| 创建     | `--create --title "..." --content "..." --output <file>` | 从内容创建       |
| 读取     | `--read <file.docx>`                                     | 读取Word文档内容 |
